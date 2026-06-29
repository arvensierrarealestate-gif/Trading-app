import { NextResponse } from "next/server";
import { authorizeCowork, type CoworkAuth } from "@/lib/cowork-auth";
import { B1_TICKERS, B2_TICKERS, B3_TICKERS, EXTRA_WATCH } from "@/lib/cowork-brief";
import {
  fetchBars,
  regimeFromCloses,
  evaluateB1,
  evaluateB2,
  evaluateB3,
  evaluateOwnedOption,
  evaluateOwnedStock,
  evaluateReentry,
  evaluateScalp,
} from "@/lib/cowork-eval";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { coworkPortfolioSchema, type CoworkPortfolio } from "@/lib/cowork-portfolio";

export const runtime = "nodejs";
export const maxDuration = 30;

async function loadPortfolio(auth: CoworkAuth): Promise<CoworkPortfolio | null> {
  if (!auth.ok) return null;
  try {
    if (auth.source === "session") {
      const supabase = await createClient();
      const { data } = await supabase
        .from("cowork_portfolio")
        .select("document")
        .eq("user_id", auth.userId)
        .maybeSingle();
      if (!data?.document) return null;
      const parsed = coworkPortfolioSchema.safeParse(data.document);
      return parsed.success ? parsed.data : null;
    }
    // Token auth (cron): service-role client + COWORK_USER_ID env var.
    const userId = process.env.COWORK_USER_ID;
    if (!userId) return null;
    const admin = createAdminClient();
    const { data } = await admin
      .from("cowork_portfolio")
      .select("document")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data?.document) return null;
    const parsed = coworkPortfolioSchema.safeParse(data.document);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const auth = await authorizeCowork(req);
  if (!auth.ok) return auth.response;

  const portfolio = await loadPortfolio(auth);

  // Ticker lists — portfolio-driven with hard-coded fallback.
  const b1Tickers = portfolio?.monitor_B1_autofill?.tickers ?? Array.from(B1_TICKERS);
  const b2Tickers = portfolio?.monitor_B2_csp?.tickers ?? Array.from(B2_TICKERS);
  const b3Tickers = portfolio?.monitor_B3_leaps?.scan_order ?? Array.from(B3_TICKERS);
  const extraTickers = Array.from(EXTRA_WATCH);

  // Include underlying symbols for owned positions.
  const ownedSymbols = portfolio
    ? [
        ...portfolio.owned_options.map((o) => o.symbol),
        ...portfolio.owned_stocks.map((s) => s.symbol),
      ]
    : [];

  const universe = Array.from(
    new Set([...b1Tickers, ...b2Tickers, ...b3Tickers, ...extraTickers, ...ownedSymbols, "SPY", "^VIX"]),
  );

  const fetched = await Promise.all(universe.map((sym) => fetchBars(sym).then((b) => [sym, b] as const)));
  const barsMap = new Map(fetched);

  const spy = barsMap.get("SPY");
  if (!spy) return NextResponse.json({ error: "Could not fetch SPY market data" }, { status: 502 });

  const vixBars = barsMap.get("^VIX");
  const vix = vixBars ? vixBars.close[vixBars.close.length - 1] : null;
  const { regime, confidence } = regimeFromCloses(spy.close);
  const today = new Date().toISOString().slice(0, 10);

  // Bucket evaluation.
  const b1 = b1Tickers.map((t) => evaluateB1(t, barsMap.get(t) ?? null));
  const b2 = b2Tickers.map((t) => evaluateB2(t, barsMap.get(t) ?? null, vix));
  const b3 = b3Tickers.map((t) => evaluateB3(t, barsMap.get(t) ?? null, regime, today));

  // Owned positions (portfolio layer 1).
  const ownedOptions = portfolio
    ? portfolio.owned_options.map((o) =>
        evaluateOwnedOption(o, barsMap.get(o.symbol) ?? null, today),
      )
    : [];
  const ownedStocks = portfolio
    ? portfolio.owned_stocks.map((s) => evaluateOwnedStock(s, barsMap.get(s.symbol) ?? null))
    : [];

  // Re-entry.
  const reentry = portfolio ? portfolio.monitor_reentry.map((e) => evaluateReentry(e, today)) : [];

  // Scalp.
  const scalpTicker = portfolio?.monitor_scalp?.ticker;
  const scalp = evaluateScalp(
    portfolio?.monitor_scalp ?? null,
    portfolio?.owned_options ?? [],
    scalpTicker ? (barsMap.get(scalpTicker) ?? null) : null,
    vix,
  );

  return NextResponse.json({
    regime,
    regime_confidence: confidence,
    vix,
    has_portfolio: portfolio != null,
    owned_options: ownedOptions.map((r) => ({
      symbol: r.symbol, type: r.type, side: r.side, strike: r.strike,
      expiry: r.expiry, account: r.account, contracts: r.contracts,
      daysToExpiry: r.daysToExpiry, daysToHardExit: r.daysToHardExit,
      underlyingPrice: r.underlyingPrice, costBasis: r.costBasis,
      status: r.status, note: r.note,
    })),
    owned_stocks: ownedStocks.map((r) => ({
      symbol: r.symbol, account: r.account, shares: r.shares,
      livePrice: r.livePrice, pnlPct: r.pnlPct, stop: r.stop,
      status: r.status, note: r.note,
    })),
    reentry: reentry.map((r) => ({
      symbol: r.symbol, windowStatus: r.windowStatus,
      daysToWindowOpen: r.daysToWindowOpen, daysToWindowClose: r.daysToWindowClose,
      daysToGoNogo: r.daysToGoNogo, trigger: r.trigger, status: r.status,
    })),
    scalp: scalp ? { ticker: scalp.ticker, status: scalp.status, reason: scalp.reason } : null,
    b1: b1.map((r) => ({ ticker: r.ticker, price: r.price, flag: r.flag, pctFromHigh: r.pctFromHigh })),
    b2: b2.map((r) => ({ ticker: r.ticker, price: r.price, verdict: r.verdict, rsi: r.rsi, vixGate: r.vixGate })),
    b3: b3.map((r) => ({ ticker: r.ticker, price: r.price, verdict: r.verdict, alertRef: r.alertRef, daysToHardExit: r.daysToHardExit })),
  });
}
