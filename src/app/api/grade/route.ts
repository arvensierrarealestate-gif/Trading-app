import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { gradeSchema, parseBody } from "@/lib/schemas";
import { isPaid } from "@/lib/subscription";
import type { Grade } from "@/lib/types";

export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";
const FREE_GRADE_LIMIT = Number(process.env.FREE_GRADE_DAILY_LIMIT ?? "5");

const SYSTEM = `You are a strict but supportive trading coach. Grade whether this paper trade followed the trader's own SOP rules. Read the chart carefully and be specific about what you actually see — price action, indicators, structure. Score 0-100 (0 = ignored the SOP entirely, 100 = textbook adherence). The verdict must reflect the score: "SOP followed" for strong adherence, "Partial" for mixed, "SOP violated" for poor adherence. For each rule check, "pass" means clearly met, "warn" means ambiguous or partially met, "fail" means clearly not met.`;

const PROTECTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    stop_loss_placement: {
      type: "integer",
      description:
        "0-30. How well the submitted stop loss is placed on the chart: ~30 = just beyond a clear support/resistance level; ~15 = plausible but loose; 0 = no stop, or placed illogically (e.g. inside recent noise or on the wrong side).",
    },
    position_size_ok: {
      type: "boolean",
      description:
        "True if, given the entry and stop, a beginner could size this position to risk only their max-risk %% (i.e. the stop distance is sane). False if the stop is missing or so far/illogical that risking only that %% is implausible.",
    },
    placement_note: { type: "string", description: "Plain-English, encouraging note about the stop placement" },
  },
  required: ["stop_loss_placement", "position_size_ok", "placement_note"],
} as const;

function buildSchema(withProtection: boolean) {
  const base = {
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
    } as Record<string, unknown>,
    required: ["score", "verdict", "rule_checks", "what_you_did_well", "what_to_improve", "coach_note"] as string[],
  };
  if (withProtection) {
    base.properties.protection = PROTECTION_SCHEMA;
    base.required = [...base.required, "protection"];
  }
  return base;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });

  const parsed = parseBody(gradeSchema, await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.data;

  // Free users get FREE_GRADE_LIMIT paper-trade grades per UTC day; Pro is
  // unlimited. Pro check bypasses the count entirely.
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, subscription_current_period_end")
    .eq("id", user.id)
    .maybeSingle();
  const paid = isPaid({
    status: (profile?.subscription_status ?? "free") as string,
    tier: null,
    current_period_end: profile?.subscription_current_period_end ?? null,
  });
  if (!paid) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from("api_usage")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("kind", "grade")
      .gte("created_at", since.toISOString());
    if ((count ?? 0) >= FREE_GRADE_LIMIT) {
      const reset = new Date();
      reset.setUTCHours(0, 0, 0, 0);
      reset.setUTCDate(reset.getUTCDate() + 1);
      return NextResponse.json(
        {
          error: `You've used all ${FREE_GRADE_LIMIT} free grades today. Grades reset at midnight UTC. Upgrade to Pro for unlimited grading.`,
          reset_at: reset.toISOString(),
          limit_reached: true,
        },
        { status: 429 },
      );
    }
  }

  const sopText = `TRADER SOP:
Assets: ${body.sop.assets} | Timeframe: ${body.sop.tf}
Sessions: ${body.sop.sessions}
Entry signals: ${body.sop.entry_signals}
Entry confirmation: ${body.sop.entry_confirm}
Entry notes: ${body.sop.entry_notes || "none"}
TP: ${body.sop.tp} | SL: ${body.sop.sl} | Min R/R: ${body.sop.rr}
Max risk/trade: ${body.sop.risk} | Max trades/day: ${body.sop.max_trades}
Daily loss limit: ${body.sop.drawdown}
Allowed market regimes: ${body.sop.regimes || "any"}`;

  const allowedRegimes = (body.sop.regimes || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const liveRegime = (body.current_regime || "").toLowerCase();
  const regimeMismatch = !!liveRegime && allowedRegimes.length > 0 && !allowedRegimes.includes(liveRegime);
  const regimeText = liveRegime
    ? `\n\nLIVE MARKET REGIME (SPY, 4-state HMM): ${liveRegime}. The trader's SOP only permits trading in: ${allowedRegimes.join(", ") || "any"}.${regimeMismatch ? " This trade was taken OUTSIDE the trader's allowed regimes — this is a regime violation: cap the score at 49 and set the verdict to \"SOP violated\" regardless of the chart, and explain the regime mismatch in what_to_improve." : " The current regime is within the trader's allowed regimes."}`
    : "";

  const learner = body.mode === "learner";
  const stopLoss = (body.stop_loss || "").trim();

  const toneText = learner
    ? "\n\nThe trader is a BEGINNER. Write what_you_did_well, what_to_improve, coach_note and every rule_check note in plain, encouraging English. Avoid or briefly explain any jargon (e.g. say \"reward vs risk\" instead of \"R/R\"). Be supportive, not harsh."
    : "";

  const protectionText = learner
    ? `\n\nSTOP LOSS: ${stopLoss || "NONE PROVIDED"}. Also fill the "protection" object: judge stop_loss_placement (0-30) from where this stop sits on the chart relative to support/resistance, and position_size_ok given the trader's max risk of ${body.sop.risk}.`
    : "";

  const strategyText = body.strategy_label
    ? `\n\nGRADE AGAINST STRATEGY: "${body.strategy_label}". The rules above represent this strategy's playbook — judge adherence to it specifically.`
    : "";
  const criteriaText = body.criteria?.length
    ? `\n\nThe trader self-reports these criteria were met for this trade: ${body.criteria.map((c) => `"${c}"`).join(", ")}. Verify each against the chart where visible; do not take them at face value if the chart contradicts them.`
    : "";

  const content: Anthropic.Messages.ContentBlockParam[] = [
    {
      type: "text",
      text: `Grade this paper trade against the SOP.
Asset: ${body.asset}, Direction: ${body.dir}, Outcome: ${body.outcome}, Entry: ${body.entry || "—"}, Exit: ${body.exit || "—"}, Stop loss: ${stopLoss || "—"}

${sopText}${regimeText}${strategyText}${criteriaText}${toneText}${protectionText}`,
    },
    { type: "image", source: { type: "base64", media_type: body.chart.media_type, data: body.chart.data } },
    { type: "text", text: "Image: price chart" },
  ];
  if (body.news?.data) {
    content.push({ type: "image", source: { type: "base64", media_type: body.news.media_type, data: body.news.data } });
    content.push({ type: "text", text: "Image 2: news/sentiment" });
  }
  if (body.news_text?.trim()) {
    content.push({ type: "text", text: `News / catalyst text the trader pasted from the source:\n"""\n${body.news_text.trim()}\n"""\nFactor this catalyst/sentiment into the grade where the SOP considers news.` });
  }

  const anthropic = new Anthropic({ apiKey });
  let message: Anthropic.Messages.Message;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: buildSchema(learner) } },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Grading failed" }, { status: 502 });
  }

  // Every completed model call consumed tokens — log it so it counts toward the cap.
  const usage = {
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  };
  await supabase.from("api_usage").insert({
    user_id: user.id,
    kind: "grade",
    model: MODEL,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
  });

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

  let protection: {
    stop_loss_set: boolean;
    stop_loss_placement: number;
    position_size_ok: boolean;
    protection_score: number;
  } | null = null;
  if (learner) {
    const stop_loss_set = !!stopLoss;
    // No stop loss => placement and sizing can't be credited.
    const stop_loss_placement = stop_loss_set ? Math.max(0, Math.min(30, grade.protection?.stop_loss_placement ?? 0)) : 0;
    const position_size_ok = stop_loss_set ? !!grade.protection?.position_size_ok : false;
    const protection_score = (stop_loss_set ? 40 : 0) + stop_loss_placement + (position_size_ok ? 30 : 0);
    protection = { stop_loss_set, stop_loss_placement, position_size_ok, protection_score };
  }

  return NextResponse.json({ grade, usage, protection });
}
