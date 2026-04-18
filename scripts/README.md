# CampusSense scraper quick start

For the machine running scripts only (your friend's PC, i7 + 3060 Ti).
The GPU isn't used; the work here is I/O-bound (SOAP) + CPU (LightGBM later).

## 1. Bootstrap once

From `C:\claudeathon` in Git Bash:

```bash
python -m venv .venv
source .venv/Scripts/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env.local    # edit ANTHROPIC_API_KEY + Supabase keys later
```

PowerShell equivalent for activation: `.venv\Scripts\Activate.ps1`

## 2. Run the scraper

```bash
python scripts/scrape.py
```

Expected runtime: 3-4 hours at 1 req/sec. Output lands in `data/raw/`.

Useful flags:

```bash
python scripts/scrape.py --dry-run          # just print WSDL operations, no fetch
python scripts/scrape.py --only-buildings   # stop after getBuildings
python scripts/scrape.py --only-meters      # stop after getBuildingUtilities
python scripts/scrape.py --skip-weather     # skip Open-Meteo
```

The scraper is **resumable**. Parquet files with ~95% of expected rows are
skipped; the loop picks up where it left off. Safe to Ctrl-C and re-run.

Run it in a second Git Bash tab so the window stays open while the first
tab keeps working on frontend / training:

```bash
# Tab 2
cd /c/claudeathon
source .venv/Scripts/activate
python scripts/scrape.py
```

Or fire-and-forget from cmd.exe:

```cmd
start /B cmd /c "cd /d C:\claudeathon && .venv\Scripts\python.exe scripts\scrape.py > data\raw\scrape.stdout.log 2>&1"
```

## 3. If the SOAP API is down

The scraper writes `"status": "FALLBACK_REQUIRED"` to
`data/raw/summary.json` and exits with code 2. Drop the three fallback
files into `data/fallback/`:

- `meter-data-oct-2025.txt`
- `building_metadata.txt`
- `weather-sept-oct-2025.txt`

Then:

```bash
python scripts/load_fallback.py
```

Same output layout, same `init.sql`.

## 4. Sanity check

```bash
python -c "import duckdb; con=duckdb.connect(); con.execute(open('data/raw/init.sql').read()); print(con.execute('select count(*) from v_readings').fetchone())"
```

## Output tree

```
data/raw/
  wsdl.xml
  buildings_from_api.json
  meters_from_api.json
  READING_OP.txt
  MAX_WINDOW.txt
  scrape_log.jsonl
  summary.json
  init.sql
  weather.parquet
  readings/
    utility=electricity/building=<N>/readings.parquet
    utility=natural_gas/...
    utility=chilled_water/...
    utility=heating_hot_water/...
```
