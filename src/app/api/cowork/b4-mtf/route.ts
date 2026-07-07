import { NextResponse } from "next/server";
import { authorizeCowork, type CoworkAuth } from "@/lib/cowork-auth";
import { B4_WATCHLIST } from "@/lib/cowork-brief";
import {
  fetchBars,
  evaluateB4Mtf,
  B4_TIMEFRAMES,
  B4_TF_RANGE,
  type Bars,
  type B4Timeframe,
} from "@/lib/cowork-eval";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { coworkPortfolioSchema } from "@/lib/cowork-portfolio";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_TICKERS = 8; // cap parallel intraday fetches to avoid Yahoo rate limits

async function watchlistFor(auth: CoworkAuth): Promise<string[]> {
  if (!auth.ok) return Array.from(B4_WATCHLIST);
  try {
    let document: unknown = null;
    if (auth.source === "session") {
      const supabase = await createClient();
      const { data } = await supabase.from("cowork_portfolio").select("document").eq("user_id", auth.userId).maybeSingle();
      document = data?.document ?? null;
    } else {
      const userId = process.env.COWORK_USER_ID;
      if (userId) {
        const admin = createAdminClient();
        const { data } = await admin.from("cowork_portfolio").select("document").eq("user_id", userId).maybeSingle();
        document = data?.document ?? null;
      }
    }
    const parsed = coworkPortfolioSchema.safeParse(document ?? {});
    const list = parsed.success ? parsed.data.monitor_B4_daytrade?.watchlist?.map((w) => w.ticker) : null;
    return list && list.length ? list : Array.from(B4_WATCHLIST);
  } catch {
    return Array.from(B4_WATCHLIST);
  }
}

export async function GET(req: Request) {
  const auth = await authorizeCowork(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const only = url.searchParams.get("symbol");
  let tickers = only ? [only.toUpperCase()] : await watchlistFor(auth);
  tickers = Array.from(new Set(tickers)).slice(0, MAX_TICKERS);

  // Flat fetch list: one task per (ticker, timeframe), all in parallel.
  const tasks = tickers.flatMap((t) =>
    B4_TIMEFRAMES.map((tf) => fetchBars(t, B4_TF_RANGE[tf], tf).then((b) => ({ ticker: t, tf, bars: b }))),
  );
  const fetched = await Promise.all(tasks);

  const byTicker = new Map<string, Partial<Record<B4Timeframe, Bars | null>>>();
  for (const t of tickers) byTicker.set(t, {});
  for (const f of fetched) byTicker.get(f.ticker)![f.tf] = f.bars;

  const rows = tickers.map((t) => evaluateB4Mtf(t, byTicker.get(t)!));

  return NextResponse.json({ as_of: new Date().toISOString(), rows });
}
