"""
scripts/features.py — Build the 17-feature matrix for training + inference.

Consumes DuckDB views from data/raw/init.sql:
  v_readings, v_weather, v_buildings

Exports:
  FEATURE_COLS        canonical column order (17 features + derived CDH/HDH)
  CATEGORICAL_COLS    cols marked as categorical for LightGBM
  build_pair_frame()  one (building, utility) frame, tz-aware, merged w/ weather
  add_features()      adds the 17 columns (+ CDH/HDH)
  target_series()     y = readingvalue / gross_area
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

try:
    from scripts.calendar_osu import vectorized_flags
except ImportError:
    from calendar_osu import vectorized_flags

EASTERN_TZ = "America/New_York"
BALANCE_TEMP_F = 65.0

FEATURE_COLS = [
    # 1-8 weather
    "temperature",
    "humidity",
    "dew_point",
    "solar_radiation",
    "wind_speed",
    "cloud_cover",
    "apparent_temperature",
    "precipitation",
    # 9-12 time
    "hour_of_day",
    "minute_of_hour",
    "day_of_week",
    "is_weekend",
    # 13-14 calendar
    "is_academic_session",
    "is_holiday",
    # 15-17 building
    "gross_area",
    "floors_above_ground",
    "building_age_years",
    # derived
    "cooling_degree_hour",
    "heating_degree_hour",
]

CATEGORICAL_COLS = ["hour_of_day", "day_of_week", "minute_of_hour"]


def _median_building_age(buildings: pd.DataFrame, ref_year: int) -> float:
    if "construction_date" not in buildings.columns:
        return 40.0
    ages = []
    for v in buildings["construction_date"].dropna():
        try:
            y = int(str(v)[:4])
            if 1800 < y <= ref_year:
                ages.append(ref_year - y)
        except (ValueError, TypeError):
            continue
    return float(np.median(ages)) if ages else 40.0


def build_pair_frame(
    readings: pd.DataFrame,
    weather: pd.DataFrame,
    buildings: pd.DataFrame,
    building_id: int,
    utility: str,
) -> pd.DataFrame:
    """Return a per-(building, utility) frame with weather merged + building meta.
    Input `readings` is already filtered to this (building, utility) pair.
    """
    if readings.empty:
        return readings

    r = readings.copy()
    r["reading_time"] = pd.to_datetime(r["reading_time"], utc=True)
    r = r.sort_values("reading_time").dropna(subset=["reading_time"])

    if "readingvalue" not in r.columns and "readingwindowmean" in r.columns:
        r["readingvalue"] = r["readingwindowmean"]

    w = weather.copy()
    w["reading_time"] = pd.to_datetime(w["reading_time"], utc=True)
    w = w.sort_values("reading_time").rename(columns={"reading_time": "weather_time"})

    merged = pd.merge_asof(
        r, w,
        left_on="reading_time", right_on="weather_time",
        direction="backward", tolerance=pd.Timedelta("1h"),
    )

    b = buildings.loc[buildings["buildingnumber"] == building_id]
    if b.empty:
        meta = {"gross_area": np.nan, "floors_above_ground": np.nan, "construction_date": None}
    else:
        meta = b.iloc[0].to_dict()
    merged["gross_area"] = pd.to_numeric(meta.get("gross_area"), errors="coerce")
    merged["floors_above_ground"] = pd.to_numeric(meta.get("floors_above_ground"), errors="coerce")
    merged["_construction_date"] = meta.get("construction_date")
    merged["_building_id"] = building_id
    merged["_utility"] = utility
    return merged


def add_features(
    df: pd.DataFrame,
    buildings: pd.DataFrame | None = None,
) -> pd.DataFrame:
    if df.empty:
        return df
    out = df.copy()

    local = out["reading_time"].dt.tz_convert(EASTERN_TZ)
    out["hour_of_day"] = local.dt.hour.astype("int16")
    out["minute_of_hour"] = local.dt.minute.astype("int16")
    out["day_of_week"] = local.dt.dayofweek.astype("int16")
    out["is_weekend"] = out["day_of_week"].isin([5, 6]).astype(bool)

    flags = vectorized_flags(local)
    out["is_academic_session"] = flags["is_academic_session"].to_numpy()
    out["is_holiday"] = flags["is_holiday"].to_numpy()

    rename = {
        "temperature_2m": "temperature",
        "relative_humidity_2m": "humidity",
        "dew_point_2m": "dew_point",
        "shortwave_radiation": "solar_radiation",
        "wind_speed_10m": "wind_speed",
    }
    for src, dst in rename.items():
        if src in out.columns and dst not in out.columns:
            out[dst] = out[src]

    for col in [
        "temperature", "humidity", "dew_point", "solar_radiation",
        "wind_speed", "cloud_cover", "apparent_temperature", "precipitation",
    ]:
        if col not in out.columns:
            out[col] = np.nan

    t = out["temperature"].astype(float)
    out["cooling_degree_hour"] = np.maximum(0.0, t - BALANCE_TEMP_F)
    out["heating_degree_hour"] = np.maximum(0.0, BALANCE_TEMP_F - t)

    ref_year = int(out["reading_time"].dt.year.max()) if not out.empty else 2026
    median_age = _median_building_age(buildings, ref_year) if buildings is not None else 40.0
    construction = out.get("_construction_date")
    ages: list[float] = []
    if construction is not None:
        for v in construction:
            try:
                y = int(str(v)[:4])
                if 1800 < y <= ref_year:
                    ages.append(float(ref_year - y))
                    continue
            except (ValueError, TypeError):
                pass
            ages.append(median_age)
    else:
        ages = [median_age] * len(out)
    out["building_age_years"] = pd.Series(ages, index=out.index).astype(float)

    for c in ["gross_area", "floors_above_ground"]:
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors="coerce")
    out["floors_above_ground"] = out["floors_above_ground"].fillna(
        float(np.nanmedian(out["floors_above_ground"])) if out["floors_above_ground"].notna().any() else 3.0
    )

    for c in CATEGORICAL_COLS:
        out[c] = out[c].astype("category")

    return out


def target_series(df: pd.DataFrame) -> pd.Series:
    gross = pd.to_numeric(df["gross_area"], errors="coerce")
    val = pd.to_numeric(df.get("readingvalue"), errors="coerce")
    y = val / gross
    return y.where(gross.notna() & (gross != 0))


def prepare_for_pair(
    readings: pd.DataFrame,
    weather: pd.DataFrame,
    buildings: pd.DataFrame,
    building_id: int,
    utility: str,
) -> tuple[pd.DataFrame, pd.Series]:
    frame = build_pair_frame(readings, weather, buildings, building_id, utility)
    frame = add_features(frame, buildings=buildings)
    y = target_series(frame)
    mask = y.notna() & frame[FEATURE_COLS].notna().all(axis=1)
    return frame.loc[mask, FEATURE_COLS + ["reading_time", "readingvalue"]], y.loc[mask]


def split_train_valid_replay(
    frame: pd.DataFrame,
    y: pd.Series,
    train_end: str = "2026-01-23",
    valid_start: str = "2025-12-01",
) -> dict[str, tuple[pd.DataFrame, pd.Series]]:
    times = pd.to_datetime(frame["reading_time"], utc=True)
    train_end_ts = pd.Timestamp(train_end, tz="UTC") + pd.Timedelta(days=1)
    valid_start_ts = pd.Timestamp(valid_start, tz="UTC")

    train_mask = times < train_end_ts
    valid_mask = (times >= valid_start_ts) & (times < train_end_ts)
    replay_mask = times >= train_end_ts

    X = frame[FEATURE_COLS]
    return {
        "train": (X.loc[train_mask], y.loc[train_mask]),
        "valid": (X.loc[valid_mask], y.loc[valid_mask]),
        "replay": (X.loc[replay_mask], y.loc[replay_mask]),
    }


def load_duckdb_frames(init_sql: str | Path = "data/raw/init.sql"):
    import duckdb
    con = duckdb.connect()
    sql = Path(init_sql).read_text(encoding="utf-8")
    con.execute(sql)
    cols = [d[0] for d in con.execute("SELECT * FROM v_readings LIMIT 0").description]
    required = {"siteid", "utility", "reading_time", "readingvalue"}
    missing = required - set(cols)
    if missing:
        raise RuntimeError(f"Schema mismatch. Missing columns in v_readings: {missing}. Actual: {cols}")
    return con


if __name__ == "__main__":
    print("FEATURE_COLS =", FEATURE_COLS)
    print("CATEGORICAL_COLS =", CATEGORICAL_COLS)
