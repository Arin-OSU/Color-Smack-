"use client";
import { useCallback, useEffect, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { StatusBar } from "@/components/shell/StatusBar";
import { LeftRail } from "@/components/rail/LeftRail";
import { MainArea } from "@/components/shell/MainArea";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { useBus } from "@/lib/directive-bus";
import type { Anomaly } from "@/lib/types";

export default function Home() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const startTurn = useBus((s) => s.startTurn);
  const appendAssistantText = useBus((s) => s.appendAssistantText);
  const addCard = useBus((s) => s.addCard);
  const finishTurn = useBus((s) => s.finishTurn);
  const setCenter = useBus((s) => s.setCenter);
  const anomalies = useBus((s) => s.anomalies) as Anomaly[];

  useEffect(() => {
    fetch("/api/anomalies")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data?.length) useBus.getState().setAnomalies(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSubmit = useCallback(
    async (text: string) => {
      const turn_id = `turn-${Date.now()}`;
      startTurn(turn_id, text);

      const top = anomalies[0];
      const reply = top
        ? `Found ${anomalies.length} anomal${anomalies.length === 1 ? "y" : "ies"} in the meter data. Top by cost: ${top.building_name ?? `Building ${top.building_id}`} — ${top.utility.replace(/_/g, " ")} — $${top.cost_impact_usd.toFixed(0)} impact. Tap any card to open the detail view.`
        : "Here is what stands out. Three buildings are flagged; the top driver by cost is Lazenby Hall running a winter-break ghost load. Tap any card to open the detail view.";

      for (let i = 0; i < reply.length; i += 6) {
        appendAssistantText(turn_id, reply.slice(i, i + 6));
        await new Promise((r) => setTimeout(r, 18));
      }

      for (const a of anomalies) {
        addCard({
          target: "panel",
          turn_id,
          card_type: "anomaly_ref",
          data: a as unknown as Record<string, unknown>,
          config: {},
        });
      }

      setCenter({
        target: "center",
        view_type: "anomaly_list",
        data: { anomaly_ids: anomalies.map((a) => a.id) },
        config: { title: `${anomalies.length} anomalies detected` },
      });

      finishTurn(turn_id);
    },
    [startTurn, appendAssistantText, addCard, setCenter, finishTurn, anomalies],
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-bg text-fg overflow-hidden">
      <TopBar onOpenCommand={() => setCmdOpen(true)} />
      <div className="flex-1 flex min-h-0">
        <LeftRail />
        <MainArea onSubmit={handleSubmit} />
      </div>
      <StatusBar realtime="live" scrape="spec" claude="ok" latencyMs={412} />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
