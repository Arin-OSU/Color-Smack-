"""
scripts/replay.py — 30x replay loop that writes anomalies to Supabase.

Steps through time in 15-minute windows from the pinned replay start
(default 2026-01-24 00:00 UTC) to now_frozen (DEMO_FROZEN_NOW). For each
window, loads readings + weather, builds features, scores every
(building, utility) pair, and applies the lifecycle state machine:

    new (first cross of 0.95)  ->  open (percentile > 0.90)
    open -> resolved (percentile < 0.90 for 4 consecutive windows)

Writes:
  - Supabase public.anomalies (insert/update)
  - Optional: local meta/anomaly_log.jsonl for debugging

Run:
    python scripts/replay.py
    python scripts/replay.py --catchup-only        # fast-forward to now_frozen then stop
    python scripts/replay.py --speed 30            # 30 simulated minutes per real second (default)
    python scripts/replay.py --dry-run             # no Supabase writes
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
    load_dotenv(".env.example")
except ImportError:
    pass

import duckdb
import numpy as np
import pandas as pd
from tqdm import tqdm

if str(Path(__file__).resolve().parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent))

from features import (
    FEATURE_COLS,
    add_features,
    build_pair_frame,
)
from score import (
    RATES_PER_KWH,
    cost_impact_usd,
    load_meta,
    score,
    severity,
)

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "meta"
LOG_PATH = META / "anomaly_log.jsonl"

WINDOW = timedelta(minutes=15)
LOOKBACK = timedelta(hours=6)
RESOLVE_WINDOWS = 4
OPEN_PERCENTILE = 0.90

FROZEN_NOW = os.getenv("DEMO_FROZEN_NOW", "2026-01-27T08:00:00-05:00")
REPLAY_START = os.getenv("REPLAY_START", "2026-01-24T00:00:00Z")
REPLAY_SPEED = int(os.getenv("REPLAY_SPEED_X", "30"))


def _to_utc(ts: str) -> datetime:
    dt = pd.Timestamp(ts)
    if dt.tzinfo is None:
        dt = dt.tz_localize("UTC")
    return dt.tz_convert("UTC").to_pydatetime()


def ensure_dirs() -> None:
    META.mkdir(parents=True, exist_ok=True)


def log_event(event: dict[str, Any]) -> None:
    event = {"ts": datetime.now(timezone.utc).isoformat(), **event}
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, default=str) + "\n")


# ---------- Supabase client ----------

def supabase_client() -> Any | None:
    try:
        from supabase import create_client
    except ImportError:
        print("[replay] supabase package missing; running in dry-run mode.")
        return None
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key or "REPLACE_ME" in (url or "") or "REPLACE_ME" in (key or ""):
        print("[replay] Supabase creds missing/placeholder; dry-run.")
        return None
    return create_client(url, key)


# ---------- Data loading ----------

def pairs_available() -> list[tuple[int, str]]:
    pairs: list[tuple[int, str]] = []
    for p in META.glob("*.json"):
        if p.name in ("training_summary.json", "cutpoint_histogram.txt", "anomaly_log.jsonl"):
            continue
        try:
            m = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if m.get("status") == "trained":
            pairs.append((int(m["building_id"]), str(m["utility"])))
    return pairs


def load_static(con: duckdb.DuckDBPyConnection) -> tuple[pd.DataFrame, pd.DataFrame]:
    buildings = con.execute("SELECT * FROM v_buildings").df()
    weather = con.execute("SELECT * FROM v_weather").df()
    return buildings, weather


def load_window_readings(
    con: duckdb.DuckDBPyConnection,
    start: datetime,
    end: datetime,
) -> pd.DataFrame:
    return con.execute(
        "SELECT siteid, utility, reading_time, readingvalue "
        "FROM v_readings WHERE reading_time >= ? AND reading_time < ?",
        [start, end],
    ).df()


# ---------- Lifecycle ----------

class LifecycleTracker:
    """Tracks in-flight anomalies per (building_id, utility) during replay."""

    def __init__(self) -> None:
        self.active: dict[tuple[int, str], dict[str, Any]] = {}
        self.cooldown: dict[tuple[int, str], int] = {}

    def on_window(
        self,
        building_id: int,
        utility: str,
        window_end: datetime,
        percentile: float,
        residual_kwh_per_sqft: float,
        actual_kwh: float,
        expected_kwh: float,
        gross_area: float,
        severity_thresholds: dict[str, float],
        building_name: str | None,
    ) -> dict[str, Any] | None:
        """Return a mutation dict or None.

        Mutation dict shape:
          {"op": "insert"|"update"|"resolve", "row": {...}}
        """
        key = (building_id, utility)
        low = severity_thresholds.get("low", 0.95)
        active = self.active.get(key)

        if active is None:
            if percentile >= low:
                row = {
                    "id": str(uuid.uuid4()),
                    "building_id": building_id,
                    "utility": utility,
                    "first_reading_time": window_end - WINDOW,
                    "last_reading_time": window_end,
                    "peak_reading_time": window_end - WINDOW // 2,
                    "peak_percentile": float(percentile),
                    "expected_kwh": float(expected_kwh),
                    "actual_kwh": float(actual_kwh),
                    "residual_kwh": float(residual_kwh_per_sqft * gross_area),
                    "duration_minutes": int(WINDOW.total_seconds() // 60),
                    "cost_impact_usd": cost_impact_usd(
                        [residual_kwh_per_sqft], gross_area, utility
                    ),
                    "severity": severity(
                        float(percentile),
                        severity_thresholds.get("low", 0.95),
                        severity_thresholds.get("medium", 0.99),
                        severity_thresholds.get("high", 0.995),
                    ) or "low",
                    "status": "new",
                    "parent_anomaly_id": None,
                    "claude_explanation": None,
                    "work_order_draft": None,
                    "claude_explanation_state": "pending",
                    "created_at": window_end.isoformat(),
                    "updated_at": window_end.isoformat(),
                    "building_name": building_name,
                }
                self.active[key] = {
                    **row,
                    "_residuals": [float(residual_kwh_per_sqft)],
                    "_peak_pct": float(percentile),
                    "_cold_windows": 0,
                }
                self.cooldown.pop(key, None)
                return {"op": "insert", "row": row}
            return None

        # Already active
        active["_residuals"].append(float(residual_kwh_per_sqft))
        active["last_reading_time"] = window_end
        active["updated_at"] = window_end.isoformat()
        active["actual_kwh"] += float(actual_kwh)
        active["expected_kwh"] += float(expected_kwh)
        active["residual_kwh"] += float(residual_kwh_per_sqft * gross_area)
        active["duration_minutes"] += int(WINDOW.total_seconds() // 60)
        active["cost_impact_usd"] += cost_impact_usd(
            [residual_kwh_per_sqft], gross_area, utility
        )
        if percentile > active["_peak_pct"]:
            active["_peak_pct"] = float(percentile)
            active["peak_percentile"] = float(percentile)
            active["peak_reading_time"] = window_end
            active["severity"] = severity(
                float(percentile),
                severity_thresholds.get("low", 0.95),
                severity_thresholds.get("medium", 0.99),
                severity_thresholds.get("high", 0.995),
            ) or active["severity"]

        if active["status"] == "new":
            active["status"] = "open"

        if percentile < OPEN_PERCENTILE:
            active["_cold_windows"] += 1
        else:
            active["_cold_windows"] = 0

        if active["_cold_windows"] >= RESOLVE_WINDOWS:
            active["status"] = "resolved"
            row = {k: v for k, v in active.items() if not k.startswith("_")}
            del self.active[key]
            return {"op": "resolve", "row": row}

        row = {k: v for k, v in active.items() if not k.startswith("_")}
        return {"op": "update", "row": row}


# ---------- Scoring step ----------

def score_window(
    con: duckdb.DuckDBPyConnection,
    buildings: pd.DataFrame,
    weather: pd.DataFrame,
    pairs: list[tuple[int, str]],
    window_start: datetime,
    window_end: datetime,
    tracker: LifecycleTracker,
) -> list[dict[str, Any]]:
    mutations: list[dict[str, Any]] = []
    ctx_start = window_start - LOOKBACK
    ctx_readings = load_window_readings(con, ctx_start, window_end)
    if ctx_readings.empty:
        return mutations

    for bid, utility in pairs:
        sub = ctx_readings[(ctx_readings["siteid"] == bid) & (ctx_readings["utility"] == utility)]
        if sub.empty:
            continue
        sub = sub[["reading_time", "readingvalue"]]
        frame = build_pair_frame(sub, weather, buildings, bid, utility)
        if frame.empty:
            continue
        frame = add_features(frame, buildings=buildings)
        gross_area = float(frame["gross_area"].iloc[0]) if frame["gross_area"].notna().any() else 0.0
        if gross_area <= 0:
            continue

        meta = load_meta(bid, utility)
        if not meta or meta.get("status") != "trained":
            continue
        feat_cols = meta["feature_cols"]

        mask = pd.to_datetime(frame["reading_time"], utc=True) >= window_start
        mask &= pd.to_datetime(frame["reading_time"], utc=True) < window_end
        mask &= frame[FEATURE_COLS].notna().all(axis=1)
        mask &= frame["readingvalue"].notna()
        window_rows = frame.loc[mask]
        if window_rows.empty:
            continue

        X_new = window_rows[feat_cols] if all(c in window_rows.columns for c in feat_cols) else None
        if X_new is None or X_new.isna().any().any():
            continue

        actual_per_sqft = window_rows["readingvalue"].astype(float) / gross_area
        scored = score(bid, utility, X_new, actual_per_sqft)
        if scored.get("status") != "ok":
            continue

        pct_arr = np.asarray(scored["percentile"])
        residual_arr = np.asarray(scored["residual"])
        expected_arr = np.asarray(scored["expected"])

        peak_idx = int(np.argmax(pct_arr))
        percentile = float(pct_arr[peak_idx])
        residual_per_sqft = float(np.sum(residual_arr))
        expected_kwh = float(np.sum(expected_arr) * gross_area)
        actual_kwh = float(np.sum(actual_per_sqft) * gross_area)
        building_name = None
        b_row = buildings.loc[buildings["buildingnumber"] == bid]
        if not b_row.empty:
            building_name = b_row.iloc[0].get("buildingname")

        mutation = tracker.on_window(
            bid, utility, window_end,
            percentile=percentile,
            residual_kwh_per_sqft=residual_per_sqft,
            actual_kwh=actual_kwh,
            expected_kwh=expected_kwh,
            gross_area=gross_area,
            severity_thresholds=scored["severity_thresholds"],
            building_name=building_name,
        )
        if mutation is not None:
            mutations.append(mutation)
    return mutations


# ---------- Supabase writes ----------

def apply_mutations(client: Any | None, mutations: list[dict[str, Any]], dry: bool) -> None:
    if not mutations:
        return
    if dry or client is None:
        for m in mutations:
            log_event({"op": m["op"], "id": m["row"]["id"], "status": m["row"]["status"], "pct": m["row"]["peak_percentile"]})
        return
    for m in mutations:
        row = m["row"].copy()
        for k in ("first_reading_time", "last_reading_time", "peak_reading_time"):
            if isinstance(row.get(k), datetime):
                row[k] = row[k].astimezone(timezone.utc).isoformat()
        row.pop("building_name", None)
        try:
            if m["op"] == "insert":
                client.table("anomalies").upsert(row, on_conflict="id").execute()
            else:
                client.table("anomalies").update(row).eq("id", row["id"]).execute()
        except Exception as e:
            log_event({"op": "supabase_fail", "err": str(e), "id": row.get("id")})


# ---------- Main ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--speed", type=int, default=REPLAY_SPEED, help="simulated min per real sec")
    ap.add_argument("--catchup-only", action="store_true", help="fast-forward to now_frozen then exit")
    ap.add_argument("--from", dest="from_", default=REPLAY_START)
    ap.add_argument("--to", default=None, help="override DEMO_FROZEN_NOW")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    ensure_dirs()
    init_sql = Path("data/raw/init.sql").read_text(encoding="utf-8")
    con = duckdb.connect()
    con.execute(init_sql)

    client = None if args.dry_run else supabase_client()
    buildings, weather = load_static(con)
    pairs = pairs_available()
    print(f"[replay] {len(pairs)} trained pairs")

    cursor = _to_utc(args.from_)
    until = _to_utc(args.to or FROZEN_NOW)
    tracker = LifecycleTracker()

    total_windows = int((until - cursor) / WINDOW)
    pbar = tqdm(total=max(1, total_windows), desc="replay")

    while cursor < until:
        window_end = min(cursor + WINDOW, until)
        mutations = score_window(
            con, buildings, weather, pairs, cursor, window_end, tracker
        )
        apply_mutations(client, mutations, args.dry_run)
        cursor = window_end
        pbar.update(1)

    pbar.close()
    print(f"[replay] catch-up complete. In-flight anomalies: {len(tracker.active)}")

    if args.catchup_only:
        return 0

    print(f"[replay] live replay at {args.speed}x ...")
    real_sleep = 60.0 * WINDOW.total_seconds() / (60.0 * args.speed * 60.0)
    try:
        while True:
            window_end = cursor + WINDOW
            mutations = score_window(
                con, buildings, weather, pairs, cursor, window_end, tracker
            )
            apply_mutations(client, mutations, args.dry_run)
            cursor = window_end
            time.sleep(max(0.1, real_sleep))
    except KeyboardInterrupt:
        print("\n[replay] stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
