"use client";
import { Map as MapIcon } from "lucide-react";

export function MapView({
  config,
}: {
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
}) {
  const title = (config?.title as string) ?? "OSU Columbus · campus map";
  return (
    <div className="h-full w-full flex flex-col bg-bg">
      <div className="h-10 px-4 flex items-center border-b border-border text-sm text-fg-muted shrink-0">
        <MapIcon size={14} className="mr-2" />
        <span>{title}</span>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent_70%)]" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-xs uppercase tracking-wider text-fg-subtle mb-2">
              Mapbox stage
            </div>
            <div className="text-sm text-fg-muted max-w-sm">
              Building layer loads after scrape. Anomalies hot-wire via
              setFeatureState on realtime.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
