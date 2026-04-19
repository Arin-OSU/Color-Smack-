"use client";
import { Activity, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AnomalyCard } from "./AnomalyCard";
import { useBus } from "@/lib/directive-bus";
import type { Anomaly } from "@/lib/types";
import { useMemo, useState } from "react";

export function LeftRail() {
  const latestCenter = useBus((s) => s.latestCenter);
  const dispatch = useBus((s) => s.dispatch);
  const anomalies = useBus((s) => s.anomalies) as Anomaly[];
  const [collapsed, setCollapsed] = useState(false);
  const activeId =
    (latestCenter?.view_type === "anomaly_detail" &&
      (latestCenter.data.anomaly_id as string)) ||
    null;

  const sorted = useMemo<Anomaly[]>(
    () => [...anomalies].sort((a, b) => b.cost_impact_usd - a.cost_impact_usd),
    [anomalies],
  );

  const open = sorted.filter((a) =>
    ["new", "open"].includes(a.status),
  ).length;

  function handleClick(a: Anomaly) {
    dispatch({
      target: "center",
      view_type: "anomaly_detail",
      data: { anomaly_id: a.id },
      config: { title: a.building_name ?? `Anomaly ${a.id}` },
    });
  }

  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 bg-bg border-r border-border flex flex-col items-center py-2 gap-2">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded hover:bg-bg-elev-2 text-fg-muted hover:text-fg transition-colors"
          title="Expand anomaly inbox"
        >
          <ChevronRight size={16} />
        </button>
        <div className="writing-mode-vertical text-[10px] text-fg-subtle tracking-wider uppercase mt-2 select-none" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          Inbox
        </div>
        {open > 0 && (
          <Badge variant="secondary" className="font-mono tabular-nums text-[10px] px-1">
            {open}
          </Badge>
        )}
      </aside>
    );
  }

  return (
    <aside className="w-72 shrink-0 bg-bg border-r border-border flex flex-col">
      <div className="h-10 flex items-center px-3 border-b border-border justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-fg-muted" />
          <h2 className="text-sm font-medium">Anomaly inbox</h2>
          <Badge variant="secondary" className="font-mono tabular-nums">
            {open}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-fg-subtle">by cost</span>
          <button
            onClick={() => setCollapsed(true)}
            title="Collapse inbox"
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent text-white text-xs font-medium hover:bg-accent/80 transition-colors"
          >
            <ChevronLeft size={12} /> Hide
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-1 p-2">
          {sorted.length === 0 ? (
            <div className="text-center py-12 text-fg-muted text-sm">
              <Activity size={20} className="mx-auto mb-2" />
              No anomalies in the last 24 hours. Quiet night.
            </div>
          ) : (
            sorted.map((a) => (
              <AnomalyCard
                key={a.id}
                anomaly={a}
                isActive={activeId === a.id}
                onClick={handleClick}
              />
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
