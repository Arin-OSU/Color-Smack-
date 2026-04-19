"""
scripts/export_anomalies.py — batch-score all trained models over real data,
write data/raw/anomalies.json for the frontend.

Faster than replay.py: scores every (building, utility) pair in bulk rather
than stepping through 15-minute windows. Lifecycle is derived in post-processing.

Usage:
    python scripts/export_anomalies.py
    python scripts/export_anomalies.py --top 200 --min-pct 0.95
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
if str(Path(__file__).parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).parent))

from features import FEATURE_COLS, add_features, build_pair_frame
from score import RATES_PER_KWH, _booster_cached, _percentile_of, load_meta, severity

META = ROOT / "meta"
RAW = ROOT / "data" / "raw"

MAX_GAP_MIN = 30       # merge adjacent anomalous windows within this gap (minutes)
MIN_DURATION_MIN = 15  # ignore single-reading spikes shorter than this
MIN_COST_USD = 5.0     # filter trivial anomalies
MAX_COST_USD = 50_000  # cap implausible costs from meter-unit issues


def pairs_trained() -> list[tuple[int, str]]:
    pairs = []
    for p in META.glob("*.json"):
        if p.stem in ("training_summary",):
            continue
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if m.get("status") == "trained":
            pairs.append((int(m["building_id"]), str(m["utility"])))
    return sorted(pairs)


def score_pair(
    frame: pd.DataFrame,
    meta: dict,
    building_id: int,
    gross_area: float,
) -> pd.DataFrame | None:
    feat_cols = meta["feature_cols"]

    if "building_id_cat" in feat_cols and "building_id_cat" not in frame.columns:
        frame = frame.copy()
        frame["building_id_cat"] = pd.Categorical([building_id] * len(frame))

    missing = [c for c in feat_cols if c not in frame.columns]
    if missing:
        return None

    X = frame[feat_cols].copy()
    valid = X.notna().all(axis=1) & frame["readingvalue"].notna()
    X = X[valid]
    frame = frame[valid].reset_index(drop=True)
    if X.empty:
        return None

    # Drop cumulative-meter artifacts using 10th-pct of non-zero readings as reference.
    # Multiplying by 50000 is permissive for normal variance but catches meter jumps
    # where max/min > 1e6 (e.g. steam/oil cumulative readings at 6.8e11).
    rv = frame["readingvalue"].astype(float)
    nz = rv[rv > 0]
    if len(nz) >= 10:
        ref = float(np.percentile(nz, 10))
        if ref > 0:
            sane = rv <= ref * 50_000
            frame = frame[sane].reset_index(drop=True)
            X = X[sane].reset_index(drop=True)
    if X.empty:
        return None

    booster = _booster_cached(meta["model_path"])
    preds = booster.predict(X)

    actual_per_sqft = frame["readingvalue"].astype(float).values / gross_area
    residuals = actual_per_sqft - preds
    pct = _percentile_of(
        np.abs(residuals), meta["quantiles"], meta["cutpoints"]
    )

    out = frame[["reading_time", "readingvalue"]].copy().reset_index(drop=True)
    out["predicted_kwh"] = preds * gross_area
    out["residual_kwh"] = residuals * gross_area
    out["percentile"] = pct
    return out


def group_events(
    scored: pd.DataFrame,
    building_id: int,
    utility: str,
    gross_area: float,
    building_name: str,
    meta: dict,
    min_pct: float,
) -> list[dict]:
    flagged = scored[scored["percentile"] >= min_pct].copy()
    if flagged.empty:
        return []

    flagged = flagged.sort_values("reading_time").reset_index(drop=True)
    gaps = flagged["reading_time"].diff().dt.total_seconds().div(60).fillna(0)
    flagged["event_id"] = (gaps > MAX_GAP_MIN).cumsum()

    data_end = pd.to_datetime(scored["reading_time"].max(), utc=True)
    now = datetime.now(timezone.utc).isoformat()
    events = []

    for _, ev in flagged.groupby("event_id"):
        # Add 15 min for the final reading's own window (each reading = 15-min interval)
        duration = (
            ev["reading_time"].iloc[-1] - ev["reading_time"].iloc[0]
        ).total_seconds() / 60 + 15
        if duration < MIN_DURATION_MIN:
            continue

        actual_kwh = float(ev["readingvalue"].sum())
        expected_kwh = float(ev["predicted_kwh"].sum())
        residual_kwh = float(ev["residual_kwh"].sum())
        if residual_kwh <= 0:
            continue

        rate = RATES_PER_KWH.get(utility, 0.07)
        cost = round(min(abs(residual_kwh) * rate, MAX_COST_USD), 2)
        if cost < MIN_COST_USD:
            continue

        peak_idx = ev["percentile"].idxmax()
        peak_pct = float(ev.loc[peak_idx, "percentile"])
        sev = severity(
            peak_pct,
            meta.get("severity_percentile_low", 0.95),
            meta.get("severity_percentile_medium", 0.99),
            meta.get("severity_percentile_high", 0.995),
        ) or "low"

        first_t = pd.to_datetime(ev["reading_time"].iloc[0], utc=True)
        last_t = pd.to_datetime(ev["reading_time"].iloc[-1], utc=True)
        age_days = (data_end - last_t).total_seconds() / 86400
        status = "new" if age_days < 1 else ("open" if age_days < 7 else "resolved")

        events.append({
            "id": f"a-{building_id}-{utility[:3]}-{first_t.strftime('%Y%m%d%H%M')}",
            "building_id": building_id,
            "building_name": building_name,
            "utility": utility,
            "first_reading_time": first_t.isoformat(),
            "last_reading_time": last_t.isoformat(),
            "peak_reading_time": ev.loc[peak_idx, "reading_time"].isoformat(),
            "peak_percentile": round(peak_pct, 4),
            "expected_kwh": round(expected_kwh, 2),
            "actual_kwh": round(actual_kwh, 2),
            "residual_kwh": round(residual_kwh, 2),
            "duration_minutes": int(duration),
            "cost_impact_usd": cost,
            "severity": sev,
            "status": status,
            "parent_anomaly_id": None,
            "claude_explanation": None,
            "work_order_draft": None,
            "claude_explanation_state": "pending",
            "created_at": now,
            "updated_at": now,
        })
    return events


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Batch-score trained LightGBM models and write anomalies.json."
    )
    ap.add_argument("--top", type=int, default=0, help="Emit only top N by cost (0=all)")
    ap.add_argument("--max-per-pair", type=int, default=10,
                    help="Max anomalies per (building, utility) pair for diversity (0=unlimited)")
    ap.add_argument("--min-pct", type=float, default=0.95,
                    help="Percentile threshold for flagging (default 0.95)")
    args = ap.parse_args()

    init_sql = Path("data/raw/init.sql").read_text(encoding="utf-8")
    con = duckdb.connect()
    con.execute(init_sql)

    buildings_df = con.execute("SELECT * FROM v_buildings").df()
    weather_df = con.execute("SELECT * FROM v_weather").df()
    pairs = pairs_trained()
    print(f"[export] Scoring {len(pairs)} trained (building, utility) pairs ...")

    all_events: list[dict] = []
    scored_pairs = skipped = 0

    for building_id, utility in pairs:
        meta = load_meta(building_id, utility)
        if not meta or meta.get("status") != "trained":
            skipped += 1
            continue

        readings = con.execute(
            "SELECT reading_time, readingvalue FROM v_readings "
            "WHERE siteid = ? AND utility = ? ORDER BY reading_time",
            [building_id, utility],
        ).df()
        if readings.empty or len(readings) < 50:
            skipped += 1
            continue

        frame = build_pair_frame(readings, weather_df, buildings_df, building_id, utility)
        if frame.empty:
            skipped += 1
            continue

        gross_area = (
            float(frame["gross_area"].dropna().iloc[0])
            if frame["gross_area"].notna().any()
            else 0.0
        )
        if gross_area <= 0:
            skipped += 1
            continue

        frame = add_features(frame, buildings=buildings_df)
        frame = frame[frame["readingvalue"].notna()].reset_index(drop=True)
        if frame.empty:
            skipped += 1
            continue

        scored = score_pair(frame, meta, building_id, gross_area)
        if scored is None or scored.empty:
            skipped += 1
            continue

        b_row = buildings_df.loc[buildings_df["buildingnumber"] == building_id]
        building_name = (
            str(b_row.iloc[0].get("buildingname") or "") if not b_row.empty else ""
        )

        events = group_events(
            scored, building_id, utility, gross_area, building_name, meta, args.min_pct
        )
        if args.max_per_pair and len(events) > args.max_per_pair:
            events = sorted(events, key=lambda e: e["cost_impact_usd"], reverse=True)[:args.max_per_pair]
        all_events.extend(events)

        # Export time-series for pairs that have anomalies (for chart view)
        if events:
            ts_dir = RAW / "timeseries"
            ts_dir.mkdir(parents=True, exist_ok=True)
            ts_rows = []
            for _, row in scored.iterrows():
                ts_rows.append({
                    "t": row["reading_time"].isoformat(),
                    "actual": round(float(row["readingvalue"]), 3),
                    "predicted": round(float(row["predicted_kwh"]), 3),
                    "percentile": round(float(row["percentile"]), 4),
                })
            ts_path = ts_dir / f"{building_id}__{utility}.json"
            ts_path.write_text(json.dumps(ts_rows, default=str), encoding="utf-8")

        scored_pairs += 1

        if scored_pairs % 50 == 0:
            print(f"[export]   {scored_pairs}/{len(pairs)} pairs done, "
                  f"{len(all_events)} events so far ...")

    all_events.sort(key=lambda e: e["cost_impact_usd"], reverse=True)
    if args.top:
        all_events = all_events[: args.top]

    out = RAW / "anomalies.json"
    out.write_text(json.dumps(all_events, indent=2, default=str), encoding="utf-8")
    print(
        f"[export] Done -- {len(all_events)} anomalies from {scored_pairs} pairs "
        f"({skipped} skipped) -> {out.name}"
    )
    if all_events:
        top = all_events[0]
        print(
            f"[export] Top: {top.get('building_name') or top['building_id']} | "
            f"{top['utility']} | ${top['cost_impact_usd']:.0f} | {top['severity']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
