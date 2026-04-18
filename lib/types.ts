export type Utility =
  | "electricity"
  | "natural_gas"
  | "steam"
  | "heating_hot_water"
  | "chilled_water"
  | "domestic_water";

export type Severity = "low" | "medium" | "high";
export type AnomalyStatus =
  | "new"
  | "open"
  | "reviewed"
  | "dismissed"
  | "resolved";

export interface Building {
  buildingnumber: number;
  buildingname: string;
  campus: string;
  gross_area: number | null;
  floors_above_ground: number | null;
  construction_date: string | null;
  latitude: number | null;
  longitude: number | null;
  building_type: string | null;
  status: string;
}

export interface Anomaly {
  id: string;
  building_id: number;
  utility: Utility;
  first_reading_time: string;
  last_reading_time: string;
  peak_reading_time: string;
  peak_percentile: number;
  expected_kwh: number;
  actual_kwh: number;
  residual_kwh: number;
  duration_minutes: number;
  cost_impact_usd: number;
  severity: Severity;
  status: AnomalyStatus;
  parent_anomaly_id: string | null;
  claude_explanation: string | null;
  work_order_draft: string | null;
  claude_explanation_state: "pending" | "ready" | "failed" | "cached";
  created_at: string;
  updated_at: string;
  // Denormalized for UI convenience
  building_name?: string;
}

export interface CenterDirective {
  target: "center";
  view_type:
    | "map"
    | "chart"
    | "anomaly_list"
    | "anomaly_detail"
    | "work_order"
    | "dr_simulator"
    | "text";
  data: Record<string, unknown>;
  config: Record<string, unknown>;
}

export interface PanelCard {
  target: "panel";
  turn_id: string;
  card_type:
    | "entity"
    | "anomaly_ref"
    | "building_ref"
    | "chart_mini"
    | "fact"
    | "action"
    | "source";
  data: Record<string, unknown>;
  config: Record<string, unknown>;
}

export type Directive = CenterDirective | PanelCard;

export interface ChatMessage {
  id: string;
  turn_id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  created_at: string;
}
