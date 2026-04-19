"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Map as MapIcon, ZoomIn, ZoomOut, Locate, X } from "lucide-react";
import { useBus } from "@/lib/directive-bus";
import type { Anomaly } from "@/lib/types";
import type { ExternalBuilding, ExternalAnomaly } from "@/lib/ingest";

type Building = {
  buildingnumber: number;
  buildingname: string;
  latitude: number;
  longitude: number;
  gross_area?: number;
  campus?: string;
};

// OSU Columbus main campus center
const OSU_CENTER: [number, number] = [40.0, -83.015];
const OSU_BOUNDS = {
  latMin: 39.982, latMax: 40.013,
  lonMin: -83.075, lonMax: -83.003,
};

export function MapView({
  data,
  config,
}: {
  data?: Record<string, unknown>;
  config?: Record<string, unknown>;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const anomalies = useBus((s) => s.anomalies) as Anomaly[];
  const dispatch = useBus((s) => s.dispatch);
  const externalBuildings = useBus((s) => s.externalBuildings);
  const externalAnomalies = useBus((s) => s.externalAnomalies);
  const setExternalData = useBus((s) => s.setExternalData);
  const title = (config?.title as string) ?? "OSU Columbus · campus map";

  // Build anomaly index keyed by building_id (highest severity wins)
  const anomalyByBuilding = new Map<number, Anomaly>();
  const severityRank = { high: 3, medium: 2, low: 1 };
  for (const a of anomalies) {
    const existing = anomalyByBuilding.get(a.building_id);
    if (!existing || (severityRank[a.severity] ?? 0) > (severityRank[existing.severity] ?? 0)) {
      anomalyByBuilding.set(a.building_id, a);
    }
  }

  // Fetch buildings
  useEffect(() => {
    fetch("/api/buildings")
      .then((r) => r.ok ? r.json() : [])
      .then((data: Building[]) =>
        setBuildings(
          data.filter(
            (b) =>
              b.latitude > OSU_BOUNDS.latMin && b.latitude < OSU_BOUNDS.latMax &&
              b.longitude > OSU_BOUNDS.lonMin && b.longitude < OSU_BOUNDS.lonMax
          )
        )
      )
      .catch(() => {});
  }, []);

  // Init Leaflet once on mount
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Dynamic import to avoid SSR issues
    import("leaflet").then((L) => {
      // Fix default icon paths that break with webpack
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapContainerRef.current!, {
        center: OSU_CENTER,
        zoom: 15,
        zoomControl: false, // we add custom buttons
        attributionControl: true,
      });

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
      setReady(true);
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Add / update markers when buildings or anomalies change
  const markersRef = useRef<unknown[]>([]);
  useEffect(() => {
    if (!ready || !mapRef.current || buildings.length === 0) return;

    import("leaflet").then((L) => {
      const map = mapRef.current;

      // Remove old markers
      markersRef.current.forEach((m) => (m as { remove: () => void }).remove());
      markersRef.current = [];

      for (const b of buildings) {
        const anomaly = anomalyByBuilding.get(b.buildingnumber);

        const color = anomaly
          ? anomaly.severity === "high" ? "#e05a2b"
            : anomaly.severity === "medium" ? "#d97706"
            : "#ca8a04"
          : "#6b7280";

        const radius = anomaly ? 9 : 5;
        const weight = anomaly ? 2 : 1;
        const fillOpacity = anomaly ? 0.85 : 0.45;

        const circle = L.circleMarker([b.latitude, b.longitude], {
          radius,
          color: anomaly ? color : "rgba(150,160,180,0.5)",
          weight,
          fillColor: color,
          fillOpacity,
        }).addTo(map);

        const popupContent = anomaly
          ? `<div style="font-family:sans-serif;min-width:180px">
              <div style="font-weight:600;font-size:13px;margin-bottom:4px">${b.buildingname}</div>
              <div style="font-size:11px;color:#888;margin-bottom:6px">${b.campus ?? ""}</div>
              <div style="font-size:12px;margin-bottom:2px">
                <span style="color:${color};font-weight:600">${anomaly.severity.toUpperCase()}</span>
                &nbsp;·&nbsp;${anomaly.utility.replace(/_/g, " ")}
              </div>
              <div style="font-size:12px">Cost impact: <strong>$${anomaly.cost_impact_usd.toLocaleString()}</strong></div>
              <div style="font-size:11px;color:#888;margin-top:4px">Click marker to open detail</div>
            </div>`
          : `<div style="font-family:sans-serif">
              <div style="font-weight:600;font-size:13px">${b.buildingname}</div>
              <div style="font-size:11px;color:#888">${b.campus ?? ""}</div>
            </div>`;

        circle.bindPopup(popupContent, { maxWidth: 260 });

        if (anomaly) {
          circle.on("click", () => {
            dispatch({
              target: "center",
              view_type: "anomaly_detail",
              data: { anomaly_id: anomaly.id },
              config: { title: b.buildingname },
            });
          });
        }

        markersRef.current.push(circle);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, buildings, anomalies]);

  // Add / update external university markers
  const extMarkersRef = useRef<unknown[]>([]);
  useEffect(() => {
    if (!ready || !mapRef.current) return;

    import("leaflet").then((L) => {
      const map = mapRef.current;

      // Remove old external markers
      extMarkersRef.current.forEach((m) => (m as { remove: () => void }).remove());
      extMarkersRef.current = [];

      if (externalBuildings.length === 0) return;

      const extAnomalyMap = new Map<string, (typeof externalAnomalies)[0]>();
      for (const a of externalAnomalies) {
        const existing = extAnomalyMap.get(a.building_id);
        const rank = { high: 3, medium: 2, low: 1 };
        if (!existing || (rank[a.severity] ?? 0) > (rank[existing.severity] ?? 0)) {
          extAnomalyMap.set(a.building_id, a);
        }
      }

      const latlngs: [number, number][] = [];

      for (const b of externalBuildings) {
        const anomaly = extAnomalyMap.get(b.building_id);
        const color = anomaly
          ? anomaly.severity === "high" ? "#e05a2b"
            : anomaly.severity === "medium" ? "#d97706"
            : "#ca8a04"
          : "#6b7280";

        const radius = anomaly ? 9 : 5;
        const fillOpacity = anomaly ? 0.85 : 0.45;

        // Use a dashed border to distinguish external buildings from OSU
        const circle = L.circleMarker([b.latitude, b.longitude], {
          radius,
          color: anomaly ? color : "rgba(150,160,180,0.5)",
          weight: anomaly ? 3 : 1.5,
          dashArray: "4 3",
          fillColor: color,
          fillOpacity,
        }).addTo(map);

        const popupContent = anomaly
          ? `<div style="font-family:sans-serif;min-width:180px">
              <div style="font-weight:600;font-size:13px;margin-bottom:2px">${b.building_name}</div>
              <div style="font-size:11px;color:#888;margin-bottom:6px">External campus</div>
              <div style="font-size:12px;margin-bottom:2px">
                <span style="color:${color};font-weight:600">${anomaly.severity.toUpperCase()}</span>
                &nbsp;·&nbsp;${anomaly.utility.replace(/_/g, " ")}
              </div>
              <div style="font-size:12px">Cost impact: <strong>$${anomaly.cost_usd.toLocaleString()}</strong></div>
            </div>`
          : `<div style="font-family:sans-serif">
              <div style="font-weight:600;font-size:13px">${b.building_name}</div>
              <div style="font-size:11px;color:#888">External campus</div>
            </div>`;

        circle.bindPopup(popupContent, { maxWidth: 260 });

        if (anomaly) {
          circle.on("click", () => {
            dispatch({
              target: "center",
              view_type: "anomaly_detail",
              data: { anomaly_id: anomaly.id, external: true },
              config: { title: b.building_name },
            });
          });
        }

        extMarkersRef.current.push(circle);
        latlngs.push([b.latitude, b.longitude]);
      }

      // Auto-pan to fit external buildings
      if (latlngs.length > 0) {
        map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 16 });
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, externalBuildings, externalAnomalies]);

  const focusLat = typeof data?.focus_lat === "number" ? data.focus_lat : null;
  const focusLon = typeof data?.focus_lon === "number" ? data.focus_lon : null;
  useEffect(() => {
    if (!ready || !mapRef.current || focusLat === null || focusLon === null) return;
    mapRef.current.setView([focusLat, focusLon], 17);
  }, [ready, focusLat, focusLon]);

  const zoomIn = useCallback(() => mapRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => mapRef.current?.zoomOut(), []);
  const resetView = useCallback(
    () => mapRef.current?.setView(OSU_CENTER, 15),
    []
  );
  const goToOSU = useCallback(() => mapRef.current?.setView(OSU_CENTER, 15), []);
  const clearExternal = useCallback(() => {
    setExternalData([], []);
    mapRef.current?.setView(OSU_CENTER, 15);
  }, [setExternalData]);

  const flaggedCount = anomalyByBuilding.size;
  const extFlaggedCount = new Set(externalAnomalies.map((a) => a.building_id)).size;

  return (
    <div className="h-full w-full flex flex-col bg-bg">
      {/* Header */}
      <div className="h-10 px-4 flex items-center border-b border-border text-sm text-fg-muted shrink-0 gap-3">
        <MapIcon size={14} />
        <span>{title}</span>
        <span className="text-fg-subtle text-xs">·</span>
        <span className="text-xs text-fg-subtle">{buildings.length} buildings</span>
        {flaggedCount > 0 && (
          <>
            <span className="text-fg-subtle text-xs">·</span>
            <span className="text-xs text-[#e05a2b] font-medium">{flaggedCount} flagged</span>
          </>
        )}
        {externalBuildings.length > 0 && (
          <>
            <span className="text-fg-subtle text-xs">·</span>
            <span className="text-xs text-accent font-medium border border-accent/30 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
              +{externalBuildings.length} ext
              {extFlaggedCount > 0 && ` · ${extFlaggedCount} flagged`}
              <button
                onClick={clearExternal}
                aria-label="Clear external data"
                className="ml-1 -mr-0.5 rounded hover:bg-accent/10 text-accent/70 hover:text-accent transition-colors"
              >
                <X size={11} />
              </button>
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-fg-subtle">
          {externalBuildings.length > 0 && (
            <button
              onClick={goToOSU}
              className="text-[10px] px-2 py-0.5 rounded border border-border text-fg-muted hover:text-fg hover:border-border-strong transition-colors"
            >
              OSU view
            </button>
          )}
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#e05a2b]" /> high
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#d97706]" /> medium
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#ca8a04]" /> low
          </span>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={mapContainerRef} className="absolute inset-0" />

        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1">
          <button
            onClick={zoomIn}
            className="w-8 h-8 bg-bg-elev-2 border border-border rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev-1 transition-colors shadow-sm"
            aria-label="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={zoomOut}
            className="w-8 h-8 bg-bg-elev-2 border border-border rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev-1 transition-colors shadow-sm"
            aria-label="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={resetView}
            className="w-8 h-8 bg-bg-elev-2 border border-border rounded-md flex items-center justify-center text-fg-muted hover:text-fg hover:bg-bg-elev-1 transition-colors shadow-sm"
            aria-label="Reset view"
          >
            <Locate size={14} />
          </button>
        </div>

        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-fg-subtle bg-bg z-[999]">
            Loading map…
          </div>
        )}
      </div>
    </div>
  );
}
