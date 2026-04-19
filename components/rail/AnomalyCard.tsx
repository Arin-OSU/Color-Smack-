"use client";
import type { Anomaly, Utility } from "@/lib/types";
import { severityBarClass } from "@/components/ui/severity-badge";
import { Num } from "@/components/ui/num";
import {
  formatCurrency,
  formatPercentile,
  humanizeDuration,
  humanizeRange,
  stripEmDashes,
} from "@/lib/text";
import { cn } from "@/lib/utils";
import { Zap, Flame, Droplets, Wind } from "lucide-react";

const UTILITY_ICON: Record<Utility, React.ComponentType<{ size?: number }>> = {
  electricity: Zap,
  natural_gas: Flame,
  steam: Flame,
  steam_rate: Flame,
  heating_hot_water: Flame,
  chilled_water: Droplets,
  domestic_water: Droplets,
  cooling_power: Wind,
  oil28sec: Flame,
};

function utilityLabel(u: Utility): string {
  return (
    ({
      electricity: "electricity",
      natural_gas: "natural gas",
      steam: "steam",
      steam_rate: "steam rate",
      heating_hot_water: "hot water",
      chilled_water: "chilled water",
      domestic_water: "water",
      cooling_power: "cooling",
      oil28sec: "oil",
    } as Record<Utility, string>)[u] ?? u
  );
}

export function AnomalyCard({
  anomaly,
  isActive,
  onClick,
}: {
  anomaly: Anomaly;
  isActive?: boolean;
  onClick?: (a: Anomaly) => void;
}) {
  const resolved = ["resolved", "reviewed", "dismissed"].includes(
    anomaly.status,
  );
  const Icon = UTILITY_ICON[anomaly.utility];
  const firstSentence =
    stripEmDashes(anomaly.claude_explanation ?? "")
      .split(/(?<=\.)\s/)[0]
      ?.slice(0, 90) ?? "Anomaly detected.";

  return (
    <button
      onClick={() => onClick?.(anomaly)}
      className={cn(
        "w-full text-left flex gap-0 rounded-md border border-transparent hover:bg-bg-elev-1 transition-colors",
        isActive && "bg-bg-elev-2 border-border-strong",
        resolved && "opacity-50",
      )}
    >
      <span
        className={cn(
          "w-1 self-stretch rounded-l",
          resolved ? "bg-sev-none" : severityBarClass(anomaly.severity),
        )}
      />
      <div className="flex-1 p-3 flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium truncate flex-1">
            {anomaly.building_name ?? `Building ${anomaly.building_id}`}
          </span>
          <Icon size={12} />
          <span className="text-[11px] text-fg-muted">
            {utilityLabel(anomaly.utility)}
          </span>
        </div>
        <div className="text-[11px] text-fg-muted line-clamp-1 leading-snug">
          {firstSentence}
        </div>
        <div className="flex items-center gap-2 text-[11px] text-fg-muted">
          <Num value={formatCurrency(anomaly.cost_impact_usd)} />
          <span>·</span>
          <Num value={formatPercentile(anomaly.peak_percentile)} />
          <span>·</span>
          <Num value={humanizeDuration(anomaly.duration_minutes)} />
        </div>
        <div className="text-[10px] text-fg-subtle">
          {humanizeRange(anomaly.first_reading_time, anomaly.last_reading_time)}
        </div>
      </div>
    </button>
  );
}
