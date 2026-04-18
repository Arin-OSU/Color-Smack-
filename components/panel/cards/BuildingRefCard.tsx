"use client";
import type { PanelCard } from "@/lib/types";
import { Building2 } from "lucide-react";
import { useBus } from "@/lib/directive-bus";
import { Num } from "@/components/ui/num";

export function BuildingRefCard({ card }: { card: PanelCard }) {
  const data = card.data as {
    id: string | number;
    name: string;
    building_type?: string;
    gross_area?: number;
    current_kw?: number;
  };
  const dispatch = useBus((s) => s.dispatch);

  return (
    <button
      onClick={() =>
        dispatch({
          target: "center",
          view_type: "map",
          data: { building_ids: [String(data.id)] },
          config: { color_by: "severity", highlight: [String(data.id)], title: data.name },
        })
      }
      className="flex gap-3 rounded-md bg-bg-elev-1 border border-border hover:border-border-strong transition-colors text-left p-3"
    >
      <Building2 size={16} className="text-fg-muted mt-0.5" />
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-sm font-medium truncate">{data.name}</span>
        {(data.building_type || data.gross_area) && (
          <span className="text-[11px] text-fg-muted">
            {data.building_type}
            {data.building_type && data.gross_area ? " · " : ""}
            {data.gross_area && (
              <>
                <Num value={data.gross_area.toLocaleString()} /> sqft
              </>
            )}
          </span>
        )}
        {typeof data.current_kw === "number" && (
          <span className="text-[11px] text-fg-muted">
            current: <Num value={data.current_kw} suffix=" kW" />
          </span>
        )}
      </div>
    </button>
  );
}
