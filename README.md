# CampusSense

**AI-powered energy anomaly detection for The Ohio State University campus.**

CampusSense ingests building-level smart-meter data across OSU's campus, learns each building's expected energy signature, flags anomalies in near-real-time, and uses Claude to explain *why* a building is behaving strangely — in plain English a facilities manager can act on.

🔗 **Live demo:** [campussense.vercel.app](https://campussense.vercel.app)
🏆 Built for the Claude Hackathon (Claude Hacks @ OSU)

---

## The problem

A large university campus burns through an enormous amount of energy, and most waste hides in plain sight: a stuck HVAC damper, a chiller running through a holiday, lights cycling on an empty building at 3 a.m. The raw meter data exists, but nobody has time to stare at hundreds of time-series charts looking for the one that looks *off*.

CampusSense does the staring. It models normal behavior per building, surfaces the deviations that matter, and hands you a Claude-generated explanation instead of a wall of numbers.

## What it does

- **Ingests real campus data** — scrapes OSU's Energy Dashboard (SOAP/WSDL) for building-level consumption across roughly a year of history, and pulls matching weather from Open-Meteo so models can separate "it's just hot out" from "something is broken."
- **Learns expected behavior** — trains gradient-boosted (LightGBM) baseline models per building, conditioned on time-of-day, day-of-week, seasonality, and weather.
- **Detects anomalies** — scores live consumption against the learned baseline and ranks buildings by how far, and how unusually, they deviate.
- **Explains with Claude** — routes each anomaly through a tiered set of Claude models to produce a human-readable diagnosis and a campus chat assistant you can ask follow-ups.
- **Visualizes the campus** — an interactive Mapbox/Leaflet map of OSU with per-building drill-downs, Recharts time-series, and anomaly overlays.

## Claude integration

Rather than calling one model for everything, CampusSense routes by task to balance latency, cost, and depth:

| Task | Model | Why |
|------|-------|-----|
| Quick anomaly explanations | **Claude Haiku 4.5** | Fast, cheap, runs on every flagged building |
| Interactive campus chat | **Claude Sonnet 4.6** | Strong reasoning for back-and-forth Q&A |
| Deep root-cause analysis | **Claude Opus 4.7** | Reserved for the hard, high-value diagnoses |

This is configured entirely through environment variables (`ANTHROPIC_MODEL_EXPLAIN`, `ANTHROPIC_MODEL_CHAT`, `ANTHROPIC_MODEL_DEEP`), so the routing is easy to retune.

## Tech stack

**Frontend / app**
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + shadcn/ui + Framer Motion
- Mapbox GL + Leaflet / react-leaflet for the campus map
- Recharts for time-series, Zustand for state, Sonner for toasts

**Backend / data**
- Python 3.11+ pipeline: LightGBM, pandas, scipy, DuckDB, PyArrow
- `zeep` SOAP client for the OSU Energy Dashboard scraper
- Open-Meteo archive + forecast APIs for weather features
- Supabase (Postgres) for storage, served to the app via the Supabase JS client

**AI**
- Anthropic Claude (`@anthropic-ai/sdk` + Python `anthropic`)

## Architecture

```
OSU Energy Dashboard (SOAP)  ─┐
                              ├─▶  Python ETL (scripts/)  ─▶  Supabase (Postgres)
Open-Meteo (weather APIs)    ─┘            │                        │
                                           ▼                        ▼
                                  LightGBM baselines  ───▶  Anomaly scoring
                                                                    │
                                                                    ▼
                                          Next.js app  ◀──  Claude (Haiku / Sonnet / Opus)
                                          (map • charts • chat)
```

## Getting started

### Prerequisites
- Node.js 20+ and [pnpm](https://pnpm.io/)
- Python 3.11+
- A Supabase project, an Anthropic API key, and a Mapbox token

### 1. Clone and install

```bash
git clone https://github.com/Arin-OSU/Color-Smack-.git
cd Color-Smack-

# Frontend deps
pnpm install

# Python deps
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Then fill in `.env.local`:
- `ANTHROPIC_API_KEY` — your Claude API key
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` — your Supabase project
- `NEXT_PUBLIC_MAPBOX_TOKEN` — a Mapbox public token (URL-restricted recommended)

The model routing and scraper/weather settings already have sensible defaults in `.env.example`.

### 3. Run the data pipeline

```bash
# scrape energy + weather, train models, score anomalies
python scripts/...   # see scripts/ for the pipeline entrypoints
```

### 4. Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

> **Demo mode:** `.env.example` ships with `DEMO_FROZEN_MODE=true`, which pins the app to a fixed timestamp with seeded fixtures so the demo is fully reproducible without live API calls. Set it to `false` for live operation.

## Project structure

```
app/          Next.js App Router pages and API routes
components/    UI components (map, charts, chat, shadcn/ui)
hooks/         React hooks
lib/           Client/server utilities (Supabase, Claude, helpers)
scripts/       Python ETL, model training, and anomaly scoring
data/          Datasets / fixtures
public/        Static assets
```

## Roadmap

- Live alerting (email / Slack) on high-severity anomalies
- Per-building cost-impact estimates in dollars and CO₂
- Feedback loop so facilities staff can confirm/dismiss anomalies and retrain
- Expansion beyond electricity to steam, chilled water, and gas meters

## Acknowledgments

- OSU Energy Dashboard for building-level meter data
- [Open-Meteo](https://open-meteo.com/) for free weather data
- Anthropic for the Claude API
- Built at Claude Hacks @ OSU

---

*Author: [Arin](https://github.com/Arin-OSU) · The Ohio State University*
