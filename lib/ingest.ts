"use client";
// Client-side CSV ingestion + z-score anomaly detection for external universities.

export type ExternalBuilding = {
  building_id: string;
  building_name: string;
  latitude: number;
  longitude: number;
  gross_area_sqft: number;
};

export type ExternalReading = {
  building_id: string;
  utility: string;
  reading_time: string;
  reading_value: number;
};

export type ExternalAnomaly = {
  id: string;
  building_id: string;
  building_name: string;
  latitude: number;
  longitude: number;
  utility: string;
  severity: "low" | "medium" | "high";
  cost_usd: number;
  first_time: string;
  last_time: string;
  z_score: number;
};

const RATES: Record<string, number> = {
  electricity: 0.09, natural_gas: 0.70 / 29.3,
  steam: 0.04, chilled_water: 0.08,
  heating_hot_water: 0.04, domestic_water: 0.005,
};

export function parseCSV(text: string): { buildings: ExternalBuilding[]; readings: ExternalReading[] } {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());

  const idx = (name: string) => headers.indexOf(name);
  const need = ["building_id", "building_name", "latitude", "longitude", "utility", "reading_time", "reading_value"];
  const missing = need.filter((n) => idx(n) === -1);
  if (missing.length) throw new Error(`CSV missing columns: ${missing.join(", ")}`);

  const buildingMap = new Map<string, ExternalBuilding>();
  const readings: ExternalReading[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < headers.length) continue;
    const get = (name: string) => cols[idx(name)]?.trim() ?? "";

    const bid = get("building_id");
    if (!bid) continue;

    if (!buildingMap.has(bid)) {
      buildingMap.set(bid, {
        building_id: bid,
        building_name: get("building_name"),
        latitude: parseFloat(get("latitude")),
        longitude: parseFloat(get("longitude")),
        gross_area_sqft: parseFloat(get("gross_area_sqft") || "50000"),
      });
    }

    const val = parseFloat(get("reading_value"));
    if (!isNaN(val)) {
      readings.push({
        building_id: bid,
        utility: get("utility"),
        reading_time: get("reading_time"),
        reading_value: val,
      });
    }
  }

  return { buildings: [...buildingMap.values()], readings };
}

export function detectAnomalies(
  buildings: ExternalBuilding[],
  readings: ExternalReading[]
): ExternalAnomaly[] {
  // Group readings by building+utility
  const groups = new Map<string, ExternalReading[]>();
  for (const r of readings) {
    const key = `${r.building_id}::${r.utility}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const buildingMap = new Map(buildings.map((b) => [b.building_id, b]));
  const anomalies: ExternalAnomaly[] = [];

  for (const [key, rows] of groups.entries()) {
    if (rows.length < 8) continue;
    const [bid, utility] = key.split("::");
    const b = buildingMap.get(bid);
    if (!b) continue;

    const vals = rows.map((r) => r.reading_value);
    const mean = vals.reduce((a, v) => a + v, 0) / vals.length;
    const std = Math.sqrt(vals.map((v) => (v - mean) ** 2).reduce((a, v) => a + v, 0) / vals.length);
    if (std < 1e-6) continue;

    // Flag readings with z-score > 2.5
    for (const r of rows) {
      const z = (r.reading_value - mean) / std;
      if (z < 2.5) continue;

      const residual = r.reading_value - mean;
      const rate = RATES[utility] ?? 0.07;
      const cost = Math.round(residual * rate * 10) / 10;
      if (cost < 3) continue;

      const sev: "low" | "medium" | "high" = z > 4.5 ? "high" : z > 3.5 ? "medium" : "low";

      anomalies.push({
        id: `ext-${bid}-${utility}-${r.reading_time.replace(/\D/g, "")}`,
        building_id: bid,
        building_name: b.building_name,
        latitude: b.latitude,
        longitude: b.longitude,
        utility,
        severity: sev,
        cost_usd: cost,
        first_time: r.reading_time,
        last_time: r.reading_time,
        z_score: Math.round(z * 100) / 100,
      });
    }
  }

  // Deduplicate: keep highest-severity per building+utility
  const best = new Map<string, ExternalAnomaly>();
  const rank = { high: 3, medium: 2, low: 1 };
  for (const a of anomalies) {
    const k = `${a.building_id}::${a.utility}`;
    const ex = best.get(k);
    if (!ex || rank[a.severity] > rank[ex.severity]) best.set(k, a);
  }

  return [...best.values()].sort((a, b) => b.cost_usd - a.cost_usd);
}
