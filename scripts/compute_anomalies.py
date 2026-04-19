"""
scripts/compute_anomalies.py — detect energy anomalies from scraped parquet data.

Reads:  data/raw/readings/**/*.parquet  (Hive-partitioned by utility + building)
        data/raw/buildings_from_api.json

Writes: data/raw/anomalies.json  (array matching frontend Anomaly type)

Algorithm:
  1. Load all readings into one DataFrame.
  2. Compute per-(building, utility, hour-of-day, day-of-week) median baseline.
  3. Flag readings where z-score > Z_THRESHOLD.
  4. Group consecutive flagged readings (gap < MAX_GAP_MIN) into events.
  5. Filter events shorter than MIN_DURATION_MIN.
  6. Sort by cost impact descending and write JSON.

Usage:
    python scripts/compute_anomalies.py
    python scripts/compute_anomalies.py --top 100
    python scripts/compute_anomalies.py --z 2.0 --top 50
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
READINGS_DIR = RAW / "readings"

Z_THRESHOLD = 2.5
MIN_DURATION_MIN = 60
MAX_GAP_MIN = 120

COST_PER_KWH: dict[str, float] = {
    "electricity":       0.09,
    "natural_gas":       0.06,
    "steam":             0.04,
    "steam_rate":        0.04,
    "heating_hot_water": 0.04,
    "chilled_water":     0.03,
    "domestic_water":    0.02,
}
DEFAULT_COST = 0.07


# ---------- Loading ----------

def load_readings() -> pd.DataFrame:
    parts = list(READINGS_DIR.rglob("readings.parquet"))
    if not parts:
        print(f"[anomaly] No parquet files found under {READINGS_DIR}")
        print("[anomaly] Run load_fallback.py (or scrape.py) first.")
        sys.exit(1)

    print(f"[anomaly] Loading {len(parts)} parquet partition(s) ...")
    frames = []
    for p in parts:
        try:
            df = pd.read_parquet(p, columns=["siteid", "utility", "reading_time", "readingvalue"])
            frames.append(df)
        except Exception as e:
            print(f"[anomaly]   skipping {p}: {e}")

    combined = pd.concat(frames, ignore_index=True)
    combined["reading_time"] = pd.to_datetime(combined["reading_time"], utc=True)
    combined["readingvalue"] = pd.to_numeric(combined["readingvalue"], errors="coerce")
    combined = combined.dropna(subset=["reading_time", "readingvalue", "siteid", "utility"])
    combined = combined.sort_values("reading_time").reset_index(drop=True)
    print(f"[anomaly] {len(combined):,} readings, "
          f"{combined['siteid'].nunique()} buildings, "
          f"{combined['utility'].nunique()} utilities")
    return combined


def load_buildings() -> dict[int, dict]:
    p = RAW / "buildings_from_api.json"
    if not p.exists():
        return {}
    data = json.loads(p.read_text(encoding="utf-8"))
    return {b["buildingnumber"]: b for b in data if b.get("buildingnumber")}


# ---------- Baseline ----------

def add_baseline(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["hour"] = df["reading_time"].dt.hour
    df["dow"]  = df["reading_time"].dt.dayofweek

    grp = df.groupby(["siteid", "utility", "hour", "dow"])["readingvalue"]
    df["expected"]  = grp.transform("median")
    df["baseline_std"] = grp.transform("std").fillna(1.0).clip(lower=0.01)
    df["z_score"]   = (df["readingvalue"] - df["expected"]) / df["baseline_std"]

    # Percentile rank within each (building, utility) pair
    df["pct_rank"] = df.groupby(["siteid", "utility"])["readingvalue"].rank(pct=True)
    return df


# ---------- Event detection ----------

def group_events(grp: pd.DataFrame) -> list[dict]:
    """Given flagged readings for one (siteid, utility), return event dicts."""
    grp = grp.sort_values("reading_time").reset_index(drop=True)
    # Assign event labels by merging rows within MAX_GAP_MIN of each other
    gaps = grp["reading_time"].diff().dt.total_seconds().div(60).fillna(0)
    grp["event_id"] = (gaps > MAX_GAP_MIN).cumsum()

    events = []
    for _, ev in grp.groupby("event_id"):
        duration = (ev["reading_time"].iloc[-1] - ev["reading_time"].iloc[0]).total_seconds() / 60
        if duration < MIN_DURATION_MIN and len(ev) < 4:
            continue

        peak_idx     = ev["readingvalue"].idxmax()
        actual_kwh   = float(ev["readingvalue"].sum())
        expected_kwh = float(ev["expected"].sum())
        residual_kwh = actual_kwh - expected_kwh

        if residual_kwh <= 0:
            continue

        sid    = int(ev["siteid"].iloc[0])
        util   = str(ev["utility"].iloc[0])
        rate   = COST_PER_KWH.get(util, DEFAULT_COST)
        cost   = round(residual_kwh * rate, 2)

        severity = "high" if cost > 400 else ("medium" if cost > 75 else "low")
        now      = datetime.now(timezone.utc).isoformat()
        t0       = ev["reading_time"].iloc[0].isoformat()

        events.append({
            "id":                       f"a-{sid}-{util[:3]}-{ev['reading_time'].iloc[0].strftime('%Y%m%d%H%M')}",
            "building_id":              sid,
            "utility":                  util,
            "first_reading_time":       t0,
            "last_reading_time":        ev["reading_time"].iloc[-1].isoformat(),
            "peak_reading_time":        ev.loc[peak_idx, "reading_time"].isoformat(),
            "peak_percentile":          round(float(ev.loc[peak_idx, "pct_rank"]), 4),
            "expected_kwh":             round(expected_kwh, 2),
            "actual_kwh":               round(actual_kwh, 2),
            "residual_kwh":             round(residual_kwh, 2),
            "duration_minutes":         int(duration),
            "cost_impact_usd":          cost,
            "severity":                 severity,
            "status":                   "new",
            "parent_anomaly_id":        None,
            "claude_explanation":       None,
            "work_order_draft":         None,
            "claude_explanation_state": "pending",
            "created_at":               now,
            "updated_at":               now,
        })
    return events


def detect_all_events(df: pd.DataFrame, z_thresh: float) -> list[dict]:
    flagged = df[df["z_score"] > z_thresh]
    if flagged.empty:
        print("[anomaly] No anomalies detected — try lowering --z threshold.")
        return []

    all_events: list[dict] = []
    for (sid, util), grp in flagged.groupby(["siteid", "utility"]):
        all_events.extend(group_events(grp))

    return all_events


# ---------- Main ----------

def main() -> int:
    ap = argparse.ArgumentParser(description="Detect anomalies from energy meter parquet files.")
    ap.add_argument("--top", type=int, default=0,
                    help="Emit only top N anomalies by cost impact (0 = all)")
    ap.add_argument("--z", type=float, default=Z_THRESHOLD,
                    help=f"Z-score threshold (default {Z_THRESHOLD})")
    args = ap.parse_args()

    readings  = load_readings()
    buildings = load_buildings()

    print("[anomaly] Computing baselines (may take ~30s for large datasets) ...")
    readings = add_baseline(readings)

    print(f"[anomaly] Detecting events (z > {args.z}) ...")
    events = detect_all_events(readings, args.z)

    # Attach building names
    for ev in events:
        bldg = buildings.get(ev["building_id"])
        if bldg:
            ev["building_name"] = bldg.get("buildingname") or ""

    events.sort(key=lambda e: e["cost_impact_usd"], reverse=True)
    if args.top:
        events = events[: args.top]

    out_path = RAW / "anomalies.json"
    out_path.write_text(json.dumps(events, indent=2, default=str), encoding="utf-8")
    print(f"[anomaly] Wrote {len(events)} events -> {out_path.name}")

    if events:
        top = events[0]
        bname = top.get("building_name") or f"building {top['building_id']}"
        print(f"[anomaly] Top: {bname} | {top['utility']} | ${top['cost_impact_usd']:.0f} | {top['severity']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
