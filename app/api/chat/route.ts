import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL_CHAT ?? "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are CampusSense, an intelligent energy analyst assistant for Ohio State University's campus energy dashboard. Think of yourself as a Jarvis-style analyst: the user talks to you in plain English, and you reply with a concise natural-language answer AND drive the UI with your tools so they can see the relevant charts, lists, and map views without clicking around.

You have live context about current anomalies detected across OSU buildings — meter readings flagged by a LightGBM model against expected load. Each anomaly has a building, a utility (electricity, steam, chilled_water, natural_gas, etc.), a severity (low/medium/high), a dollar cost impact, a duration, and a time window.

Tools — use them proactively, not just when asked:
- show_anomaly_detail: opens the full detail view for one anomaly (chart + metrics). Use when the user asks about a specific building, the "worst" anomaly, or you want to highlight one.
- show_anomaly_list: displays a filtered table of anomalies on the main stage. Use for category queries ("show all steam problems", "top 10 by cost", "high-severity only").
- show_map: shows the campus map, optionally focused on a lat/lon. Use when the user asks geographic questions.
- add_anomaly_card: pins an anomaly card to the chat panel. Use to surface 2–5 relevant anomalies alongside your text reply.

Style:
- Keep text responses short — 1-3 sentences. Let the tools do the visualization.
- Cite specific buildings and numbers when you have them.
- If the user asks something outside the anomaly context (general energy questions, how the system works), just answer in text — you don't have to use a tool every turn.
- Never hallucinate anomaly ids. Only reference ids from the context block below.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "show_anomaly_detail",
    description:
      "Open the detail view on the main stage for a specific anomaly, showing its expected-vs-actual time-series chart, cost impact, duration, and metadata. Use for single-anomaly queries.",
    input_schema: {
      type: "object",
      properties: {
        anomaly_id: {
          type: "string",
          description: "The id of the anomaly to display (must match an id from the context).",
        },
      },
      required: ["anomaly_id"],
    },
  },
  {
    name: "show_anomaly_list",
    description:
      "Display a filtered, sortable list of anomalies as a table on the main stage. Use for category/filter queries.",
    input_schema: {
      type: "object",
      properties: {
        anomaly_ids: {
          type: "array",
          items: { type: "string" },
          description: "Ids of anomalies to include in the list, in the desired order.",
        },
        title: {
          type: "string",
          description: "Title to show in the header (e.g. 'Top 10 by cost', 'Steam anomalies').",
        },
      },
      required: ["anomaly_ids", "title"],
    },
  },
  {
    name: "show_map",
    description:
      "Show the campus map on the main stage. Optionally focus on a specific lat/lon (the map auto-zooms in).",
    input_schema: {
      type: "object",
      properties: {
        focus_lat: { type: "number", description: "Latitude to center on." },
        focus_lon: { type: "number", description: "Longitude to center on." },
        title: { type: "string", description: "Optional header title." },
      },
    },
  },
  {
    name: "add_anomaly_card",
    description:
      "Pin a small reference card for an anomaly to the chat panel so the user can click it later. Good for surfacing 2-5 anomalies alongside your text reply.",
    input_schema: {
      type: "object",
      properties: {
        anomaly_id: { type: "string", description: "Id of the anomaly to pin." },
      },
      required: ["anomaly_id"],
    },
  },
];

type ChatRequestBody = {
  message: string;
  anomalies: Array<Record<string, unknown>>;
};

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not set. Copy .env.example to .env.local and fill it in." }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { message, anomalies } = body;
  if (typeof message !== "string" || !message.trim()) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new Anthropic();

  const contextBlock =
    anomalies.length === 0
      ? "No anomalies currently in context."
      : `Current anomalies in the dashboard (showing ${anomalies.length}):\n${JSON.stringify(anomalies, null, 0)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));

      let currentToolName: string | null = null;
      let currentToolJson = "";

      try {
        const msgStream = client.messages.stream({
          model: MODEL,
          max_tokens: 2048,
          system: SYSTEM_PROMPT,
          tools: TOOLS,
          messages: [
            {
              role: "user",
              content: `${contextBlock}\n\nUser: ${message}`,
            },
          ],
        });

        for await (const event of msgStream) {
          if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              currentToolName = event.content_block.name;
              currentToolJson = "";
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              write({ type: "text", text: event.delta.text });
            } else if (event.delta.type === "input_json_delta") {
              currentToolJson += event.delta.partial_json;
            }
          } else if (event.type === "content_block_stop") {
            if (currentToolName) {
              try {
                const input = currentToolJson ? JSON.parse(currentToolJson) : {};
                write({ type: "tool", name: currentToolName, input });
              } catch {
                // malformed partial JSON — skip
              }
              currentToolName = null;
              currentToolJson = "";
            }
          }
        }
        write({ type: "done" });
      } catch (err) {
        write({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "X-Accel-Buffering": "no",
    },
  });
}
