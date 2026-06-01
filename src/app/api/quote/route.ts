import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizeSymbol } from "@/lib/yahoo";

export const runtime = "nodejs";

const RANGE_INTERVAL: Record<string, string> = {
  "1mo": "1d",
  "6mo": "1d",
  "1y": "1d",
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const raw = url.searchParams.get("symbol");
  const symbol = raw ? normalizeSymbol(raw) : undefined;
  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });
  const range = url.searchParams.get("range") ?? "1mo";
  const interval = RANGE_INTERVAL[range] ?? "1d";

  const y = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const res = await fetch(y, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" }, next: { revalidate: 300 } });
  if (!res.ok) return NextResponse.json({ error: `No data for ${symbol}` }, { status: 502 });
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const meta = r?.meta;
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q?.close) return NextResponse.json({ error: "No price data" }, { status: 502 });

  const timestamps: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (typeof q.close[i] === "number") {
      timestamps.push(r.timestamp[i]);
      closes.push(q.close[i]);
    }
  }
  const last = closes[closes.length - 1] ?? meta?.regularMarketPrice ?? null;
  const prevClose = meta?.chartPreviousClose ?? meta?.previousClose ?? closes[0] ?? null;

  return NextResponse.json({
    symbol,
    range,
    price: meta?.regularMarketPrice ?? last,
    prev_close: prevClose,
    day_high: meta?.regularMarketDayHigh ?? null,
    day_low: meta?.regularMarketDayLow ?? null,
    volume: meta?.regularMarketVolume ?? null,
    fifty_two_high: meta?.fiftyTwoWeekHigh ?? null,
    fifty_two_low: meta?.fiftyTwoWeekLow ?? null,
    currency: meta?.currency ?? "USD",
    timestamps,
    closes,
    // No reliable free feed — surfaced as unavailable, never faked.
    bid: null,
    ask: null,
    open_interest: null,
  });
}
