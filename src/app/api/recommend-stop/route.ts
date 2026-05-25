import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";
const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
const MAX_IMAGE_B64 = 7_000_000;

const SYSTEM =
  "You are a careful trading-safety assistant for a beginner. Read the price chart and recommend a single protective stop-loss price placed just beyond the nearest meaningful support (for a long) or resistance (for a short) visible on the chart. Explain it in plain, encouraging English with no jargon. Return ONLY the structured object.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stop_loss_price: { type: "number", description: "Recommended stop-loss price" },
    direction: { type: "string", enum: ["long", "short"], description: "Trade direction the stop assumes" },
    support_basis: { type: "string", description: "Plain-English reason, referencing the support/resistance on the chart" },
    drop_pct: { type: "number", description: "Approx percent from entry to the stop (0 if entry unknown)" },
  },
  required: ["stop_loss_price", "direction", "support_basis", "drop_pct"],
} as const;

type ImageInput = { data: string; media_type: (typeof ALLOWED_MEDIA)[number] };
type Body = { chart: ImageInput; asset?: string; dir?: string; entry?: string };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as Body | null;
  const img = body?.chart;
  if (!img || typeof img.data !== "string" || !img.data) {
    return NextResponse.json({ error: "Chart image required" }, { status: 400 });
  }
  if (!ALLOWED_MEDIA.includes(img.media_type) || img.data.length > MAX_IMAGE_B64) {
    return NextResponse.json({ error: "Invalid or oversized image" }, { status: 400 });
  }

  const anthropic = new Anthropic({ apiKey });
  let message: Anthropic.Messages.Message;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Recommend a protective stop loss.\nAsset: ${body?.asset || "unknown"}, Direction: ${body?.dir || "long"}, Planned entry: ${body?.entry || "unknown"}.`,
            },
            { type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } },
          ],
        },
      ],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Recommendation failed" }, { status: 502 });
  }

  await supabase.from("api_usage").insert({
    user_id: user.id,
    kind: "recommend",
    model: MODEL,
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  });

  const raw = message.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text;
  if (!raw) return NextResponse.json({ error: "Empty recommendation" }, { status: 502 });
  try {
    return NextResponse.json({ recommendation: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ error: "Could not parse recommendation" }, { status: 502 });
  }
}
