import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { aggressionLabel } from "@/lib/ticker";

export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";

type Body = {
  symbol?: string;
  aggression_score?: number;
  atr_pct?: number;
  beta?: number;
  scalp_suitable?: boolean;
  swing_suitable?: boolean;
  sop?: { regimes?: string; tf?: string; assets?: string };
  stats?: { win_rate?: number | null; max_single_loss?: number | null; primary_assets?: string | null } | null;
  regime?: string | null;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });

  const prompt = `Write a two-sentence, technical, no-fluff insight for an experienced trader about ${b.symbol} today. Use these facts and personalize to the trader's profile. Do not invent options data.
Ticker (price-derived): aggression ${b.aggression_score}/10 (${aggressionLabel(b.aggression_score ?? 5)}), ATR ${b.atr_pct}% of price, beta ${b.beta}, scalp-suitable ${b.scalp_suitable}, swing-suitable ${b.swing_suitable}.
Live SPY regime: ${b.regime ?? "unknown"}.
Trader SOP: timeframe ${b.sop?.tf ?? "?"}, allowed regimes ${b.sop?.regimes ?? "any"}, watchlist ${b.sop?.assets ?? "?"}.
Trader history: win rate ${b.stats?.win_rate ?? "unknown"}%, worst single loss ${b.stats?.max_single_loss ?? "unknown"}% of account, mostly trades ${b.stats?.primary_assets ?? "unknown"}.
End the second sentence with whether this ticker is "well suited", "caution advised", or "not recommended" for this trader's style. Output only the two sentences.`;

  let message: Anthropic.Messages.Message;
  try {
    message = await new Anthropic({ apiKey }).messages.create({
      model: MODEL,
      max_tokens: 400,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Insight failed" }, { status: 502 });
  }

  await supabase.from("api_usage").insert({
    user_id: user.id,
    kind: "insight",
    model: MODEL,
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  });

  const text = message.content.find((c): c is Anthropic.Messages.TextBlock => c.type === "text")?.text?.trim();
  return NextResponse.json({ insight: text || "" });
}
