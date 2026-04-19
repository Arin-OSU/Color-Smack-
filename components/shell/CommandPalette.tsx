"use client";
import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { useBus } from "@/lib/directive-bus";
import { Building2, AlertTriangle, Map } from "lucide-react";

type Building = {
  buildingnumber: number;
  buildingname: string;
  latitude: number;
  longitude: number;
  campus?: string;
};

const SEV_COLOR: Record<string, string> = {
  high: "text-[#e05a2b]",
  medium: "text-[#d97706]",
  low: "text-[#ca8a04]",
};

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const dispatch = useBus((s) => s.dispatch);
  const anomalies = useBus((s) => s.anomalies);
  const externalAnomalies = useBus((s) => s.externalAnomalies);
  const [buildings, setBuildings] = useState<Building[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/buildings")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Building[]) => setBuildings(data.slice(0, 200)))
      .catch(() => {});
  }, [open]);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search buildings or anomalies…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {anomalies.length > 0 && (
          <CommandGroup heading="OSU Anomalies">
            {anomalies.map((a) => (
              <CommandItem
                key={a.id}
                value={`${a.building_name} ${a.utility} ${a.severity} anomaly`}
                onSelect={() => {
                  dispatch({
                    target: "center",
                    view_type: "anomaly_detail",
                    data: { anomaly_id: a.id },
                    config: { title: a.building_name ?? a.id },
                  });
                  onOpenChange(false);
                }}
              >
                <AlertTriangle size={14} className={SEV_COLOR[a.severity] ?? "text-fg-muted"} />
                <span className="flex-1 truncate">{a.building_name}</span>
                <span className="text-xs text-fg-subtle mr-2">{a.utility.replace(/_/g, " ")}</span>
                <span className={`text-xs font-medium ${SEV_COLOR[a.severity]}`}>{a.severity}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {externalAnomalies.length > 0 && (
          <CommandGroup heading="External Anomalies">
            {externalAnomalies.map((a) => (
              <CommandItem
                key={a.id}
                value={`${a.building_name} ${a.utility} ${a.severity} external anomaly`}
                onSelect={() => {
                  dispatch({
                    target: "center",
                    view_type: "anomaly_detail",
                    data: { anomaly_id: a.id, external: true },
                    config: { title: a.building_name },
                  });
                  onOpenChange(false);
                }}
              >
                <AlertTriangle size={14} className={SEV_COLOR[a.severity] ?? "text-fg-muted"} />
                <span className="flex-1 truncate">{a.building_name}</span>
                <span className="text-xs text-fg-subtle mr-2">{a.utility.replace(/_/g, " ")}</span>
                <span className={`text-xs font-medium ${SEV_COLOR[a.severity]}`}>{a.severity}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {buildings.length > 0 && (
          <CommandGroup heading="Buildings">
            {buildings.map((b) => (
              <CommandItem
                key={b.buildingnumber}
                value={`${b.buildingname} ${b.campus ?? ""} building`}
                onSelect={() => {
                  dispatch({
                    target: "center",
                    view_type: "map",
                    data: { focus_lat: b.latitude, focus_lon: b.longitude },
                    config: { title: b.buildingname },
                  });
                  onOpenChange(false);
                }}
              >
                <Building2 size={14} className="text-fg-muted shrink-0" />
                <span className="flex-1 truncate">{b.buildingname}</span>
                {b.campus && (
                  <span className="text-xs text-fg-subtle">{b.campus}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Views">
          <CommandItem
            value="campus map overview osu"
            onSelect={() => {
              dispatch({
                target: "center",
                view_type: "map",
                data: {},
                config: { title: "OSU Columbus · campus map" },
              });
              onOpenChange(false);
            }}
          >
            <Map size={14} className="text-fg-muted" />
            <span>Campus map</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
