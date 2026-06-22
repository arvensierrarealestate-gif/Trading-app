import { NextResponse } from "next/server";
import { authorizeCowork } from "@/lib/cowork-auth";

export const runtime = "nodejs";

type Range = "1w" | "1m" | "3m" | "6m" | "1y";
type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };

const RANGE_TO_YAHOO: Record<Range, { range: string; interval: string }> = {
  "1w": { range: "5d", interval: "1d" },
  "1m": { range: "1mo", interval: "1d" },
  "3m": { range: "3mo", interval: "1d" },
  "6m": { range: "6mo", interval: "1d" },
  "1y": { range: "1y", interval: "1d" },
};

async function fetchYahoo(symbol: string, range: string, interval: string): Promise<Candle[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" } });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
  const j = (await res.json()) as {
    chart: { result?: Array<{ timestamp?: number[]; indicators: { quote: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> } }> };
  };
  const r = j.chart.result?.[0];
  const q = r?.indicators.quote[0];
  if (!r?.timestamp || !q?.close) return [];
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (typeof o === "number" && typeof h === "number" && typeof l === "number" && typeof c === "number" && Number.isFinite(c)) {
      out.push({
        date: new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10),
        open: o, high: h, low: l, close: c,
        volume: q.volume?.[i] ?? 0,
      });
    }
  }
  return out;
}

function pctChange(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - lookback];
  if (!then) return null;
  return ((now - then) / then) * 100;
}

export async function GET(req: Request) {
  const auth = await authorizeCowork(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol")?.toUpperCase();
  const range = (url.searchParams.get("range") ?? "3m") as Range;
  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  if (!RANGE_TO_YAHOO[range]) return NextResponse.json({ error: "Invalid range" }, { status: 400 });

  try {
    // Always fetch 1y so we can compute every growth period from a single call,
    // then slice to the requested window for the candle chart.
    const fullYear = await fetchYahoo(symbol, "1y", "1d");
    if (!fullYear.length) return NextResponse.json({ error: `No bars for ${symbol}` }, { status: 502 });

    const closes = fullYear.map((c) => c.close);
    const growth = {
      "1d": pctChange(closes, 1),
      "1w": pctChange(closes, 5),
      "1m": pctChange(closes, 21),
      "3m": pctChange(closes, 63),
      "6m": pctChange(closes, 126),
      "1y": closes.length > 1 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : null,
    };

    // Slice to the requested range.
    const lookbackBars: Record<Range, number> = { "1w": 5, "1m": 21, "3m": 63, "6m": 126, "1y": fullYear.length };
    const candles = fullYear.slice(-lookbackBars[range]);

    return NextResponse.json({ symbol, range, candles, growth });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Fetch failed" }, { status: 502 });
  }
}
