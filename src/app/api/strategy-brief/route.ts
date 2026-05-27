import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Bars = { close: number[]; volume: number[] };

async function fetchSpy(): Promise<Bars | null> {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=1y&interval=1d";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" }, next: { revalidate: 1800 } });
  if (!res.ok) return null;
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q?.close) return null;
  const close: number[] = [];
  const volume: number[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (typeof q.close[i] === "number") {
      close.push(q.close[i]);
      volume.push(q.volume[i] ?? 0);
    }
  }
  return close.length ? { close, volume } : null;
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

// True if 20-EMA crossed above 50-EMA within the last `windowDays` bars.
function recentCrossover(close: number[], windowDays = 5): boolean {
  if (close.length < 50 + windowDays) return false;
  let prevAbove = false;
  for (let i = close.length - windowDays - 1; i < close.length; i++) {
    const slice = close.slice(0, i + 1);
    const e20 = ema(slice, 20);
    const e50 = ema(slice, 50);
    const above = e20 > e50;
    if (i > close.length - windowDays - 1 && above && !prevAbove) return true;
    prevAbove = above;
  }
  return false;
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bars = await fetchSpy();
  if (!bars) return NextResponse.json({ error: "No SPY data" }, { status: 502 });

  const close = bars.close;
  const last = close[close.length - 1];
  // ~40 trading days = roughly 8 weeks
  const recentLow = Math.min(...close.slice(-40));
  const pct_above_low = ((last - recentLow) / recentLow) * 100;

  const e20 = ema(close, 20);
  const e50 = ema(close, 50);
  const cross_recent = recentCrossover(close, 5);

  const vol = bars.volume;
  const avg20 = vol.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, vol.length || 1);
  const lastVol = vol[vol.length - 1] || 0;
  const volume_ratio = avg20 ? lastVol / avg20 : 1;

  return NextResponse.json({
    last_close: Number(last.toFixed(2)),
    leaps: {
      recent_low: Number(recentLow.toFixed(2)),
      pct_above_low: Number(pct_above_low.toFixed(2)),
      at_support: pct_above_low <= 3,
    },
    momentum: {
      ema20: Number(e20.toFixed(2)),
      ema50: Number(e50.toFixed(2)),
      crossover_recent: cross_recent,
      ema20_above_ema50: e20 > e50,
      volume_ratio: Number(volume_ratio.toFixed(2)),
      volume_high: volume_ratio >= 1.2,
    },
    premium_selling: {
      iv_rank_available: false,
      note: "IV rank requires an options data provider (Polygon or Tradier). Add provider keys to enable this brief.",
    },
  });
}
