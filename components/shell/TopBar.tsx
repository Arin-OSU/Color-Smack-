"use client";
import { Search, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFrozenClock } from "@/hooks/useFrozenClock";
import { isFrozenMode } from "@/lib/clock";
import { cn } from "@/lib/utils";

export function TopBar({ onOpenCommand }: { onOpenCommand: () => void }) {
  const now = useFrozenClock();
  const frozen = isFrozenMode();

  const timeLabel = now
    ? now.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      })
    : "--";

  return (
    <header className="bg-bg-elev-1 border-b border-border h-12 flex items-center px-4 gap-3 shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-[16px] font-semibold tracking-tight">
          CampusSense
        </span>
        <span className="text-fg-muted text-sm">· OSU</span>
        <span className="text-fg-subtle text-xs border border-border rounded px-2 py-0.5">
          Columbus main · 485 buildings
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenCommand}
          className="flex items-center gap-2 bg-bg border border-border rounded-md px-3 py-1.5 text-sm text-fg-muted hover:border-border-strong transition-colors min-w-[260px]"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search buildings or anomalies</span>
          <kbd className="text-[10px] font-mono px-1.5 py-0.5 bg-bg-elev-2 rounded border border-border">
            ⌘K
          </kbd>
        </button>

        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-mono tabular-nums",
            frozen ? "bg-accent-soft text-accent" : "bg-ok/20 text-ok",
          )}
        >
          <span className="font-sans font-semibold tracking-wider text-[10px]">
            {frozen ? "REPLAY" : "LIVE"}
          </span>
          <span>·</span>
          <span>{timeLabel} EST</span>
        </div>

        <Button variant="ghost" size="icon" aria-label="Menu">
          <MoreVertical size={16} />
        </Button>
      </div>
    </header>
  );
}
