"use client";
import { useEffect, useState } from "react";
import { useBus } from "@/lib/directive-bus";
import { MapView } from "./MapView";
import { stripEmDashes } from "@/lib/text";
import type { Anomaly } from "@/lib/types";
import type { ExternalAnomaly } from "@/lib/ingest";
import { SeverityBadge } from "@/components/ui/severity-badge";
import { Num } from "@/components/ui/num";
import {
  formatCurrency,
  formatPercentile,
  humanizeDuration,
  humanizeRange,
} from "@/lib/text";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Legend,
} from "recharts";

export function Stage() {
  const latest = useBus((s) => s.latestCenter);

  if (!latest) return <MapView />;

  switch (latest.view_type) {
    case "map":
      return <MapView data={latest.data} config={latest.config} />;
    case "anomaly_detail":
      return <AnomalyDetailPlaceholder data={latest.data} />;
    case "anomaly_list":
      return <AnomalyListView data={latest.data} config={latest.config} />;
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
  const anomalies = useBus((s) => s.anomalies) as Anomaly[];
  const externalAnomalies = useBus((s) => s.externalAnomalies);
  const a = anomalies.find((x) => x.id === id);
  if (!a) {
    const ext = externalAnomalies.find((x) => x.id === id);
    if (ext) return <ExternalAnomalyDetail anomaly={ext} />;
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
          <AnomalyChart anomaly={a} />
        </div>
      </div>
    </div>
  );
}

function AnomalyListView({
  data,
  config,
}: {
  data: Record<string, unknown>;
  config?: Record<string, unknown>;
}) {
  const anomalies = useBus((s) => s.anomalies) as Anomaly[];
  const dispatch = useBus((s) => s.dispatch);
  const title = (config?.title as string) ?? "Anomalies";
  const filterIds = Array.isArray(data.anomaly_ids)
    ? (data.anomaly_ids as string[])
    : null;

  const rows = (filterIds
    ? filterIds
        .map((id) => anomalies.find((a) => a.id === id))
        .filter((a): a is Anomaly => Boolean(a))
    : anomalies
  ).sort((a, b) => b.cost_impact_usd - a.cost_impact_usd);

  function openDetail(a: Anomaly) {
    dispatch({
      target: "center",
      view_type: "anomaly_detail",
      data: { anomaly_id: a.id },
      config: { title: a.building_name ?? `Anomaly ${a.id}` },
    });
  }

  return (
    <div className="h-full w-full flex flex-col bg-bg">
      <div className="h-10 px-4 flex items-center border-b border-border text-sm text-fg-muted shrink-0 gap-2">
        <span className="font-medium text-fg">{title}</span>
        <span className="text-fg-subtle text-xs">·</span>
        <span className="text-xs tabular-nums">{rows.length}</span>
      </div>
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-fg-subtle">
            No anomalies match.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-bg-elev-1 text-[10px] uppercase tracking-wider text-fg-subtle border-b border-border sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Building</th>
                <th className="text-left px-3 py-2 font-medium">Utility</th>
                <th className="text-left px-3 py-2 font-medium">Severity</th>
                <th className="text-right px-3 py-2 font-medium">Cost impact</th>
                <th className="text-right px-3 py-2 font-medium">Duration</th>
                <th className="text-right px-4 py-2 font-medium">Peak pct</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => openDetail(a)}
                  className="border-b border-border hover:bg-bg-elev-1 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-2 truncate max-w-[240px]">
                    {a.building_name ?? `Building ${a.building_id}`}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {a.utility.replaceAll("_", " ")}
                  </td>
                  <td className="px-3 py-2">
                    <SeverityBadge severity={a.severity} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(a.cost_impact_usd)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-muted">
                    {humanizeDuration(a.duration_minutes)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-fg-muted">
                    {formatPercentile(a.peak_percentile)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ExternalAnomalyDetail({ anomaly }: { anomaly: ExternalAnomaly }) {
  return (
    <div className="h-full w-full flex flex-col bg-bg">
      <div className="h-10 px-4 flex items-center border-b border-border justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">{anomaly.building_name}</span>
          <span className="text-fg-subtle">·</span>
          <span className="text-fg-muted">{anomaly.utility.replaceAll("_", " ")}</span>
          <span className="text-fg-subtle">·</span>
          <span className="text-[10px] uppercase tracking-wider text-accent border border-accent/30 rounded px-1.5 py-0.5">
            external
          </span>
        </div>
        <SeverityBadge severity={anomaly.severity} />
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Cost impact" value={formatCurrency(anomaly.cost_usd)} />
            <Stat label="Z-score" value={anomaly.z_score.toFixed(2)} unit="σ" />
            <Stat label="Severity" value={anomaly.severity.toUpperCase()} />
          </div>
          <div className="rounded-md bg-bg-elev-1 border border-border p-4">
            <div className="text-[10px] uppercase tracking-wider text-fg-subtle mb-2">
              Window
            </div>
            <div className="text-sm text-fg-muted">
              {humanizeRange(anomaly.first_time, anomaly.last_time)}
            </div>
          </div>
          <div className="rounded-md bg-bg-elev-1 border border-border p-4 text-xs text-fg-subtle">
            Time-series chart is only available for OSU buildings. External anomalies
            are computed client-side from the uploaded CSV via z-score detection.
          </div>
        </div>
      </div>
    </div>
  );
}

type TsRow = { t: string; actual: number; predicted: number; percentile: number };

const SEV_COLOR = { high: "#e05a2b", medium: "#d97706", low: "#ca8a04" };

function AnomalyChart({ anomaly }: { anomaly: Anomaly }) {
  const [rows, setRows] = useState<TsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/timeseries?building_id=${anomaly.building_id}&utility=${encodeURIComponent(anomaly.utility)}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data: TsRow[]) => { setRows(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [anomaly.building_id, anomaly.utility]);

  if (loading) {
    return (
      <div className="rounded-md bg-bg-elev-1 border border-border h-48 flex items-center justify-center text-xs text-fg-subtle">
        Loading chart…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="rounded-md bg-bg-elev-1 border border-border h-48 flex items-center justify-center text-xs text-fg-subtle">
        No time-series data available
      </div>
    );
  }

  const anomalyStart = anomaly.first_reading_time;
  const anomalyEnd = anomaly.last_reading_time;
  const sevColor = SEV_COLOR[anomaly.severity] ?? SEV_COLOR.low;

  // Focus window: ±5 days around the anomaly
  const focusCenter = new Date(anomalyStart).getTime();
  const windowMs = 5 * 24 * 60 * 60 * 1000;
  const windowStart = new Date(focusCenter - windowMs).toISOString();
  const windowEnd = new Date(focusCenter + windowMs).toISOString();
  const windowed = rows.filter((r) => r.t >= windowStart && r.t <= windowEnd);
  const source = windowed.length >= 4 ? windowed : rows;

  // Downsample to ≤200 pts
  const step = Math.max(1, Math.floor(source.length / 200));
  const pts = source.filter((_, i) => i % step === 0).map((r) => ({
    ...r,
    label: new Date(r.t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
  }));

  const xIdxStart = pts.findIndex((p) => p.t >= anomalyStart);
  const xIdxEnd = pts.findLastIndex((p) => p.t <= anomalyEnd);
  const x1 = xIdxStart >= 0 ? pts[xIdxStart].label : undefined;
  const x2 = xIdxEnd >= 0 ? pts[Math.max(xIdxStart, xIdxEnd)].label : x1;

  return (
    <div className="rounded-md bg-bg-elev-1 border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
          Expected vs Actual · {anomaly.utility.replace(/_/g, " ")}
        </span>
        <span className="text-[10px] text-fg-subtle">
          {new Date(windowStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {" – "}
          {new Date(windowEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          {" · "}{pts.length} pts
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={pts} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={sevColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={sevColor} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradPredicted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6b7280" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#6b7280" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "var(--color-fg-subtle)" }}
            tickLine={false}
            axisLine={false}
            interval={Math.floor(pts.length / 6)}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-fg-subtle)" }}
            tickLine={false}
            axisLine={false}
            width={48}
            tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-bg-elev-2)",
              border: "1px solid var(--color-border)",
              borderRadius: 6,
              fontSize: 11,
              color: "var(--color-fg)",
            }}
            formatter={(value, name) => [
              `${Number(value).toFixed(1)} kWh`,
              name === "actual" ? "Actual" : "Expected",
            ]}
            labelStyle={{ color: "var(--color-fg-muted)", marginBottom: 4 }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            formatter={(value) => value === "actual" ? "Actual" : "Expected"}
          />
          {x1 && x2 && (
            <ReferenceArea
              x1={x1}
              x2={x2}
              fill={sevColor}
              fillOpacity={0.15}
              stroke={sevColor}
              strokeOpacity={0.4}
              strokeDasharray="4 2"
              label={{ value: anomaly.severity.toUpperCase(), position: "insideTop", fontSize: 10, fill: sevColor }}
            />
          )}
          <Area
            type="monotone"
            dataKey="predicted"
            stroke="#6b7280"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            fill="url(#gradPredicted)"
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Area
            type="monotone"
            dataKey="actual"
            stroke={sevColor}
            strokeWidth={2}
            fill="url(#gradActual)"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </AreaChart>
      </ResponsiveContainer>
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
