"use client";
import { useBus } from "@/lib/directive-bus";
import { Separator } from "@/components/ui/separator";
import { TurnHeader } from "./TurnHeader";
import { PanelCardRouter } from "./cards/PanelCardRouter";
import { ChevronLeft, ChevronRight, CornerDownRight, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ResponsePanel() {
  const turns = useBus((s) => s.turns);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, turns.at(-1)?.cards.length, turns.at(-1)?.assistant?.text]);

  if (collapsed) {
    return (
      <aside className="w-10 shrink-0 bg-bg border-l border-border flex flex-col items-center py-2 gap-2">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 rounded hover:bg-bg-elev-2 text-fg-muted hover:text-fg transition-colors"
          title="Expand chat panel"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-[10px] text-fg-subtle tracking-wider uppercase mt-2 select-none" style={{ writingMode: "vertical-rl" }}>
          Chat
        </div>
      </aside>
    );
  }

  if (turns.length === 0) {
    return (
      <aside className="w-[380px] shrink-0 bg-bg border-l border-border flex flex-col overflow-hidden">
        <div className="h-10 flex items-center justify-end px-2 border-b border-border shrink-0">
          <button
            onClick={() => setCollapsed(true)}
            className="p-1 rounded hover:bg-bg-elev-2 text-fg-muted hover:text-fg transition-colors"
            title="Collapse chat panel"
          >
            <ChevronRight size={14} />
          </button>
        </div>
        <EmptyState />
      </aside>
    );
  }

  return (
    <aside className="w-[380px] shrink-0 bg-bg border-l border-border flex flex-col overflow-hidden">
      <div className="h-10 flex items-center justify-between px-3 border-b border-border shrink-0">
        <span className="text-xs font-medium text-fg-muted">Chat</span>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 rounded hover:bg-bg-elev-2 text-fg-muted hover:text-fg transition-colors"
          title="Collapse chat panel"
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
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
      </div>
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
