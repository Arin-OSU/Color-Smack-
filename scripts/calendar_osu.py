"""
scripts/calendar_osu.py — OSU 2025-2026 academic + holiday + event calendar.

Baked-in dates. No network calls. Consumed by features.py and by the frontend
(mirror written to public/osu_calendar_2025_2026.json).
"""
from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import pandas as pd

ACADEMIC_SESSIONS = [
    ("2025-05-06", "2025-07-30"),   # summer
    ("2025-08-26", "2025-12-10"),   # autumn classes
    ("2025-12-12", "2025-12-17"),   # autumn finals
    ("2026-01-12", "2026-04-27"),   # spring classes
]

BREAKS = [
    ("2025-10-16", "2025-10-17"),   # autumn break
    ("2025-11-26", "2025-11-28"),   # thanksgiving
    ("2025-12-18", "2026-01-11"),   # winter
    ("2026-03-16", "2026-03-20"),   # spring break
]

OSU_HOLIDAYS = [
    "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-11",
    "2025-11-27", "2025-11-28",
    "2025-12-25", "2026-01-01", "2026-01-19",
]

FOOTBALL_HOME = [
    ("2025-08-30", "Texas", "12:00"),
    ("2025-09-06", "Grambling", "15:30"),
    ("2025-09-13", "Ohio", "19:00"),
    ("2025-10-04", "Minnesota", "19:30"),
    ("2025-11-01", "Penn State", "12:00"),
    ("2025-11-15", "UCLA", "19:30"),
    ("2025-11-22", "Rutgers", "12:00"),
]

BASKETBALL_HOME_BIG_TEN = [
    "2026-01-05", "2026-01-17", "2026-01-20", "2026-01-26",
    "2026-02-17", "2026-03-01", "2026-03-07",
]

WEATHER_EVENTS = [
    ("2025-06-22", "2025-06-26", "heat_wave_1"),
    ("2025-07-23", "2025-07-25", "heat_wave_2"),
    ("2026-01-24", "2026-01-26", "winter_storm"),
    ("2026-02-06", "2026-02-07", "polar_vortex"),
]


def _as_date(x: date | datetime | pd.Timestamp | str) -> date:
    if isinstance(x, pd.Timestamp):
        return x.date()
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    return pd.Timestamp(x).date()


_SESSION_DATES: set[date] = set()
for _s, _e in ACADEMIC_SESSIONS:
    for d in pd.date_range(_s, _e, freq="D"):
        _SESSION_DATES.add(d.date())

_HOLIDAY_DATES: set[date] = set()
for _h in OSU_HOLIDAYS:
    _HOLIDAY_DATES.add(_as_date(_h))
for _s, _e in BREAKS:
    for d in pd.date_range(_s, _e, freq="D"):
        _HOLIDAY_DATES.add(d.date())

_FOOTBALL_DATES: set[date] = {_as_date(d) for d, _, _ in FOOTBALL_HOME}
_BASKETBALL_DATES: set[date] = {_as_date(d) for d in BASKETBALL_HOME_BIG_TEN}

_WEATHER_EVENT_DATES: dict[date, str] = {}
for _s, _e, _label in WEATHER_EVENTS:
    for d in pd.date_range(_s, _e, freq="D"):
        _WEATHER_EVENT_DATES[d.date()] = _label


def is_academic_session(ts: pd.Timestamp | datetime | date | str) -> bool:
    return _as_date(ts) in _SESSION_DATES


def is_holiday(ts: pd.Timestamp | datetime | date | str) -> bool:
    return _as_date(ts) in _HOLIDAY_DATES


def is_football_home(ts: pd.Timestamp | datetime | date | str) -> bool:
    return _as_date(ts) in _FOOTBALL_DATES


def is_basketball_home(ts: pd.Timestamp | datetime | date | str) -> bool:
    return _as_date(ts) in _BASKETBALL_DATES


def weather_event_label(ts: pd.Timestamp | datetime | date | str) -> str | None:
    return _WEATHER_EVENT_DATES.get(_as_date(ts))


def vectorized_flags(ts: pd.Series) -> pd.DataFrame:
    """Vectorized flags for a Series of UTC-or-naive timestamps.

    Date derivation should already be in local America/New_York. Caller
    converts tz before passing in (features.py handles that).
    """
    dates = pd.to_datetime(ts).dt.date
    return pd.DataFrame({
        "is_academic_session": dates.map(_SESSION_DATES.__contains__).astype(bool),
        "is_holiday": dates.map(_HOLIDAY_DATES.__contains__).astype(bool),
        "is_football_home": dates.map(_FOOTBALL_DATES.__contains__).astype(bool),
        "is_basketball_home": dates.map(_BASKETBALL_DATES.__contains__).astype(bool),
    })


def export_frontend_json(path: str | Path = "public/osu_calendar_2025_2026.json") -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "academic_sessions": [{"start": s, "end": e} for s, e in ACADEMIC_SESSIONS],
        "breaks": [{"start": s, "end": e} for s, e in BREAKS],
        "holidays": OSU_HOLIDAYS,
        "football_home": [{"date": d, "opponent": o, "kickoff": t} for d, o, t in FOOTBALL_HOME],
        "basketball_home_big_ten": BASKETBALL_HOME_BIG_TEN,
        "weather_events": [{"start": s, "end": e, "label": lbl} for s, e, lbl in WEATHER_EVENTS],
    }
    p.write_text(json.dumps(payload, indent=2), encoding="utf-8")


if __name__ == "__main__":
    export_frontend_json()
    print("Wrote public/osu_calendar_2025_2026.json")
