import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPaid } from "@/lib/subscription";

export const runtime = "nodejs";

const FREE_GRADE_LIMIT = Number(process.env.FREE_GRADE_DAILY_LIMIT ?? "5");
// Opus 4.7 list pricing, USD per token.
const INPUT_PRICE = 5 / 1_000_000;
const OUTPUT_PRICE = 25 / 1_000_000;

function utcMidnightToday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function utcMidnightTomorrow(): Date {
  const d = utcMidnightToday();
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Pro users get unlimited Stage 2 grading; Free users get FREE_GRADE_LIMIT/day.
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

  const since = utcMidnightToday();

  const { data, error } = await supabase
    .from("api_usage")
    .select("input_tokens, output_tokens")
    .eq("user_id", user.id)
    .eq("kind", "grade")
    .gte("created_at", since.toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const inputTokens = rows.reduce((a, r) => a + (r.input_tokens ?? 0), 0);
  const outputTokens = rows.reduce((a, r) => a + (r.output_tokens ?? 0), 0);
  const grades = rows.length;
  const estCostUsd = Number((inputTokens * INPUT_PRICE + outputTokens * OUTPUT_PRICE).toFixed(4));

  return NextResponse.json({
    today: {
      paid,
      grades,
      limit: paid ? null : FREE_GRADE_LIMIT,
      remaining: paid ? null : Math.max(0, FREE_GRADE_LIMIT - grades),
      resets_at: utcMidnightTomorrow().toISOString(),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      est_cost_usd: estCostUsd,
    },
  });
}
