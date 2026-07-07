import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { coworkPortfolioSchema, checkInvariants } from "@/lib/cowork-portfolio";

export const runtime = "nodejs";

// Focused editor endpoint: upsert the mapped levels for a single B4 watchlist
// ticker without the client needing to re-send the whole portfolio document.
const bodySchema = z.object({
  ticker: z.string().min(1).max(12),
  bull_level: z.number().nullable().optional(),
  bear_level: z.number().nullable().optional(),
  targets: z.array(z.number()).max(6).optional(),
  stop: z.number().nullable().optional(),
  gaps: z.array(z.number()).max(6).optional(),
  note: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const ticker = parsed.data.ticker.toUpperCase();

  // Load current portfolio (or start fresh from schema defaults).
  const { data: existing } = await supabase
    .from("cowork_portfolio")
    .select("document")
    .eq("user_id", user.id)
    .maybeSingle();

  const docParse = coworkPortfolioSchema.safeParse(existing?.document ?? {});
  if (!docParse.success) {
    return NextResponse.json({ error: "Existing portfolio is invalid — fix it in Manage portfolio first." }, { status: 409 });
  }
  const doc = docParse.data;

  const b4 = doc.monitor_B4_daytrade ?? {
    account: "Individual Z33181037",
    live: false,
    max_trades_per_day: 2,
    watchlist: [],
  };
  const watchlist = [...(b4.watchlist ?? [])];
  const idx = watchlist.findIndex((w) => w.ticker.toUpperCase() === ticker);
  const next = {
    ...(idx >= 0 ? watchlist[idx] : {}),
    ticker,
    bull_level: parsed.data.bull_level ?? null,
    bear_level: parsed.data.bear_level ?? null,
    targets: parsed.data.targets ?? [],
    stop: parsed.data.stop ?? null,
    gaps: parsed.data.gaps ?? (idx >= 0 ? watchlist[idx].gaps : []) ?? [],
    note: parsed.data.note ?? (idx >= 0 ? watchlist[idx].note : undefined),
  };
  if (idx >= 0) watchlist[idx] = next;
  else watchlist.push(next);

  doc.monitor_B4_daytrade = { ...b4, watchlist };

  // Re-validate the whole document + run invariants (R4.1 account, go-live gate).
  const revalidate = coworkPortfolioSchema.safeParse(doc);
  if (!revalidate.success) {
    return NextResponse.json({ error: "Validation failed", issues: revalidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const invariantErrs = checkInvariants(revalidate.data);
  if (invariantErrs.length) {
    return NextResponse.json({ error: "Portfolio rules failed", issues: invariantErrs }, { status: 400 });
  }

  const { error } = await supabase
    .from("cowork_portfolio")
    .upsert({ user_id: user.id, document: revalidate.data, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, ticker, watchlist });
}
