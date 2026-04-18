"use client";
import type { PanelCard } from "@/lib/types";
import { AnomalyRefCard } from "./AnomalyRefCard";
import { BuildingRefCard } from "./BuildingRefCard";
import { FactCard } from "./FactCard";
import { EntityCard } from "./EntityCard";

export function PanelCardRouter({ card }: { card: PanelCard }) {
  switch (card.card_type) {
    case "anomaly_ref":  return <AnomalyRefCard card={card} />;
    case "building_ref": return <BuildingRefCard card={card} />;
    case "fact":         return <FactCard card={card} />;
    case "entity":       return <EntityCard card={card} />;
    default:
      return (
        <div className="p-3 bg-bg-elev-1 rounded-md text-xs text-fg-muted border border-border">
          {(card.data.title as string) ?? card.card_type}
        </div>
      );
  }
}
