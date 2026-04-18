# CampusSense Build Meta-Prompt

**For:** Claude Code, executing the 44-hour CampusSense build at Claude Hacks @ Ohio State, April 17-19, 2026.
**Owner:** David Kumar, OSU Fisher.
**Judge target:** IGS Energy (Silver sponsor).
**Generated:** 2026-04-18 from `./research/campussense/GROUND_TRUTH.md` plus 20 agent reports under `./research/campussense/`.

---

## 0. How to use this document

This is your build contract. Every section below is load-bearing. If something is labeled UNCONFIRMED or SPEC-ONLY, it needs a verification step before it ships. If something is labeled HARD RULE, it never changes.

One explicit gap exists: **Section 16 (Frontend Design)**. David will drop a separate frontend design prompt on top of this one. When that prompt arrives, integrate its UI/UX guidance into Section 16, then wire the components to the backend contracts defined in Sections 9 through 15. The backend in this doc is specified completely enough that the frontend prompt only needs to render views against the view directive contract in Section 9c.

Before writing a single line of code: read Section 1, Section 2, and Section 22. They tell you what cannot go wrong.

---

## 1. Hard rules

1. **No em dashes anywhere.** Not in code comments, not in UI copy, not in Claude system prompts, not in commit messages. David does not want em dashes in anything written on his behalf. Use hyphens, periods, or sentence splits instead.
2. **No fabricated data.** If the live scrape fails and the fallback CSVs are not available, the UI labels the demo state `SPEC MODE` and shows clear placeholders. Never pass synthetic numbers as real.
3. **Cost math is precomputed, never hallucinated.** Claude explanations receive `cost_impact_usd` as an injected number in the tool result. The model never multiplies rates on its own.
4. **IGS framing is "layer on JadeTrack," never "replace JadeTrack."** Anywhere the product mentions IGS, use the safe-claims vocabulary from Section 20.
5. **Jordan Clark, not Julian Clark.** Civil, Environmental and Geodetic Engineering, OSU Sustainability Institute. Appears in README, pitch deck, and any "credits" UI.
6. **The 16% figure is "overall energy reduction since 2018 while adding buildings," not per-sqft.**
7. **Medical Center phrasing is "wing-level energy use," never anything that sounds like patient data.**
8. **Target models:**
   - `claude-haiku-4-5-20251001` for anomaly explanations and work order drafts.
   - `claude-sonnet-4-6` for the analyst chat (tool use).
   - `claude-opus-4-7` reserved for a "deep analysis" button if built; optional.
9. **HARD STOP: never quote more than 15 words from any single source** in UI copy or explanations. Paraphrase.
10. **All timestamps stored in UTC.** Local time (America/New_York) is derived only for feature engineering and display.
11. **Replay pin default:** `DEMO_FROZEN_MODE=true`, frozen "now" = `2026-01-27T08:00:00-05:00`. This lands Hero 3 (polar-vortex Med Center) as "yesterday's anomaly," the morning after the 2026-01-25 11.9 inch record snowstorm.
12. **If the hackathon is already live and running, prefer speed over perfection.** Every section below has a "ship-first" variant.

---

## 2. Pre-flight (do these first, in order)

Working directory is `C:\claudeathon` on Windows 11. Commands run in Git Bash or the Claude Code bash shell (Unix syntax, forward slashes).

```bash
# 1. Confirm tooling
node --version          # expect >=20
pnpm --version          # expect >=9; install with: npm i -g pnpm
python --version        # expect 3.11 or 3.12; 3.13 works too
# Supabase CLI on Windows: scoop install supabase  (preferred)
#   or: winget install Supabase.CLI
#   or: download supabase_windows_amd64.tar.gz from github.com/supabase/cli/releases

# 2. Create layout (idempotent)
mkdir -p app/api components lib scripts supabase/migrations models meta data/raw/readings data/fallback cache/claude demo/backup logs public/fallback

# 3. Keep research, ignore data
touch .gitignore
grep -qxF 'data/' .gitignore || echo 'data/' >> .gitignore
grep -qxF 'models/' .gitignore || echo 'models/' >> .gitignore
grep -qxF 'meta/' .gitignore || echo 'meta/' >> .gitignore
grep -qxF '.venv/' .gitignore || echo '.venv/' >> .gitignore
grep -qxF '.env.local' .gitignore || echo '.env.local' >> .gitignore
grep -qxF 'cache/' .gitignore || echo 'cache/' >> .gitignore
grep -qxF 'logs/' .gitignore || echo 'logs/' >> .gitignore
grep -qxF 'node_modules/' .gitignore || echo 'node_modules/' >> .gitignore
grep -qxF '.next/' .gitignore || echo '.next/' >> .gitignore

# 4. Python venv (Windows activation path)
python -m venv .venv
source .venv/Scripts/activate          # Git Bash. PowerShell: .venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install "lightgbm==4.6.0" "scipy>=1.11" "pandas>=2.2" "pyarrow>=14" "duckdb>=1.0" "zeep>=4.2" "requests>=2.31" "tqdm>=4.66" "lxml>=5" "python-dateutil>=2.8" "joblib>=1.4" "anthropic>=0.40" "supabase>=2.0"

# 5. Next.js app
pnpm create next-app@latest . --ts --tailwind --app --eslint --use-pnpm --import-alias "@/*" --src-dir=false
pnpm add @supabase/supabase-js @anthropic-ai/sdk mapbox-gl recharts next-themes lucide-react class-variance-authority clsx tailwind-merge framer-motion
pnpm add -D @types/mapbox-gl

# 6. shadcn/ui init
pnpm dlx shadcn@latest init -y
pnpm dlx shadcn@latest add button card badge sheet tabs textarea input skeleton command dialog dropdown-menu select sonner tooltip scroll-area separator avatar collapsible chart empty table toggle-group

# 7. Supabase CLI (Windows)
scoop install supabase      # or: winget install Supabase.CLI
supabase --version
```

Then, still pre-build:

```bash
# 8. Stub env
cp .env.example .env.local   # after Section 3 file is written
# Fill in ANTHROPIC_API_KEY and NEXT_PUBLIC_MAPBOX_TOKEN at minimum.

# 9. Smoke test
pnpm dev
# Expect the default Next.js starter at http://localhost:3000. Ctrl+C, then continue.
```

**Background process convention on Windows.** This doc references `tmux` several times. On Windows pick one equivalent and stick with it for the demo:
- A second Git Bash / Windows Terminal tab (simplest).
- `start /B python scripts/replay.py` from cmd.exe.
- PowerShell: `Start-Process python -ArgumentList "scripts/replay.py" -WindowStyle Hidden`.
- Claude Code's own `run_in_background=true` on Bash calls.

---

## 3. `.env.example` (commit this exact file)

Create `/.env.example` with the following. David then copies to `.env.local` and fills values.

```bash
# ============================================================
# CampusSense .env.example
# Copy to .env.local. DO NOT commit .env.local.
# ============================================================

# Anthropic (Claude API)
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
ANTHROPIC_MODEL_CHAT=claude-sonnet-4-6
ANTHROPIC_MODEL_EXPLAIN=claude-haiku-4-5-20251001
ANTHROPIC_MODEL_DEEP=claude-opus-4-7

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://REPLACE_ME.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...REPLACE_ME
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...REPLACE_ME
DATABASE_URL=postgresql://postgres.REPLACE_PROJECT_REF:REPLACE_PASSWORD@aws-0-us-east-1.pooler.supabase.com:5432/postgres

# Mapbox (public token with URL restrictions)
NEXT_PUBLIC_MAPBOX_TOKEN=pk.REPLACE_ME

# App
NEXT_PUBLIC_APP_URL=https://campussense.vercel.app
NODE_ENV=development

# Demo toggles
USE_CACHED_CLAUDE=false
DEMO_FROZEN_MODE=true
DEMO_FROZEN_NOW=2026-01-27T08:00:00-05:00
DEMO_SEED_FIXTURES=true

# OSU Energy Dashboard (scraper)
OSU_ENERGY_SOAP_URL=http://energydashboard.osu.edu/dashboard.asmx
OSU_ENERGY_WSDL_URL=http://energydashboard.osu.edu/dashboard.asmx?WSDL
SCRAPER_USER_AGENT=CampusSense-Research/0.1 (kumar.1189@osu.edu)
SCRAPER_RATE_LIMIT_QPS=1
SCRAPER_BACKOFF_MS=2000
SCRAPER_MAX_RETRIES=5
SCRAPE_START=2025-05-01
SCRAPE_END=2026-04-17

# Open-Meteo
OPEN_METEO_ARCHIVE_URL=https://archive-api.open-meteo.com/v1/archive
OPEN_METEO_FORECAST_URL=https://api.open-meteo.com/v1/forecast
OSU_LAT=40.0795
OSU_LON=-83.0732

# Observability (optional)
SENTRY_DSN=
```

Mirror all of these into Vercel (Production and Preview) except service role keys which go to Production only.

---

## 4. Data pipeline

### 4a. The single-file scraper

This is the most important file in the repo. It must be runnable standalone. Path: `scripts/scrape.py`.

Behavior contract:
- Pulls the WSDL, prints all operations, writes `data/raw/wsdl.xml`.
- Calls `getBuildings`, writes `data/raw/buildings_from_api.json`.
- Calls `getBuildingUtilities(bldgKey)` for every building, writes `data/raw/meters_from_api.json`.
- Auto-detects the reading retrieval op (try `getMeterReadings`, `getMeterData`, `getConsumption`, `getBuildingData`, `getReadings`, `getHistoricalData`, `getTrendData` in that order). Write the winning op name to `data/raw/READING_OP.txt`.
- Probes max window against building 44073 electricity: 1d, 7d, 30d, 90d, 365d. Write the largest passing window to `data/raw/MAX_WINDOW.txt`.
- Scrapes 2025-05-01 to 2026-04-17 for every (building, utility) at 1 req/sec with exponential backoff (2-4-8-16 sec, cap 480 sec, max 5 retries, honor Retry-After).
- Writes partitioned parquet to `data/raw/readings/utility=<u>/building=<b>/readings.parquet`.
- Hits Open-Meteo archive for the same window; writes `data/raw/weather.parquet`.
- Writes `data/raw/scrape_log.jsonl` (one line per call: ts, building, utility, status, bytes, elapsed_ms, rows).
- Writes `data/raw/summary.json`: total buildings, total meters, total readings, date range, total bytes on disk, total elapsed, error breakdown.
- Writes `data/raw/init.sql` with DuckDB views (see Section 4d).

Header (HARD RULE):

```python
USER_AGENT = "CampusSense-Research/0.1 (kumar.1189@osu.edu)"
HEADERS = {
    "User-Agent": USER_AGENT,
    "Content-Type": "text/xml; charset=utf-8",
}
```

Idempotency: skip a (building, utility) if its parquet already exists and has the expected row count for the window. Resume-from-last-seen is better than full restart.

Fallback path (if the API is unreachable after 10 consecutive failures on `getBuildings`):
- Log loudly.
- Exit with `FALLBACK_REQUIRED` in `data/raw/summary.json`.
- A separate script `scripts/load_fallback.py` (Section 4b) takes over.

### 4b. Fallback loader

Path: `scripts/load_fallback.py`. Reads from `data/fallback/`:
- `meter-data-oct-2025.txt` (~223 MB, pipe or tab separated; sniff with `pandas.read_csv(sep=None, engine='python')`)
- `building_metadata.txt`
- `weather-sept-oct-2025.txt`

Normalizes to the parquet layout from Section 4a. Writes to `data/raw/readings/utility=<u>/building=<b>/readings.parquet` using the same partitioning. For weather, if the fallback CSV is the Sept-Oct window only, still pull Open-Meteo for the full 2025-05-01 to 2026-04-17 window (Open-Meteo does not need the SOAP API, so even in fallback mode, run the weather pull).

David will drop the three files at a path he chooses. The pre-flight script prompts him for that path and copies into `data/fallback/`.

### 4c. Open-Meteo weather pull

Endpoint: `https://archive-api.open-meteo.com/v1/archive`. Query string:

```
latitude=40.0795
longitude=-83.0732
start_date=2025-05-01
end_date=2026-04-17
hourly=temperature_2m,relative_humidity_2m,dew_point_2m,shortwave_radiation,direct_radiation,diffuse_radiation,wind_speed_10m,wind_speed_100m,wind_direction_10m,wind_direction_100m,cloud_cover,apparent_temperature,precipitation
temperature_unit=fahrenheit
wind_speed_unit=mph
precipitation_unit=inch
timezone=UTC
```

Write to `data/raw/weather.parquet`. Expected 8,448 rows (352 days x 24 hr). All timestamps UTC.

Retry: 3 tries with 5, 10, 20 sec backoff. No API key required.

### 4d. Parquet layout + DuckDB views

Partition scheme:

```
data/raw/
  buildings_from_api.json
  meters_from_api.json
  readings/
    utility=electricity/
      building=44073/readings.parquet
      building=44074/readings.parquet
      ...
    utility=natural_gas/...
    utility=chilled_water/...
    utility=heating_hot_water/...
  weather.parquet
  scrape_log.jsonl
  summary.json
  init.sql
  READING_OP.txt
  MAX_WINDOW.txt
```

`data/raw/init.sql` contents:

```sql
-- Buildings table from API JSON
CREATE OR REPLACE VIEW v_buildings AS
SELECT * FROM read_json_auto('data/raw/buildings_from_api.json');

-- Readings with hive partitioning
CREATE OR REPLACE VIEW v_readings AS
SELECT * FROM read_parquet('data/raw/readings/**/readings.parquet', hive_partitioning=1);

-- Weather
CREATE OR REPLACE VIEW v_weather AS
SELECT * FROM read_parquet('data/raw/weather.parquet');

-- Readings joined to buildings
CREATE OR REPLACE VIEW v_readings_with_meta AS
SELECT r.*, b.buildingname, b.campus, b.gross_area, b.latitude, b.longitude,
       b.construction_date, b.building_type
FROM v_readings r
LEFT JOIN v_buildings b ON r.siteid = b.buildingnumber;

-- Readings joined to hourly weather (floor to hour)
CREATE OR REPLACE VIEW v_readings_full AS
SELECT rm.*, w.temperature_2m, w.relative_humidity_2m, w.dew_point_2m,
       w.shortwave_radiation, w.wind_speed_10m, w.cloud_cover,
       w.apparent_temperature, w.precipitation
FROM v_readings_with_meta rm
LEFT JOIN v_weather w
  ON date_trunc('hour', rm.reading_time) = w.reading_time;
```

Schema validation step (HARD RULE). At the top of the training script, run:

```python
import duckdb
con = duckdb.connect()
con.execute(open('data/raw/init.sql').read())
row = con.execute("SELECT * FROM v_readings LIMIT 1").fetchone()
cols = [d[0] for d in con.description]
required = {'siteid','utility','reading_time','readingvalue'}
missing = required - set(cols)
if missing:
    raise RuntimeError(f"Schema mismatch. Missing columns: {missing}. Actual: {cols}")
```

If the scraped shape differs from Section 5 below, stop and log the divergence. Do not silently remap.

### 4e. Expected data volumes

- 1,411 buildings
- ~4 active utilities per building on average (electricity, gas, steam/heating_hot_water, chilled_water)
- 15-minute cadence → 96 windows per day per (building, utility)
- 352 days in window → ~34k windows per (building, utility)
- Total: ~190M rows
- Parquet on disk: ballpark 2 to 6 GB depending on compression

The scrape itself takes 3-4 hours at 1 req/sec. Start it in a second Git Bash tab (or `start /B python scripts/scrape.py` from cmd.exe) and do other work while it runs.

---

## 5. Supabase schema + setup

### 5a. Project creation

```bash
# Dashboard (once): https://supabase.com → New Project
#   name: campussense
#   region: us-east-1
#   save db password
# Then:
supabase login
cd /c/claudeathon           # Git Bash drive-letter style; in PowerShell use C:\claudeathon
supabase init
supabase link --project-ref <REF>
```

### 5b. Schema migration

Write `supabase/migrations/0001_init.sql`:

```sql
-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Buildings
create table public.buildings (
  buildingnumber int primary key,
  buildingname text not null,
  campus text not null,
  gross_area int,
  floors_above_ground int,
  construction_date date,
  latitude double precision,
  longitude double precision,
  building_type text,
  status text default 'active'
);
create index on public.buildings (campus);
create index on public.buildings (latitude, longitude) where latitude is not null;

-- Meters (one row per building x utility)
create table public.meters (
  id uuid primary key default uuid_generate_v4(),
  building_id int not null references public.buildings(buildingnumber),
  utility text not null check (utility in (
    'electricity','natural_gas','steam','heating_hot_water',
    'chilled_water','domestic_water'
  )),
  unit text not null default 'kWh',
  status text not null default 'active',
  unique (building_id, utility)
);
create index on public.meters (building_id);

-- Readings (downsampled for realtime; full history lives in parquet)
create table public.readings (
  id bigserial primary key,
  building_id int not null,
  utility text not null,
  reading_time timestamptz not null,
  reading_value double precision,
  expected_value double precision,
  residual double precision,
  percentile double precision check (percentile is null or (percentile >= 0 and percentile <= 1)),
  imputed boolean default false,
  dropped_zero boolean default false,
  inserted_at timestamptz not null default now()
);
create index on public.readings (building_id, utility, reading_time desc);
create index on public.readings (reading_time desc);

-- Weather (hourly)
create table public.weather (
  reading_time timestamptz primary key,
  temperature_2m double precision,
  relative_humidity_2m double precision,
  dew_point_2m double precision,
  shortwave_radiation double precision,
  wind_speed_10m double precision,
  cloud_cover double precision,
  apparent_temperature double precision,
  precipitation double precision
);

-- Anomalies
create table public.anomalies (
  id uuid primary key default uuid_generate_v4(),
  building_id int not null,
  utility text not null,
  first_reading_time timestamptz not null,
  last_reading_time timestamptz not null,
  peak_reading_time timestamptz not null,
  peak_percentile double precision not null check (peak_percentile >= 0 and peak_percentile <= 1),
  expected_kwh double precision not null,
  actual_kwh double precision not null,
  residual_kwh double precision not null,
  duration_minutes int not null,
  cost_impact_usd double precision not null,
  severity text not null check (severity in ('low','medium','high')),
  status text not null default 'new'
    check (status in ('new','open','reviewed','dismissed','resolved')),
  parent_anomaly_id uuid references public.anomalies(id),
  claude_explanation text,
  work_order_draft text,
  claude_explanation_state text not null default 'pending'
    check (claude_explanation_state in ('pending','ready','failed','cached')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.anomalies (last_reading_time desc);
create index on public.anomalies (building_id, utility, status);
create index on public.anomalies (severity, status);

-- Chat sessions
create table public.chat_sessions (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index on public.chat_messages (session_id, created_at);

-- Realtime publications
alter publication supabase_realtime add table public.anomalies;
alter publication supabase_realtime add table public.readings;
alter table public.anomalies replica identity full;
alter table public.readings replica identity full;

-- Keep-alive to prevent 7-day pause
select cron.schedule(
  'campussense-keepalive',
  '0 */6 * * *',
  $$ select now(); $$
);
```

Push with `supabase db push`.

### 5c. RLS posture for the hackathon

Leave RLS disabled on `buildings`, `meters`, `readings`, `weather`, `anomalies`, `chat_messages`, `chat_sessions`. Grant `select` on all to the `anon` role. Per the research, Supabase explicitly supports this pattern for public realtime tables. Do not spend time on auth.

### 5d. Seeding from parquet

Write `scripts/seed_supabase.py`. Load order:
1. `buildings` from `data/raw/buildings_from_api.json` (upsert on buildingnumber)
2. `meters` from `data/raw/meters_from_api.json`
3. `weather` from `data/raw/weather.parquet` (upsert on reading_time)
4. `readings` from parquet, but ONLY the replay window (2026-01-20 to 2026-04-17) to fit under the 500 MB free tier limit. Full history stays in parquet and is queried from DuckDB on the server when needed.

Chunk size: 10,000 rows per insert. Use `supabase.table(...).upsert(...)`.

Estimate: 97 days x 1,411 buildings x 4 utilities x 96 readings = ~52M rows. At ~60 bytes per row plus indexes this is too much for 500 MB free tier. **Downsample the readings table to hourly resolution for the Supabase copy** (average by hour); keep 15-min resolution in parquet. Inline DuckDB query from the server for deep drill-ins.

Hourly resolution: ~13M rows. At ~60 bytes = ~780 MB. Still too much. **Further narrow the Supabase window to 2026-01-20 to 2026-02-10** (3 weeks around the pinned replay). That is ~1.1M rows and fits comfortably.

The frontend's default views (map, anomaly list, last-24h chart) hit Supabase. Any chart wider than 21 days falls through to a server route that queries parquet via DuckDB. The parquet files sit on the laptop during demo, not on Vercel.

### 5e. Chat persistence

The analyst chat persists to `chat_messages` so the demo can tolerate a refresh. Session ID lives in a cookie. Server-side route `POST /api/chat` accepts `{session_id, user_message}`, appends to table, calls Claude, streams response.

---

## 6. Feature engineering module

Path: `scripts/features.py`. Used by training (Section 7) and by inference (Section 8).

### 6a. Feature list (17)

| # | Feature | Type | Source | Transformation |
|---|---|---|---|---|
| 1 | temperature | float | weather.temperature_2m | passthrough (F) |
| 2 | humidity | float | weather.relative_humidity_2m | passthrough |
| 3 | dew_point | float | weather.dew_point_2m | passthrough (F) |
| 4 | solar_radiation | float | weather.shortwave_radiation | passthrough |
| 5 | wind_speed | float | weather.wind_speed_10m | passthrough (mph) |
| 6 | cloud_cover | float | weather.cloud_cover | passthrough |
| 7 | apparent_temperature | float | weather.apparent_temperature | passthrough (F) |
| 8 | precipitation | float | weather.precipitation | passthrough (inches) |
| 9 | hour_of_day | int (cat) | reading_time | local `America/New_York` hour |
| 10 | minute_of_hour | int (cat) | reading_time | {0,15,30,45} |
| 11 | day_of_week | int (cat) | reading_time | 0=Mon, 6=Sun |
| 12 | is_weekend | bool | day_of_week | in {5,6} |
| 13 | is_academic_session | bool | calendar | inside any session window |
| 14 | is_holiday | bool | calendar | OSU holiday OR inside break |
| 15 | gross_area | int | buildings | passthrough (sqft) |
| 16 | floors_above_ground | int | buildings | passthrough |
| 17 | building_age_years | int | buildings | reading_year minus construction_year; median fill if missing |

Derived, add both (HARD RULE):
- `cooling_degree_hour = max(0, temperature - 65)`
- `heating_degree_hour = max(0, 65 - temperature)`

### 6b. Calendar module

Write `scripts/calendar_osu.py` with the OSU 2025-2026 calendar baked in. Source: Agent 04 findings. Export two functions:

```python
def is_academic_session(ts: pd.Timestamp) -> bool: ...
def is_holiday(ts: pd.Timestamp) -> bool: ...  # includes break windows
```

Dates to hardcode:

```python
ACADEMIC_SESSIONS = [
    ("2025-05-06","2025-07-30"),   # summer
    ("2025-08-26","2025-12-10"),   # autumn classes
    ("2025-12-12","2025-12-17"),   # autumn finals
    ("2026-01-12","2026-04-27"),   # spring classes
]
BREAKS = [
    ("2025-10-16","2025-10-17"),   # autumn break
    ("2025-11-26","2025-11-28"),   # thanksgiving
    ("2025-12-18","2026-01-11"),   # winter
    ("2026-03-16","2026-03-20"),   # spring break
]
OSU_HOLIDAYS = [
    "2025-05-26","2025-06-19","2025-07-04","2025-09-01","2025-11-11",
    "2025-11-27","2025-11-28",  # OSU observes Indigenous Peoples / Columbus Day here
    "2025-12-25","2026-01-01","2026-01-19",
]
FOOTBALL_HOME = [
    ("2025-08-30","Texas","12:00"),
    ("2025-09-06","Grambling","15:30"),
    ("2025-09-13","Ohio","19:00"),
    ("2025-10-04","Minnesota","19:30"),   # Homecoming
    ("2025-11-01","Penn State","12:00"),
    ("2025-11-15","UCLA","19:30"),
    ("2025-11-22","Rutgers","12:00"),
]
BASKETBALL_HOME_BIG_TEN = [
    "2026-01-05","2026-01-17","2026-01-20","2026-01-26",
    "2026-02-17","2026-03-01","2026-03-07",
]
WEATHER_EVENTS = [
    ("2025-06-22","2025-06-26","heat_wave_1"),
    ("2025-07-23","2025-07-25","heat_wave_2"),
    ("2026-01-24","2026-01-26","winter_storm"),    # 11.9in record on 01-25
    ("2026-02-06","2026-02-07","polar_vortex"),    # wind chills -10 to -15F
]
```

Also write to `public/osu_calendar_2025_2026.json` for the frontend to pick up if Section 16 needs it.

### 6c. Weather alignment

Forward-fill from the on-the-hour observation to the next three 15-min windows. Implementation:

```python
import pandas as pd
df_readings = df_readings.sort_values('reading_time')
df_weather = df_weather.sort_values('reading_time').rename(
    columns={'reading_time':'weather_time'}
)
df = pd.merge_asof(
    df_readings, df_weather,
    left_on='reading_time', right_on='weather_time',
    direction='backward', tolerance=pd.Timedelta('1h'),
)
```

### 6d. Timezone rule

Storage: UTC. Feature derivation: convert to `America/New_York` for `hour_of_day` and `day_of_week`. UTC storage handles DST fall-back 2025-11-02 and spring-forward 2026-03-08 invisibly.

### 6e. Target

```python
y = df['readingvalue'] / df['gross_area']
# Skip training where gross_area is null or zero.
```

If post-scrape reveals `readingvalue` is consistently null but `readingwindowmean` is populated, fall through to that column. Log the fallback.

---

## 7. LightGBM training pipeline

Path: `scripts/train_all.py`. One script. One process. ~1,411 x ~4 = ~5,600 model fits.

### 7a. Hyperparameters (HARD RULE, copy-paste)

```python
PARAMS = {
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
CATEGORICAL = ["hour_of_day","day_of_week","minute_of_hour"]
```

Use `lgb.train` with `Dataset`, not `LGBMRegressor`. Early stopping via `callbacks=[lgb.early_stopping(50), lgb.log_evaluation(0)]`.

### 7b. Split (pinned-replay variant, HARD RULE)

- **Train:** 2025-05-01 to 2026-01-23
- **Validate:** 2025-12-01 to 2026-01-23 (sliding window inside train for early stopping)
- **Replay:** 2026-01-24 onward

Chronological only. Never random-split time series.

### 7c. Per-building loop

```python
for (building_id, utility) in grouped_iterator():
    try:
        train_one(building_id, utility, df_for_pair)
    except Exception as e:
        write_meta({"building_id": building_id, "utility": utility,
                    "status": "error", "error": str(e)})
```

Parallelize with `joblib.Parallel(n_jobs=-1)` on the per-building function. Targets: <1 hour total wall time on a laptop.

### 7d. Sparse checks

Before fitting:

```python
if df[y_col].abs().sum() == 0 or df[y_col].isna().mean() > 0.95:
    write_meta({"status":"no_data", "reason":"all_zero_or_null"})
    return
n = df[y_col].notna().sum()
if n < 500:
    # register for pooled model pass
    write_meta({"status":"pending_pool"})
    return
```

### 7e. Pooled fallback

Second pass after the main training loop: for every `(utility, building_type)` pair with >= 3 `pending_pool` members plus some `trained` peers, fit one pooled model with `building_id` and `building_type` as categorical features. Assign that pooled model path + per-building `cutpoints` computed on the pooled residuals filtered to that building's rows.

### 7f. Percentile cutoffs (replaces MAD z-score)

After fit, on validation residuals only. We skip the Gaussian-assumption MAD scaling and record the empirical distribution of absolute residuals. This is the anomaly threshold surface.

```python
import numpy as np
residuals = y_valid - booster.predict(X_valid, num_iteration=booster.best_iteration)
abs_res = np.abs(residuals)
abs_res = abs_res[np.isfinite(abs_res)]

# Store 21 quantile cutpoints from p50 to p99.9. Compact and trivially searchable.
QUANTILES = np.array([
    0.50, 0.75, 0.85, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98,
    0.985, 0.99, 0.991, 0.992, 0.993, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999,
])
cutpoints = np.quantile(abs_res, QUANTILES).tolist()
# Guard against degenerate zero-variance buildings: fall back to std + epsilon.
if not np.any(np.diff(cutpoints) > 0):
    eps = float(abs_res.std(ddof=1) + 1e-9)
    cutpoints = [eps * q for q in QUANTILES]
```

**Why percentile, not z-score.** Three reasons:
1. Energy residuals are heavy-tailed around HVAC cycling. MAD with `scale='normal'` assumes roughly Gaussian, which overstates z at the tails.
2. "This reading is at the 99.7th percentile of this building's normal error" is a sentence any operator understands. "This reading is 5.2 MAD out" is not.
3. One lookup table (21 floats) is cheaper than one MAD number plus a distribution assumption the UI has to translate.

**The severity threshold vocabulary** is percentile, not sigma. See 8b.

### 7g. Serialization

```python
booster.save_model(f"models/{building_id}__{utility}.txt",
                   num_iteration=booster.best_iteration)
```

Write one JSON metadata file per model to `meta/{building_id}__{utility}.json`:

```json
{
  "building_id": 44073,
  "utility": "electricity",
  "status": "trained",
  "n_train": 97000,
  "n_valid": 5280,
  "best_iteration": 412,
  "valid_mae": 0.0031,
  "quantiles": [0.50, 0.75, 0.85, 0.90, 0.92, 0.94, 0.95, 0.96, 0.97, 0.98,
                0.985, 0.99, 0.991, 0.992, 0.993, 0.994, 0.995, 0.996, 0.997, 0.998, 0.999],
  "cutpoints": [0.0012, 0.0021, 0.0029, 0.0036, 0.0041, 0.0047, 0.0052, 0.0058, 0.0066, 0.0078,
                0.0086, 0.0098, 0.0104, 0.0112, 0.0121, 0.0134, 0.0151, 0.0176, 0.0214, 0.0281, 0.0402],
  "severity_percentile_low": 0.95,
  "severity_percentile_medium": 0.99,
  "severity_percentile_high": 0.995,
  "model_path": "models/44073__electricity.txt",
  "feature_cols": ["temperature", "...", "building_age_years"],
  "trained_at": "2026-04-18T10:15:00Z"
}
```

Total on disk: roughly 110 to 420 MB across 1,411 models.

### 7h. Acceptance check after training

Write `scripts/check_training.py`. Asserts:
- At least 80% of `(building, utility)` pairs have status `trained`.
- Median valid MAE < 20% of median actual value.
- Every `trained` model has a `cutpoints` array of length 21 with strictly non-decreasing values.
- No `cutpoints[-1] == 0` for a `trained` model.
- Log a histogram of `cutpoints[-2]` (the p99.8 threshold) to `meta/cutpoint_histogram.txt` to eyeball distribution health.

If acceptance fails, do not proceed to scoring.

---

## 8. Anomaly scoring + lifecycle

### 8a. Scoring module

Path: `scripts/score.py`. Function:

```python
import json, numpy as np, lightgbm as lgb
from pathlib import Path

def _percentile_of(abs_r: np.ndarray, quantiles: list[float], cutpoints: list[float]) -> np.ndarray:
    """Map abs-residual to empirical percentile using the stored cutpoints.
    Linear interpolation between adjacent quantiles; clamps at [0.50, 1.0]."""
    q = np.asarray(quantiles, dtype=np.float64)
    c = np.asarray(cutpoints, dtype=np.float64)
    idx = np.searchsorted(c, abs_r, side="right")
    out = np.empty_like(abs_r, dtype=np.float64)
    for i, x in enumerate(abs_r):
        k = idx[i]
        if k == 0:
            out[i] = q[0] * (x / max(c[0], 1e-12))
        elif k >= len(c):
            out[i] = 1.0 - (1.0 - q[-1]) * min(1.0, c[-1] / max(x, 1e-12))
        else:
            lo_q, hi_q = q[k - 1], q[k]
            lo_c, hi_c = c[k - 1], c[k]
            t = (x - lo_c) / max(hi_c - lo_c, 1e-12)
            out[i] = lo_q + t * (hi_q - lo_q)
    return np.clip(out, 0.0, 1.0)

def score(building_id: int, utility: str, X_new, actual) -> dict:
    meta = json.loads(Path(f"meta/{building_id}__{utility}.json").read_text())
    if meta["status"] != "trained":
        return {"status": "skipped", "reason": meta["status"]}
    booster = lgb.Booster(model_file=meta["model_path"])
    preds = booster.predict(X_new[meta["feature_cols"]])
    residuals = np.asarray(actual) - preds
    pct = _percentile_of(np.abs(residuals), meta["quantiles"], meta["cutpoints"])
    return {
        "expected": preds.tolist(),
        "residual": residuals.tolist(),
        "percentile": pct.tolist(),
    }
```

### 8b. Severity tiers

Bands are percentile cutoffs of the per-building residual distribution. Tunable per model via `severity_percentile_*` fields in metadata.

```python
def severity(pct: float,
             low: float = 0.95,
             medium: float = 0.99,
             high: float = 0.995) -> str | None:
    if pct < low:    return None
    if pct < medium: return "low"
    if pct < high:   return "medium"
    return "high"
```

Rule of thumb for UI copy: phrase as "99.7th percentile of this building's normal error," not "z of 5.2." The chip format on anomaly cards is `p99.7` (see frontend Section 5b).

### 8c. Cost math (HARD RULE, precomputed only)

```python
RATES_PER_KWH = {
    "electricity": 0.09,
    "natural_gas": 0.70 / 29.3,    # therm → kWh equivalent
    "steam": 0.04,
    "heating_hot_water": 0.04,
    "chilled_water": 0.08,
    "domestic_water": 0.005,
}

def cost_impact_usd(residuals_kwh_per_sqft, gross_area, utility):
    rate = RATES_PER_KWH[utility]
    return float(np.abs(residuals_kwh_per_sqft).sum() * gross_area * rate)
```

These are build-time defaults per the Ohio C&I rate research. All are marked UNCONFIRMED in the corpus; pull fresh from EIA if time allows. Label the number `estimate` everywhere in UI copy.

### 8d. Lifecycle state machine

States: `new → open → {resolved | reviewed | dismissed}`.

Transition rules:
- `new`: percentile first crosses the `low` severity threshold (default 0.95). Insert row. Fire realtime broadcast.
- `open`: still firing (percentile > 0.90 each new 15-min window). Update `last_reading_time`, `cost_impact_usd`, `peak_percentile`. No duplicate row.
- `resolved`: percentile < 0.90 for 4 consecutive 15-min windows (1 hour cooldown). Close.
- `reviewed` / `dismissed`: analyst actions via `PATCH /api/anomaly/:id`.

One anomaly row per (building, utility, event). The anomaly detector job runs every 15 minutes (in live mode) or every simulated 15 minutes (in replay mode, scaled 30x).

### 8e. Clustering

Write `scripts/cluster_anomalies.py`. Run after each detection pass. Criteria (any of):
- Pearson correlation of residuals > 0.7 across buildings over event window
- Centroid distance < 300 m (haversine on buildings.latitude/longitude)
- Same utility AND 3+ buildings AND within 30 min

When triggered, mark the highest-magnitude row as primary. Assign `parent_anomaly_id` on the others.

### 8f. Noise floor

Suppress rows where `cost_impact_usd < 5.0` after the event closes. This is the most important product polish. Without it the inbox is unreadable.

### 8g. Replay loop

Path: `scripts/replay.py`. Reads historical parquet, steps through time at 30x real speed, scores each 15-min window per building, inserts/updates anomaly rows in Supabase. This is what drives the "live" demo. In `DEMO_FROZEN_MODE=true`, the clock starts at `DEMO_FROZEN_NOW` and advances from there for as long as the demo runs.

---

## 9. Claude orchestration

### 9a. Tool schemas (9 tools, HARD RULE, exact shape)

Write `lib/tools/schemas.ts`. Claude Sonnet 4.6 receives these nine tools for the chat. Claude Haiku 4.5 for explanations receives no tools (straight text). Claude Opus 4.7 for deep analysis receives the same nine.

```typescript
export const TOOLS = [
  {
    name: "query_readings",
    description: "Fetch a time-series of meter readings for a single building and utility. Use this when the user asks to see, plot, compare, or analyze actual consumption over a time window. ALWAYS call this before render_chart when the user wants a trend, day-over-day comparison, or anomaly overlay. Do NOT call this to ask 'is there an anomaly' (use query_anomalies instead). Returns up to 10,000 points; if the window is wider than that at the requested aggregation, downsample by choosing a coarser aggregation.",
    input_schema: {
      type: "object",
      properties: {
        building_id: { type: "string" },
        utility: { type: "string", enum: ["electricity","natural_gas","steam","heating_hot_water","chilled_water","domestic_water"] },
        start_time: { type: "string", format: "date-time" },
        end_time: { type: "string", format: "date-time" },
        aggregation: { type: "string", enum: ["raw_15min","hourly","daily","weekly"], default: "hourly" }
      },
      required: ["building_id","utility","start_time","end_time"]
    }
  },
  {
    name: "query_anomalies",
    description: "List anomalies detected by the CampusSense model. Use this when the user asks 'what broke', 'what is wrong', 'show me anomalies', or wants to triage. Returns anomalies sorted by severity DESC, then detected_at DESC. If no time window is given, defaults to the last 24 hours from the current (possibly frozen) clock.",
    input_schema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["low","medium","high"] },
            utility: { type: "string", enum: ["electricity","natural_gas","steam","heating_hot_water","chilled_water","domestic_water"] },
            building_id: { type: "string" },
            status: { type: "string", enum: ["new","open","reviewed","dismissed","resolved"], default: "open" },
            since: { type: "string", format: "date-time" },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 }
          }
        }
      },
      required: ["filters"]
    }
  },
  {
    name: "get_building_info",
    description: "Get metadata (name, campus, square footage, year built, meters installed, lat/lon) plus current live status for one building. Call when the user names a building or when enriching an anomaly before rendering a chart or work order.",
    input_schema: {
      type: "object",
      properties: { building_id: { type: "string" } },
      required: ["building_id"]
    }
  },
  {
    name: "list_buildings",
    description: "Enumerate buildings on the CampusSense campus graph. Use to resolve a fuzzy name ('the library', 'Thompson'), to find all buildings on a campus, or to populate a map. Returns id, name, campus, and primary utility. For deep metadata, follow up with get_building_info.",
    input_schema: {
      type: "object",
      properties: {
        filters: {
          type: "object",
          properties: {
            campus: { type: "string" },
            utility: { type: "string" },
            name_contains: { type: "string" },
            limit: { type: "integer", minimum: 1, maximum: 2000, default: 100 }
          }
        }
      },
      required: ["filters"]
    }
  },
  {
    name: "render_chart",
    description: "Emit a frontend directive to draw a chart. Does NOT compute anything. Call AFTER query_readings or query_anomalies returned data. Prefer 'line' for time-series, 'bar' for hourly comparisons, 'heatmap' for week-by-hour patterns. Include overlays for baseline vs actual or anomaly windows.",
    input_schema: {
      type: "object",
      properties: {
        chart_type: { type: "string", enum: ["line","bar","area","heatmap","scatter"] },
        data: { type: "array", items: { type: "object" } },
        x_axis: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, type: { type: "string", enum: ["time","category","number"] } }, required: ["key","type"] },
        y_axis: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, unit: { type: "string" } }, required: ["key"] },
        overlays: { type: "array", items: { type: "object", properties: { kind: { type: "string", enum: ["baseline","threshold","anomaly_window","event_marker"] }, label: { type: "string" }, value: {}, color: { type: "string" } }, required: ["kind"] } },
        title: { type: "string" }
      },
      required: ["chart_type","data","x_axis","y_axis"]
    }
  },
  {
    name: "render_map",
    description: "Emit a frontend directive to draw the campus map with buildings color-coded. Call when the user wants a spatial view. Empty building_ids means all buildings.",
    input_schema: {
      type: "object",
      properties: {
        building_ids: { type: "array", items: { type: "string" } },
        color_by: { type: "string", enum: ["severity","kwh_today","anomaly_count_24h","delta_vs_baseline_pct","none"], default: "severity" },
        highlight: { type: "array", items: { type: "string" } },
        title: { type: "string" }
      },
      required: ["building_ids","color_by"]
    }
  },
  {
    name: "render_anomaly_list",
    description: "Emit a frontend directive to render a sortable list of anomaly cards. Default visualization for query_anomalies results.",
    input_schema: {
      type: "object",
      properties: {
        anomaly_ids: { type: "array", items: { type: "string" } },
        title: { type: "string" },
        empty_message: { type: "string" }
      },
      required: ["anomaly_ids"]
    }
  },
  {
    name: "draft_work_order",
    description: "Draft the text of a maintenance work order for an anomaly, suitable for copy-paste into OSU FOD's CMMS. Use when the user asks to 'write up', 'send to facilities', 'file a ticket', or 'make a work order'. Returns draft text; does NOT submit.",
    input_schema: {
      type: "object",
      properties: {
        anomaly_id: { type: "string" },
        custom_instructions: { type: "string" }
      },
      required: ["anomaly_id"]
    }
  },
  {
    name: "simulate_dr_event",
    description: "Simulate an IGS-called demand response event and return a curtailment plan. Returns which buildings to shed, estimated MW, confidence, and rebound risk. Does NOT execute any control action.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", format: "date-time" },
        duration_minutes: { type: "integer", minimum: 15, maximum: 240 },
        target_mw: { type: "number", minimum: 0.1, maximum: 50 },
        zone: { type: "string", enum: ["AEP","DUKE_OH","FIRSTENERGY_OH","ALL"], default: "AEP" }
      },
      required: ["date","duration_minutes","target_mw"]
    }
  }
];
```

### 9b. Handler implementations

Path: `lib/tools/handlers.ts`. Each handler returns `{ view_type, data, config }` per the contract below, OR `{ view_type: "text", data: { markdown } }` for text-only results.

Handlers:

- `query_readings` → Supabase if window <= 21 days and readings table covers it; else call `/api/deep-query` which hits DuckDB + parquet on the server.
- `query_anomalies` → Supabase `select` with filters. Default `since = now_frozen() - interval '24 hours'`.
- `get_building_info` → Supabase `buildings` join `meters` by building_id.
- `list_buildings` → Supabase `buildings` with `ilike` on name_contains.
- `render_chart` → pass through, backend adds display defaults.
- `render_map` → pass through with campus bounds precomputed.
- `render_anomaly_list` → pass through.
- `draft_work_order` → see Section 11.
- `simulate_dr_event` → see Section 12.

### 9c. View directive contract (HARD RULE, frontend will consume)

Every tool return goes through this shape:

```typescript
interface ViewDirective {
  view_type: "chart" | "map" | "anomaly_list" | "anomaly_detail" | "work_order" | "dr_simulator" | "text";
  data: Record<string, any>;   // tool-specific payload
  config: Record<string, any>; // display knobs (axes, title, highlight, color_by, etc.)
}
```

Per-view payloads:

| view_type | data keys | config keys |
|---|---|---|
| chart | chart_type, points, overlays | x_axis, y_axis, title |
| map | building_ids, points_geojson | color_by, highlight, title, bounds |
| anomaly_list | anomaly_ids, anomalies (hydrated) | title, empty_message |
| anomaly_detail | anomaly_id, building, timeseries, baseline | title |
| work_order | anomaly_id, draft_text | allow_edit, target_cmms |
| dr_simulator | plan, total_shed_mw, rebound_risk, notes | date, duration_minutes, target_mw, zone |
| text | markdown | (none) |

The frontend subscribes to a single stream of `ViewDirective` objects emitted by the assistant turn. Each `render_*` tool call becomes one directive. Any tool_use whose name does not start with `render_` or match `draft_work_order` / `simulate_dr_event` is data-plane only (not visualized unless Claude follows up with a render call).

### 9d. Agent loop (Sonnet chat)

Path: `app/api/chat/route.ts`.

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "@/lib/tools/schemas";
import { dispatch } from "@/lib/tools/handlers";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL_CHAT ?? "claude-sonnet-4-6";
const MAX_TURNS = 8;

export async function POST(req: Request) {
  const { session_id, user_message } = await req.json();
  const messages = await loadHistory(session_id);
  messages.push({ role: "user", content: user_message });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });
    messages.push({ role: "assistant", content: resp.content });

    if (resp.stop_reason !== "tool_use") break;

    const toolResults = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      const result = await dispatch(block.name, block.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  await saveHistory(session_id, messages);
  return new Response(JSON.stringify(messages[messages.length - 1]));
}
```

Hard turn cap = 8. If exceeded, return a graceful "I couldn't complete the request" text.

### 9e. Streaming

For the final assistant text turn (after all tool_use resolved), use `client.messages.stream(...)` and pipe `text_stream` events through a Next.js streaming response. Do NOT stream tool_use input_json_delta events for this demo; too complex and the 200 to 900 ms non-streamed latency is fine.

### 9f. Prompt caching (save 30%+)

On every `messages.create`:
- Add `cache_control: { type: "ephemeral" }` to the last tool definition in `tools`.
- Add `cache_control` to the system prompt.

```typescript
tools: [...TOOLS.slice(0, -1), { ...TOOLS.at(-1)!, cache_control: { type: "ephemeral" } }],
system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
```

Validate with SDK version at build time; fall back silently if unsupported.

### 9g. Model routing

| Surface | Model | Why |
|---|---|---|
| Analyst chat (tool use) | `claude-sonnet-4-6` | 1M context, tool use GA, streaming, reasonable cost |
| Anomaly explanation | `claude-haiku-4-5-20251001` | $0.0035/call, fast first token |
| Work order draft | `claude-haiku-4-5-20251001` | Same cost envelope |
| "Deep analysis" button (optional) | `claude-opus-4-7` | Adaptive thinking; save for rare clicks |

### 9h. System prompt (chat)

Write `lib/prompts/chat_system.md`. Keep under 1,500 tokens so caching is cheap. Include:
- Role: CampusSense analyst assistant for IGS Energy analysts managing OSU as demo portfolio.
- Capabilities: the 9 tools and when to use each.
- Hard rules: never compute costs yourself; never claim a number you did not see in a tool result; never mention JadeTrack as a competitor.
- Style: concise, operator-voice, no em dashes, use hyphens or periods.
- Current time context: "The current simulated time is {frozen_now}. When the user says 'yesterday' or 'overnight', interpret relative to this clock."
- Examples: two worked exchanges ("what broke overnight", "show me the med center").

---

## 10. Anomaly explanation worker

Path: `app/api/explain/route.ts` and `scripts/explain_worker.py` for background pre-caching.

### 10a. Prompt shape

```
You are a plain-English energy analyst. Given an anomaly row from OSU campus meters, write a 3-to-5 sentence explanation of what is off and what the likely cause is. Use specific numbers from the data, not estimates. Do not compute costs; the cost_impact_usd field is already computed for you. Do not recommend vendor products.

ANOMALY:
{anomaly_json}

BUILDING METADATA:
{building_json}

WEATHER AT PEAK:
{weather_json}

PEER COMPARISON (same building_type, same utility, same hour):
{peer_json}

OSU CALENDAR CONTEXT:
{calendar_json}

Write the explanation.
```

Target output: 100 to 200 tokens. Input: roughly 1,500 tokens.

### 10b. Caching

Pre-cache the three hero anomalies' explanations at page load in `DEMO_FROZEN_MODE`. Store in memory keyed by anomaly_id. On click, if a cached explanation exists, render it with a 40 ms/token fake-stream to preserve the "Claude is thinking" feel. If not cached, fire a real Haiku call with streaming.

Also write raw responses to `cache/claude/explain_{anomaly_id}.json` so `USE_CACHED_CLAUDE=true` can serve them without any API call.

### 10c. Cost tracking

Log every real Haiku call's token counts to `logs/claude_usage.jsonl`. At demo end, print total cost.

---

## 11. Work order drafter

Path: `app/api/work-order/route.ts`. Calls Haiku.

### 11a. Prompt

```
Draft a maintenance work order for OSU Facility Operations and Development (FOD). The anomaly is:
{anomaly_json}
The building is {building_name} (ID {building_id}), {building_type}, {gross_area} sqft.
{custom_instructions if provided}

Format: professional, 4 to 6 sentences, direct, actionable. Include:
- What was observed (pull specifics from anomaly)
- When it occurred (peak time and duration)
- Estimated cost impact (from anomaly.cost_impact_usd; call it an estimate)
- Recommended action (ONE specific next step)
- Priority (map severity: low → routine, medium → 48 hours, high → same day)

Do not use em dashes. Do not use vendor brand names. Do not overclaim.
```

### 11b. Output

Returns `{ draft_text, target_cmms: "OSU FOD CMMS", allow_edit: true }`. Rendered as a work_order view directive.

---

## 12. DR simulator

Path: `lib/dr/simulator.ts`. Deterministic, no Claude call.

### 12a. Defaults (HARD RULE)

```typescript
const DR_DEFAULTS = {
  capacity_price_mwday_aep_2026_27: 329.17,
  capacity_price_mwday_rest_2026_27: 329.17,
  elcc_ucap_factor: 0.77,
  aggregator_retention_pct: 0.25,
  energy_lmp_midpoint_usd_per_mwh: 500,
  annualized_per_mw_year: 120147,
  default_event_hours_per_year: 60,
  default_event_duration_minutes: 60,
};
```

### 12b. Ranking logic

For each `{ building_id, date, duration_minutes }` candidate:

1. Estimate `kw_available` as mean electricity consumption at that hour of week over last 30 days.
2. Tag `load_type`: chiller (if chilled_water meter exists), AHU (electricity in academic), lab_exhaust (if building_type = STEM_research), lighting (electricity baseline). Hospital / Med Center → flagged `exclude_life_safety` and shed = 0.
3. Tag `customer_impact`: low (lighting, precool), medium (AHU setback), high (lab exhaust).
4. Tag `notice_time_minutes`: 5 (lighting), 30 (AHU), 60 (precool), 120 (chiller cycle).
5. Rank by `kw_available / customer_impact_weight` descending.

### 12c. Output shape

```json
{
  "plan": [
    { "building_id": "RPAC", "load_type": "precool+setback", "est_mw_shed": 1.8, "customer_impact": "low", "notice_time_min": 60, "rebound_risk": "low" },
    ...
    { "building_id": "ScottLab", "action": "Exclude (fume-hood safety)", "est_mw_shed": 0 }
  ],
  "total_shed_mw": 2.9,
  "rebound_risk": "medium",
  "notes": "OSU main campus realistic shed caps around 3 MW without touching labs or chillers. 50 MW target not achievable from this portfolio.",
  "econ": {
    "annualized_capacity_revenue_usd": 348426.33,
    "assumption": "100 kW net curtailment, 60 event hrs/yr, 25% aggregator fee, $500/MWh event energy midpoint",
    "net_year_usd": 9188
  }
}
```

Always return econ based on the `target_mw` the user passed, not on what was achievable. Separate fields.

### 12d. Safety copy

Every DR response includes `notes` that mention "this does not execute any control action; all dispatch decisions stay with OSU FOD and OSEP." Keeps the judge-safe framing intact.

---

## 13. Replay mode / demo frozen mode

### 13a. Clock

Path: `lib/clock.ts`.

```typescript
export function now_frozen(): Date {
  if (process.env.DEMO_FROZEN_MODE === "true" && process.env.DEMO_FROZEN_NOW) {
    return new Date(process.env.DEMO_FROZEN_NOW);
  }
  return new Date();
}
```

Every server-side tool handler, every anomaly detection pass, every "since" default uses `now_frozen()` instead of `Date.now()`.

### 13b. Replay daemon

`scripts/replay.py` runs in a dedicated Git Bash tab (or detached via `start /B python scripts/replay.py`). On start:
1. Set clock to `DEMO_FROZEN_NOW`.
2. Read the next 15 minutes of history from parquet.
3. Score all buildings.
4. Insert new anomalies, update open anomalies, close resolved ones.
5. Upsert hourly-aggregated readings to Supabase for the last 21 days from current frozen time.
6. Advance clock by 30 seconds of wall time = 15 simulated minutes.
7. Loop.

At 30x speed, one hour of real wall time = 30 hours of simulated time. For a 45-minute demo window, that is 22.5 simulated hours, plenty.

### 13c. Hero anomalies

Write `scripts/patch_heroes.py`. Takes the three patched `{HERO_N}` slugs from `data/fixtures/hero_anomalies.json` (Agent 03 fills this after the scrape or after manual curation) and force-inserts them into the anomalies table at their canonical timestamps, with pre-generated Claude explanations loaded from `cache/claude/explain_<anomaly_id>.json`.

Hero mapping (canonical, HARD RULE):
- `{HERO_1}` = Winter-break ghost load, academic lecture hall, electricity, window 2025-12-22 to 2026-01-05.
- `{HERO_2}` = Lab fume-hood sash, STEM research building, electricity, any weekday night Nov 2025 onward.
- `{HERO_3}` = Polar-vortex Med Center override, Wexner Medical Center wing, electricity, 2026-02-06 to 02-07.
- `{HERO_4}` alt = Chiller short-cycling, medical chiller plant, chilled water, 2025-09-15 to 09-30.
- `{HERO_5}` alt = Ohio Stadium Homecoming, electricity, 2025-10-04 15:00 to 22:00.

After scrape, David or the build agent picks three real anomalies from the scored results that match these archetypes and writes them to `data/fixtures/hero_anomalies.json`. If the scrape fails, use the five archetypes as fictional but clearly-labeled demo anomalies (UI shows "SPEC MODE" banner).

### 13d. `demo:reset` script

`package.json`:

```json
{
  "scripts": {
    "demo:reset": "node scripts/demo_reset.js",
    "scrape:live": "node scripts/scrape_live.js",
    "replay": "python3 scripts/replay.py",
    "train": "python3 scripts/train_all.py",
    "score:batch": "python3 scripts/score_batch.py"
  }
}
```

`scripts/demo_reset.js` does:
1. Truncate `anomalies`, `chat_messages`, `chat_sessions`.
2. Re-seed from `data/fixtures/hero_anomalies.json`.
3. Clear `.next/cache`.
4. Warm Claude prompt cache with three canned calls (scan, explain, simulate).
5. Verify Mapbox token with a single-tile GET. Fail fast if 401.
6. Reset `DEMO_FROZEN_NOW` to the pinned value.
7. Print `READY` to stdout.

### 13e. Hidden anomaly injector (fallback)

Keyboard shortcut `Cmd+Shift+Option+D` intercepts the next user chat message and forces the assistant response to come from `cache/claude/*.json` instead of hitting Claude. Streaming faked with 40 ms per token. Leaves a 3-pixel debug dot bottom-right so David knows injection is on. Hidden to judges.

---

## 14. Realtime wiring

Client subscribes to the `anomalies` and `readings` tables:

```typescript
// lib/realtime.ts
import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export function subscribeAnomalies(onInsert: (row: any) => void) {
  return sb
    .channel("anomalies-live")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "anomalies" },
      (payload) => onInsert(payload.new))
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "anomalies" },
      (payload) => onInsert(payload.new))
    .subscribe();
}
```

Polling fallback (in case realtime is >2s delayed): if no realtime event in 5 seconds AND an anomaly count query returns a higher count, refetch. 3-second polling interval.

Target realtime latency: <2s p50. Measured during build phase, documented in `README.md`.

---

## 15. Backend API routes (summary)

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Returns `{status, db, claude}` for T-30 check |
| `/api/chat` | POST | Analyst chat entry; streams |
| `/api/explain` | POST | Explain an anomaly; Haiku |
| `/api/work-order` | POST | Draft a work order; Haiku |
| `/api/dr/simulate` | POST | DR simulator; deterministic |
| `/api/anomaly/:id` | GET | Full anomaly row + building + timeseries |
| `/api/anomaly/:id` | PATCH | Update status (reviewed, dismissed) |
| `/api/buildings` | GET | List buildings with filters |
| `/api/buildings/:id` | GET | Building info + meters + current kWh |
| `/api/readings` | GET | Time-series query; Supabase or DuckDB |
| `/api/deep-query` | POST | DuckDB-backed deep query for wider windows |
| `/api/demo/reset` | POST | Internal; calls `demo:reset` |

Write `app/api/health/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await checkDb();
  const claude = await checkClaude();
  const ok = db === "ok" && claude === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", db, claude,
      frozen_now: process.env.DEMO_FROZEN_NOW ?? null },
    { status: ok ? 200 : 503 }
  );
}

async function checkDb() {
  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error } = await sb.from("buildings").select("buildingnumber").limit(1);
    return error ? "fail" : "ok";
  } catch { return "fail"; }
}

async function checkClaude() {
  try {
    const a = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
    const r = await a.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4,
      messages: [{ role: "user", content: "ok" }],
    });
    return r ? "ok" : "fail";
  } catch { return "fail"; }
}
```

---

## 16. Frontend design [GAP — to be filled by David's separate frontend design prompt]

**Status:** This section is intentionally left thin. David will deliver a dedicated frontend design prompt that specifies layout, component hierarchy, Tailwind/shadcn styling, color theme, typography, spacing, motion, and interaction patterns. When that prompt arrives, integrate its contents here and wire the resulting components to the backend contracts defined above.

**What the frontend must bind to (integration checklist, already fixed by the backend):**

1. **View directive stream.** The chat streams `{view_type, data, config}` objects (Section 9c). The frontend renders each based on `view_type`.
2. **Realtime channel.** Subscribe via `subscribeAnomalies` (Section 14). On INSERT or UPDATE, refresh the affected row in the anomaly list and update the map marker's feature state.
3. **Mapbox source.** Single GeoJSON source, single circle layer. Every feature has numeric `id = buildingnumber`. Color via `["case", ["==", ["feature-state", "severity"], "high"], RED, ...]`. Hot path = `map.setFeatureState`. Cold path = `map.setData`. No clustering at campus zoom (13-17). See Agent 06 spike at `research/campussense/artifacts/mapbox_spike.html`.
4. **Recharts wrapper.** Use shadcn `ChartContainer` + `LineChart` + `ReferenceLine` for baseline overlays. Token usage: `var(--chart-1)` through `var(--chart-5)` (no `hsl(...)` wrap; Recharts v3 convention).
5. **Anomaly card fields** (from Supabase): id, building_id, building_name, utility, severity, cost_impact_usd, peak_percentile, duration_minutes, first_reading_time, status, claude_explanation.
6. **Chat input + view panel split.** Chat stays persistent on one side (probably right rail based on prior conversation notes); view directives render in the main area. Concrete layout details are the frontend prompt's job.
7. **Cmd-K palette.** Opens full-width from anywhere. Contents: building search, anomaly search, "reset demo" (hidden), "inject anomaly" (hidden debug).
8. **Font convention.** Inter body, JetBrains Mono for all numbers (add `font-mono tabular-nums` to every numeric span).
9. **Dark mode.** `next-themes`, `defaultTheme="system"`, `suppressHydrationWarning` on `<html>`.
10. **No em dashes in any UI copy.** Use hyphens or periods.

When the frontend prompt lands, the integration is: render components, bind to the view directive stream, hook Cmd-K, subscribe to realtime. The backend does not change.

---

## 17. Deployment

### 17a. Vercel

```bash
npm i -g vercel@latest
vercel login
vercel link        # project name: campussense
# Set env vars for Production and Preview. See list in Section 3.
vercel env pull .env.local
vercel --prod
```

Production URL: `https://campussense.vercel.app`. No custom domain needed for demo.

### 17b. Scraper runtime

Runs on the PC in a dedicated Git Bash tab, NOT on Vercel.

```bash
# Tab 1 - scraper / replay
source .venv/Scripts/activate
python scripts/replay.py
```

```bash
# Tab 2 - live log tail
tail -f data/raw/scrape_log.jsonl | jq '{t:.ts, b:.building, n:.rows, ms:.ms}'
```

Alternative detached launch from cmd.exe: `start /B python scripts/replay.py > logs/replay.out 2>&1`.

### 17c. Keep-alive

Supabase `pg_cron` fires `select now();` every 6 hours. Plus a Vercel Edge cron at `/api/health` every 15 min for the 24 hours before the demo (configure via Vercel dashboard or GitHub Actions).

### 17d. Mapbox token hygiene

Create token `campussense-prod`. Add URL restrictions:
- `https://campussense.vercel.app/*`
- `https://*.campussense.vercel.app/*`
- `http://localhost:3000/*`

Keep a second unrestricted token in 1Password as backup (only swap in if the primary gets throttled).

---

## 18. Demo-day runbook

(Print this. Laminate optional.)

### T-60 minutes: FULL RESET + DRY RUN

```bash
cd /c/claudeathon                 # Git Bash; PowerShell use C:\claudeathon
git status                        # clean on main
git pull origin main
pnpm install
pnpm build                        # local sanity
vercel --prod                     # or confirm auto-deploy landed
# Launch replay in a second Git Bash tab:
#   source .venv/Scripts/activate && python scripts/replay.py
# Or detached from cmd.exe:
#   start /B python scripts/replay.py > logs/replay.out 2>&1
pnpm demo:reset
curl -sS https://campussense.vercel.app/api/health | jq .
# Expect: {status:"ok", db:"ok", claude:"ok"}
```

Open demo browser. Run the full 90-second demo once. Note any latency hiccups.

### T-30 minutes: GREEN CHECK

1. Vercel dashboard → Production latest = "Ready"
2. Three sequential `/api/health` returns 200
3. Replay tab shows live log lines (or `tail -f logs/replay.out`)
4. Supabase dashboard → Table Editor → `anomalies` sorted by `created_at desc` shows rows from the last 15 simulated minutes

### T-15 minutes: BROWSER STAGING

Tabs left to right:
1. `https://campussense.vercel.app` (demo)
2. `https://campussense.vercel.app/buildings/44073` (deep link backup)
3. Supabase dashboard → Realtime → `anomalies`
4. Vercel dashboard → Deployments
5. Backup video player on `demo/backup/campussense_90s.mp4`

Display = Mirror. Do Not Disturb ON. Close Slack/Mail/Messages/1Password/Docker.

### T-5 minutes

Stand up. Water. Read the hook: "CampusSense finds the five percent of OSU buildings wasting forty percent of the energy, in real time, using Claude."

### T-0: GO

90-second script (from Agent 18, minor tightening):

> [0:00] I am an energy analyst for Ohio State. 1,411 buildings, meter on almost every one, and yesterday it all looked fine on the dashboard. That is the problem. I open CampusSense.
>
> [0:10] I ask it, what broke overnight. CampusSense scans every meter from the last 24 hours against a per-building forecast, and surfaces three anomalies. `{HERO_1}`, `{HERO_2}`, `{HERO_3}`, ranked by estimated dollar impact.
>
> [0:25] I click the top one. A detail view opens. Claude streams an explanation in plain English, grounded in the meter trace and the weather. It does not just say the number is high. It says which signal is off, for how long, and what the closest past match looks like.
>
> [0:45] I ask, show me the med center. The map pans and zooms. Every building glows by severity. The heat map blooms around the hospital wing where `{HERO_3}` is sitting.
>
> [1:00] I ask, if IGS called a demand-response event right now, what could I shed. The simulator ranks my top ten flex loads by kilowatts available, by customer impact, and by notice time.
>
> [1:20] One chat box. A scan. An explanation. A map. A dispatch plan. That is CampusSense, and it is ready for any portfolio, not just ours. [1:30] [End.]

### Go-bag physical checklist

- Stage laptop (fully charged)
- Backup laptop (same Chrome profile, backup video downloaded)
- Backup video on both laptops + USB-C thumb drive
- Mobile hotspot, 4G+ verified
- USB-C to HDMI
- USB-C to DisplayPort
- Presentation clicker + fresh batteries
- Two charging bricks, two cables
- Printed runbook
- Water bottle
- Business cards for IGS conversation

---

## 19. Fallback ladder

Escalate in this order. Never panic-swap; use the matrix.

| Failure signal | Recovery (≤30s) | Fallback (≤2min) |
|---|---|---|
| Vercel 5xx | Switch URL to `http://localhost:3000` | "Going local for stability" + continue |
| Vercel DNS times out | Same | Backup video |
| Supabase `db: fail` | `supabase start` locally + flip `DATABASE_URL` | Backup video |
| Claude 429 / 5xx | Set `USE_CACHED_CLAUDE=true` via keyboard shortcut | Cached JSON responses |
| Claude 401 | Swap `ANTHROPIC_API_KEY` to backup in Vercel + redeploy | Cached responses |
| Projector no signal | Swap HDMI/DP cable | "Screen-to-judge" (turn laptop) |
| Wi-Fi down | Phone hotspot | Backup video (offline) |
| Scraper died | Relaunch: `start /B python scripts/replay.py` from cmd, or new Git Bash tab | Historical anomalies already in table |
| Laptop crash | Hot-swap to backup laptop | Backup video |
| Mapbox 401 | Swap to backup token, redeploy | Static screenshot fallback page |

Backup video spec: `demo/backup/campussense_90s.mp4`, 1080p, 30fps, H.264, <20MB, plays in QuickTime. Record the night before.

---

## 20. IGS positioning (safe claims only)

These are the ONLY IGS claims the UI, pitch, or Claude explanations may reference. All are citation-grade per Agent 09.

**Safe:**
- IGS acquired JadeTrack in March 2021.
- JadeTrack does utility-bill management, ENERGY STAR benchmarking, real-time energy monitoring.
- Reference customers: Wendy's, City of Columbus, Huntington Bank, Olentangy Local School District.
- IGS offers a commercial Demand Response product at `igs.com/for-your-business/demandresponse`.
- IGS offers commercial LED Lighting Solutions.
- IGS serves 12 states.
- IGS has internal AI on Snowflake for forecasting and anomaly detection plus some LLM work on internal bots.
- "IGS has no publicly launched customer-facing AI product" (the gap CampusSense fills).

**Not safe (do NOT say):**
- "IGS needs us" / "IGS is behind"
- "IGS has no AI" (factually wrong)
- Any PJM or MISO specific DR revenue number for IGS
- Any Ohio C&I customer count
- Any JadeTrack pricing number

**Framing line (memorize):**
> "CampusSense is the Claude-powered chat and explanation layer that could ship on top of IGS's existing JadeTrack data platform. We add generative explanations, draft work orders, and chat-primary analyst UX that no one in the C&I category confirmably ships end-to-end."

---

## 21. Q&A preparation

Memorize five answers. Each is capped at four sentences.

**Q1. How did you train without labels?**
> We did not treat this as supervised classification. For each building-and-utility pair we fit a LightGBM regressor on kWh per sqft, conditioned on weather, OSU calendar, and temporal features. Anomalies are residuals that land above the 95th percentile of that building's own historical forecast error. That is the standard pattern in AMI-based M&V counterfactual baselining, and percentile framing makes the threshold distribution-free.

**Q2. What about drift from October to April?**
> The forecaster retrains weekly with a rolling window. Weather normalization handles seasonal swings, and the academic-calendar feature handles the spring load shape that looks nothing like fall. For a production deployment we would add a KL-divergence monitor on the feature distribution to trigger a refit.

**Q3. Why Claude and not GPT?**
> Three reasons. Prompt caching on Claude 4.x does not count cached reads against input-token rate limits, which matters when the same 1,411-building context is reused. Haiku 4.5 first-token latency is fast enough that the explanation feels alive. And this is Claude Hacks, so we used what the judges asked for.

**Q4. Could IGS ship this?**
> Yes, as a layer on JadeTrack. IGS already has the C&I data pipe from the 2021 acquisition, the commercial DR relationships, and the procurement book. CampusSense adds the anomaly model and the Claude-grounded explanation layer on top of that existing data.

**Q5. What is the moat?**
> The moat is the loop, not the model. Any team can train a LightGBM forecaster. The defensibility is that CampusSense closes the operator loop in one chat surface: detect, explain, visualize, translate into a DR dispatch plan. The deeper moat is the data asset that accumulates once thousands of C&I buildings are scored daily against their own history.

---

## 22. Acceptance criteria (build checklist)

Check each before demo. If any fails, stop and fix.

**Pre-flight:**
- [ ] `pnpm dev` boots without errors
- [ ] `/api/health` returns `{status:"ok", db:"ok", claude:"ok"}` locally
- [ ] `.env.local` has all required keys
- [ ] `.gitignore` excludes `data/`, `models/`, `meta/`, `.env.local`

**Data:**
- [ ] `data/raw/buildings_from_api.json` exists with >1,000 buildings OR fallback CSVs loaded
- [ ] `data/raw/readings/` has partitioned parquet
- [ ] `data/raw/weather.parquet` has 8,000+ rows
- [ ] `data/raw/init.sql` executes cleanly in DuckDB
- [ ] Schema validation passes (see Section 4e)

**Training:**
- [ ] At least 80% of (building, utility) pairs have `status:"trained"`
- [ ] Median validation MAE < 20% of median target
- [ ] Every trained model has a `cutpoints` array of length 21, strictly non-decreasing, with a nonzero maximum
- [ ] `models/` disk footprint between 100 MB and 500 MB

**Scoring:**
- [ ] Replay daemon inserts anomalies into Supabase
- [ ] Every anomaly has `cost_impact_usd >= 5`
- [ ] Lifecycle transitions (new → open → resolved) observed end-to-end
- [ ] Severity bands produce roughly expected distribution (most low, some medium, rare high)

**Chat:**
- [ ] "what broke overnight" returns an anomaly list within 3 seconds
- [ ] Clicking an anomaly returns a Claude explanation within 2 seconds (first token)
- [ ] "show me the med center" triggers a map view
- [ ] "if IGS called a DR event..." triggers the simulator
- [ ] All nine tools are exercised at least once during the dry run

**Realtime:**
- [ ] Inserting a row in `anomalies` updates the UI within 2 seconds
- [ ] Updating a row updates the map feature state within 2 seconds

**Demo:**
- [ ] `demo:reset` brings the app to a clean state in <10 seconds
- [ ] Backup video exists and plays offline
- [ ] Hidden injector shortcut works
- [ ] Hero anomalies are fixture-loaded and pre-cached

**Safety:**
- [ ] No em dashes anywhere in UI, explanations, work orders, or code comments
- [ ] No synthetic data passed off as real
- [ ] All cost numbers labeled "estimate"
- [ ] IGS framing is "layer on JadeTrack" everywhere
- [ ] Jordan Clark (not Julian), 16% overall (not per-sqft), OSU-observed holidays (not federal)

---

## 23. Honesty rules

If any of these are violated, the demo breaks the trust with the IGS judge and with Anthropic.

1. Label every spec-mode value. If the scrape failed, the UI shows a `SPEC MODE` banner. Not "beta," not "preview." Use the exact phrase "spec mode" so David can answer honestly if asked.
2. The word "estimate" appears next to every dollar figure the model surfaces.
3. If Claude says something the data does not support, mark it in a debug log and flag it in the post-demo retrospective.
4. Don't claim the scrape is live if it is running in replay. Say "replay against historical data." The judge will respect it.
5. The OSU dashboard has no published Terms of Service. The scraper identifies itself with David's OSU email in the User-Agent as courtesy. If OSU IT ever asks, the answer is "public endpoint, non-commercial research use, academic hackathon, happy to stop."

---

## 24. Risk register (top five, for quick pre-demo reference)

| # | Risk | Prob | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Scrape never runs cleanly | HIGH | HIGH | Single-file `scripts/scrape.py`; fallback CSVs ready; SPEC MODE banner if all else fails |
| 2 | Claude 429 during demo | MED | HIGH | Pre-cache hero explanations; warm cache at T-90s; `USE_CACHED_CLAUDE` flag |
| 3 | Wi-Fi fails at venue | MED | HIGH | Mobile hotspot paired; backup video on USB |
| 4 | Supabase project auto-paused | LOW | HIGH | `pg_cron` keep-alive every 6 hours + /api/health ping every 15 min for 24 hours prior |
| 5 | Judge presses IGS overclaim | HIGH | MED | Safe claims list (Section 20); rehearse the framing line |

---

## 25. Reference facts (grab bag)

- Claude Haiku 4.5 per call cost (1,500 in + 400 out, uncached): **$0.0035**.
- Claude Sonnet 4.6 per chat turn cost (3,000 in + 500 out, uncached): **$0.0165**.
- With prompt caching on 2,000 static tokens, a 100-turn Sonnet session drops from $1.65 to **$1.12** (32% savings).
- Tier 1 rate limits: Haiku 50 RPM / 50K ITPM / 10K OTPM. Sonnet 50 / 30K / 8K. Opus same as Sonnet.
- Cached input tokens do NOT count against ITPM.
- Mapbox free tier: 50,000 web map loads / month. Plenty.
- Supabase free tier: 500 MB DB, 200 peak realtime connections, 100 events/sec per tenant.
- OSU Columbus campus coordinates: **lat 40.0795, lon -83.0732**.
- OSU has 1,411 buildings per prior scrape; 270 in ERIK Data Hub; 485 on main Columbus campus under the OSEP concession.
- PJM 2026/2027 BRA capacity clearing price (AEP zone): **$329.17/MW-day UCAP** = **$120,147/MW-year**.
- DR worked default: 100 kW curtailable in AEP zone → **~$9,200/year net** after 25% aggregator fee and $500/MWh event-energy midpoint.
- Pinned replay clock: **2026-01-27T08:00:00-05:00** (morning after the record 11.9 inch snowstorm on 2026-01-25).
- 2026-01-26 is the snowstorm peak; 2026-02-06 to 02-07 is the polar vortex (wind chills -10F to -15F) → `{HERO_3}` source window.

---

## 26. Sequencing guide (the 44 hours)

Suggested schedule. Flex as needed.

**Hours 0 to 4:** pre-flight, repo skeleton, .env, Supabase project, Next.js boot, shadcn init. Green `/api/health` locally.

**Hours 4 to 8:** kick off `scripts/scrape.py` in a second Git Bash tab on the PC (runs 3-4 hours in background). While it runs, write schema migration, seed script skeleton, tool schemas, agent loop on the laptop.

**Hours 8 to 12:** training script finalized; once scrape completes, train (1 hour parallel). Meanwhile wire up `/api/chat`, `/api/anomaly/:id`, `/api/explain`.

**Hours 12 to 16:** scoring + lifecycle + cost math. Replay daemon first pass. Smoke test with fake data.

**Hours 16 to 24:** drop in frontend from David's separate frontend design prompt (once delivered). Wire to view directive stream. Bind realtime. Get the chat UX feeling right.

**Hours 24 to 32:** hero anomaly patching, pre-caching, map polish, DR simulator polish, dress rehearsal #1.

**Hours 32 to 38:** dress rehearsal #2. Record backup video. Buff the 90-second script. Rehearse Q&A out loud.

**Hours 38 to 42:** buffer for bugs. Pre-demo reset. Load the go-bag.

**Hours 42 to 44:** walk to Pomerene 280. Demo.

---

## 27. When the frontend design prompt arrives

Integration steps for when David drops the frontend prompt:

1. Read the full frontend prompt. Note the design system (tokens, spacing, color, typography, motion).
2. Merge its content into **Section 16** of this document, keeping the integration checklist intact.
3. Generate shadcn component files per the frontend prompt's spec. Use the components already added by `shadcn add` in Section 2 as starting points.
4. Wire:
   - Chat UI → `/api/chat` streaming response.
   - Anomaly inbox → Supabase realtime subscription.
   - View panel → router keyed off `view_type` in directive stream.
   - Map → Mapbox setup from research spike, bound to feature state.
   - Cmd-K → `Command` component with building + anomaly search.
5. Run the full acceptance checklist from Section 22. Every box gets checked before demo.

The backend does not change. The contracts in Sections 9, 13, 14, 15 are frozen.

---

**End of build meta-prompt.** The frontend design section is the one remaining gap. Everything else is specified.
