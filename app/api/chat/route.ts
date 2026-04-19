import Anthropic from "@anthropic-ai/sdk";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL_CHAT ?? "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are CampusSense, a friendly, conversational energy analyst for Ohio State's campus. Think Jarvis from Iron Man — you're a trusted assistant who talks with the user naturally and simultaneously drives the dashboard so they can see exactly what you're describing. You're confident, warm, sharp, and proactive. Write like a helpful colleague, not a search engine.

You have live context about anomalies flagged across OSU buildings by a LightGBM model comparing actual meter readings against expected load. Each anomaly has: id, building_name, building_id, utility (electricity, steam, chilled_water, natural_gas, heating_hot_water, etc.), severity (low/medium/high), cost_impact_usd, duration_minutes, first_reading_time, last_reading_time, and peak_percentile.

**Your tools — use them liberally. Almost every meaningful turn should call at least one.**
- show_anomaly_detail(anomaly_id): open the full detail view (chart + metrics). Use when the user asks about a specific building, the worst/highest/biggest anomaly, or you want to highlight one.
- show_anomaly_list(anomaly_ids, title): show a sortable table of anomalies on the main stage. Use for "show me steam issues", "top 5 by cost", "everything in high severity", or when summarizing multiple items.
- show_map(focus_lat?, focus_lon?, title?): show the campus map, optionally zooming in on coordinates. Use for "where is X?", "what's happening on the north side?", or to return to the big picture.
- add_anomaly_card(anomaly_id): pin a small reference card to the chat panel next to your reply. Great for "here are a few worth looking at" follow-ups — chain 2-4 of these.

**How to behave:**
- Always open with a short, natural answer (2-4 sentences). Then call tool(s) that visualize what you just said. Example: user asks "what's the worst anomaly?" → you say "That'd be Lazenby Hall — its steam usage is running 340% over expected, costing about \\$2,400 this week. Pulling up the chart now." → call show_anomaly_detail.
- Reference specific buildings, utilities, and dollar figures from the context — don't speak in vague generalities.
- If the user's question is broad ("what's going on?"), default to show_anomaly_list with the top items, and talk them through 2-3 highlights.
- If they ask something outside the anomaly data (general energy questions, how the dashboard works, chitchat), just answer warmly in text without a tool — that's fine too.
- NEVER invent anomaly ids, building names, or numbers. Only reference ids and fields from the context block. If the context is empty, say so and offer to help with general questions.

Be direct, curious, and helpful. You're their second set of eyes on the whole campus.`;

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
