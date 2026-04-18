"use client";
import { cn } from "@/lib/utils";

export function StatusBar({
  realtime = "live",
  scrape = "ready",
  claude = "ok",
  latencyMs,
}: {
  realtime?: "live" | "polling" | "offline";
  scrape?: "ready" | "spec" | "running";
  claude?: "ok" | "cached" | "down";
  latencyMs?: number;
}) {
  const realtimeDot =
    realtime === "live"
      ? "bg-ok"
      : realtime === "polling"
      ? "bg-warn"
      : "bg-danger";
  const realtimeLabel =
    realtime === "live"
      ? "Live"
      : realtime === "polling"
      ? "Polling"
      : "Offline";

  const pill = (
    label: string,
    tone: "ok" | "warn" | "danger" | "muted",
  ) =>
    cn(
      "rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
      tone === "ok" && "bg-ok/15 text-ok",
      tone === "warn" && "bg-warn/15 text-warn",
      tone === "danger" && "bg-danger/15 text-danger",
      tone === "muted" && "bg-bg-elev-2 text-fg-muted",
    );

  return (
    <footer className="h-7 bg-bg-elev-1 border-t border-border text-xs text-fg-muted flex items-center px-4 gap-3 shrink-0">
      <div className="flex items-center gap-1.5">
        <span className={cn("inline-block w-2 h-2 rounded-full", realtimeDot)} />
        <span>{realtimeLabel}</span>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <span className={pill(scrape === "ready" ? "Data ready" : scrape === "running" ? "Scraping" : "Spec mode", scrape === "ready" ? "ok" : "warn")}>
          {scrape === "ready" ? "Data ready" : scrape === "running" ? "Scraping" : "Spec mode"}
        </span>
        <span className={pill(claude === "ok" ? "Claude OK" : claude === "cached" ? "Cached" : "Claude down", claude === "ok" ? "ok" : claude === "cached" ? "warn" : "danger")}>
          Claude {claude === "ok" ? "OK" : claude === "cached" ? "cached" : "down"}
        </span>
        {typeof latencyMs === "number" && (
          <span className="font-mono tabular-nums">{latencyMs}ms</span>
        )}
      </div>
    </footer>
  );
}
