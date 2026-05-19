import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import type { SOP, Grade } from "@/lib/types";

export const runtime = "nodejs";

const SYSTEM = `You are a strict but supportive trading coach. Grade whether this paper trade followed the trader's own SOP rules. Be specific about what you see in the chart.
Return ONLY valid JSON, no other text:
{
  "score": 0-100,
  "verdict": "SOP followed"|"Partial"|"SOP violated",
  "rule_checks": [
    {"rule":"Entry signal visible on chart","status":"pass"|"fail"|"warn","note":"specific detail"},
    {"rule":"Trend aligned with direction","status":"pass"|"fail"|"warn","note":"specific detail"},
    {"rule":"Risk/reward looks acceptable","status":"pass"|"fail"|"warn","note":"specific detail"},
    {"rule":"Entry timing reasonable","status":"pass"|"fail"|"warn","note":"specific detail"},
    {"rule":"Volume supports the move","status":"pass"|"fail"|"warn","note":"specific detail"},
    {"rule":"Volatility / MACD context","status":"pass"|"fail"|"warn","note":"specific detail"}
  ],
  "what_you_did_well": "specific positive",
  "what_to_improve": "specific actionable improvement",
  "coach_note": "one encouraging sentence for a beginner"
}`;

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
  let raw = "";
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    raw = msg.content.find((b): b is Anthropic.Messages.TextBlock => b.type === "text")?.text ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Grading failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const clean = raw.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return NextResponse.json({ error: "Bad model response", raw }, { status: 502 });

  let grade: Grade;
  try {
    grade = JSON.parse(clean.slice(start, end + 1));
  } catch {
    return NextResponse.json({ error: "Could not parse grade JSON", raw }, { status: 502 });
  }

  return NextResponse.json({ grade });
}
