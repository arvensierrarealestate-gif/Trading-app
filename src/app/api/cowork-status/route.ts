import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { B1_TICKERS, B2_TICKERS, B3_TICKERS, EXTRA_WATCH } from "@/lib/cowork-brief";
import { fetchBars, regimeFromCloses, evaluateB1, evaluateB2, evaluateB3 } from "@/lib/cowork-eval";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const universe = Array.from(new Set([...B1_TICKERS, ...B2_TICKERS, ...B3_TICKERS, ...EXTRA_WATCH, "SPY", "^VIX"]));

  const fetched = await Promise.all(universe.map((sym) => fetchBars(sym).then((b) => [sym, b] as const)));
  const barsMap = new Map(fetched);

  const spy = barsMap.get("SPY");
  if (!spy) return NextResponse.json({ error: "Could not fetch SPY market data" }, { status: 502 });

  const vixBars = barsMap.get("^VIX");
  const vix = vixBars?.close[vixBars.close.length - 1] ?? null;
  const { regime, confidence } = regimeFromCloses(spy.close);
  const today = new Date().toISOString().slice(0, 10);

  const b1 = Array.from(B1_TICKERS).map((t) => evaluateB1(t, barsMap.get(t) ?? null));
  const b2 = Array.from(B2_TICKERS).map((t) => evaluateB2(t, barsMap.get(t) ?? null, vix));
  const b3 = Array.from(B3_TICKERS).map((t) => evaluateB3(t, barsMap.get(t) ?? null, regime, today));

  return NextResponse.json({
    regime,
    regime_confidence: confidence,
    vix,
    b1: b1.map((r) => ({ ticker: r.ticker, price: r.price, flag: r.flag, pctFromHigh: r.pctFromHigh })),
    b2: b2.map((r) => ({ ticker: r.ticker, price: r.price, verdict: r.verdict, rsi: r.rsi, vixGate: r.vixGate })),
    b3: b3.map((r) => ({ ticker: r.ticker, price: r.price, verdict: r.verdict, alertRef: r.alertRef, daysToHardExit: r.daysToHardExit })),
  });
}
