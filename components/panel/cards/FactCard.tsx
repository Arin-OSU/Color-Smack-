"use client";
import type { PanelCard } from "@/lib/types";
import { Num } from "@/components/ui/num";

export function FactCard({ card }: { card: PanelCard }) {
  const data = card.data as {
    label: string;
    value: string | number;
    unit?: string;
    note?: string;
  };
  return (
    <div className="p-3 rounded-md bg-bg-elev-1 border border-border flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
        {data.label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <Num value={data.value} className="text-lg font-medium text-fg" />
        {data.unit && (
          <span className="text-xs text-fg-muted">{data.unit}</span>
        )}
      </div>
      {data.note && (
        <span className="text-[11px] text-fg-muted">{data.note}</span>
      )}
    </div>
  );
}
