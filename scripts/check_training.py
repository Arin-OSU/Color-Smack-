"""
scripts/check_training.py — Acceptance check after train_all.py finishes.

Pass conditions:
  1. >= 80% of (building, utility) pairs have status=trained
  2. Median valid_mae < 20% of median actual value
  3. Every trained model has cutpoints len=21 AND strictly non-decreasing
  4. No trained model has cutpoints[-1] == 0
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import duckdb
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
META = ROOT / "meta"


def load_metas() -> list[dict]:
    out = []
    for p in META.glob("*.json"):
        if p.name in ("training_summary.json",):
            continue
        try:
            out.append(json.loads(p.read_text(encoding="utf-8")))
        except Exception:
            continue
    return out


def median_actual() -> float:
    init_sql = Path("data/raw/init.sql").read_text(encoding="utf-8")
    con = duckdb.connect()
    con.execute(init_sql)
    val = con.execute(
        "SELECT median(readingvalue) FROM v_readings WHERE readingvalue IS NOT NULL"
    ).fetchone()
    return float(val[0]) if val and val[0] is not None else float("nan")


def main() -> int:
    metas = load_metas()
    if not metas:
        print("[check] No meta files. Run train_all.py first.")
        return 1
    total = len(metas)
    trained = [m for m in metas if m.get("status") == "trained"]
    trained_frac = len(trained) / max(total, 1)
    print(f"[check] trained {len(trained)}/{total} = {trained_frac:.1%}")

    bad_cut: list[str] = []
    zero_tail: list[str] = []
    for m in trained:
        cut = m.get("cutpoints") or []
        if len(cut) != 21:
            bad_cut.append(f"{m.get('building_id')}__{m.get('utility')} len={len(cut)}")
            continue
        if not all(b >= a for a, b in zip(cut, cut[1:])):
            bad_cut.append(f"{m.get('building_id')}__{m.get('utility')} not non-decreasing")
        if float(cut[-1]) == 0.0:
            zero_tail.append(f"{m.get('building_id')}__{m.get('utility')}")

    mae_values = [float(m["valid_mae"]) for m in trained if isinstance(m.get("valid_mae"), (int, float))]
    median_mae = float(np.median(mae_values)) if mae_values else float("nan")
    med_actual = median_actual()

    print(f"[check] median valid_mae    = {median_mae:.5f}")
    print(f"[check] median actual value = {med_actual:.5f}")
    ratio = median_mae / med_actual if med_actual and not np.isnan(med_actual) else float("nan")
    print(f"[check] mae/actual ratio     = {ratio:.3%}")

    ok = True
    if trained_frac < 0.80:
        print("[FAIL] trained fraction < 80%")
        ok = False
    if not np.isnan(ratio) and ratio > 0.20:
        print("[FAIL] median valid MAE > 20% of median actual value")
        ok = False
    if bad_cut:
        print(f"[FAIL] {len(bad_cut)} models with bad cutpoints")
        for row in bad_cut[:10]:
            print(f"       {row}")
        ok = False
    if zero_tail:
        print(f"[FAIL] {len(zero_tail)} models with cutpoints[-1] == 0")
        ok = False

    if ok:
        print("[check] PASS")
        return 0
    print("[check] FAIL -- do not proceed to scoring")
    return 1


if __name__ == "__main__":
    sys.exit(main())
