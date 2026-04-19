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
  const errorTurn = useBus((s) => s.errorTurn);
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

      const anomalyContext = [...anomalies]
        .sort((a, b) => b.cost_impact_usd - a.cost_impact_usd)
        .slice(0, 20)
        .map((a) => ({
          id: a.id,
          building_id: a.building_id,
          building_name: a.building_name,
          utility: a.utility,
          severity: a.severity,
          cost_impact_usd: a.cost_impact_usd,
          duration_minutes: a.duration_minutes,
          first_reading_time: a.first_reading_time,
          last_reading_time: a.last_reading_time,
          peak_percentile: a.peak_percentile,
        }));

      const applyTool = (name: string, input: Record<string, unknown>) => {
        if (name === "show_anomaly_detail") {
          const id = input.anomaly_id as string | undefined;
          if (!id) return;
          const match = anomalies.find((a) => a.id === id);
          setCenter({
            target: "center",
            view_type: "anomaly_detail",
            data: { anomaly_id: id },
            config: { title: match?.building_name ?? id },
          });
        } else if (name === "show_anomaly_list") {
          const ids = Array.isArray(input.anomaly_ids) ? (input.anomaly_ids as string[]) : [];
          setCenter({
            target: "center",
            view_type: "anomaly_list",
            data: { anomaly_ids: ids },
            config: { title: (input.title as string) ?? "Anomalies" },
          });
        } else if (name === "show_map") {
          const data: Record<string, unknown> = {};
          if (typeof input.focus_lat === "number") data.focus_lat = input.focus_lat;
          if (typeof input.focus_lon === "number") data.focus_lon = input.focus_lon;
          setCenter({
            target: "center",
            view_type: "map",
            data,
            config: { title: (input.title as string) ?? "Campus map" },
          });
        } else if (name === "add_anomaly_card") {
          const id = input.anomaly_id as string | undefined;
          if (!id) return;
          const a = anomalies.find((x) => x.id === id);
          if (!a) return;
          addCard({
            target: "panel",
            turn_id,
            card_type: "anomaly_ref",
            data: a as unknown as Record<string, unknown>,
            config: {},
          });
        }
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, anomalies: anomalyContext }),
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          appendAssistantText(turn_id, `[chat error: ${res.status}${errText ? ` — ${errText}` : ""}]`);
          errorTurn(turn_id, `HTTP ${res.status}`);
          finishTurn(turn_id);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            let evt: { type: string; [k: string]: unknown };
            try {
              evt = JSON.parse(line) as { type: string; [k: string]: unknown };
            } catch {
              continue;
            }
            if (evt.type === "text") {
              appendAssistantText(turn_id, String(evt.text ?? ""));
            } else if (evt.type === "tool") {
              applyTool(String(evt.name), (evt.input as Record<string, unknown>) ?? {});
            } else if (evt.type === "error") {
              appendAssistantText(turn_id, `\n\n[error: ${String(evt.message ?? "")}]`);
              errorTurn(turn_id, String(evt.message ?? ""));
            }
          }
        }
        finishTurn(turn_id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "network error";
        appendAssistantText(turn_id, `[chat error: ${msg}]`);
        errorTurn(turn_id, msg);
        finishTurn(turn_id);
      }
    },
    [startTurn, appendAssistantText, addCard, setCenter, finishTurn, errorTurn, anomalies],
  );

  return (
    <div className="h-screen w-screen flex flex-col bg-bg text-fg overflow-hidden">
      <TopBar onOpenCommand={() => setCmdOpen(true)} />
      <div className="flex-1 flex min-h-0">
        <LeftRail />
        <MainArea onSubmit={handleSubmit} />
      </div>
      <StatusBar realtime="live" scrape="ready" claude="ok" latencyMs={412} />
      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </div>
  );
}
