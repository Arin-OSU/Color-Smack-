"use client";
import { useBus } from "@/lib/directive-bus";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { TurnHeader } from "./TurnHeader";
import { PanelCardRouter } from "./cards/PanelCardRouter";
import { CornerDownRight, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

export function ResponsePanel() {
  const turns = useBus((s) => s.turns);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, turns.at(-1)?.cards.length, turns.at(-1)?.assistant?.text]);

  if (turns.length === 0) {
    return (
      <aside className="w-[380px] shrink-0 bg-bg border-l border-border flex flex-col">
        <EmptyState />
      </aside>
    );
  }

  return (
    <aside className="w-[380px] shrink-0 bg-bg border-l border-border flex flex-col">
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-5 px-4 py-5">
          {turns.map((t, i) => (
            <div key={t.turn_id} className="flex flex-col gap-3">
              {i > 0 && <Separator className="mb-1" />}
              <TurnHeader user={t.user} assistant={t.assistant} />
              {t.status === "streaming" && t.cards.length === 0 && (
                <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                  <Sparkles size={12} className="animate-pulse text-accent" />
                  <span>Claude is scanning</span>
                </div>
              )}
              {t.cards.map((c, idx) => (
                <PanelCardRouter key={idx} card={c} />
              ))}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
    </aside>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
      <CornerDownRight size={20} className="text-fg-subtle mb-3" />
      <h1 className="text-2xl font-light tracking-tight">CampusSense</h1>
      <p className="text-sm text-fg-muted mt-2">
        Claude-powered energy analyst for Ohio State.
      </p>
      <p className="text-xs text-fg-subtle mt-6">Start typing below to begin.</p>
    </div>
  );
}
