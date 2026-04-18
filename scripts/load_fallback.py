"""
scripts/load_fallback.py — Load CampusSense fallback CSVs into parquet layout.

Used when scrape.py writes FALLBACK_REQUIRED to data/raw/summary.json.

Expects three files in data/fallback/ (pipe or tab separated, sniff with
pandas.read_csv(sep=None, engine='python')):
  meter-data-oct-2025.txt      -- long-format meter readings
  building_metadata.txt        -- building list (ids, names, sqft, lat/lon)
  weather-sept-oct-2025.txt    -- fallback hourly weather

Produces the same layout scrape.py would produce:
  data/raw/buildings_from_api.json
  data/raw/meters_from_api.json
  data/raw/readings/utility=<u>/building=<b>/readings.parquet
  data/raw/weather.parquet   (Open-Meteo pulled fresh for the full window)
  data/raw/init.sql
  data/raw/summary.json

Run:
    python scripts/load_fallback.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
    load_dotenv(".env.example")
except ImportError:
    pass

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import requests
from tqdm import tqdm

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
READINGS = RAW / "readings"
FALLBACK = ROOT / "data" / "fallback"

START = os.getenv("SCRAPE_START", "2025-05-01")
END = os.getenv("SCRAPE_END", "2026-04-17")
OPEN_METEO_URL = os.getenv("OPEN_METEO_ARCHIVE_URL", "https://archive-api.open-meteo.com/v1/archive")
OSU_LAT = float(os.getenv("OSU_LAT", "40.0795"))
OSU_LON = float(os.getenv("OSU_LON", "-83.0732"))

UTILITY_NORMALIZE = {
    "electric": "electricity", "electricity": "electricity", "elec": "electricity",
    "natural_gas": "natural_gas", "naturalgas": "natural_gas", "gas": "natural_gas",
    "steam": "steam",
    "heating_hot_water": "heating_hot_water", "hhw": "heating_hot_water", "hotwater": "heating_hot_water",
    "chilled_water": "chilled_water", "chw": "chilled_water", "chilledwater": "chilled_water",
    "domestic_water": "domestic_water", "water": "domestic_water", "dw": "domestic_water",
}


def normalize_utility(raw: object) -> str:
    k = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    return UTILITY_NORMALIZE.get(k, k)


def sniff_read(path: Path) -> pd.DataFrame:
    print(f"[fallback] Reading {path.name} ...")
    df = pd.read_csv(path, sep=None, engine="python", on_bad_lines="skip", low_memory=False)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    return df


def load_buildings() -> pd.DataFrame:
    src = FALLBACK / "building_metadata.txt"
    if not src.exists():
        raise FileNotFoundError(f"missing {src}. Drop the CSV here first.")
    df = sniff_read(src)

    def pick(names: list[str]) -> str | None:
        for n in names:
            if n in df.columns:
                return n
        return None

    id_col = pick(["buildingnumber", "buildingid", "bldgkey", "building_id", "id", "bldgnum"])
    name_col = pick(["buildingname", "name", "building_name"])
    campus_col = pick(["campus", "location"])
    area_col = pick(["gross_area", "grossarea", "sqft", "area", "grosssquarefeet"])
    lat_col = pick(["latitude", "lat"])
    lon_col = pick(["longitude", "lon", "lng"])
    type_col = pick(["building_type", "type", "buildingtype"])
    floors_col = pick(["floors_above_ground", "floors", "numfloors"])
    date_col = pick(["construction_date", "yearbuilt", "yearopened", "year_built"])

    out = pd.DataFrame({
        "buildingnumber": pd.to_numeric(df[id_col], errors="coerce").astype("Int64") if id_col else pd.NA,
        "buildingname": df[name_col].astype(str) if name_col else None,
        "campus": df[campus_col].astype(str) if campus_col else "Columbus",
        "gross_area": pd.to_numeric(df[area_col], errors="coerce").astype("Int64") if area_col else pd.NA,
        "floors_above_ground": pd.to_numeric(df[floors_col], errors="coerce").astype("Int64") if floors_col else pd.NA,
        "construction_date": df[date_col].astype(str) if date_col else None,
        "latitude": pd.to_numeric(df[lat_col], errors="coerce") if lat_col else None,
        "longitude": pd.to_numeric(df[lon_col], errors="coerce") if lon_col else None,
        "building_type": df[type_col].astype(str) if type_col else None,
        "status": "active",
    })
    out = out.dropna(subset=["buildingnumber"]).drop_duplicates("buildingnumber")
    (RAW / "buildings_from_api.json").write_text(
        out.to_json(orient="records", indent=2), encoding="utf-8"
    )
    print(f"[fallback] Wrote {len(out)} buildings")
    return out


def load_readings(buildings: pd.DataFrame) -> pd.DataFrame:
    src = FALLBACK / "meter-data-oct-2025.txt"
    if not src.exists():
        raise FileNotFoundError(f"missing {src}. Drop the CSV here first.")
    df = sniff_read(src)

    def pick(names: list[str]) -> str | None:
        for n in names:
            if n in df.columns:
                return n
        return None

    id_col = pick(["siteid", "buildingnumber", "bldgkey", "building_id", "buildingid"])
    utility_col = pick(["utility", "utilitytype", "metertype", "type"])
    time_col = pick(["reading_time", "readingtime", "timestamp", "time", "readingdatetime"])
    value_col = pick(["readingvalue", "value", "consumption", "readingwindowmean"])

    if not (id_col and utility_col and time_col and value_col):
        raise RuntimeError(f"Could not find expected columns. Got: {list(df.columns)[:20]}")

    print(f"[fallback] id={id_col} utility={utility_col} time={time_col} value={value_col}")

    df["siteid"] = pd.to_numeric(df[id_col], errors="coerce").astype("Int64")
    df["utility"] = df[utility_col].map(normalize_utility)
    df["reading_time"] = pd.to_datetime(df[time_col], utc=True, errors="coerce")
    df["readingvalue"] = pd.to_numeric(df[value_col], errors="coerce")
    df = df.dropna(subset=["siteid", "utility", "reading_time"])

    out = df[["siteid", "utility", "reading_time", "readingvalue"]]

    pairs = out[["siteid", "utility"]].drop_duplicates()
    print(f"[fallback] Writing {len(pairs)} parquet partitions from {len(out):,} rows ...")
    for _, row in tqdm(list(pairs.iterrows())):
        b, u = int(row["siteid"]), row["utility"]
        sub = out[(out["siteid"] == b) & (out["utility"] == u)]
        p = READINGS / f"utility={u}" / f"building={b}" / "readings.parquet"
        p.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(pa.Table.from_pandas(sub, preserve_index=False), p, compression="zstd")
    return pairs


def write_meters(pairs: pd.DataFrame) -> None:
    meters = [
        {"building_id": int(r["siteid"]), "utility": r["utility"], "unit": "kWh", "status": "active"}
        for _, r in pairs.iterrows()
    ]
    (RAW / "meters_from_api.json").write_text(json.dumps(meters, indent=2), encoding="utf-8")
    print(f"[fallback] Wrote {len(meters)} meters")


def pull_weather() -> None:
    out = RAW / "weather.parquet"
    if out.exists():
        print("[fallback] weather.parquet already exists; skipping")
        return
    hourly = ",".join([
        "temperature_2m", "relative_humidity_2m", "dew_point_2m",
        "shortwave_radiation", "direct_radiation", "diffuse_radiation",
        "wind_speed_10m", "wind_speed_100m", "wind_direction_10m", "wind_direction_100m",
        "cloud_cover", "apparent_temperature", "precipitation",
    ])
    params = {
        "latitude": OSU_LAT, "longitude": OSU_LON,
        "start_date": START, "end_date": END,
        "hourly": hourly,
        "temperature_unit": "fahrenheit", "wind_speed_unit": "mph",
        "precipitation_unit": "inch", "timezone": "UTC",
    }
    for attempt, delay in enumerate([0, 5, 10, 20]):
        if attempt:
            time.sleep(delay)
        try:
            r = requests.get(OPEN_METEO_URL, params=params, timeout=120)
            r.raise_for_status()
            hp = r.json()["hourly"]
            df = pd.DataFrame(hp).rename(columns={"time": "reading_time"})
            df["reading_time"] = pd.to_datetime(df["reading_time"], utc=True)
            pq.write_table(pa.Table.from_pandas(df, preserve_index=False), out, compression="zstd")
            print(f"[fallback] weather.parquet rows={len(df)}")
            return
        except Exception as e:
            print(f"[fallback] weather attempt {attempt} failed: {e}")
    print("[fallback] weather pull gave up")


INIT_SQL = """CREATE OR REPLACE VIEW v_buildings AS
SELECT * FROM read_json_auto('data/raw/buildings_from_api.json');
CREATE OR REPLACE VIEW v_readings AS
SELECT * FROM read_parquet('data/raw/readings/**/readings.parquet', hive_partitioning=1);
CREATE OR REPLACE VIEW v_weather AS
SELECT * FROM read_parquet('data/raw/weather.parquet');
CREATE OR REPLACE VIEW v_readings_with_meta AS
SELECT r.*, b.buildingname, b.campus, b.gross_area, b.latitude, b.longitude,
       b.construction_date, b.building_type
FROM v_readings r LEFT JOIN v_buildings b ON r.siteid = b.buildingnumber;
CREATE OR REPLACE VIEW v_readings_full AS
SELECT rm.*, w.temperature_2m, w.relative_humidity_2m, w.dew_point_2m,
       w.shortwave_radiation, w.wind_speed_10m, w.cloud_cover,
       w.apparent_temperature, w.precipitation
FROM v_readings_with_meta rm
LEFT JOIN v_weather w ON date_trunc('hour', rm.reading_time) = w.reading_time;
"""


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    READINGS.mkdir(parents=True, exist_ok=True)
    FALLBACK.mkdir(parents=True, exist_ok=True)
    (RAW / "init.sql").write_text(INIT_SQL, encoding="utf-8")

    buildings = load_buildings()
    pairs = load_readings(buildings)
    write_meters(pairs)
    pull_weather()

    total = 0
    bytes_ = 0
    for p in READINGS.rglob("*.parquet"):
        bytes_ += p.stat().st_size
        try:
            total += pq.read_metadata(p).num_rows
        except Exception:
            pass
    (RAW / "summary.json").write_text(
        json.dumps({
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "source": "fallback",
            "buildings": int(len(buildings)),
            "meters": int(len(pairs)),
            "readings": int(total),
            "bytes_on_disk": int(bytes_),
            "date_range": {"start": START, "end": END},
        }, indent=2), encoding="utf-8"
    )
    print("[fallback] Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
