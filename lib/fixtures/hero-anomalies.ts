import type { Anomaly } from "@/lib/types";

// SPEC MODE fixtures. Used when scrape has not landed yet.
// All labels say "est." and the UI shows a SPEC MODE banner so we stay honest.

export const HERO_ANOMALIES: Anomaly[] = [
  {
    id: "hero-1",
    building_id: 1001,
    building_name: "Lazenby Hall",
    utility: "electricity",
    first_reading_time: "2025-12-22T07:14:00Z",
    last_reading_time: "2026-01-05T18:00:00Z",
    peak_reading_time: "2025-12-27T19:00:00Z",
    peak_percentile: 0.997,
    expected_kwh: 8400,
    actual_kwh: 24100,
    residual_kwh: 15700,
    duration_minutes: 20220,
    cost_impact_usd: 1413,
    severity: "high",
    status: "open",
    parent_anomaly_id: null,
    claude_explanation:
      "Lazenby Hall is running a winter-break ghost load. Expected use during the break is about 8,400 kWh based on this building's own baseline from prior December-to-January breaks, weather-normalized. Actual use over this window is 24,100 kWh, a residual of 15,700 kWh. The shape is flat, not peaked, which points to HVAC fans and plug loads that did not enter setback. Check the BAS schedule for 2025-12-22 and confirm the academic-break override was applied.",
    work_order_draft: null,
    claude_explanation_state: "ready",
    created_at: "2026-01-26T22:00:00Z",
    updated_at: "2026-01-27T08:00:00Z",
  },
  {
    id: "hero-2",
    building_id: 1002,
    building_name: "Scott Laboratory",
    utility: "electricity",
    first_reading_time: "2026-01-26T22:00:00Z",
    last_reading_time: "2026-01-27T06:45:00Z",
    peak_reading_time: "2026-01-27T03:15:00Z",
    peak_percentile: 0.993,
    expected_kwh: 480,
    actual_kwh: 920,
    residual_kwh: 440,
    duration_minutes: 525,
    cost_impact_usd: 312,
    severity: "medium",
    status: "open",
    parent_anomaly_id: null,
    claude_explanation:
      "Scott Lab is drawing roughly double its expected overnight load for a Monday outside class hours. The pattern is consistent with a fume-hood sash left open on the 2nd floor research wing. Expected overnight load is about 480 kWh based on the last 30 days of same-weekday-same-hour samples; actual is 920 kWh. Morning start-up is normal, which rules out a chiller or AHU failure. Dispatch a walk-through on the 2nd floor first.",
    work_order_draft: null,
    claude_explanation_state: "ready",
    created_at: "2026-01-27T06:00:00Z",
    updated_at: "2026-01-27T07:00:00Z",
  },
  {
    id: "hero-3",
    building_id: 1003,
    building_name: "Wexner Medical Center - 4E wing",
    utility: "electricity",
    first_reading_time: "2026-01-26T18:00:00Z",
    last_reading_time: "2026-01-27T07:30:00Z",
    peak_reading_time: "2026-01-27T04:00:00Z",
    peak_percentile: 0.989,
    expected_kwh: 9600,
    actual_kwh: 11850,
    residual_kwh: 2250,
    duration_minutes: 810,
    cost_impact_usd: 275,
    severity: "medium",
    status: "new",
    parent_anomaly_id: null,
    claude_explanation:
      "The 4E wing at Wexner is 23 percent above its weather-normalized expected use for last night, immediately following the record 11.9 inch snowstorm. The signature is steady elevation across all night hours rather than a single spike, consistent with a reheat override after the cold-weather envelope stress. This is a wing-level pattern; patient operations are not implicated. Recommend FOD review the 4E AHU setpoints and reheat valves in the morning.",
    work_order_draft: null,
    claude_explanation_state: "ready",
    created_at: "2026-01-27T07:30:00Z",
    updated_at: "2026-01-27T07:45:00Z",
  },
];

export function findHeroAnomaly(id: string): Anomaly | undefined {
  return HERO_ANOMALIES.find((a) => a.id === id);
}
