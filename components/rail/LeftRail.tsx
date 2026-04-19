"use client";
import { Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AnomalyCard } from "./AnomalyCard";
import { useBus } from "@/lib/directive-bus";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Anomaly } from "@/lib/types";
import { useMemo } from "react";

export function LeftRail() {
  const { latestCenter, dispatch } = useBus();
  const anomalies = useBus((s) => s.anomalies) as Anomaly[];
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
        <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
          by cost
        </span>
      </div>
      <ScrollArea className="flex-1">
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
      </ScrollArea>
    </aside>
  );
}
