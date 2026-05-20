import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import type { SOP, Grade } from "@/lib/types";

export const runtime = "nodejs";

const SYSTEM = `You are a strict but supportive trading coach. Grade whether this paper trade followed the trader's own SOP rules. Read the chart carefully and be specific about what you actually see — price action, indicators, structure. Score 0-100 (0 = ignored the SOP entirely, 100 = textbook adherence). The verdict must reflect the score: "SOP followed" for strong adherence, "Partial" for mixed, "SOP violated" for poor adherence. For each rule check, "pass" means clearly met, "warn" means ambiguous or partially met, "fail" means clearly not met.`;

const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    score: { type: "integer", description: "Overall SOP-compliance score from 0 to 100" },
    verdict: { type: "string", enum: ["SOP followed", "Partial", "SOP violated"] },
    rule_checks: {
      type: "array",
      description: "Exactly these six checks, in this order",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          rule: {
            type: "string",
            enum: [
              "Entry signal visible on chart",
              "Trend aligned with direction",
              "Risk/reward looks acceptable",
              "Entry timing reasonable",
              "Volume supports the move",
              "Volatility / MACD context",
            ],
          },
          status: { type: "string", enum: ["pass", "fail", "warn"] },
          note: { type: "string", description: "Specific detail referencing what is visible in the chart" },
        },
        required: ["rule", "status", "note"],
      },
    },
    what_you_did_well: { type: "string", description: "Specific positive observation" },
    what_to_improve: { type: "string", description: "Specific, actionable improvement" },
    coach_note: { type: "string", description: "One encouraging sentence for a beginner" },
  },
  required: ["score", "verdict", "rule_checks", "what_you_did_well", "what_to_improve", "coach_note"],
} as const;

type ImageInput = { data: string; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp" };
type Body = {
  sop: SOP;
  asset: string;
  dir: string;
  outcome: string;
  entry?: string;
  exit?: string;
  chart: ImageInput;
  news?: ImageInput | null;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const body = (await req.json()) as Body;
  if (!body?.chart?.data) return NextResponse.json({ error: "Chart image required" }, { status: 400 });

  const sopText = `TRADER SOP:
Assets: ${body.sop.assets} | Timeframe: ${body.sop.tf}
Sessions: ${body.sop.sessions}
Entry signals: ${body.sop.entry_signals}
Entry confirmation: ${body.sop.entry_confirm}
Entry notes: ${body.sop.entry_notes || "none"}
TP: ${body.sop.tp} | SL: ${body.sop.sl} | Min R/R: ${body.sop.rr}
Max risk/trade: ${body.sop.risk} | Max trades/day: ${body.sop.max_trades}
Daily loss limit: ${body.sop.drawdown}`;

  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text: `Grade this paper trade against the SOP.
Asset: ${body.asset}, Direction: ${body.dir}, Outcome: ${body.outcome}, Entry: ${body.entry || "—"}, Exit: ${body.exit || "—"}

${sopText}`,
    },
    { type: "image", source: { type: "base64", media_type: body.chart.media_type, data: body.chart.data } },
    { type: "text", text: "Image: price chart" },
  ];
  if (body.news?.data) {
    content.push({ type: "image", source: { type: "base64", media_type: body.news.media_type, data: body.news.data } });
    content.push({ type: "text", text: "Image 2: news/sentiment" });
  }

  const anthropic = new Anthropic({ apiKey });
  let message: Anthropic.Messages.Message;
  try {
    message = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: GRADE_SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grading failed" }, { status: 502 });
  }

  if (message.stop_reason === "refusal") {
    return NextResponse.json({ error: "The model declined to grade this image." }, { status: 422 });
  }
  if (message.stop_reason === "max_tokens") {
    return NextResponse.json({ error: "Grading response was truncated. Try again." }, { status: 502 });
  }

  const raw = message.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text;
  if (!raw) return NextResponse.json({ error: "Empty grade response" }, { status: 502 });

  let grade: Grade;
  try {
    grade = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Could not parse grade JSON" }, { status: 502 });
  }

  return NextResponse.json({ grade });
}
