"use client";
import type { PanelCard } from "@/lib/types";
import { Num } from "@/components/ui/num";
import { stripEmDashes } from "@/lib/text";

export function EntityCard({ card }: { card: PanelCard }) {
  const data = card.data as {
    title: string;
    subtitle?: string;
    body?: string;
    stats?: { label: string; value: string | number }[];
  };
  return (
    <div className="p-3 rounded-md bg-bg-elev-1 border border-border flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{data.title}</span>
        {data.subtitle && (
          <span className="text-[11px] text-fg-muted">{data.subtitle}</span>
        )}
      </div>
      {data.body && (
        <p className="text-[12px] text-fg-muted leading-relaxed">
          {stripEmDashes(data.body)}
        </p>
      )}
      {data.stats && data.stats.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          {data.stats.map((s) => (
            <div key={s.label} className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-fg-subtle">
                {s.label}
              </span>
              <Num value={s.value} className="text-xs text-fg" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
