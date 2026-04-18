"use client";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { HERO_ANOMALIES } from "@/lib/fixtures/hero-anomalies";
import { useBus } from "@/lib/directive-bus";
import { Building2, AlertTriangle } from "lucide-react";

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const dispatch = useBus((s) => s.dispatch);

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search buildings or anomalies" />
      <CommandList>
        <CommandEmpty>Nothing here yet. Scrape lands soon.</CommandEmpty>
        <CommandGroup heading="Anomalies">
          {HERO_ANOMALIES.map((a) => (
            <CommandItem
              key={a.id}
              value={`${a.building_name} ${a.id}`}
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
              <AlertTriangle size={14} className="text-fg-muted" />
              <span>{a.building_name}</span>
              <span className="ml-auto text-xs text-fg-subtle">
                {a.severity}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Views">
          <CommandItem
            value="campus map overview"
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
            <Building2 size={14} className="text-fg-muted" />
            <span>Campus map</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
