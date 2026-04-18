# CampusSense Frontend Design Meta-Prompt

**For:** Claude Code, executing the CampusSense frontend at Claude Hacks @ Ohio State, April 17-19, 2026.
**Drops into:** Section 16 of `campussense_build_meta_prompt.md`. Replaces the `[GAP]` placeholder.
**Owner:** Arin (for David Kumar, OSU Fisher).
**Judge target:** IGS Energy (Silver sponsor).

---

## 0. How to read this doc

This prompt defines the UI/UX layer only. The backend contracts in Sections 9 (view directive stream), 13 (frozen clock), 14 (realtime), and 15 (API routes) are frozen. Do not change them. This document specifies:

- The overall layout: two columns plus a sticky bottom composer, Claude-app style.
- The design system (tokens, type, motion, density).
- Every component the app renders, broken into files, with props and state.
- How each `view_type` from the directive stream maps to a component.
- How the chat drives three surfaces at once: entity cards into the ResponsePanel, a view directive into CenterStage, and assistant text inline.
- The three hero moments from the 90-second demo script, staged for maximum visual impact.
- The failure states (SPEC MODE banner, Claude down, scrape failed, realtime lagging).

Every hard rule from Sections 1, 16, and 22 of the build contract still applies. In particular: no em dashes, every dollar figure labeled "estimate," the frozen clock is displayed so the judge knows we are not hiding replay mode, and the IGS framing is "layer on JadeTrack."

Before coding: read Section 1 of this doc (layout), Section 2 (hero beats), and Section 3 (design system). The rest is execution.

---

## 1. Layout: Claude-app shell

### 1a. Shell structure

Full viewport. No scrolling on the outer shell. Two columns on desktop (≥1280px): LeftRail + MainArea. MainArea is itself a vertical flex: TopBar, then a horizontal flex (CenterStage + ResponsePanel), then the sticky BottomComposer. Below everything is the StatusBar.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TopBar (h-12)                                                              │
├──────────────┬───────────────────────────────────────────┬─────────────────┤
│              │                                           │                 │
│  LeftRail    │  CenterStage                              │  ResponsePanel  │
│  (w-72)      │  (flex-1, min-w-0)                        │  (w-[380px])    │
│              │                                           │                 │
│  Anomaly     │  Map (default) OR whatever the latest     │  Stacked turn   │
│  inbox       │  ViewDirective asks for.                  │  cards.         │
│              │                                           │                 │
│              │  Max one directive view at a time.        │  Scrolls        │
│              │  New directive = smooth cross-fade.       │  independently. │
│              │                                           │                 │
│              │                                           │  Latest turn    │
│              │                                           │  auto-scrolls   │
│              │                                           │  into view.     │
│              │                                           │                 │
│              │                                           │                 │
│              ├───────────────────────────────────────────┤                 │
│              │  BottomComposer (sticky, centered,        │                 │
│              │  max-w-3xl, h-auto up to 6 rows)          │                 │
├──────────────┴───────────────────────────────────────────┴─────────────────┤
│ StatusBar (h-7): frozen clock · scrape status · claude status · 429 guard  │
└────────────────────────────────────────────────────────────────────────────┘
```

### 1b. Why this shape

The Claude-app paradigm works because the chat bar is always one keystroke away, and the response surface accumulates context without stealing attention from the main visual. In CampusSense:

- The **map stays the centerpiece** (CenterStage) because the hero-3 Med Center moment in the 90-second script pans and zooms into a specific wing.
- The **BottomComposer** is where every question starts. It is never hidden, never minimized. Identical to Claude's own chat input.
- The **ResponsePanel** is where Claude's work accumulates as entity cards: "current global events in energy" returns five cards (Iran oil exports, EU gas storage, PJM capacity auction, etc.) stacked top-to-bottom within that turn's group. Each card is lightweight, clickable, and stacks with previous turns' cards.
- The **LeftRail** remains the work queue of anomalies, separate from the chat surface, because those are ambient (come in via realtime) rather than chat-driven.

Two surfaces, two weights:
- ResponsePanel = lightweight, contextual, stackable, scrollable, never full-canvas.
- CenterStage = heavyweight, one thing at a time, full-canvas, meant to be pointed at during the demo.

One chat turn can drive both. Asking "show me the Med Center" emits a `render_map` directive to CenterStage AND a reference card to ResponsePanel ("Wexner Medical Center · 37 buildings · currently showing on map"), so you can scroll back later and re-fire that view by clicking the card.

### 1c. The view directive router

File: `components/stage/Stage.tsx`. This is the beating heart of CenterStage. It subscribes to the directive stream emitted by the assistant turn (Section 9c of the build contract) and switches between render components:

```tsx
// Pseudocode
function Stage({ directive }: { directive: ViewDirective | null }) {
  if (!directive) return <MapView mode="overview" />;  // default state
  switch (directive.view_type) {
    case "map":             return <MapView directive={directive} />;
    case "chart":           return <ChartView directive={directive} />;
    case "anomaly_list":    return <AnomalyListView directive={directive} />;
    case "anomaly_detail":  return <AnomalyDetailView directive={directive} />;
    case "work_order":      return <WorkOrderView directive={directive} />;
    case "dr_simulator":    return <DRSimulatorView directive={directive} />;
    case "text":            return <TextView directive={directive} />;
  }
}
```

Transition: Framer Motion `<AnimatePresence mode="wait">` around the switch. Exit: opacity 1 → 0 in 180ms. Enter: opacity 0 → 1, y: 8 → 0 in 220ms, ease-out. No scaling, no slides. Feels fast, not flashy.

**Hard rule:** the map is always mounted behind the active directive, kept warm. When the directive is `chart`, `anomaly_detail`, `work_order`, `dr_simulator`, or `text`, the map fades to `opacity-0` but stays in the DOM. When the directive closes (via the X button in the view header, or a new `map` directive), we fade back in without re-initializing Mapbox. This avoids the ~400ms Mapbox cold-boot every time.

### 1d. The directive bus, extended

The build contract's view directive stream (Section 9c) was designed for CenterStage. We extend it with a second directive type that targets the ResponsePanel.

```typescript
// lib/directive-bus.ts
export interface CenterDirective {
  target: "center";
  view_type: "map" | "chart" | "anomaly_list" | "anomaly_detail" | "work_order" | "dr_simulator" | "text";
  data: Record<string, any>;
  config: Record<string, any>;
}

export interface PanelCard {
  target: "panel";
  card_type: "entity" | "anomaly_ref" | "building_ref" | "chart_mini" | "fact" | "action" | "source";
  data: Record<string, any>;
  config: Record<string, any>;
}

export type Directive = CenterDirective | PanelCard;
```

**Routing rule:** tools whose name starts with `render_` or equals `draft_work_order` / `simulate_dr_event` emit `CenterDirective`. Tools whose name is `list_buildings`, `query_anomalies`, `get_building_info`, `query_readings` (without a follow-up render) emit one or more `PanelCard` entries, one per result item, up to a cap (see Section 8). The assistant text always lands in the ResponsePanel as a turn header above that turn's card group.

This does NOT change the backend. The `lib/tools/handlers.ts` return shape stays `{ view_type, data, config }` per the contract. The client-side directive router inspects the tool name and decides whether the result lands in CenterStage (it is a `render_*` / `draft_*` / `simulate_*`) or in ResponsePanel as cards (it is a data-plane tool).

### 1e. Viewport scope

Desktop web app only. Assume a 1440×900 minimum viewport for the demo laptop and a 1920×1080 PC monitor for dev. No tablet, no mobile, no responsive collapse. If the viewport is narrower than 1280px, the layout simply clips with horizontal scroll - we are not spending hours on breakpoints for a build this short.

---

## 2. The three hero moments (stage directions)

Everything else in this doc serves these three beats from the 90-second script.

### 2a. Beat 1 @ 0:10 - "what broke overnight"

User types in BottomComposer. Sonnet calls `query_anomalies` → emits three `anomaly_ref` PanelCards for HERO_1, HERO_2, HERO_3 → then calls `render_anomaly_list` → emits a CenterDirective.

Visual choreography:
1. User's message slides up into the ResponsePanel as a turn header at the bottom of the stack (200ms).
2. "Claude is scanning" micro-indicator under it.
3. Three entity cards stream into the panel, 60ms stagger, each a compact anomaly reference with severity color, building name, cost estimate.
4. 400ms after the last card lands, CenterStage fades from map → AnomalyListView showing the same three anomalies in full-canvas form.
5. Assistant text ("I found three anomalies from the last 24 hours") appears inline above the entity cards in the ResponsePanel.
6. LeftRail was already populated (realtime), highlights sync: the three hero cards in LeftRail get a subtle ring to show they are the active subject.

The ResponsePanel auto-scrolls so the new turn group is fully visible. Older turns push up.

### 2b. Beat 2 @ 0:25 - "I click the top one"

User clicks either the entity card in ResponsePanel OR the full row in CenterStage AnomalyListView OR the card in LeftRail. Any of the three click targets opens the same view.

CenterStage fades to AnomalyDetailView. The Claude explanation streams into the right-hand side of the detail panel at 40ms/token (fake stream for cached, real stream otherwise). A Recharts line chart on the left shows the meter trace for the event window, with the baseline as a dashed overlay and the anomaly window as a red tinted band.

The click also pushes one `fact` card into ResponsePanel: "Opened: Lazenby Hall · electricity · $420 est." so the turn history still makes sense.

Visual hook: watching the explanation type itself out IS the Claude moment. Do not let it feel instant. The meter chart should finish rendering before the text starts streaming (chart first, text second — sequencing builds anticipation).

### 2c. Beat 3 @ 0:45 - "show me the med center"

Sonnet calls `list_buildings` (filter: campus=Medical Center) → emits one `building_ref` PanelCard per building, grouped under the turn header. Then calls `render_map` with `building_ids` filtered to the Med Center complex and `highlight: [HERO_3.building_id]`.

CenterStage fades back to MapView, but this time the map smoothly pans + zooms using `map.flyTo({center, zoom: 16, duration: 2000, essential: true})`. Every building in the frame pulses once at its severity color, then settles. HERO_3's marker pulses continuously (2s cycle) to mark it as the focus.

The ResponsePanel for this turn shows: assistant text ("Zooming to Wexner Medical Center. 37 buildings. HERO_3 is active."), followed by a compact list of `building_ref` cards (collapsed to 5 visible with a "show 32 more" expander).

Visual hook: the flyTo animation is the whole thing. Do not zoom too fast. 2 seconds feels intentional, not janky.

### 2d. Beat 4 @ 1:00 - "if IGS called a DR event"

Sonnet calls `simulate_dr_event` → directive is `dr_simulator` in CenterStage. ResponsePanel gets one `fact` card with the econ summary (annualized capacity revenue estimate + net per year) so the numbers live on after the full view is dismissed.

CenterStage fades to DRSimulatorView. This is a two-column view: top 10 flex loads ranked (left, table) and the econ summary card (right, three big numbers with the "estimate" label). The "exclude (fume-hood safety)" row must render with a gray chip, not a red warning — it is a safety feature, not a problem.

Visual hook: the ranked table rows stagger in one per 80ms, kWh bar fills growing left to right like a horse race finishing. The econ card numbers count up from 0 to their final values over 600ms (not 2 seconds, that feels slow).

---

## 3. Design system

### 3a. Tokens (Tailwind v4, `app/globals.css`)

We use the OKLCH color space because it matches shadcn's v4 defaults and renders better on dark. Values below are final; do not invent new ones in components.

```css
@theme {
  /* Core palette */
  --color-bg:            oklch(0.14 0.005 250);   /* near-black, slight cool */
  --color-bg-elev-1:     oklch(0.18 0.006 250);   /* cards */
  --color-bg-elev-2:     oklch(0.22 0.008 250);   /* popovers, hover */
  --color-border:        oklch(0.28 0.008 250);
  --color-border-strong: oklch(0.38 0.010 250);
  --color-fg:            oklch(0.96 0.003 250);
  --color-fg-muted:      oklch(0.72 0.008 250);
  --color-fg-subtle:     oklch(0.52 0.010 250);

  /* Accent - scarlet, tuned down so it does not scream */
  --color-accent:        oklch(0.62 0.19 25);     /* OSU scarlet, desat */
  --color-accent-fg:     oklch(0.98 0.003 250);
  --color-accent-soft:   oklch(0.62 0.19 25 / 0.15);

  /* Severity */
  --color-sev-low:       oklch(0.78 0.14 95);     /* amber */
  --color-sev-med:       oklch(0.70 0.17 50);     /* orange */
  --color-sev-high:      oklch(0.62 0.22 27);     /* red-scarlet */
  --color-sev-none:      oklch(0.45 0.020 250);   /* slate */

  /* Status */
  --color-ok:            oklch(0.72 0.15 155);    /* green */
  --color-warn:          oklch(0.78 0.14 95);
  --color-danger:        oklch(0.62 0.22 27);

  /* Recharts tokens (Recharts v3 convention, raw values, no hsl wrap) */
  --chart-1: var(--color-accent);
  --chart-2: oklch(0.70 0.14 220);   /* blue for baseline */
  --chart-3: var(--color-sev-med);
  --chart-4: oklch(0.68 0.12 155);   /* green for savings */
  --chart-5: var(--color-fg-muted);  /* gray for secondary series */

  /* Typography */
  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "SF Mono", ui-monospace, monospace;

  /* Radii */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  /* Motion */
  --ease-out-snappy: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 180ms;
  --duration-base: 220ms;
  --duration-slow: 420ms;
}
```

Dark mode is the default and only mode for demo. `next-themes` sets `defaultTheme="dark"`, `enableSystem={false}`.

### 3b. Typography rules

- Body: Inter, 14px (leading-5), weight 400.
- Labels / eyebrow text: Inter, 11px, uppercase, `tracking-[0.08em]`, weight 500, `text-fg-muted`.
- H1 (screen title, used once per view): Inter, 20px, weight 600.
- H2 (section header): Inter, 15px, weight 600.
- **Numbers (hard rule):** JetBrains Mono, `tabular-nums`, weight 500. Every numeric span gets `className="font-mono tabular-nums"`. This includes dollars, kWh, percentiles, timestamps, percentages, building IDs.
- Building names stay in Inter, never mono.

Create a `<Num>` component that enforces this:

```tsx
// components/ui/Num.tsx
export function Num({ value, prefix, suffix, className }: NumProps) {
  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {prefix}{value}{suffix}
    </span>
  );
}
```

### 3c. Spacing density

Hackathon demo = dense, not airy. Defaults:

- Card padding: `p-4` (16px). Cards in LeftRail: `p-3` (12px, they need to fit 4+ rows). Cards in ResponsePanel: `p-3` (12px, they stack and must stay lightweight).
- Gap between cards: `gap-2` (8px).
- Gap between sections inside a card: `gap-3` (12px).
- Gap between turn groups in ResponsePanel: `gap-5` (20px), with a hairline divider.
- Line height for data: `leading-snug`.

### 3d. Motion rules

- Hover on interactive: `transition-colors duration-fast`.
- Panel transitions in CenterStage: 220ms.
- ResponsePanel card entry: opacity 0→1, y 6→0, 180ms, 60ms stagger within a group.
- Number count-ups: 600ms with `ease-out-snappy`.
- Map flyTo: 2000ms (intentionally slow for the hero beat).
- Anomaly row stagger: 60ms between items, max 8 items staggered.
- Claude streaming token: 40ms/token for cached, native speed for real.
- **No bouncy easings.** Nothing springs. Everything is `ease-out` or `linear`. This is an operator tool, not a consumer app.

### 3e. Iconography

Lucide React, already installed. 16px default, 14px for dense rails. Use `strokeWidth={1.75}`. Specific mappings:

- `Activity` - live data / anomaly
- `Zap` - electricity
- `Flame` - natural gas / steam
- `Droplets` - chilled water / domestic water
- `Building2` - buildings list
- `Map` - map view
- `MessageSquare` - chat
- `Wrench` - work order
- `Gauge` - DR simulator
- `AlertTriangle` - severity high
- `TriangleAlert` - severity medium
- `Info` - severity low
- `CornerDownRight` - assistant turn indicator
- `Sparkles` - Claude streaming indicator (yes, the obvious one)

---

## 4. TopBar

File: `components/shell/TopBar.tsx`. Fixed, h-12, `bg-bg-elev-1 border-b border-border`, flex row with three sections.

**Left:** wordmark `CampusSense`, Inter 16px weight 600, followed by a subtle `· OSU` in `text-fg-muted`. 12px gap between wordmark and the campus selector dropdown (stub: "Columbus main, 485 buildings"). The dropdown is visual only for demo; no alt campus is wired.

**Center:** empty on desktop.

**Right:** three controls, 8px gap:
1. **Cmd-K trigger:** a faux search input showing "Search buildings or anomalies" with a `⌘K` kbd chip. `onClick` opens the palette (Section 10).
2. **Frozen clock badge:** shows "REPLAY · Jan 27, 2026 · 08:00 EST" (pulled from `DEMO_FROZEN_NOW`). `bg-accent-soft text-accent` so the judge sees it but it is not alarming. If `DEMO_FROZEN_MODE=false`, this becomes "LIVE · [current time]" in green. This is an honesty rule (Section 23 of the build contract).
3. **Settings menu** (three-dots): exposes demo-reset, inject-anomaly (dev only), and a theme toggle stub.

Never let the TopBar wrap or truncate the clock badge. It is the most important piece of information on the screen for the judge's trust.

---

## 5. LeftRail: the anomaly inbox

File: `components/rail/LeftRail.tsx`. `w-72`, `bg-bg`, `border-r border-border`, scrollable inside.

### 5a. Header

Sticky, h-10, `border-b`. Title "Anomaly inbox" plus a `<Badge>` count (total open anomalies) in `bg-bg-elev-2`. A sort dropdown on the right: "by cost" (default), "by severity", "by recency". No filter UI; filtering happens through chat ("show me chilled water anomalies").

### 5b. Cards

File: `components/rail/AnomalyCard.tsx`. Bound to the full Anomaly row shape from Supabase (Section 16 point 5 of the build contract). Renders:

```
┌──────────────────────────────────────┐
│▓│ LAZENBY HALL · electricity         │
│▓│ Winter break ghost load            │
│▓│                                    │
│▓│ $420 est. · p99.7 · 13 days        │
│▓│ Dec 22 - Jan 5                     │
└──────────────────────────────────────┘
```

- Left severity bar (`w-1`, full height, `bg-sev-{severity}`).
- First line: building name (Inter 14 weight 500) · utility icon + text (Inter 12 muted).
- Second line: short context (explanation title, or fallback to `claude_explanation` first sentence truncated to 60ch).
- Third line: the three data chips, all `font-mono tabular-nums`: `$<cost_impact_usd> est.` · `p<peak_percentile * 100, 1 decimal>` · `<duration_minutes → humanized>`. Example: `p99.7`.
- Fourth line: first reading time humanized (`Jan 27, 02:14` or `Dec 22 - Jan 5` for multi-day).

**Status styling:**
- `new` (less than 60s old): whole card has a subtle left-edge glow (`shadow-[inset_4px_0_0_0] shadow-accent`), pulses once on mount (opacity 0 → 1 over 400ms).
- `open`: normal.
- `reviewed`, `dismissed`, `resolved`: card `opacity-50`, no severity bar color, just gray.

Hover: `bg-bg-elev-1`, cursor-pointer. Active (currently displayed in CenterStage): `bg-bg-elev-2 ring-1 ring-border-strong`.

Click: dispatches a synthetic CenterDirective `{target: "center", view_type: "anomaly_detail", data: {anomaly_id: card.id}, config: {}}` to Stage, no chat round-trip. ResponsePanel gets a small `fact` card in the current turn group ("Opened from inbox: Lazenby Hall") so the context stays coherent if the user follows up with chat.

**Hard rule:** every `$` number has `" est."` appended inline, not in a tooltip. Honesty rule.

### 5c. Realtime behavior

Subscribed to Supabase `anomalies` table via `subscribeAnomalies` (Section 14).
- On INSERT: prepend card, play the `new` glow pulse.
- On UPDATE where `status` changed to resolved: apply the muted styling in place, do not remove.
- On UPDATE where `cost_impact_usd` or `peak_percentile` changed: animate the number with a 400ms count-up.
- Target latency: <2s from DB row to visible card. If `subscribeAnomalies` returns no events for 5s, fall back to 3s polling (Section 14 of build contract).

### 5d. Empty and error states

- Empty: "No anomalies in the last 24 hours. Quiet night." in `text-fg-muted`, centered, `py-12`. With a small `Activity` icon above.
- Scrape failed / SPEC MODE: banner at top of rail `bg-warn/15 text-warn text-xs p-2`: "SPEC MODE - showing fictional anomalies." Does not dismiss.
- Realtime disconnected: small dot turns red in the StatusBar (Section 9), no rail-level banner.

---

## 6. CenterStage views

All live under `components/stage/`.

### 6a. MapView

File: `components/stage/MapView.tsx`. Wraps Mapbox GL JS per the spike at `research/campussense/artifacts/mapbox_spike.html`.

**Setup (one time on mount):**
- Style: `mapbox://styles/mapbox/dark-v11` for the dark aesthetic.
- Center: `[-83.0132, 40.0036]` (OSU Columbus main campus center, not quite the lat/lon in `.env` because that is a meteorological reference).
- Zoom: 14.5 (shows full main campus).
- Single GeoJSON source `buildings` containing all 1,411 features, each with `id = buildingnumber` (numeric, required for `setFeatureState`).
- Single circle layer `buildings-layer`:
  - `circle-radius`: `["interpolate", ["linear"], ["zoom"], 13, 3, 17, 8]`
  - `circle-color`: `["case", ["==", ["feature-state", "severity"], "high"], "#db3520", ["==", ["feature-state", "severity"], "medium"], "#d97642", ["==", ["feature-state", "severity"], "low"], "#d4a43e", "#5a6070"]` (inline hex because Mapbox expressions do not resolve CSS variables; keep these synced with `lib/map-tokens.ts`)
  - `circle-stroke-width`: `["case", ["==", ["feature-state", "highlighted"], true], 2, 0]`
  - `circle-stroke-color`: `"#ffffff"`

**Hot path (per the build contract):** `map.setFeatureState({source: "buildings", id: buildingnumber}, {severity, highlighted})`. Called whenever an anomaly INSERT/UPDATE lands for that building. Never call `map.setData` on every anomaly; that re-parses the full 1,411-feature geojson and janks.

**Cold path:** `map.setData` only when the building set itself changes (e.g., campus switch).

**Directive handling:**
- `color_by: "severity"` - default, uses the feature state we are already updating via realtime.
- `color_by: "kwh_today"` - swap the color expression to an interpolate on the `kwh_today` feature property (already on the feature from `list_buildings`), using an OKLCH ramp (cool to warm). Not a hot path.
- `color_by: "delta_vs_baseline_pct"` - similar, diverging ramp centered on 0.
- `highlight: [ids]` - set `feature-state` `highlighted: true` on those, false on others. Draw a pulsing ring DOM overlay at each highlighted building's projected coordinates (Mapbox `project()`). Ring is `w-12 h-12 rounded-full border-2 border-accent animate-ping` absolute positioned; only first 3 highlighted get rings to avoid clutter.
- `building_ids` filter - if provided and non-empty, call `map.fitBounds` on the bounding box of those buildings with 80px padding. If empty/undefined, stay at overview.
- Directive-level `flyTo`: when switching from one MapView directive to another with a tighter `building_ids` set, use `flyTo` for 2000ms. This is how the "show me the med center" hero beat works.

**Popups:** click a building → small popup with name + current kWh + "open details" button. Popup content is `bg-bg-elev-2 border border-border rounded-md p-3 text-sm`, NOT Mapbox default white popup. Use a custom React portal rendered at the building's projected coord.

**Legend:** bottom-right corner, `absolute bottom-4 right-4`, tiny `bg-bg-elev-1/80 backdrop-blur-sm` pill showing the four severity colors with labels. Hidden when `color_by` is not severity.

**View header:** all views have a tiny header bar at top: title on left, `<X>` close button on right that pops back to the default map. MapView's header says "Campus map" plus subtitle from directive title.

### 6b. ChartView

File: `components/stage/ChartView.tsx`. Uses shadcn's `ChartContainer` wrapped around Recharts.

Supports `chart_type: "line" | "bar" | "area" | "heatmap" | "scatter"`:

```tsx
const chartConfig = {
  actual: { label: "Actual", color: "var(--chart-1)" },
  baseline: { label: "Expected", color: "var(--chart-2)" },
} satisfies ChartConfig;

<ChartContainer config={chartConfig} className="h-[420px] w-full">
  <LineChart data={directive.data.points}>
    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
    <XAxis dataKey={directive.config.x_axis.key} stroke="var(--color-fg-muted)" fontSize={11} />
    <YAxis stroke="var(--color-fg-muted)" fontSize={11} unit={directive.config.y_axis.unit} />
    <ChartTooltip content={<ChartTooltipContent />} />
    <Line dataKey="actual" stroke="var(--color-chart-1)" strokeWidth={1.75} dot={false} />
    {directive.data.overlays?.map(o => renderOverlay(o))}
  </LineChart>
</ChartContainer>
```

**Overlay kinds:**
- `baseline` - a dashed `Line` in `var(--chart-2)`, `strokeDasharray="4 3"`.
- `threshold` - a `ReferenceLine` horizontal at `value` in `var(--color-sev-med)`.
- `anomaly_window` - a `ReferenceArea` between `value.start` and `value.end` on the x-axis, `fill="var(--color-sev-high)" fillOpacity={0.12}`.
- `event_marker` - a `ReferenceLine` vertical at `value` (timestamp), `stroke="var(--color-accent)"` with a small label at top.

**Heatmap:** Recharts does not ship a heatmap. For the one expected use case (week-by-hour patterns), build a custom SVG component: 7 rows (days) × 24 cols (hours), each cell colored on an OKLCH ramp from chart-5 (cold) to chart-3 (warm). 240px tall, full width. Keep it fast; no interactivity beyond a tooltip on hover.

**Chart header:** title + subtitle + right-side controls. Controls are a `ToggleGroup` for time range (1D / 7D / 30D / 90D) when the chart is a timeseries; clicking refetches via `query_readings` and replaces the directive. Hidden when the chart is not time-based.

**Empty state:** if `points` is empty, render a shadcn `<Empty>` card: "No data in this window."

### 6c. AnomalyListView

File: `components/stage/AnomalyListView.tsx`. Different from LeftRail cards: these are wider, richer, and one directive at a time.

Each row is a full-width card (max 960px centered):

```
┌──────────────────────────────────────────────────────────────────────┐
│▓│ LAZENBY HALL              electricity      HIGH    $420 est.  ⟶   │
│▓│ Winter break ghost load                                             │
│▓│                                                                     │
│▓│ p99.7 peak · 13 day duration · actual 24,100 kWh ·                 │
│▓│ expected 8,400 kWh  ·  residual 15,700 kWh                         │
│▓│                                                                     │
│▓│ Started Dec 22, 2025 02:14 · Peaked Dec 27, 14:00 · Ongoing        │
└──────────────────────────────────────────────────────────────────────┘
```

- Same severity bar + chip convention as the rail card, bigger.
- Three rows of data. All numbers `font-mono tabular-nums`. Units after numbers, muted.
- Click → opens AnomalyDetailView as a directive.
- Stagger on mount: 60ms per row, max 8 items animated, rest appear instantly.
- Filterable via chips at top: utility, severity, status. Chips mirror whatever filters the directive was called with, read-only (they can update but they dispatch a new `query_anomalies` call through chat).

### 6d. AnomalyDetailView

File: `components/stage/AnomalyDetailView.tsx`. The most important view. Two-column layout inside CenterStage, 60/40 split. Left column (wider) is the chart. Right column is the Claude explanation plus action buttons.

**Left column:**
- A ChartView-like line chart showing the meter trace for the anomaly window PLUS 2 days of lead-in and 1 day of trailing context.
- Baseline overlay (dashed, chart-2).
- Anomaly window shaded (chart-3, opacity 0.12).
- Title: building name + utility. Subtitle: the event window in human format.
- Below the chart, a row of 5 stat chips: peak percentile (`p99.7`), residual kWh, duration, cost estimate, severity. Each with label above, value below in 20px mono.

**Right column:**
- Header: the anomaly status (`<Badge>` in severity color) and a tiny "copy link" button.
- Claude explanation, streamed. While streaming, show a small `Sparkles` icon with a pulse next to the title "Analysis by Claude." Once streamed, freeze.
- Below the explanation, three action buttons stacked: "Draft work order" (primary), "Mark reviewed", "Dismiss." All trigger API calls + state updates. Draft work order opens WorkOrderView as a new directive; the others PATCH the anomaly and update the card.
- At the very bottom, a small "peer comparison" collapsible (`<Collapsible>`) showing a small table: this building vs peers of same building_type for same utility + hour. Data comes from the explanation prompt's `peer_json`.

**Hard rule for explanation text:** never render em dashes. If the Haiku response contains any, replace with ` - ` pre-display. Add a `stripEmDashes()` utility in `lib/text.ts` and call it on every Claude string before it hits the DOM.

### 6e. WorkOrderView

File: `components/stage/WorkOrderView.tsx`. Renders a "document" mockup that looks like it could be pasted into a CMMS.

Layout: centered, max-w-2xl, `bg-bg-elev-1 border border-border rounded-lg p-6`. A small eyebrow "Draft for OSU FOD CMMS · not submitted" in `text-fg-muted text-xs uppercase tracking-wide`. Then an `h1` "Work order draft - [Building name]". Then the `draft_text` field, rendered as formatted prose (`prose prose-invert` from Tailwind typography plugin — add this plugin).

Bottom row of buttons: "Copy to clipboard" (primary), "Edit" (opens a Textarea inline replacing the prose, shadcn Button variant ghost), "Close" (returns to default map). No submit button, per the build contract — this never actually dispatches.

Sonner toast on copy: "Copied. Paste into FOD CMMS."

### 6f. DRSimulatorView

File: `components/stage/DRSimulatorView.tsx`. The visual reward for Beat 4.

Two-column at 55/45 split.

**Left column - the plan table:**
- Header: "Curtailment plan · [duration_minutes] min target at [target_mw] MW · [zone]"
- Ranked table of `plan` entries. Columns: rank, building, load type, kW shed (with a bar fill behind the row proportional to max), customer impact chip, notice time, rebound risk chip.
- Excluded rows (like ScottLab with fume-hood exclusion) render in a muted row with the `action` string in the shed column. Gray chip saying "Safety excluded." Not red.
- Bottom of the table: `Total shed X.X MW · Confidence: [high/med/low] · Rebound risk: [low/med/high]`.

**Right column - econ card:**
- Large card, `bg-bg-elev-1 p-5`.
- Three big numbers stacked, each with a label above:
  - "Annualized capacity revenue (est.)" → `$348,426` (count-up 600ms)
  - "Net per year (est.)" → `$9,188`
  - "Based on" → `100 kW · 60 event hrs/yr · 25% aggregator fee`
- Below the numbers, `<Alert>` component (shadcn) in info variant with the `notes` text. Leading icon: `Info`.

Footer: small muted text block carrying the safety copy from Section 12d: "This does not execute any control action. All dispatch decisions stay with OSU FOD and OSEP."

### 6g. TextView

File: `components/stage/TextView.tsx`. Fallback for Claude replies that specifically requested a full-canvas text view (rare; most text goes to the ResponsePanel turn header). Renders `data.markdown` in a centered max-w-2xl card with `prose prose-invert` styling. Supports Markdown headings, lists, code, but strip em dashes first.

---

## 7. BottomComposer

File: `components/composer/BottomComposer.tsx`. Sticky to the bottom of MainArea, spans CenterStage width (not ResponsePanel). Centered contents, `max-w-3xl mx-auto`. This is the Claude app's chat input, ported over.

### 7a. Structure

```
┌─────────────────────────────────────────────────────────────┐
│   ┌─────────────────────────────────────────────────────┐   │
│   │ Ask anything. Try "what broke overnight"         ↑  │   │  ← textarea + send button
│   └─────────────────────────────────────────────────────┘   │
│   [What broke overnight?] [Show Med Center] [DR event?]     │  ← suggestion chips, first load only
└─────────────────────────────────────────────────────────────┘
```

- Outer wrapper: `bg-bg/80 backdrop-blur-sm border-t border-border pt-3 pb-4 px-6`.
- Textarea wrapper: `bg-bg-elev-1 border border-border rounded-lg focus-within:border-border-strong transition-colors`.
- Textarea: auto-growing up to 6 rows then scrolls, `bg-transparent p-3 pr-12 resize-none w-full outline-none`, placeholder `text-fg-subtle`.
- Send button: absolute positioned bottom-right inside the textarea wrapper, 32×32, `rounded-md bg-accent text-accent-fg hover:bg-accent/90`. Icon: `ArrowUp` 16px. Disabled when input is empty OR Claude is streaming.
- Suggestion chips: only on empty state (no messages yet). After the first user message, the chip row collapses to 0 height. Click a chip = fill textarea and immediately submit.

### 7b. Keyboard

- Enter: submit.
- Shift+Enter: newline.
- Cmd+K / Ctrl+K: open palette (Section 10).
- Esc: blur textarea.
- ↑ on empty textarea: recall the last user message into the field (Claude app convention).

### 7c. Streaming state

While Claude is streaming a response:
- Send button becomes a Stop button (`Square` icon). Click stops the stream via AbortController.
- Textarea remains editable; user can start composing the next turn during the stream.
- A thin 2px progress bar at the top of the composer wrapper (`bg-accent`) indicates activity, indeterminate animation.

### 7d. Empty state

First load, no messages: ResponsePanel is empty (see Section 8d). BottomComposer shows three suggestion chips, centered below the textarea:
- "What broke overnight?"
- "Show me the Med Center"
- "If IGS called a DR event now, what could we shed?"

### 7e. Session persistence

Section 5e of the build contract: session ID in a cookie, history loaded on mount from `/api/chat` GET, messages appended on each POST. Reload should not lose state. Handle the cookie in `lib/session.ts`.

---

## 8. ResponsePanel

File: `components/panel/ResponsePanel.tsx`. Right-side rail within MainArea, `w-[380px]`, `bg-bg border-l border-border`, scrollable. This is where Claude's work accumulates as stacked entity cards, grouped by turn.

### 8a. Structure

Top-to-bottom, vertical scroll:

```
┌─────────────────────────────────┐
│ Turn group 1                    │  ← oldest turn at top
│ ─────────────────────           │
│  "You: what broke overnight?"   │  ← user message line
│  ┌───────────────────────────┐  │
│  │ Claude: Here are three.   │  │  ← assistant text
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ ▓ Lazenby Hall            │  │  ← anomaly_ref card
│  │   electricity · $420 est. │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ ▓ Scott Lab               │  │
│  │   electricity · $312 est. │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ ▓ Wexner 4E wing          │  │
│  │   electricity · $275 est. │  │
│  └───────────────────────────┘  │
│                                 │
│ ─────────────────────           │
│ Turn group 2                    │
│  "You: show me the med center"  │
│  ┌───────────────────────────┐  │
│  │ Claude: Zooming in...     │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │ ⊕ Map directive           │  │  ← thin ref card for the CenterStage view
│  │   Wexner, 37 buildings    │  │
│  │   click to re-show        │  │
│  └───────────────────────────┘  │
│  ⋯                              │
│                                 │
│ ─────────────────────           │
│ Turn group 3 ← latest, active   │  ← auto-scroll target
│  ...                            │
└─────────────────────────────────┘
```

Each turn group is a logical unit: user message on top, assistant text below it, card stack below that, optional thin divider (`border-t border-border`, 20px margin top/bottom).

### 8b. Turn header

File: `components/panel/TurnHeader.tsx`. Renders the user message and assistant text as a pair:

- User message: `text-fg-muted text-xs uppercase tracking-wide` label "You" above; content in Inter 14 weight 400 `text-fg`. Max 3 lines, then "show more" expander.
- Assistant text: similar eyebrow "Claude"; content renders as `<StreamedMarkdown>` while streaming, frozen after. Supports inline code, lists, bold. No em dashes (post-strip).
- If the turn has no assistant text (because tool calls produced only cards), skip the assistant block.

### 8c. Card types

File: `components/panel/cards/`. Each card is compact, single-card height 60-100px, designed to be scanned.

**`anomaly_ref`** - `components/panel/cards/AnomalyRefCard.tsx`:
```
┌──────────────────────────────────┐
│ ▓  LAZENBY HALL                  │
│    electricity · HIGH            │
│    $420 est. · p99.7 · 13 days   │
└──────────────────────────────────┘
```
Severity bar on left, building name, utility + severity chip, stats row. Click opens AnomalyDetailView in CenterStage.

**`building_ref`** - `components/panel/cards/BuildingRefCard.tsx`:
```
┌──────────────────────────────────┐
│ 🏢 SCOTT LAB                     │
│    STEM research · 142,000 sqft  │
│    current: 840 kW               │
└──────────────────────────────────┘
```
Building icon, name, building_type + area, current kWh reading if available. Click emits a `render_map` CenterDirective zoomed to that one building.

**`entity`** - `components/panel/cards/EntityCard.tsx` (the generic):
```
┌──────────────────────────────────┐
│    IRAN OIL EXPORTS              │
│    geopolitics · energy market   │
│    2.1M bbl/day Q1 2026          │
│    ↗ 12% YoY                     │
└──────────────────────────────────┘
```
For open-ended queries like "current global events in energy" where the model returns entities that do not map to a campus anomaly or building. Title + subtitle + two data lines. Used sparingly; if a card fits one of the typed variants, prefer that.

**`chart_mini`** - `components/panel/cards/ChartMiniCard.tsx`:
A 120px-tall sparkline-only chart inside a card, with a title and one stat ("last 24h · 12.4 MWh"). Click expands to full ChartView in CenterStage.

**`fact`** - `components/panel/cards/FactCard.tsx`:
Single-value prominent display, used for things like "Opened from inbox: Lazenby Hall" or the DR econ summary ("Annualized capacity revenue est. · $348,426").

**`action`** - `components/panel/cards/ActionCard.tsx`:
A single button-style card. Used for "Draft work order for Lazenby Hall" or "Retry scan." Click triggers the named action.

**`source`** - `components/panel/cards/SourceCard.tsx`:
Citation / reference card. Title, URL or data source, one-line excerpt. Used when Claude cites something (PJM capacity auction result, EIA data, etc.). Click opens the source in a new tab.

### 8d. Empty state

First load, no turns yet: ResponsePanel shows a centered column with the CampusSense wordmark (24px weight 300) and a one-line tagline: "Claude-powered energy analyst for Ohio State." Below that, a small `text-fg-subtle text-xs` note: "Start typing below to begin."

After the first message, empty state is replaced permanently for that session.

### 8e. Streaming and card arrival

During a chat turn:
1. User message lands in the turn header immediately on submit (optimistic).
2. Skeleton card placeholders (3 of them, randomly sized 60-100px) appear in the turn group to indicate work is happening.
3. When Sonnet emits tool_use + tool_result, the skeletons get replaced one-by-one with real cards as they stream in. Each card transitions opacity 0→1, y 6→0, 180ms, 60ms stagger.
4. Assistant text (after all tool_use resolved) streams in above the card stack. If text arrives before all cards, cards still stream in below.
5. When the turn is done, the skeleton "ghost" vanishes and the turn group settles.

### 8f. Auto-scroll rules

When a new turn starts, auto-scroll the latest turn group into view, bottom-aligned with 16px padding from the BottomComposer. If the user has manually scrolled up more than 200px from the bottom, do NOT auto-scroll; instead show a small "↓ new response" floating button at the bottom-right of the panel, click to scroll down.

### 8g. Turn group actions

On hover over a turn group, show a tiny toolbar in the top-right of the group:
- "Copy turn" (copies user message + assistant text + card titles as markdown).
- "Re-run" (re-sends the user message as a new turn).
- "Delete turn" (hides from view; does not delete from DB, but marks as hidden in session state).

These are dev/power-user affordances, low-contrast so they do not steal focus.

### 8h. Card caps

To prevent runaway panels:
- Max 10 cards per turn group. If a tool returns 50 buildings, render the first 10 as cards + one collapsible "show 40 more" card that expands inline.
- Max 50 total turn groups in session; older groups fade to 40% opacity and eventually get a "collapse" button. Not strictly enforced for demo (5-10 turns max).

---

## 9. StatusBar

File: `components/shell/StatusBar.tsx`. Fixed bottom, h-7, `bg-bg-elev-1 border-t border-border`, `text-xs text-fg-muted`, flex row.

Left: `<Dot />` in green if realtime connected, amber if polling fallback, red if both down. Label: "Live" / "Polling" / "Offline."

Center: frozen clock mirror (same content as TopBar but smaller, acts as second source of truth).

Right: three tiny pills:
1. Scrape: `data/raw/summary.json` status. Green "Data ready" when summary shows no `FALLBACK_REQUIRED`, amber "Spec mode" otherwise.
2. Claude: last API call status from `/api/health`. Green "OK" / amber "Cached" / red "Down."
3. Latency: last realtime round-trip in ms, e.g. "840ms." Updates every realtime event.

Hover any pill → tooltip with details.

---

## 10. Cmd-K palette

File: `components/shell/CommandPalette.tsx`. Uses shadcn `<CommandDialog>`.

Trigger: `⌘K` / `Ctrl+K` global. Also by clicking the TopBar faux-search.

Groups:
1. **Buildings** (fuzzy search on `buildingname`, `list_buildings` call). Icon: `Building2`. Selection: close palette, dispatch a synthetic `render_map` CenterDirective with that building highlighted and zoomed.
2. **Anomalies** (search over open anomalies by building name or utility). Icon: `AlertTriangle`. Selection: dispatch `anomaly_detail` CenterDirective.
3. **Views** (static): "Go to map", "Show last 24h anomalies", "DR simulator scratchpad."
4. **Actions** (dev-only, hidden unless `?dev=1` query param): "Reset demo," "Inject hero anomaly," "Toggle cached Claude."

Keyboard: arrow keys navigate, Enter selects. Esc closes.

---

## 11. Status and failure visuals

These are the non-happy paths. They must not look broken, just informative.

### 11a. SPEC MODE banner

Full-width banner at top of CenterStage (below TopBar), `bg-warn/10 text-warn border-b border-warn/20`, `h-7`, text: "SPEC MODE · Showing fictional data. Live scrape not available." Does not dismiss. Triggered by `data/raw/summary.json.FALLBACK_REQUIRED === true` or `NEXT_PUBLIC_SPEC_MODE=true` env.

### 11b. Claude unavailable

If `/api/health` reports Claude `fail`, the BottomComposer gets disabled and shows a small banner above it: "Claude is unavailable. Showing cached demo responses." Cmd+Shift+Option+D still works per Section 13e of build contract.

### 11c. Realtime lag

If no realtime event for >5s and polling kicks in, the StatusBar left dot goes amber. No user-visible banner; this is an operator signal.

### 11d. Scrape running in background

If `summary.json` shows partial completion (scrape still in progress), show a thin progress bar at the bottom of the StatusBar: "Scrape: 842 of 1411 buildings · 59%." Auto-hides at 100%.

### 11e. Map 401

If Mapbox returns 401, MapView falls back to a static SVG of the OSU campus (shipped in `public/fallback/campus.svg`, pre-drawn). Buildings render as dots on the SVG, severity colored. Not interactive, but presentable. Section 19 fallback ladder covers this.

---

## 12. Files to create

Canonical file list. Path + one-line purpose.

```
app/
  layout.tsx                              root, loads fonts, theme provider
  page.tsx                                the shell (TopBar + LeftRail + MainArea + StatusBar)
  globals.css                             @theme tokens from Section 3a

components/
  shell/
    TopBar.tsx                            Section 4
    StatusBar.tsx                         Section 9
    CommandPalette.tsx                    Section 10
    MainArea.tsx                          flex wrapper: CenterStage + ResponsePanel + BottomComposer
  rail/
    LeftRail.tsx                          Section 5
    AnomalyCard.tsx                       Section 5b
  composer/
    BottomComposer.tsx                    Section 7
    SuggestionChips.tsx                   Section 7d
  panel/
    ResponsePanel.tsx                     Section 8
    TurnHeader.tsx                        Section 8b
    cards/
      AnomalyRefCard.tsx                  Section 8c
      BuildingRefCard.tsx                 Section 8c
      EntityCard.tsx                      Section 8c
      ChartMiniCard.tsx                   Section 8c
      FactCard.tsx                        Section 8c
      ActionCard.tsx                      Section 8c
      SourceCard.tsx                      Section 8c
      CardSkeleton.tsx                    loading state
  stage/
    Stage.tsx                             Section 1c (the router)
    MapView.tsx                           Section 6a
    ChartView.tsx                         Section 6b
    AnomalyListView.tsx                   Section 6c
    AnomalyDetailView.tsx                 Section 6d
    WorkOrderView.tsx                     Section 6e
    DRSimulatorView.tsx                   Section 6f
    TextView.tsx                          Section 6g
  ui/
    Num.tsx                               tabular-num enforcer
    SeverityBadge.tsx                     severity chip
    Dot.tsx                               status dot
    SpecModeBanner.tsx                    Section 11a
    StreamedMarkdown.tsx                  markdown renderer that re-parses on stream
    CountUp.tsx                           animated number rising from 0

lib/
  directive-bus.ts                        pub/sub for CenterDirective + PanelCard stream
  directive-router.ts                     inspects tool_name, decides center vs panel
  realtime.ts                             Section 14 wrapper (already in build contract)
  clock.ts                                frozen clock reader (already in build contract)
  session.ts                              cookie-based session ID for chat
  text.ts                                 stripEmDashes, humanizeDuration, formatCurrency
  map-tokens.ts                           OKLCH → hex map for Mapbox expressions
  fixtures/hero_anomalies.ts              re-export of the JSON for SPEC mode fallback

hooks/
  useDirectiveStream.ts                   subscribes to directive-bus
  useAnomalies.ts                         Supabase query + realtime
  useFrozenClock.ts                       reads DEMO_FROZEN_NOW, ticks every sec
  useStreamingText.ts                     token-by-token stream with 40ms/token cached fallback
  useTurnHistory.ts                       ResponsePanel turn group state

public/
  fallback/campus.svg                     Section 11e
```

---

## 13. Wiring summary

This is the integration checklist per Section 16 of the build contract, made concrete.

1. **Directive stream** (Section 9c of build contract, Sections 1c and 1d here):
   - `lib/directive-bus.ts` exports `publishDirective(d)`, `useCenterDirective()`, `usePanelCards(turn_id)`.
   - `lib/directive-router.ts` inspects each tool result: if tool_name is `render_*` / `draft_work_order` / `simulate_dr_event`, publish a CenterDirective; otherwise map to one or more PanelCards.
   - `/api/chat` streaming response pipes tool_use/tool_result blocks through the client, which calls the router.
   - `Stage.tsx` consumes the latest CenterDirective. `ResponsePanel.tsx` consumes the full turn history.

2. **Realtime channel** (Section 14 of build contract, Section 5c here):
   - `lib/realtime.ts` already defined; import into `hooks/useAnomalies.ts`.
   - On INSERT → prepend card in LeftRail + MapView `setFeatureState`.
   - On UPDATE → patch card + MapView `setFeatureState`.

3. **Mapbox** (Section 6a here): single source + single layer, feature state hot path, flyTo for hero beat.

4. **Recharts** (Section 6b here): `ChartContainer` wrapper, `var(--chart-N)` tokens, ReferenceLine / ReferenceArea for overlays.

5. **Anomaly card fields** (Section 5b here): bound directly to Supabase row.

6. **Two-column + bottom composer** (Section 1a): LeftRail + MainArea, MainArea has CenterStage + ResponsePanel stacked over BottomComposer.

7. **Cmd-K** (Section 10): global shortcut, shadcn command.

8. **Font** (Section 3b): Inter via `next/font/google`, JetBrains Mono via `next/font/google`, applied through `className` on `<body>` + the `<Num>` component.

9. **Dark mode** (Section 3a): `next-themes` default dark, system disabled.

10. **No em dashes** (hard rule): `stripEmDashes()` in `lib/text.ts` applied to every Claude-generated string before render.

---

## 14. Acceptance checklist for the frontend

Before the demo runs, each of these must pass.

**Shell:**
- [ ] Two-column layout + bottom composer renders at 1280×800 without horizontal scroll.
- [ ] TopBar frozen clock shows `REPLAY · Jan 27, 2026 · 08:00 EST` in `DEMO_FROZEN_MODE=true`.
- [ ] StatusBar shows green dot when realtime connected.
- [ ] Cmd+K opens palette from anywhere; Esc closes.

**LeftRail:**
- [ ] On first load with DEMO_SEED_FIXTURES=true, 3 hero anomaly cards are visible within 500ms.
- [ ] Clicking a card opens AnomalyDetailView in CenterStage and logs a fact card in the current turn.
- [ ] Supabase INSERT on anomalies table causes a new card to appear within 2s with a glow pulse.
- [ ] Every `$` number has "est." appended.
- [ ] No em dashes anywhere in rail copy.

**BottomComposer:**
- [ ] Sticky to bottom, centered, max-w-3xl.
- [ ] Enter sends, Shift+Enter newlines.
- [ ] Suggestion chips fire the full message on click.
- [ ] Composer shows progress bar + stop button while Claude streams.
- [ ] Session survives a page refresh.
- [ ] Cmd+K works from composer focus.

**ResponsePanel:**
- [ ] Empty state renders CampusSense wordmark + tagline on first load.
- [ ] User message appears optimistically on submit.
- [ ] Skeleton cards render while waiting for tool results.
- [ ] Entity cards stream in with 60ms stagger, opacity + y transform.
- [ ] Turn groups separate visually with dividers.
- [ ] Auto-scroll latest turn into view UNLESS user has scrolled up >200px.
- [ ] "↓ new response" floater appears when user is scrolled up.
- [ ] Max 10 cards per turn group; "show N more" collapsible works.
- [ ] Clicking an `anomaly_ref` card opens AnomalyDetailView in CenterStage.
- [ ] Clicking a `building_ref` card fires a `render_map` zoom-in.
- [ ] No em dashes in any card or turn header.

**MapView:**
- [ ] Map boots in <1s (Mapbox tile load does not count).
- [ ] 1,411 building features render at zoom 14.5 without jank.
- [ ] `setFeatureState` does not cause full-layer repaints.
- [ ] flyTo animation runs in 2000ms when directive targets a subset.
- [ ] Fallback SVG renders if Mapbox 401.

**ChartView:**
- [ ] Line chart renders with baseline overlay.
- [ ] Anomaly window ReferenceArea is visible.
- [ ] Tokens resolve to the correct OKLCH colors.
- [ ] Empty state renders when data is empty.

**AnomalyDetailView:**
- [ ] Chart renders before explanation starts streaming.
- [ ] Explanation fake-streams at 40ms/token for cached heroes.
- [ ] "Draft work order" button opens WorkOrderView.
- [ ] "Mark reviewed" PATCHes the anomaly and updates the card in LeftRail.

**WorkOrderView:**
- [ ] Copy to clipboard works and shows a Sonner toast.
- [ ] Edit mode swaps prose for a Textarea.
- [ ] No em dashes in the draft text (post-stripEmDashes).

**DRSimulatorView:**
- [ ] Plan rows stagger in at 80ms per row.
- [ ] Excluded rows render in gray with "Safety excluded" chip.
- [ ] Econ card count-up animates over 600ms.
- [ ] Safety footer is present.

**Global:**
- [ ] Dark mode only; `next-themes` defaultTheme="dark" enableSystem={false}.
- [ ] All numbers in `font-mono tabular-nums`.
- [ ] No em dashes anywhere.
- [ ] SPEC MODE banner renders if `NEXT_PUBLIC_SPEC_MODE=true`.
- [ ] No synthetic data labeled as real.

**Performance:**
- [ ] First paint <1.5s on Vercel prod.
- [ ] Interaction to Next Paint <200ms on all card clicks.
- [ ] No layout shift on directive transitions.
- [ ] ResponsePanel scroll stays 60fps with 50 turn groups, 500 total cards.

---

## 15. Sequencing for the frontend 24 hours

Per Section 26 of the build contract, hours 16 to 24 of the 44-hour window are the frontend. Recommended order.

**Hour 16 to 18:** shell scaffolding. `app/page.tsx`, two-column grid + MainArea flex + BottomComposer sticky, tokens, TopBar, StatusBar, LeftRail skeleton. No real data yet. Hard-code 3 fake anomaly cards for visual baseline. Ship the design system.

**Hour 18 to 19:** directive bus + directive router + Stage router + MapView. Bind to the feature state hot path. Verify the flyTo hero beat works with a fake directive. No chat integration yet.

**Hour 19 to 20:** ResponsePanel structure + turn groups + 3 most-used card types (anomaly_ref, building_ref, fact). Skeleton loading. Auto-scroll logic.

**Hour 20 to 21:** ChartView + AnomalyDetailView. Wire to API. Confirm the chart-first-then-explanation sequencing feels right.

**Hour 21 to 22:** AnomalyListView + WorkOrderView + DRSimulatorView. These are smaller; knock them out.

**Hour 22 to 23:** BottomComposer full wiring. Streaming. Stop button. Suggestion chips. Cmd+K. Remaining card types (entity, chart_mini, action, source).

**Hour 23 to 24:** Realtime subscription end-to-end. LeftRail + MapView both update on INSERT. Polish the hero beat sequencing. Test the three demo questions end-to-end.

Then the regular Section 26 schedule resumes (hours 24 to 32 for hero polish, rehearsal, etc.).

---

## 16. Rules of thumb while building

Things to keep on a sticky note.

- Every number gets `<Num>` or `font-mono tabular-nums`.
- Every dollar gets " est." appended.
- No em dashes. Run `stripEmDashes` on every Claude string.
- Map gets `setFeatureState`, never `setData` per anomaly.
- Directive transitions in CenterStage cross-fade in 220ms, no spring, no bounce.
- ResponsePanel cards stream in at 60ms stagger, opacity + y.
- Dark mode only.
- Keep one view in CenterStage at a time. Map is the default.
- ResponsePanel accumulates, it does not replace. Turn history is sacred.
- LeftRail stays persistent. BottomComposer stays persistent. Only CenterStage swaps.
- Frozen clock visible at all times. Judge should never wonder if this is live.
- Hero beats are the priority. Everything else can be half-polished and still ship.

---

**End of frontend design meta-prompt.** This replaces Section 16 of the build meta-prompt. The backend contracts in Sections 9, 13, 14, and 15 are unchanged.
