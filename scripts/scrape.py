"""
scripts/scrape.py — CampusSense OSU Energy Dashboard scraper (Windows-friendly).

Single-file, resumable, idempotent SOAP scraper. Writes partitioned parquet.

Pipeline:
  1. Load WSDL, print operations, save to data/raw/wsdl.xml
  2. getBuildings             -> data/raw/buildings_from_api.json
  3. getBuildingUtilities(b)  -> data/raw/meters_from_api.json
  4. Auto-detect reading op   -> data/raw/READING_OP.txt
  5. Probe max window         -> data/raw/MAX_WINDOW.txt
  6. Scrape readings in chunks at 1 req/sec with exp backoff
     -> data/raw/readings/utility=<u>/building=<b>/readings.parquet
  7. Open-Meteo archive       -> data/raw/weather.parquet
  8. Emit scrape_log.jsonl, summary.json, init.sql

Run:
    python scripts/scrape.py
    python scripts/scrape.py --skip-weather
    python scripts/scrape.py --only-buildings

If `getBuildings` fails 10 times in a row, writes FALLBACK_REQUIRED to
summary.json and exits — load_fallback.py takes over.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import signal
import sys
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

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
from zeep import Client, Settings
from zeep.exceptions import Fault, TransportError
from zeep.transports import Transport


# ---------- Config ----------

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
READINGS_DIR = RAW / "readings"
LOG_PATH = RAW / "scrape_log.jsonl"
SUMMARY_PATH = RAW / "summary.json"

WSDL_URL = os.getenv("OSU_ENERGY_WSDL_URL", "http://energydashboard.osu.edu/dashboard.asmx?WSDL")
SOAP_URL = os.getenv("OSU_ENERGY_SOAP_URL", "http://energydashboard.osu.edu/dashboard.asmx")
USER_AGENT = os.getenv("SCRAPER_USER_AGENT", "CampusSense-Research/0.1 (kumar.1189@osu.edu)")
QPS = float(os.getenv("SCRAPER_RATE_LIMIT_QPS", "1"))
BACKOFF_MS = int(os.getenv("SCRAPER_BACKOFF_MS", "2000"))
MAX_RETRIES = int(os.getenv("SCRAPER_MAX_RETRIES", "5"))
START_DATE = os.getenv("SCRAPE_START", "2025-05-01")
END_DATE = os.getenv("SCRAPE_END", "2026-04-17")

OPEN_METEO_URL = os.getenv("OPEN_METEO_ARCHIVE_URL", "https://archive-api.open-meteo.com/v1/archive")
OSU_LAT = float(os.getenv("OSU_LAT", "40.0795"))
OSU_LON = float(os.getenv("OSU_LON", "-83.0732"))

HEADERS = {"User-Agent": USER_AGENT}

READING_OP_CANDIDATES = [
    "getMeterReadings",
    "getMeterData",
    "getConsumption",
    "getBuildingData",
    "getReadings",
    "getHistoricalData",
    "getTrendData",
]

UTILITY_NORMALIZE = {
    "electric": "electricity",
    "electricity": "electricity",
    "elec": "electricity",
    "natural_gas": "natural_gas",
    "naturalgas": "natural_gas",
    "gas": "natural_gas",
    "steam": "steam",
    "heating_hot_water": "heating_hot_water",
    "hhw": "heating_hot_water",
    "hotwater": "heating_hot_water",
    "chilled_water": "chilled_water",
    "chw": "chilled_water",
    "chilledwater": "chilled_water",
    "domestic_water": "domestic_water",
    "water": "domestic_water",
    "dw": "domestic_water",
}

STOP_REQUESTED = False


def _handle_sigint(_sig: int, _frame: Any) -> None:
    global STOP_REQUESTED
    if STOP_REQUESTED:
        print("\n[scrape] Force exit.")
        sys.exit(130)
    STOP_REQUESTED = True
    print("\n[scrape] Stop requested after current call. Ctrl-C again to force.")


signal.signal(signal.SIGINT, _handle_sigint)


# ---------- Utilities ----------

def ensure_dirs() -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    READINGS_DIR.mkdir(parents=True, exist_ok=True)
    (ROOT / "data" / "fallback").mkdir(parents=True, exist_ok=True)


def log_event(event: dict[str, Any]) -> None:
    event = {"ts": datetime.now(timezone.utc).isoformat(), **event}
    with LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, default=str) + "\n")


def normalize_utility(raw: str | None) -> str:
    if raw is None:
        return "unknown"
    k = str(raw).strip().lower().replace(" ", "_").replace("-", "_")
    return UTILITY_NORMALIZE.get(k, k)


def sleep_qps() -> None:
    time.sleep(max(0.0, 1.0 / max(QPS, 0.001)))


def backoff_sleep(attempt: int, retry_after: float | None = None) -> None:
    if retry_after is not None:
        time.sleep(min(retry_after, 480))
        return
    base = (BACKOFF_MS / 1000.0) * (2 ** attempt)
    jitter = random.uniform(0, 0.25 * base)
    time.sleep(min(base + jitter, 480))


# ---------- Zeep client + SOAP helpers ----------

def build_client() -> Client:
    session = requests.Session()
    session.headers.update(HEADERS)
    transport = Transport(session=session, timeout=60, operation_timeout=120)
    settings = Settings(strict=False, xml_huge_tree=True, raw_response=False)
    print(f"[scrape] Loading WSDL from {WSDL_URL} ...")
    client = Client(wsdl=WSDL_URL, transport=transport, settings=settings)
    return client


def save_wsdl() -> None:
    try:
        r = requests.get(WSDL_URL, headers=HEADERS, timeout=60)
        r.raise_for_status()
        (RAW / "wsdl.xml").write_bytes(r.content)
        print(f"[scrape] Saved WSDL ({len(r.content)} bytes)")
    except Exception as e:
        print(f"[scrape] WSDL raw download failed: {e}")


def list_operations(client: Client) -> list[str]:
    ops: list[str] = []
    for service in client.wsdl.services.values():
        for port in service.ports.values():
            for op in port.binding._operations.values():
                ops.append(op.name)
    ops = sorted(set(ops))
    print(f"[scrape] WSDL exposes {len(ops)} operations:")
    for o in ops:
        print(f"         - {o}")
    return ops


def soap_call(client: Client, op_name: str, **kwargs: Any) -> Any:
    """Call a SOAP op by string name with retries and backoff."""
    fn = getattr(client.service, op_name, None)
    if fn is None:
        raise RuntimeError(f"Operation not found: {op_name}")

    for attempt in range(MAX_RETRIES + 1):
        if STOP_REQUESTED:
            raise KeyboardInterrupt()
        t0 = time.time()
        try:
            result = fn(**kwargs)
            elapsed_ms = int((time.time() - t0) * 1000)
            log_event({"op": op_name, "kwargs": kwargs, "status": "ok", "elapsed_ms": elapsed_ms})
            return result
        except TransportError as e:
            retry_after = None
            if hasattr(e, "status_code") and e.status_code in (429, 503):
                retry_after = 30.0
            if attempt >= MAX_RETRIES:
                log_event({"op": op_name, "kwargs": kwargs, "status": "transport_fail", "err": str(e)})
                raise
            log_event({"op": op_name, "kwargs": kwargs, "status": "retry", "attempt": attempt, "err": str(e)})
            backoff_sleep(attempt, retry_after)
        except Fault as e:
            if attempt >= MAX_RETRIES:
                log_event({"op": op_name, "kwargs": kwargs, "status": "fault", "err": str(e)})
                raise
            log_event({"op": op_name, "kwargs": kwargs, "status": "retry_fault", "attempt": attempt, "err": str(e)})
            backoff_sleep(attempt)
        except Exception as e:
            if attempt >= MAX_RETRIES:
                log_event({"op": op_name, "kwargs": kwargs, "status": "error", "err": str(e)})
                raise
            log_event({"op": op_name, "kwargs": kwargs, "status": "retry_err", "attempt": attempt, "err": str(e)})
            backoff_sleep(attempt)
    raise RuntimeError(f"exhausted retries for {op_name}")


def to_dict(obj: Any) -> Any:
    """Recursively convert zeep/OrderedDict/list objects to plain dicts."""
    if obj is None:
        return None
    if hasattr(obj, "__values__"):
        return {k: to_dict(v) for k, v in obj.__values__.items()}
    if isinstance(obj, dict):
        return {k: to_dict(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [to_dict(x) for x in obj]
    if isinstance(obj, (datetime,)):
        return obj.isoformat()
    return obj


def normalize_buildings(raw: Any) -> list[dict[str, Any]]:
    """Coerce getBuildings output into a list of dicts with canonical keys."""
    items = to_dict(raw)
    if isinstance(items, dict):
        for key in ("Buildings", "Building", "buildings", "items", "Table", "diffgram"):
            if key in items:
                items = items[key]
                break
    if isinstance(items, dict):
        vals = list(items.values())
        if len(vals) == 1 and isinstance(vals[0], list):
            items = vals[0]
    if not isinstance(items, list):
        return []

    def find_int(d: dict[str, Any], keys: list[str]) -> int | None:
        for k in keys:
            for actual in d.keys():
                if actual.lower() == k.lower():
                    v = d[actual]
                    try:
                        return int(v) if v not in (None, "") else None
                    except (ValueError, TypeError):
                        return None
        return None

    def find_str(d: dict[str, Any], keys: list[str]) -> str | None:
        for k in keys:
            for actual in d.keys():
                if actual.lower() == k.lower():
                    v = d[actual]
                    return str(v) if v not in (None, "") else None
        return None

    def find_float(d: dict[str, Any], keys: list[str]) -> float | None:
        for k in keys:
            for actual in d.keys():
                if actual.lower() == k.lower():
                    v = d[actual]
                    try:
                        return float(v) if v not in (None, "") else None
                    except (ValueError, TypeError):
                        return None
        return None

    out: list[dict[str, Any]] = []
    for row in items:
        if not isinstance(row, dict):
            continue
        out.append(
            {
                "buildingnumber": find_int(row, ["buildingnumber", "buildingNumber", "bldgKey", "bldgkey", "BldgKey", "id", "buildingId"]),
                "buildingname": find_str(row, ["buildingname", "buildingName", "name", "BuildingName"]),
                "campus": find_str(row, ["campus", "Campus", "location"]) or "Columbus",
                "gross_area": find_int(row, ["gross_area", "grossArea", "grossSquareFeet", "sqft", "area"]),
                "floors_above_ground": find_int(row, ["floors_above_ground", "floorsAboveGround", "floors"]),
                "construction_date": find_str(row, ["construction_date", "constructionDate", "yearBuilt", "yearOpened"]),
                "latitude": find_float(row, ["latitude", "Latitude", "lat"]),
                "longitude": find_float(row, ["longitude", "Longitude", "lon", "lng"]),
                "building_type": find_str(row, ["building_type", "buildingType", "type"]),
                "status": find_str(row, ["status", "Status"]) or "active",
                "_raw": row,
            }
        )
    out = [b for b in out if b["buildingnumber"] is not None]
    return out


# ---------- Step 2: buildings ----------

def step_buildings(client: Client) -> list[dict[str, Any]]:
    path = RAW / "buildings_from_api.json"
    if path.exists():
        print(f"[scrape] Reusing cached {path.name}")
        return json.loads(path.read_text(encoding="utf-8"))

    print("[scrape] Calling getBuildings ...")
    consecutive_fails = 0
    for attempt in range(MAX_RETRIES + 1):
        try:
            raw = soap_call(client, "getBuildings")
            buildings = normalize_buildings(raw)
            if not buildings:
                raise RuntimeError(f"getBuildings returned no parseable rows (raw type={type(raw).__name__})")
            path.write_text(json.dumps(buildings, indent=2, default=str), encoding="utf-8")
            print(f"[scrape] Saved {len(buildings)} buildings -> {path.name}")
            return buildings
        except Exception as e:
            consecutive_fails += 1
            print(f"[scrape] getBuildings attempt {attempt} failed: {e}")
            if consecutive_fails >= 10 or attempt >= MAX_RETRIES:
                write_summary({"status": "FALLBACK_REQUIRED", "reason": str(e)})
                print("[scrape] Too many failures. Wrote FALLBACK_REQUIRED. Exiting.")
                sys.exit(2)
            backoff_sleep(attempt)
    return []


# ---------- Step 3: meters ----------

def normalize_meters(raw: Any, building_id: int) -> list[dict[str, Any]]:
    items = to_dict(raw)
    if isinstance(items, dict):
        for key in ("Utilities", "Utility", "utilities", "items", "Table", "Meters", "Meter", "meters"):
            if key in items:
                items = items[key]
                break
    if isinstance(items, dict):
        vals = list(items.values())
        if len(vals) == 1 and isinstance(vals[0], list):
            items = vals[0]
    if not isinstance(items, list):
        items = [items] if items else []

    out: list[dict[str, Any]] = []
    for row in items:
        if not isinstance(row, dict):
            continue
        utility = None
        for k in row.keys():
            if k.lower() in ("utility", "utilityname", "utilitytype", "meter_type", "metertype", "type", "name"):
                utility = normalize_utility(str(row[k]))
                break
        unit = None
        for k in row.keys():
            if k.lower() in ("unit", "units", "uom"):
                unit = str(row[k])
                break
        out.append(
            {
                "building_id": building_id,
                "utility": utility or "unknown",
                "unit": unit or "kWh",
                "status": "active",
                "_raw": row,
            }
        )
    return out


def step_meters(client: Client, buildings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    path = RAW / "meters_from_api.json"
    if path.exists():
        print(f"[scrape] Reusing cached {path.name}")
        return json.loads(path.read_text(encoding="utf-8"))

    print(f"[scrape] Calling getBuildingUtilities for {len(buildings)} buildings ...")
    meters: list[dict[str, Any]] = []
    try:
        for b in tqdm(buildings, desc="meters"):
            if STOP_REQUESTED:
                break
            bldg = b["buildingnumber"]
            try:
                raw = soap_call(client, "getBuildingUtilities", bldgKey=bldg)
            except TypeError:
                raw = soap_call(client, "getBuildingUtilities", buildingNumber=bldg)
            except Exception as e:
                log_event({"op": "getBuildingUtilities", "building": bldg, "status": "error", "err": str(e)})
                sleep_qps()
                continue
            meters.extend(normalize_meters(raw, bldg))
            sleep_qps()
    finally:
        path.write_text(json.dumps(meters, indent=2, default=str), encoding="utf-8")
        print(f"[scrape] Saved {len(meters)} meters -> {path.name}")
    return meters


# ---------- Step 4: reading op detection ----------

def detect_reading_op(client: Client, building_id: int) -> tuple[str, dict[str, Any]]:
    """Return (op_name, canonical_kwargs_template)."""
    path = RAW / "READING_OP.txt"
    if path.exists():
        line = path.read_text(encoding="utf-8").strip()
        if line:
            print(f"[scrape] Reusing reading op: {line}")
            return line.split("|", 1)[0], json.loads(line.split("|", 1)[1]) if "|" in line else {}

    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)

    param_variants = [
        {"bldgKey": building_id, "utility": "electricity", "startDate": start, "endDate": end},
        {"buildingNumber": building_id, "utility": "electricity", "startDate": start, "endDate": end},
        {"bldgKey": building_id, "utilityType": "electricity", "startDate": start, "endDate": end},
        {"bldgKey": building_id, "startDate": start, "endDate": end},
        {"bldgKey": building_id, "utility": "Electric", "startDate": start, "endDate": end},
    ]

    available_ops = set()
    for service in client.wsdl.services.values():
        for port in service.ports.values():
            for op in port.binding._operations.values():
                available_ops.add(op.name)

    for op in READING_OP_CANDIDATES:
        if op not in available_ops:
            continue
        for variant in param_variants:
            try:
                print(f"[scrape] Probe reading op {op} with keys {list(variant.keys())} ...")
                raw = soap_call(client, op, **variant)
                rows = flatten_readings(raw, building_id, "electricity")
                if rows is None:
                    continue
                path.write_text(f"{op}|{json.dumps(variant, default=str)}", encoding="utf-8")
                print(f"[scrape] Reading op detected: {op}  (rows from probe={len(rows)})")
                template = {k: None for k in variant}
                return op, template
            except Exception as e:
                log_event({"op": op, "probe_kwargs": list(variant.keys()), "status": "probe_fail", "err": str(e)})
                continue

    raise RuntimeError("No reading op worked. Manual investigation required.")


# ---------- Step 5: max window probe ----------

def probe_max_window(client: Client, op: str, building_id: int) -> int:
    path = RAW / "MAX_WINDOW.txt"
    if path.exists():
        try:
            return int(path.read_text(encoding="utf-8").strip())
        except ValueError:
            pass

    candidates = [1, 7, 30, 90, 365]
    end = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=2)
    largest_ok = 1
    for days in candidates:
        start = end - timedelta(days=days)
        try:
            print(f"[scrape] Probe window={days}d on building {building_id} / electricity ...")
            raw = soap_call(
                client, op, bldgKey=building_id, utility="electricity", startDate=start, endDate=end
            )
            rows = flatten_readings(raw, building_id, "electricity")
            if rows is not None:
                largest_ok = days
                sleep_qps()
            else:
                break
        except Exception as e:
            log_event({"op": op, "probe_window_days": days, "status": "fail", "err": str(e)})
            break
    path.write_text(str(largest_ok), encoding="utf-8")
    print(f"[scrape] Max window: {largest_ok} days")
    return largest_ok


# ---------- Step 6: readings scrape ----------

def flatten_readings(raw: Any, building_id: int, utility: str) -> list[dict[str, Any]] | None:
    """Return normalized rows or None if the payload looks unparseable."""
    items = to_dict(raw)
    if items is None:
        return None
    if isinstance(items, dict):
        for key in (
            "Readings", "Reading", "readings", "items", "Table",
            "MeterReadings", "Data", "data", "Consumption", "results",
        ):
            if key in items:
                items = items[key]
                break
    if isinstance(items, dict):
        vals = list(items.values())
        if len(vals) == 1 and isinstance(vals[0], list):
            items = vals[0]
    if not isinstance(items, list):
        return None

    rows: list[dict[str, Any]] = []
    for r in items:
        if not isinstance(r, dict):
            continue
        t = None
        for k in r.keys():
            if k.lower() in ("reading_time", "readingtime", "timestamp", "time", "datetime", "readingdatetime"):
                t = r[k]
                break
        v = None
        for k in r.keys():
            if k.lower() in ("readingvalue", "reading_value", "value", "consumption", "usage"):
                v = r[k]
                break
        if v is None:
            for k in r.keys():
                if k.lower() in ("readingwindowmean", "windowmean", "averagevalue"):
                    v = r[k]
                    break
        if t is None:
            continue
        try:
            ts = pd.to_datetime(t, utc=True).to_pydatetime()
        except Exception:
            continue
        try:
            vv = float(v) if v is not None else None
        except (ValueError, TypeError):
            vv = None
        rows.append(
            {
                "siteid": building_id,
                "utility": utility,
                "reading_time": ts,
                "readingvalue": vv,
            }
        )
    return rows


def parquet_path(building_id: int, utility: str) -> Path:
    return READINGS_DIR / f"utility={utility}" / f"building={building_id}" / "readings.parquet"


def write_parquet(rows: list[dict[str, Any]], building_id: int, utility: str) -> int:
    if not rows:
        return 0
    p = parquet_path(building_id, utility)
    p.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(rows).drop_duplicates(subset=["siteid", "utility", "reading_time"])
    df["reading_time"] = pd.to_datetime(df["reading_time"], utc=True)
    if p.exists():
        prior = pd.read_parquet(p)
        df = pd.concat([prior, df], ignore_index=True)
        df = df.drop_duplicates(subset=["siteid", "utility", "reading_time"])
        df = df.sort_values("reading_time")
    table = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(table, p, compression="zstd")
    return len(df)


def expected_rows(start: datetime, end: datetime) -> int:
    minutes = int((end - start).total_seconds() // 60)
    return max(0, minutes // 15)


def step_readings(
    client: Client,
    buildings: list[dict[str, Any]],
    meters: list[dict[str, Any]],
    op: str,
    max_window: int,
) -> None:
    start_dt = datetime.fromisoformat(START_DATE).replace(tzinfo=timezone.utc)
    end_dt = datetime.fromisoformat(END_DATE).replace(tzinfo=timezone.utc)

    pairs: list[tuple[int, str]] = []
    bldg_ids = {b["buildingnumber"] for b in buildings}
    seen: set[tuple[int, str]] = set()
    for m in meters:
        key = (m["building_id"], m["utility"])
        if m["utility"] in ("unknown", "") or m["building_id"] not in bldg_ids:
            continue
        if key in seen:
            continue
        seen.add(key)
        pairs.append(key)
    print(f"[scrape] Scraping {len(pairs)} (building, utility) pairs over {(end_dt - start_dt).days} days ...")

    expected = expected_rows(start_dt, end_dt)
    window = timedelta(days=max_window)

    pbar = tqdm(pairs, desc="readings")
    for building_id, utility in pbar:
        if STOP_REQUESTED:
            break
        out_path = parquet_path(building_id, utility)
        if out_path.exists():
            try:
                existing = pq.read_metadata(out_path).num_rows
            except Exception:
                existing = 0
            if existing >= int(expected * 0.95):
                pbar.set_postfix_str(f"skip {building_id}/{utility}")
                continue

        pbar.set_postfix_str(f"{building_id}/{utility}")
        all_rows: list[dict[str, Any]] = []
        cursor = start_dt
        while cursor < end_dt:
            if STOP_REQUESTED:
                break
            chunk_end = min(cursor + window, end_dt)
            try:
                raw = soap_call(
                    client, op,
                    bldgKey=building_id,
                    utility=utility,
                    startDate=cursor,
                    endDate=chunk_end,
                )
                rows = flatten_readings(raw, building_id, utility) or []
                all_rows.extend(rows)
                log_event({
                    "op": op, "building": building_id, "utility": utility,
                    "start": cursor.isoformat(), "end": chunk_end.isoformat(),
                    "rows": len(rows), "status": "ok",
                })
            except Exception as e:
                log_event({
                    "op": op, "building": building_id, "utility": utility,
                    "start": cursor.isoformat(), "end": chunk_end.isoformat(),
                    "status": "chunk_fail", "err": str(e),
                })
            cursor = chunk_end
            sleep_qps()

        if all_rows:
            n = write_parquet(all_rows, building_id, utility)
            log_event({"building": building_id, "utility": utility, "status": "parquet", "rows": n})


# ---------- Step 7: weather ----------

def step_weather() -> None:
    path = RAW / "weather.parquet"
    if path.exists():
        try:
            nrows = pq.read_metadata(path).num_rows
            if nrows >= 7000:
                print(f"[scrape] Reusing cached weather.parquet ({nrows} rows)")
                return
        except Exception:
            pass

    hourly = ",".join([
        "temperature_2m", "relative_humidity_2m", "dew_point_2m",
        "shortwave_radiation", "direct_radiation", "diffuse_radiation",
        "wind_speed_10m", "wind_speed_100m", "wind_direction_10m", "wind_direction_100m",
        "cloud_cover", "apparent_temperature", "precipitation",
    ])
    params = {
        "latitude": OSU_LAT,
        "longitude": OSU_LON,
        "start_date": START_DATE,
        "end_date": END_DATE,
        "hourly": hourly,
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "UTC",
    }
    print(f"[scrape] Pulling Open-Meteo {START_DATE} -> {END_DATE} ...")
    delays = [5, 10, 20]
    for attempt, delay in enumerate([0] + delays):
        if attempt:
            time.sleep(delay)
        try:
            r = requests.get(OPEN_METEO_URL, params=params, headers=HEADERS, timeout=120)
            r.raise_for_status()
            payload = r.json()
            hourly_data = payload["hourly"]
            df = pd.DataFrame(hourly_data)
            df.rename(columns={"time": "reading_time"}, inplace=True)
            df["reading_time"] = pd.to_datetime(df["reading_time"], utc=True)
            table = pa.Table.from_pandas(df, preserve_index=False)
            pq.write_table(table, path, compression="zstd")
            print(f"[scrape] Saved weather.parquet ({len(df)} rows)")
            log_event({"step": "weather", "rows": len(df), "status": "ok"})
            return
        except Exception as e:
            log_event({"step": "weather", "attempt": attempt, "status": "fail", "err": str(e)})
            print(f"[scrape] Weather attempt {attempt} failed: {e}")
    print("[scrape] Weather pull exhausted retries. Continuing.")


# ---------- Step 8: init.sql + summary ----------

INIT_SQL = """-- Generated by scripts/scrape.py. DuckDB views over scraped parquet.
CREATE OR REPLACE VIEW v_buildings AS
SELECT * FROM read_json_auto('data/raw/buildings_from_api.json');

CREATE OR REPLACE VIEW v_readings AS
SELECT * FROM read_parquet('data/raw/readings/**/readings.parquet', hive_partitioning=1);

CREATE OR REPLACE VIEW v_weather AS
SELECT * FROM read_parquet('data/raw/weather.parquet');

CREATE OR REPLACE VIEW v_readings_with_meta AS
SELECT r.*, b.buildingname, b.campus, b.gross_area, b.latitude, b.longitude,
       b.construction_date, b.building_type
FROM v_readings r
LEFT JOIN v_buildings b ON r.siteid = b.buildingnumber;

CREATE OR REPLACE VIEW v_readings_full AS
SELECT rm.*, w.temperature_2m, w.relative_humidity_2m, w.dew_point_2m,
       w.shortwave_radiation, w.wind_speed_10m, w.cloud_cover,
       w.apparent_temperature, w.precipitation
FROM v_readings_with_meta rm
LEFT JOIN v_weather w
  ON date_trunc('hour', rm.reading_time) = w.reading_time;
"""


def write_init_sql() -> None:
    (RAW / "init.sql").write_text(INIT_SQL, encoding="utf-8")


@dataclass
class Counters:
    buildings: int = 0
    meters: int = 0
    readings: int = 0
    bytes_on_disk: int = 0
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    finished_at: str | None = None
    errors: dict[str, int] = field(default_factory=dict)


def write_summary(extra: dict[str, Any] | None = None) -> None:
    buildings = 0
    meters = 0
    try:
        bp = RAW / "buildings_from_api.json"
        if bp.exists():
            buildings = len(json.loads(bp.read_text(encoding="utf-8")))
        mp = RAW / "meters_from_api.json"
        if mp.exists():
            meters = len(json.loads(mp.read_text(encoding="utf-8")))
    except Exception:
        pass

    readings = 0
    bytes_on_disk = 0
    if READINGS_DIR.exists():
        for p in READINGS_DIR.rglob("*.parquet"):
            bytes_on_disk += p.stat().st_size
            try:
                readings += pq.read_metadata(p).num_rows
            except Exception:
                pass

    errors: dict[str, int] = {}
    if LOG_PATH.exists():
        try:
            for line in LOG_PATH.read_text(encoding="utf-8").splitlines():
                try:
                    ev = json.loads(line)
                except Exception:
                    continue
                status = ev.get("status", "")
                if status and status not in ("ok", "retry", "retry_fault", "retry_err", "parquet"):
                    errors[status] = errors.get(status, 0) + 1
        except Exception:
            pass

    summary = {
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "buildings": buildings,
        "meters": meters,
        "readings": readings,
        "bytes_on_disk": bytes_on_disk,
        "date_range": {"start": START_DATE, "end": END_DATE},
        "errors": errors,
    }
    if extra:
        summary.update(extra)
    SUMMARY_PATH.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(f"[scrape] Summary -> {SUMMARY_PATH.name}  (buildings={buildings}, meters={meters}, readings={readings:,})")


# ---------- Main ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-weather", action="store_true")
    ap.add_argument("--only-buildings", action="store_true", help="Stop after getBuildings")
    ap.add_argument("--only-meters", action="store_true", help="Stop after getBuildingUtilities")
    ap.add_argument("--dry-run", action="store_true", help="Inspect WSDL + print ops then exit")
    args = ap.parse_args()

    ensure_dirs()
    write_init_sql()
    save_wsdl()

    try:
        client = build_client()
    except Exception as e:
        print(f"[scrape] Zeep client build failed: {e}")
        traceback.print_exc()
        write_summary({"status": "FALLBACK_REQUIRED", "reason": f"wsdl_load_failed: {e}"})
        return 2

    list_operations(client)

    if args.dry_run:
        return 0

    buildings = step_buildings(client)
    if args.only_buildings:
        write_summary()
        return 0
    if not buildings:
        write_summary({"status": "FALLBACK_REQUIRED", "reason": "no_buildings"})
        return 2

    meters = step_meters(client, buildings)
    if args.only_meters:
        write_summary()
        return 0

    probe_bldg = 44073 if any(b["buildingnumber"] == 44073 for b in buildings) else buildings[0]["buildingnumber"]

    try:
        op, _template = detect_reading_op(client, probe_bldg)
    except Exception as e:
        print(f"[scrape] Reading op detection failed: {e}")
        write_summary({"status": "FALLBACK_REQUIRED", "reason": f"no_reading_op: {e}"})
        return 2

    max_window = probe_max_window(client, op, probe_bldg)

    step_readings(client, buildings, meters, op, max_window)

    if not args.skip_weather:
        step_weather()

    write_summary()
    print("[scrape] Done.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        write_summary({"status": "INTERRUPTED"})
        print("\n[scrape] Interrupted. Progress saved. Re-run to resume.")
        sys.exit(130)
