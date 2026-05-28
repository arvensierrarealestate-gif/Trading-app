import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { checkDailyLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";
const MAX_FILES = 8;
const MAX_B64 = 8_000_000; // ~6MB per file
const MAX_TEXT = 200_000;

const SYSTEM =
  "You verify a trader's real history from uploaded broker statements, journal exports, or screenshots. Extract the requested statistics as accurately as the documents allow. If a value cannot be determined, estimate conservatively and lower your confidence. Be precise and technical. Return ONLY the structured object.";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    total_trades: { type: "integer", description: "Total completed trades found" },
    win_rate: { type: "number", description: "Win rate as a percentage 0-100" },
    avg_win: { type: "number", description: "Average profit per winning trade, in account currency" },
    avg_loss: { type: "number", description: "Average loss per losing trade, positive magnitude, in account currency" },
    max_single_loss: { type: "number", description: "Largest single losing trade as a percent of account at the time" },
    max_drawdown: { type: "number", description: "Largest peak-to-trough drawdown as a percent" },
    primary_assets: { type: "string", description: "Most traded asset classes/symbols, comma separated" },
    avg_hold_time: { type: "string", description: "Typical holding time, e.g. '2 days', '15 min'" },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    summary: { type: "string", description: "One or two technical sentences on what the documents showed and any gaps" },
  },
  required: [
    "total_trades",
    "win_rate",
    "avg_win",
    "avg_loss",
    "max_single_loss",
    "max_drawdown",
    "primary_assets",
    "avg_hold_time",
    "confidence",
    "summary",
  ],
} as const;

type UploadFile =
  | { kind: "pdf"; name: string; data: string }
  | { kind: "image"; name: string; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; data: string }
  | { kind: "csv"; name: string; text: string };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const limit = await checkDailyLimit(supabase, user.id, "verify");
  if (!limit.ok) return NextResponse.json({ error: limit.message }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { files?: UploadFile[] } | null;
  const files = body?.files ?? [];
  if (!files.length) return NextResponse.json({ error: "Upload at least one file" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Max ${MAX_FILES} files` }, { status: 400 });

  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text: "Extract this trader's verified statistics from the attached documents. Use every file. Fill the structured object.",
    },
  ];
  for (const f of files) {
    if (f.kind === "pdf") {
      if (!f.data || f.data.length > MAX_B64) return NextResponse.json({ error: `PDF ${f.name} missing or too large` }, { status: 400 });
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } });
    } else if (f.kind === "image") {
      if (!f.data || f.data.length > MAX_B64) return NextResponse.json({ error: `Image ${f.name} missing or too large` }, { status: 400 });
      content.push({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } });
    } else if (f.kind === "csv") {
      const text = (f.text ?? "").slice(0, MAX_TEXT);
      content.push({ type: "text", text: `CSV file "${f.name}":\n${text}` });
    }
  }

  const anthropic = new Anthropic({ apiKey });
  let message: Anthropic.Messages.Message;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Verification failed" }, { status: 502 });
  }

  await supabase.from("api_usage").insert({
    user_id: user.id,
    kind: "verify",
    model: MODEL,
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  });

  if (message.stop_reason === "refusal") {
    return NextResponse.json({ error: "The model declined to process these files." }, { status: 422 });
  }
  const raw = message.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text;
  if (!raw) return NextResponse.json({ error: "Empty extraction" }, { status: 502 });
  try {
    return NextResponse.json({ stats: JSON.parse(raw) });
  } catch {
    return NextResponse.json({ error: "Could not parse extraction" }, { status: 502 });
  }
}
