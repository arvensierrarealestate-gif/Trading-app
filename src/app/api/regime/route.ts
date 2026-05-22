import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fitGaussianHMM } from "@/lib/hmm";
import { REGIMES, type Regime, type RegimePoint, type RegimeResponse } from "@/lib/regime";

export const runtime = "nodejs";

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=3mo&interval=1d";

type YahooChart = {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators: { quote: Array<{ close?: (number | null)[] }> };
    }>;
    error?: { description?: string } | null;
  };
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let json: YahooChart;
  try {
    const res = await fetch(YAHOO, {
      headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Yahoo Finance returned ${res.status}` }, { status: 502 });
    }
    json = (await res.json()) as YahooChart;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Price fetch failed" }, { status: 502 });
  }

  const result = json.chart?.result?.[0];
  const ts = result?.timestamp;
  const closeRaw = result?.indicators?.quote?.[0]?.close;
  if (!ts || !closeRaw) {
    return NextResponse.json({ error: "Malformed price data from Yahoo" }, { status: 502 });
  }

  // Drop holidays/gaps where close is null.
  const dates: string[] = [];
  const closes: number[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = closeRaw[i];
    if (typeof c === "number" && isFinite(c)) {
      dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
      closes.push(c);
    }
  }

  // Daily log returns in percent; date is that of the closing price.
  const returns: number[] = [];
  const retDates: string[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]) * 100);
    retDates.push(dates[i]);
  }

  if (returns.length < 20) {
    return NextResponse.json({ error: "Not enough price history to estimate regimes" }, { status: 502 });
  }

  const model = fitGaussianHMM(returns, 4, { restarts: 12, seed: 42 });

  // Label the 4 learned states by ascending mean: crash < bear < neutral < bull.
  const order = model.means
    .map((m, i) => [m, i] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .map((p) => p[1]);
  const stateToRegime: Regime[] = new Array(4);
  order.forEach((stateIdx, rank) => (stateToRegime[stateIdx] = REGIMES[rank]));

  const timeline: RegimePoint[] = returns.map((r, t) => ({
    date: retDates[t],
    regime: stateToRegime[model.states[t]],
    return: Number(r.toFixed(3)),
  }));

  const lastIdx = returns.length - 1;
  const lastState = model.states[lastIdx];
  const confidence = model.posteriors[lastIdx]?.[lastState] ?? 0;

  const means = {} as Record<Regime, number>;
  for (let s = 0; s < 4; s++) means[stateToRegime[s]] = Number(model.means[s].toFixed(3));

  const payload: RegimeResponse = {
    symbol: "SPY",
    asOf: retDates[lastIdx],
    current: { regime: stateToRegime[lastState], confidence: Number(confidence.toFixed(4)) },
    timeline,
    means,
  };
  return NextResponse.json(payload);
}
