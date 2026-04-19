# CampusSense — Fix List for Handoff

## Project Overview

CampusSense is a Next.js 16 (App Router) campus energy monitoring dashboard for Ohio State University. It shows anomaly alerts from LightGBM meter-reading models, a Leaflet map with building markers, a Recharts time-series chart, and a chat panel intended to be powered by Claude.

**Stack:** Next.js App Router · TypeScript · Tailwind v4 · Zustand v5 (`zustand/react`) · Leaflet (dynamic import, SSR-safe) · Recharts · shadcn/ui · cmdk · next-themes

**Run:** `pnpm dev` (or `start.bat`) → http://localhost:3000

**Key files:**
- `app/page.tsx` — root, wires everything together, fake chat handler lives here
- `components/stage/Stage.tsx` — center panel router + `AnomalyDetailPlaceholder` + `AnomalyChart`
- `components/stage/MapView.tsx` — Leaflet map, OSU + external university layers
- `components/shell/CommandPalette.tsx` — ⌘K search
- `components/rail/LeftRail.tsx` — anomaly inbox sidebar
- `components/panel/ResponsePanel.tsx` — chat response panel
- `components/shell/DataSourceDialog.tsx` — CSV upload modal (+ button in TopBar)
- `lib/directive-bus.ts` — Zustand store (anomalies, external data, turns, dispatch)
- `lib/ingest.ts` — client-side CSV parse + z-score anomaly detection
- `app/api/anomalies/route.ts` — serves `data/raw/anomalies.json`
- `app/api/timeseries/route.ts` — serves `data/raw/timeseries/{building_id}__{utility}.json`

---

## Bug 1 — Chat is completely fake (CRITICAL)

**File:** `app/page.tsx` lines 38–73

`handleSubmit` never calls Claude. It generates a hardcoded string, streams it character-by-character with `setTimeout`, and always shows the same top-5 anomaly cards regardless of what the user typed.

**Fix:** Create `app/api/chat/route.ts` that:
1. Accepts `POST { message: string, anomalies: Anomaly[] }` (pass top 20 anomalies as context)
2. Uses the Anthropic SDK (`@anthropic-ai/sdk`) with `claude-sonnet-4-6` (or the latest model at time of fix)
3. Streams the response using `createStreamableValue` or `ReadableStream` + SSE
4. Returns tool-use directives so Claude can emit `{ target: "center", view_type: "anomaly_detail", data: { anomaly_id } }` JSON blocks that `handleSubmit` can parse and call `dispatch()` with

In `handleSubmit`, replace the fake loop with a real `fetch('/api/chat', ...)` streaming call that pipes chunks to `appendAssistantText(turn_id, chunk)`.

**Anthropic SDK import:** `import Anthropic from "@anthropic-ai/sdk"` — already in node_modules from pnpm. API key from `process.env.ANTHROPIC_API_KEY` in `.env.local`.

---

## Bug 2 — `anomaly_list` view is an unimplemented placeholder

**File:** `components/stage/Stage.tsx` lines 39–44

After any chat message, `handleSubmit` calls `setCenter({ view_type: "anomaly_list", ... })`. `Stage.tsx` falls through to `GenericStagePlaceholder` for this case, showing "anomaly_list view wired in next pass."

**Fix:** Add a real `AnomalyListView` component in Stage.tsx and handle the `"anomaly_list"` case. It should:
- Read `anomalies` from the bus
- Show them in a sortable table or card grid (cost, severity, building name, utility, duration)
- Clicking a row dispatches `{ target: "center", view_type: "anomaly_detail", data: { anomaly_id } }`

---

## Bug 3 — External anomaly markers on the map have no click handler

**File:** `components/stage/MapView.tsx` — the `extMarkersRef` useEffect (the second markers effect, around line 174–246)

OSU building markers dispatch to `anomaly_detail` on click. External university markers only bind a popup — there is no `circle.on("click", ...)` handler.

**Fix:** After `circle.bindPopup(...)`, add:
```ts
if (anomaly) {
  circle.on("click", () => {
    // External anomalies need their own detail view or reuse AnomalyDetailPlaceholder
    // For now, dispatch with enough data to show a generic detail
    dispatch({
      target: "center",
      view_type: "anomaly_detail",
      data: { anomaly_id: anomaly.id, external: true },
      config: { title: anomaly.building_name },
    });
  });
}
```

Also `dispatch` is not in scope in the markers effect — add `const dispatch = useBus((s) => s.dispatch)` at the top of the component (it's already there) and make sure it's included in the effect's dependency array or captured via a ref.

---

## Bug 4 — `AnomalyDetailPlaceholder` can't find external anomaly IDs

**File:** `components/stage/Stage.tsx` lines 48–99

`AnomalyDetailPlaceholder` does `anomalies.find((x) => x.id === id)` where `anomalies` is the OSU bus anomalies. External anomaly IDs start with `"ext-"` and live in `externalAnomalies` (a separate bus field). If none is found it falls back to `GenericStagePlaceholder`.

**Fix:** In `AnomalyDetailPlaceholder`, also search `externalAnomalies`:
```ts
const externalAnomalies = useBus((s) => s.externalAnomalies);
const extA = externalAnomalies.find((x) => x.id === id);
```
Then render a simplified detail card for `extA` (it has `building_name`, `severity`, `utility`, `cost_usd`, `z_score`, `first_time`, `last_time` — see `ExternalAnomaly` type in `lib/ingest.ts`). No timeseries chart is expected for external anomalies since there's no server-side data file for them.

---

## Bug 5 — Search results don't navigate on select

**File:** `components/shell/CommandPalette.tsx`

Two broken `onSelect` handlers:
1. **External anomalies** (`externalAnomalies.map`): `onSelect` only calls `onOpenChange(false)` — never dispatches.
2. **Buildings** (`buildings.map`): `onSelect` only closes — doesn't pan the map or open any detail.

**Fix for external anomalies:**
```ts
onSelect={() => {
  dispatch({
    target: "center",
    view_type: "anomaly_detail",
    data: { anomaly_id: a.id, external: true },
    config: { title: a.building_name },
  });
  onOpenChange(false);
}}
```

**Fix for buildings:** For now, dispatch a center directive that pans the map. You can add a new `view_type: "map"` directive with `data: { focus_lat: b.latitude, focus_lon: b.longitude }` and handle it in `MapView.tsx` with `map.setView([lat, lon], 17)`. Or simply close and show a toast — the map pan requires some plumbing.

---

## Bug 6 — Chart grid is invisible in light mode

**File:** `components/stage/Stage.tsx` line 183

```tsx
<CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
```

White at 5% opacity is invisible on a light background.

**Fix:**
```tsx
<CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
```

---

## Bug 7 — TopBar hardcodes "485 buildings"

**File:** `components/shell/TopBar.tsx` line 38

```tsx
<span>Columbus main · 485 buildings</span>
```

**Fix:** Either fetch `/api/buildings` once (count the array length) and store it in local state, or read from the bus if buildings are stored there. A simple approach: fetch on mount in TopBar with `useEffect`.

---

## Bug 8 — No way to clear uploaded external data

Once a CSV is uploaded via the `+` dialog, external buildings/anomalies stay on the map forever. There is no reset/clear button.

**Fix:** Add a `clearExternalData` action to `lib/directive-bus.ts`:
```ts
clearExternalData: () => set({ externalBuildings: [], externalAnomalies: [] }),
```
In `MapView.tsx` header, show an `×` button next to the "+X ext" badge that calls `clearExternalData()` and snaps the map back to `OSU_CENTER` at zoom 15.

---

## Notes for the fixer

- Zustand v5 requires `import { create } from "zustand/react"` — **not** `"zustand"`. All hooks must use a selector: `useBus((s) => s.field)`. Calling `useBus()` with no selector crashes.
- Leaflet must be dynamically imported (`import("leaflet").then(...)`) — SSR breaks with static imports.
- All components that touch browser APIs need `"use client"` at the top.
- The app builds fine with `pnpm build`. TypeScript is strict. Don't introduce `any` without an eslint-disable comment.
- `data/raw/anomalies.json` and `data/raw/timeseries/*.json` are generated by `scripts/export_anomalies.py` — they may be empty or missing in a fresh clone, which is fine (the app falls back to `HERO_ANOMALIES` from `lib/fixtures/hero-anomalies.ts`).
