import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeSymbol } from "@/lib/yahoo";

export const runtime = "nodejs";

const INTERVALS: Record<string, { range: string; interval: string }> = {
  "5m": { range: "5d", interval: "5m" },
  "15m": { range: "1mo", interval: "15m" },
  "1h": { range: "3mo", interval: "1h" },
};

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const out: number[] = [values[0]];
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out.push(e);
  }
  return out;
}

function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  let avgG = gains / period;
  let avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(0, ch)) / period;
    avgL = (avgL * (period - 1) + Math.max(0, -ch)) / period;
  }
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function atr(high: number[], low: number[], close: number[], period = 14): number {
  if (close.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < close.length; i++) {
    trs.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  const slice = trs.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / (slice.length || 1);
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const raw = url.searchParams.get("symbol");
  if (!raw) return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  const symbol = normalizeSymbol(raw);
  const intervalKey = url.searchParams.get("interval") ?? "15m";
  const cfg = INTERVALS[intervalKey];
  if (!cfg) return NextResponse.json({ error: "Invalid interval" }, { status: 400 });

  const y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${cfg.range}&interval=${cfg.interval}`;
  const r = await fetch(y, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" }, next: { revalidate: 60 } });
  if (!r.ok) return NextResponse.json({ error: `No data for ${symbol}` }, { status: 502 });
  const json = await r.json();
  const result = json?.chart?.result?.[0];
  const q = result?.indicators?.quote?.[0];
  if (!result?.timestamp || !q?.close) return NextResponse.json({ error: "No price data" }, { status: 502 });

  const close: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  const volume: number[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    if (typeof q.close[i] === "number" && typeof q.high[i] === "number" && typeof q.low[i] === "number") {
      close.push(q.close[i]);
      high.push(q.high[i]);
      low.push(q.low[i]);
      volume.push(q.volume[i] ?? 0);
    }
  }
  if (close.length < 50) return NextResponse.json({ error: "Not enough bars yet" }, { status: 502 });

  const ema20 = ema(close, 20);
  const ema50 = ema(close, 50);
  const e20Last = ema20[ema20.length - 1];
  const e50Last = ema50[ema50.length - 1];
  const e20Prev = ema20[ema20.length - 2];
  const e50Prev = ema50[ema50.length - 2];
  const rsiVal = rsi(close, 14);
  const atrVal = atr(high, low, close, 14);
  const lastClose = close[close.length - 1];

  const avgVol20 = volume.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volume.length || 1);
  const lastVol = volume[volume.length - 1] || 0;
  const volRatio = avgVol20 ? lastVol / avgVol20 : 1;

  const crossedUp = e20Prev <= e50Prev && e20Last > e50Last;
  const above = e20Last > e50Last;
  const rsiHealthy = rsiVal >= 50 && rsiVal <= 70;
  const volStrong = volRatio >= 1.2;

  const reasons: string[] = [];
  if (crossedUp) reasons.push("20-EMA just crossed above 50-EMA (fresh momentum)");
  else if (above) reasons.push(`20-EMA is ${(((e20Last - e50Last) / e50Last) * 100).toFixed(2)}% above 50-EMA`);
  else reasons.push("20-EMA below 50-EMA — trend not aligned for a long");
  reasons.push(`RSI ${rsiVal.toFixed(0)}${rsiHealthy ? " (in momentum band)" : rsiVal > 70 ? " (overbought)" : " (weak)"}`);
  reasons.push(`Volume ${volRatio.toFixed(2)}× 20-bar average${volStrong ? " (confirming)" : " (light)"}`);

  const buy = above && rsiHealthy && volStrong;
  const stop = Math.max(0.01, lastClose - 1.5 * atrVal);
  const target = lastClose + (lastClose - stop) * 2; // 1:2 default

  return NextResponse.json({
    symbol,
    interval: intervalKey,
    direction: buy ? "BUY" : "WAIT",
    last_close: Number(lastClose.toFixed(2)),
    entry: Number(lastClose.toFixed(2)),
    stop: Number(stop.toFixed(2)),
    target: Number(target.toFixed(2)),
    atr_pct: Number(((atrVal / lastClose) * 100).toFixed(2)),
    rsi: Number(rsiVal.toFixed(1)),
    ema20: Number(e20Last.toFixed(2)),
    ema50: Number(e50Last.toFixed(2)),
    volume_ratio: Number(volRatio.toFixed(2)),
    cross_recent: crossedUp,
    reasons,
  });
}
