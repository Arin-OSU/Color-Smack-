"""
scripts/train_all.py — LightGBM per (building, utility) with percentile cutpoints.

Produces:
  models/{building_id}__{utility}.txt           LightGBM Booster text
  meta/{building_id}__{utility}.json            training + cutpoints metadata
  meta/cutpoint_histogram.txt                   distribution of p99.8 cutpoints
  meta/training_summary.json                    global counts + timing

Percentile approach (replaces MAD z-score): we fit the model on the train
split, compute |residuals| on the validation split, and store 21 quantile
cutpoints of that distribution (p50 .. p99.9). At inference, the UI says
"p99.7 of this building's normal error," not "z = 5.2."

Run:
    python scripts/train_all.py
    python scripts/train_all.py --n-jobs 4
    python scripts/train_all.py --limit 50         # first N pairs, smoke test
    python scripts/train_all.py --only 44073:electricity
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
    load_dotenv(".env.example")
except ImportError:
    pass

import duckdb
import lightgbm as lgb
import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from tqdm import tqdm

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from features import (
    FEATURE_COLS,
    CATEGORICAL_COLS,
    add_features,
    build_pair_frame,
    split_train_valid_replay,
    target_series,
)

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
META = ROOT / "meta"

PARAMS: dict[str, Any] = {
    "objective": "regression",
    "metric": ["l2", "l1"],
    "num_leaves": 31,
    "max_depth": -1,
    "learning_rate": 0.05,
    "min_data_in_leaf": 50,
    "feature_fraction": 0.9,
    "bagging_fraction": 0.8,
    "bagging_freq": 5,
    "lambda_l1": 0.1,
    "lambda_l2": 0.1,
    "verbose": -1,
    "seed": 42,
}
NUM_BOOST_ROUND = 2000
EARLY_STOPPING = 50

QUANTILES: list[float] = [
    0.50, 0.75, 0.85, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98,
    0.985, 0.99, 0.991, 0.992, 0.993, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999,
]
SEVERITY_LOW = 0.95
SEVERITY_MEDIUM = 0.99
SEVERITY_HIGH = 0.995


@dataclass
class PairResult:
    building_id: int
    utility: str
    status: str
    reason: str | None = None


# ---------- IO helpers ----------

def ensure_dirs() -> None:
    MODELS.mkdir(parents=True, exist_ok=True)
    META.mkdir(parents=True, exist_ok=True)


def meta_path(building_id: int, utility: str) -> Path:
    return META / f"{building_id}__{utility}.json"


def model_path(building_id: int, utility: str) -> Path:
    return MODELS / f"{building_id}__{utility}.txt"


def write_meta(payload: dict[str, Any]) -> None:
    p = meta_path(payload["building_id"], payload["utility"])
    p.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


# ---------- DuckDB loaders ----------

def load_pairs(con: duckdb.DuckDBPyConnection) -> list[tuple[int, str]]:
    rows = con.execute(
        "SELECT DISTINCT siteid, utility FROM v_readings "
        "WHERE siteid IS NOT NULL AND utility IS NOT NULL "
        "ORDER BY siteid, utility"
    ).fetchall()
    return [(int(a), str(b)) for a, b in rows]


def load_pair_data(
    con: duckdb.DuckDBPyConnection, building_id: int, utility: str
) -> pd.DataFrame:
    return con.execute(
        """
        SELECT reading_time, readingvalue
        FROM v_readings
        WHERE siteid = ? AND utility = ?
        ORDER BY reading_time
        """,
        [building_id, utility],
    ).df()


def load_buildings(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    try:
        return con.execute("SELECT * FROM v_buildings").df()
    except Exception:
        return pd.DataFrame()


def load_weather(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    return con.execute("SELECT * FROM v_weather").df()


# ---------- Per-pair training ----------

def _compute_cutpoints(abs_res: np.ndarray) -> list[float]:
    abs_res = abs_res[np.isfinite(abs_res)]
    if abs_res.size == 0:
        return [float(q) for q in QUANTILES]
    cut = np.quantile(abs_res, QUANTILES).tolist()
    if not np.any(np.diff(cut) > 0):
        eps = float(abs_res.std(ddof=1) + 1e-9)
        cut = [eps * q for q in QUANTILES]
    return [float(x) for x in cut]


def train_one(
    building_id: int,
    utility: str,
    readings_df: pd.DataFrame,
    weather_df: pd.DataFrame,
    buildings_df: pd.DataFrame,
) -> PairResult:
    try:
        if readings_df.empty:
            write_meta({
                "building_id": building_id, "utility": utility,
                "status": "no_data", "reason": "empty_readings",
            })
            return PairResult(building_id, utility, "no_data", "empty_readings")

        frame = build_pair_frame(readings_df, weather_df, buildings_df, building_id, utility)
        if frame.empty or frame["gross_area"].isna().all() or (frame["gross_area"] == 0).all():
            write_meta({
                "building_id": building_id, "utility": utility,
                "status": "no_data", "reason": "no_gross_area",
            })
            return PairResult(building_id, utility, "no_data", "no_gross_area")

        frame = add_features(frame, buildings=buildings_df)
        y = target_series(frame)
        mask = y.notna()
        if int(mask.sum()) < 500:
            write_meta({
                "building_id": building_id, "utility": utility,
                "status": "pending_pool", "reason": f"n={int(mask.sum())}",
            })
            return PairResult(building_id, utility, "pending_pool", f"n={int(mask.sum())}")
        if float(y[mask].abs().sum()) == 0.0:
            write_meta({
                "building_id": building_id, "utility": utility,
                "status": "no_data", "reason": "all_zero_target",
            })
            return PairResult(building_id, utility, "no_data", "all_zero_target")

        frame = frame.loc[mask]
        y = y.loc[mask]

        splits = split_train_valid_replay(frame, y)
        X_train, y_train = splits["train"]
        X_valid, y_valid = splits["valid"]

        if len(X_valid) < 200:
            tail = max(1, int(len(X_train) * 0.1))
            X_valid = X_train.tail(tail)
            y_valid = y_train.tail(tail)
            X_train = X_train.head(len(X_train) - tail)
            y_train = y_train.head(len(y_train) - tail)

        dtrain = lgb.Dataset(
            X_train, label=y_train,
            categorical_feature=CATEGORICAL_COLS, free_raw_data=False,
        )
        dvalid = lgb.Dataset(
            X_valid, label=y_valid,
            reference=dtrain,
            categorical_feature=CATEGORICAL_COLS, free_raw_data=False,
        )

        booster = lgb.train(
            PARAMS,
            dtrain,
            num_boost_round=NUM_BOOST_ROUND,
            valid_sets=[dvalid],
            callbacks=[lgb.early_stopping(EARLY_STOPPING), lgb.log_evaluation(0)],
        )

        best_iter = booster.best_iteration or booster.current_iteration()
        preds = booster.predict(X_valid, num_iteration=best_iter)
        residuals = np.asarray(y_valid, dtype=np.float64) - preds
        abs_res = np.abs(residuals)
        cutpoints = _compute_cutpoints(abs_res)
        valid_mae = float(np.nanmean(abs_res))

        mp = model_path(building_id, utility)
        booster.save_model(str(mp), num_iteration=best_iter)

        write_meta({
            "building_id": building_id,
            "utility": utility,
            "status": "trained",
            "model_path": str(mp.relative_to(ROOT)).replace("\\", "/"),
            "n_train": int(len(X_train)),
            "n_valid": int(len(X_valid)),
            "best_iteration": int(best_iter),
            "valid_mae": valid_mae,
            "quantiles": QUANTILES,
            "cutpoints": cutpoints,
            "severity_percentile_low": SEVERITY_LOW,
            "severity_percentile_medium": SEVERITY_MEDIUM,
            "severity_percentile_high": SEVERITY_HIGH,
            "feature_cols": FEATURE_COLS,
            "categorical_cols": CATEGORICAL_COLS,
            "trained_at": datetime.now(timezone.utc).isoformat(),
        })
        return PairResult(building_id, utility, "trained")

    except Exception as e:
        write_meta({
            "building_id": building_id, "utility": utility,
            "status": "error", "reason": f"{type(e).__name__}: {e}",
            "traceback": traceback.format_exc(),
        })
        return PairResult(building_id, utility, "error", f"{type(e).__name__}: {e}")


def _worker(
    building_id: int,
    utility: str,
    init_sql: str,
    buildings_df: pd.DataFrame,
    weather_df: pd.DataFrame,
) -> PairResult:
    con = duckdb.connect()
    con.execute(init_sql)
    try:
        readings = load_pair_data(con, building_id, utility)
    finally:
        con.close()
    return train_one(building_id, utility, readings, weather_df, buildings_df)


# ---------- Pooled fallback ----------

def _infer_type(buildings_df: pd.DataFrame, bid: int) -> str:
    row = buildings_df.loc[buildings_df["buildingnumber"] == bid]
    if row.empty:
        return "unknown"
    v = row.iloc[0].get("building_type")
    return str(v) if v else "unknown"


def run_pooled_fallback(
    con: duckdb.DuckDBPyConnection,
    buildings_df: pd.DataFrame,
    weather_df: pd.DataFrame,
) -> list[PairResult]:
    """For each (utility, building_type) with >=3 pending_pool members and any
    trained peers, fit one pooled model and assign per-building cutpoints.
    """
    pending: list[tuple[int, str]] = []
    for p in META.glob("*.json"):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if m.get("status") == "pending_pool":
            pending.append((int(m["building_id"]), str(m["utility"])))
    if not pending:
        return []

    by_group: dict[tuple[str, str], list[int]] = {}
    for bid, utility in pending:
        btype = _infer_type(buildings_df, bid)
        by_group.setdefault((utility, btype), []).append(bid)

    results: list[PairResult] = []
    for (utility, btype), bids in by_group.items():
        if len(bids) < 3:
            continue
        print(f"[pool] fit pooled {utility}/{btype} over {len(bids)} buildings ...")
        try:
            placeholders = ",".join(["?"] * len(bids))
            readings = con.execute(
                f"SELECT siteid, reading_time, readingvalue FROM v_readings "
                f"WHERE utility = ? AND siteid IN ({placeholders}) ORDER BY siteid, reading_time",
                [utility, *bids],
            ).df()
            if readings.empty:
                continue

            frames = []
            for bid in bids:
                sub = readings.loc[readings["siteid"] == bid, ["reading_time", "readingvalue"]].copy()
                if sub.empty:
                    continue
                pf = build_pair_frame(sub, weather_df, buildings_df, bid, utility)
                if pf.empty:
                    continue
                pf["_building_id"] = bid
                frames.append(pf)
            if not frames:
                continue
            merged = pd.concat(frames, ignore_index=True)
            merged = add_features(merged, buildings=buildings_df)
            y = target_series(merged)
            mask = y.notna()
            merged = merged.loc[mask]
            y = y.loc[mask]
            merged["building_id_cat"] = merged["_building_id"].astype("category")

            feat_cols = FEATURE_COLS + ["building_id_cat"]
            cat_cols = CATEGORICAL_COLS + ["building_id_cat"]
            X = merged[feat_cols]

            splits_time = pd.to_datetime(merged["reading_time"], utc=True)
            train_end = pd.Timestamp("2026-01-24", tz="UTC")
            tr = splits_time < train_end
            vm = (splits_time >= pd.Timestamp("2025-12-01", tz="UTC")) & tr
            if int(tr.sum()) < 500 or int(vm.sum()) < 200:
                continue

            dtrain = lgb.Dataset(X.loc[tr], label=y.loc[tr], categorical_feature=cat_cols, free_raw_data=False)
            dvalid = lgb.Dataset(X.loc[vm], label=y.loc[vm], reference=dtrain, categorical_feature=cat_cols, free_raw_data=False)
            booster = lgb.train(
                PARAMS, dtrain, num_boost_round=NUM_BOOST_ROUND,
                valid_sets=[dvalid],
                callbacks=[lgb.early_stopping(EARLY_STOPPING), lgb.log_evaluation(0)],
            )
            best_iter = booster.best_iteration or booster.current_iteration()

            pool_model_path = MODELS / f"pool__{utility}__{btype}.txt".replace(" ", "_")
            booster.save_model(str(pool_model_path), num_iteration=best_iter)

            for bid in bids:
                mask_b = merged["_building_id"] == bid
                if int(mask_b.sum()) < 50:
                    write_meta({
                        "building_id": bid, "utility": utility,
                        "status": "error", "reason": "pool_not_enough_rows",
                    })
                    results.append(PairResult(bid, utility, "error", "pool_not_enough_rows"))
                    continue
                X_b = merged.loc[mask_b & vm, feat_cols]
                y_b = y.loc[mask_b & vm]
                if len(X_b) < 50:
                    X_b = merged.loc[mask_b, feat_cols].tail(200)
                    y_b = y.loc[mask_b].tail(200)
                preds = booster.predict(X_b, num_iteration=best_iter)
                abs_res = np.abs(np.asarray(y_b) - preds)
                cut = _compute_cutpoints(abs_res)

                write_meta({
                    "building_id": bid,
                    "utility": utility,
                    "status": "trained",
                    "model_path": str(pool_model_path.relative_to(ROOT)).replace("\\", "/"),
                    "pooled": True,
                    "pool_key": f"{utility}/{btype}",
                    "n_train": int(tr.sum()),
                    "n_valid": int((mask_b & vm).sum()),
                    "best_iteration": int(best_iter),
                    "valid_mae": float(np.nanmean(abs_res)),
                    "quantiles": QUANTILES,
                    "cutpoints": cut,
                    "severity_percentile_low": SEVERITY_LOW,
                    "severity_percentile_medium": SEVERITY_MEDIUM,
                    "severity_percentile_high": SEVERITY_HIGH,
                    "feature_cols": feat_cols,
                    "categorical_cols": cat_cols,
                    "trained_at": datetime.now(timezone.utc).isoformat(),
                })
                results.append(PairResult(bid, utility, "trained"))
        except Exception as e:
            print(f"[pool] {utility}/{btype} failed: {e}")
            for bid in bids:
                write_meta({
                    "building_id": bid, "utility": utility,
                    "status": "error", "reason": f"pool: {type(e).__name__}: {e}",
                })
                results.append(PairResult(bid, utility, "error", str(e)))
    return results


# ---------- Main ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-jobs", type=int, default=-1)
    ap.add_argument("--limit", type=int, default=0, help="train first N pairs (smoke test)")
    ap.add_argument("--only", type=str, default="", help="building_id:utility")
    ap.add_argument("--skip-pool", action="store_true")
    args = ap.parse_args()

    ensure_dirs()
    init_sql = Path("data/raw/init.sql").read_text(encoding="utf-8")
    con = duckdb.connect()
    con.execute(init_sql)

    cols = [d[0] for d in con.execute("SELECT * FROM v_readings LIMIT 0").description]
    required = {"siteid", "utility", "reading_time", "readingvalue"}
    missing = required - set(cols)
    if missing:
        print(f"[train] Schema mismatch. Missing columns: {missing}. Actual: {cols}")
        sys.exit(2)

    buildings_df = load_buildings(con)
    weather_df = load_weather(con)

    if args.only:
        bid, util = args.only.split(":", 1)
        pairs = [(int(bid), util)]
    else:
        pairs = load_pairs(con)
        if args.limit:
            pairs = pairs[: args.limit]

    print(f"[train] {len(pairs)} pairs, n_jobs={args.n_jobs}")
    t0 = time.time()

    results = Parallel(n_jobs=args.n_jobs, backend="loky", verbose=0)(
        delayed(_worker)(bid, util, init_sql, buildings_df, weather_df)
        for bid, util in tqdm(pairs, desc="train")
    )

    if not args.skip_pool:
        pool_results = run_pooled_fallback(con, buildings_df, weather_df)
        results.extend(pool_results)

    elapsed = time.time() - t0
    counts: dict[str, int] = {}
    for r in results:
        counts[r.status] = counts.get(r.status, 0) + 1

    write_cutpoint_histogram()
    summary = {
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "total_pairs": len(pairs),
        "counts": counts,
        "elapsed_sec": elapsed,
    }
    (META / "training_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"[train] Done in {elapsed:.1f}s. Counts: {counts}")
    return 0


def write_cutpoint_histogram() -> None:
    p99_8: list[float] = []
    for p in META.glob("*.json"):
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if m.get("status") != "trained":
            continue
        cut = m.get("cutpoints") or []
        if len(cut) >= 2:
            p99_8.append(float(cut[-2]))
    if not p99_8:
        return
    arr = np.array(p99_8)
    hist, edges = np.histogram(arr, bins=20)
    lines = [f"p99.8 cutpoint histogram ({len(arr)} models)"]
    for h, (lo, hi) in zip(hist.tolist(), zip(edges[:-1], edges[1:])):
        lines.append(f"  [{lo:.5f}, {hi:.5f}]  {'#' * h} ({h})")
    (META / "cutpoint_histogram.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
