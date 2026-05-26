import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { scoreAggression, type TickerMetrics } from "@/lib/ticker";

export const runtime = "nodejs";

type Bars = { close: number[]; high: number[]; low: number[]; open: number[]; volume: number[] };

async function fetchBars(symbol: string): Promise<Bars | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1y&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" }, next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q?.close) return null;
  const close: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const open: number[] = [];
  const volume: number[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (typeof q.close[i] === "number" && typeof q.high[i] === "number" && typeof q.low[i] === "number") {
      close.push(q.close[i]);
      high.push(q.high[i]);
      low.push(q.low[i]);
      open.push(q.open[i] ?? q.close[i]);
      volume.push(q.volume[i] ?? 0);
    }
  }
  return close.length ? { close, high, low, open, volume } : null;
}

function returns(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < close.length; i++) out.push(close[i] / close[i - 1] - 1);
  return out;
}

function beta(rx: number[], rspy: number[]): number {
  const n = Math.min(rx.length, rspy.length);
  if (n < 30) return 1;
  const a = rx.slice(-n);
  const b = rspy.slice(-n);
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let varb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    varb += (b[i] - mb) * (b[i] - mb);
  }
  return varb ? cov / varb : 1;
}

function atrPct(bars: Bars, period = 14): number {
  const { high, low, close } = bars;
  const trs: number[] = [];
  for (let i = 1; i < close.length; i++) {
    trs.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const last = trs.slice(-period);
  const atr = last.reduce((s, v) => s + v, 0) / (last.length || 1);
  const px = close[close.length - 1] || 1;
  return (atr / px) * 100;
}

function worstDrawdown(close: number[]): number {
  let peak = close[0] ?? 0;
  let worst = 0;
  for (const px of close) {
    if (px > peak) peak = px;
    if (peak > 0) {
      const dd = (px - peak) / peak;
      if (dd < worst) worst = dd;
    }
  }
  return Math.abs(worst) * 100;
}

function gapFreq(bars: Bars, lookback = 90): number {
  const { open, close } = bars;
  let gaps = 0;
  let days = 0;
  for (let i = Math.max(1, close.length - lookback); i < close.length; i++) {
    days++;
    if (Math.abs(open[i] - close[i - 1]) / close[i - 1] > 0.01) gaps++;
  }
  return days ? gaps / days : 0;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  const forceFresh = url.searchParams.get("fresh") === "1";

  // Serve fresh cache (< 24h) to spare Yahoo on watchlist fan-out.
  const { data: cached } = forceFresh
    ? { data: null }
    : await supabase.from("ticker_cache").select("*").eq("symbol", symbol).maybeSingle();
  if (cached && Date.now() - new Date(cached.last_updated).getTime() < 24 * 3600 * 1000) {
    const atr = cached.atr_pct ?? 0;
    const metrics: TickerMetrics = {
      symbol,
      price: null,
      atr_pct: cached.atr_pct,
      beta: cached.beta,
      volume_ratio: null,
      gap_freq: null,
      worst_drawdown_pct: null,
      aggression_score: cached.aggression_score ?? 5,
      scalp_suitable: !!cached.scalp_suitable,
      swing_suitable: !!cached.swing_suitable,
      scalp_window_min: atr ? Math.max(5, Math.min(240, Math.round(120 / Math.max(atr, 0.3)))) : null,
      swing_duration_days: atr ? Math.max(2, Math.min(15, Math.round(12 / Math.max(atr, 0.5)))) : null,
      iv_rank: null,
      put_call_ratio: null,
      calls_available: false,
      puts_available: false,
      options_available: false,
    };
    return NextResponse.json({ metrics, cached: true });
  }

  const [bars, spy] = await Promise.all([fetchBars(symbol), fetchBars("SPY")]);
  if (!bars) return NextResponse.json({ error: `No price data for ${symbol}` }, { status: 502 });

  const atr = atrPct(bars);
  const b = spy ? beta(returns(bars.close), returns(spy.close)) : 1;
  const gaps = gapFreq(bars);
  const vol = bars.volume;
  const avg90 = vol.slice(-90).reduce((s, v) => s + v, 0) / Math.min(90, vol.length || 1);
  const avg10 = vol.slice(-10).reduce((s, v) => s + v, 0) / Math.min(10, vol.length || 1);
  const volRatio = avg90 ? avg10 / avg90 : 1;
  const aggression = scoreAggression(atr, b, gaps);
  const price = bars.close[bars.close.length - 1];

  const scalp_suitable = atr >= 1.2 && avg90 >= 500_000;
  const swing_suitable = atr >= 1 && atr <= 6 && Math.abs(b) < 2.5;

  const metrics: TickerMetrics = {
    symbol,
    price: Number(price.toFixed(2)),
    atr_pct: Number(atr.toFixed(2)),
    beta: Number(b.toFixed(2)),
    volume_ratio: Number(volRatio.toFixed(2)),
    gap_freq: Number(gaps.toFixed(2)),
    worst_drawdown_pct: Number(worstDrawdown(bars.close).toFixed(1)),
    aggression_score: aggression,
    scalp_suitable,
    swing_suitable,
    scalp_window_min: Math.max(5, Math.min(240, Math.round(120 / Math.max(atr, 0.3)))),
    swing_duration_days: Math.max(2, Math.min(15, Math.round(12 / Math.max(atr, 0.5)))),
    iv_rank: null,
    put_call_ratio: null,
    calls_available: false,
    puts_available: false,
    options_available: false,
  };

  await supabase.from("ticker_cache").upsert({
    symbol,
    aggression_score: aggression,
    scalp_suitable,
    swing_suitable,
    calls_suitable: null,
    puts_suitable: null,
    iv_rank: null,
    put_call_ratio: null,
    atr_pct: metrics.atr_pct,
    beta: metrics.beta,
    last_updated: new Date().toISOString(),
  });

  return NextResponse.json({ metrics, cached: false });
}
