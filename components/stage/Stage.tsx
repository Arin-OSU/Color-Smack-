"use client";
import { useBus } from "@/lib/directive-bus";
import { MapView } from "./MapView";
import { stripEmDashes } from "@/lib/text";
import { findHeroAnomaly } from "@/lib/fixtures/hero-anomalies";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { Num } from "@/components/ui/num";
import {
  formatCurrency,
  formatPercentile,
  humanizeDuration,
  humanizeRange,
} from "@/lib/text";

export function Stage() {
  const latest = useBus((s) => s.latestCenter);

  if (!latest) return <MapView />;

  switch (latest.view_type) {
    case "map":
      return <MapView data={latest.data} config={latest.config} />;
    case "anomaly_detail":
      return <AnomalyDetailPlaceholder data={latest.data} />;
    case "anomaly_list":
    case "chart":
    case "work_order":
    case "dr_simulator":
    case "text":
    default:
      return <GenericStagePlaceholder label={latest.view_type} config={latest.config} />;
  }
}

function AnomalyDetailPlaceholder({ data }: { data: Record<string, unknown> }) {
  const id = data.anomaly_id as string;
  const a = findHeroAnomaly(id);
  if (!a) {
    return <GenericStagePlaceholder label="anomaly_detail" config={{ title: id }} />;
  }
  return (
    <div className="h-full w-full flex flex-col bg-bg">
      <div className="h-10 px-4 flex items-center border-b border-border justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{a.building_name}</span>
          <span className="text-fg-subtle">·</span>
          <span className="text-fg-muted">{a.utility.replaceAll("_", " ")}</span>
        </div>
        <SeverityBadge severity={a.severity} />
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          <div className="grid grid-cols-4 gap-3">
            <Stat label="Cost impact" value={formatCurrency(a.cost_impact_usd)} />
            <Stat label="Peak" value={formatPercentile(a.peak_percentile)} />
            <Stat label="Duration" value={humanizeDuration(a.duration_minutes)} />
            <Stat
              label="Residual"
              value={a.residual_kwh.toLocaleString()}
              unit="kWh"
            />
          </div>
          <div className="rounded-md bg-bg-elev-1 border border-border p-4">
            <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
              Window
            </div>
            <div className="text-sm text-fg-muted">
              {humanizeRange(a.first_reading_time, a.last_reading_time)}
            </div>
          </div>
          {a.claude_explanation && (
            <div className="rounded-md bg-bg-elev-1 border border-border p-4">
              <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
                Claude explanation
              </div>
              <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap">
                {stripEmDashes(a.claude_explanation)}
              </p>
            </div>
          )}
          <div className="rounded-md bg-bg-elev-1 border border-dashed border-border p-8 text-center text-xs text-fg-subtle">
            Chart view lands with Recharts wiring. Expected vs actual overlay +
            severity ReferenceArea.
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string | number;
  unit?: string;
}) {
  return (
    <div className="rounded-md bg-bg-elev-1 border border-border p-3 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {label}
      </span>
      <div className="flex items-baseline gap-1">
        <Num value={value} className="text-base text-fg" />
        {unit && <span className="text-xs text-fg-muted">{unit}</span>}
      </div>
    </div>
  );
}

function GenericStagePlaceholder({
  label,
  config,
}: {
  label: string;
  config?: Record<string, unknown>;
}) {
  const title = (config?.title as string) ?? label;
  return (
    <div className="h-full w-full flex flex-col bg-bg">
      <div className="h-10 px-4 flex items-center border-b border-border text-sm text-fg-muted shrink-0">
        <span>{title}</span>
      </div>
      <div className="flex-1 flex items-center justify-center text-xs text-fg-subtle">
        {label} view wired in next pass.
      </div>
    </div>
  );
}
