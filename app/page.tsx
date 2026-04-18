"use client";
import { useCallback, useEffect, useState } from "react";
import { TopBar } from "@/components/shell/TopBar";
import { StatusBar } from "@/components/shell/StatusBar";
import { LeftRail } from "@/components/rail/LeftRail";
import { MainArea } from "@/components/shell/MainArea";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { useBus } from "@/lib/directive-bus";
import { HERO_ANOMALIES } from "@/lib/fixtures/hero-anomalies";

export default function Home() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const startTurn = useBus((s) => s.startTurn);
  const appendAssistantText = useBus((s) => s.appendAssistantText);
  const addCard = useBus((s) => s.addCard);
  const finishTurn = useBus((s) => s.finishTurn);
  const setCenter = useBus((s) => s.setCenter);

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
      const turn_id = `mock-${Date.now()}`;
      startTurn(turn_id, text);

      // Mock a streaming reply so the shell feels alive before the real /api/chat lands.
      const reply =
        "Here is what stands out across the last 24 hours. Three buildings are flagged; the top driver by cost is Lazenby Hall running a winter-break ghost load. Tap any card to open the detail view.";
      for (let i = 0; i < reply.length; i += 6) {
        appendAssistantText(turn_id, reply.slice(i, i + 6));
        await new Promise((r) => setTimeout(r, 18));
      }

      for (const a of HERO_ANOMALIES) {
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
        data: { anomaly_ids: HERO_ANOMALIES.map((a) => a.id) },
        config: { title: "Overnight anomalies · Jan 27, 2026" },
      });

      finishTurn(turn_id);
    },
    [startTurn, appendAssistantText, addCard, setCenter, finishTurn],
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
