"use client";
import type { PanelCard, Anomaly } from "@/lib/types";
import { severityBarClass, SeverityBadge } from "@/components/ui/severity-badge";
import { Num } from "@/components/ui/num";
import {
  formatCurrency,
  formatPercentile,
  humanizeDuration,
} from "@/lib/text";
import { useBus } from "@/lib/directive-bus";

export function AnomalyRefCard({ card }: { card: PanelCard }) {
  const a = card.data as unknown as Anomaly;
  const dispatch = useBus((s) => s.dispatch);

  return (
    <button
      onClick={() =>
        dispatch({
          target: "center",
          view_type: "anomaly_detail",
          data: { anomaly_id: a.id },
          config: { title: a.building_name ?? `Anomaly ${a.id}` },
        })
      }
      className="flex gap-0 rounded-md bg-bg-elev-1 border border-border hover:border-border-strong transition-colors text-left"
    >
      <span className={`w-1 rounded-l ${severityBarClass(a.severity)}`} />
      <div className="flex-1 p-3 flex flex-col gap-1.5 min-w-0">
        <div className="flex items-center gap-2 justify-between">
          <span className="text-sm font-medium truncate">
            {a.building_name ?? `Building ${a.building_id}`}
          </span>
          <SeverityBadge severity={a.severity} />
        </div>
        <div className="text-[11px] text-fg-muted">
          {a.utility.replaceAll("_", " ")}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-fg-muted">
          <Num value={formatCurrency(a.cost_impact_usd)} />
          <span>·</span>
          <Num value={formatPercentile(a.peak_percentile)} />
          <span>·</span>
          <Num value={humanizeDuration(a.duration_minutes)} />
        </div>
      </div>
    </button>
  );
}
