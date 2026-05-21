import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DAILY_LIMIT = Number(process.env.GRADE_DAILY_LIMIT ?? "50");
// Opus 4.7 list pricing, USD per token.
const INPUT_PRICE = 5 / 1_000_000;
const OUTPUT_PRICE = 25 / 1_000_000;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const since = new Date();
  since.setHours(0, 0, 0, 0);

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
      grades,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      est_cost_usd: estCostUsd,
      limit: DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - grades),
    },
  });
}
