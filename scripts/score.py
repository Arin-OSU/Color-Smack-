"""
scripts/score.py — Anomaly scoring (percentile-based).

Core functions:
  _percentile_of()  map |residual| to empirical percentile via stored cutpoints
  severity()        percentile -> {None, low, medium, high}
  cost_impact_usd() dollar math per utility
  score()           end-to-end: features -> predictions -> percentiles

Called by replay.py (batch) and by /api/ routes on demand.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
META = ROOT / "meta"


RATES_PER_KWH = {
    "electricity": 0.09,
    "natural_gas": 0.70 / 29.3,
    "steam": 0.04,
    "heating_hot_water": 0.04,
    "chilled_water": 0.08,
    "domestic_water": 0.005,
}


def load_meta(building_id: int, utility: str) -> dict[str, Any] | None:
    p = META / f"{building_id}__{utility}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return None


@lru_cache(maxsize=2048)
def _booster_cached(model_path: str) -> lgb.Booster:
    return lgb.Booster(model_file=str(ROOT / model_path))


def _percentile_of(
    abs_r: np.ndarray, quantiles: list[float], cutpoints: list[float]
) -> np.ndarray:
    """Map abs-residual to empirical percentile using stored cutpoints.
    Linear interpolation between adjacent quantiles. Clamps to [0, 1].
    """
    abs_r = np.asarray(abs_r, dtype=np.float64)
    q = np.asarray(quantiles, dtype=np.float64)
    c = np.asarray(cutpoints, dtype=np.float64)
    n = abs_r.size
    out = np.empty(n, dtype=np.float64)
    idx = np.searchsorted(c, abs_r, side="right")
    for i in range(n):
        x = float(abs_r[i])
        k = int(idx[i])
        if k == 0:
            out[i] = float(q[0]) * (x / max(float(c[0]), 1e-12))
        elif k >= c.size:
            out[i] = 1.0 - (1.0 - float(q[-1])) * min(1.0, float(c[-1]) / max(x, 1e-12))
        else:
            lo_q, hi_q = float(q[k - 1]), float(q[k])
            lo_c, hi_c = float(c[k - 1]), float(c[k])
            denom = max(hi_c - lo_c, 1e-12)
            t = (x - lo_c) / denom
            out[i] = lo_q + t * (hi_q - lo_q)
    return np.clip(out, 0.0, 1.0)


def severity(
    pct: float,
    low: float = 0.95,
    medium: float = 0.99,
    high: float = 0.995,
) -> str | None:
    if pct < low:
        return None
    if pct < medium:
        return "low"
    if pct < high:
        return "medium"
    return "high"


def cost_impact_usd(residuals_kwh_per_sqft, gross_area: float, utility: str) -> float:
    rate = RATES_PER_KWH.get(utility, 0.0)
    arr = np.asarray(residuals_kwh_per_sqft, dtype=np.float64)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0 or not gross_area:
        return 0.0
    return float(np.abs(arr).sum() * float(gross_area) * rate)


def score(
    building_id: int,
    utility: str,
    X_new: pd.DataFrame,
    actual: np.ndarray | pd.Series,
) -> dict[str, Any]:
    """Return predictions + residuals + percentiles for a window of readings.

    Inputs:
      X_new   DataFrame with columns matching meta["feature_cols"]
      actual  y per sqft (readingvalue / gross_area) aligned to X_new rows
    """
    meta = load_meta(building_id, utility)
    if meta is None:
        return {"status": "skipped", "reason": "no_meta"}
    if meta.get("status") != "trained":
        return {"status": "skipped", "reason": meta.get("status", "untrained")}

    feat_cols = meta["feature_cols"]
    if "building_id_cat" in feat_cols and "building_id_cat" not in X_new.columns:
        X_new = X_new.copy()
        X_new["building_id_cat"] = pd.Categorical([building_id] * len(X_new))

    missing = [c for c in feat_cols if c not in X_new.columns]
    if missing:
        return {"status": "skipped", "reason": f"missing_cols:{missing}"}

    booster = _booster_cached(meta["model_path"])
    preds = booster.predict(X_new[feat_cols])
    actual_arr = np.asarray(actual, dtype=np.float64)
    residuals = actual_arr - preds
    pct = _percentile_of(np.abs(residuals), meta["quantiles"], meta["cutpoints"])
    return {
        "status": "ok",
        "expected": preds.tolist(),
        "residual": residuals.tolist(),
        "percentile": pct.tolist(),
        "severity_thresholds": {
            "low": meta.get("severity_percentile_low", 0.95),
            "medium": meta.get("severity_percentile_medium", 0.99),
            "high": meta.get("severity_percentile_high", 0.995),
        },
    }
