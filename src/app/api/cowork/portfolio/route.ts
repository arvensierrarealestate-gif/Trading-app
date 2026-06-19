import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { coworkPortfolioSchema, checkInvariants } from "@/lib/cowork-portfolio";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("cowork_portfolio")
    .select("document, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ portfolio: data?.document ?? null, updated_at: data?.updated_at ?? null });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = coworkPortfolioSchema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 6).map((i: z.ZodIssue) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return NextResponse.json({ error: "Schema validation failed", issues }, { status: 400 });
  }

  const invariantErrs = checkInvariants(parsed.data);
  if (invariantErrs.length > 0) {
    return NextResponse.json({ error: "Portfolio rules failed", issues: invariantErrs }, { status: 400 });
  }

  const { error } = await supabase
    .from("cowork_portfolio")
    .upsert({ user_id: user.id, document: parsed.data, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    saved_at: new Date().toISOString(),
    summary: {
      owned_options: parsed.data.owned_options.length,
      owned_stocks: parsed.data.owned_stocks.length,
      b1_tickers: parsed.data.monitor_B1_autofill?.tickers.length ?? 0,
      b2_tickers: parsed.data.monitor_B2_csp?.tickers.length ?? 0,
      b3_tickers: parsed.data.monitor_B3_leaps?.scan_order.length ?? 0,
      reentry_count: parsed.data.monitor_reentry.length,
      scalp_ticker: parsed.data.monitor_scalp?.ticker ?? null,
      other_watch: parsed.data.other_watch.length,
    },
  });
}
