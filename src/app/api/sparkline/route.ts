import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const symbol = new URL(req.url).searchParams.get("symbol")?.trim().toUpperCase();
  if (!symbol) return NextResponse.json({ error: "Symbol required" }, { status: 400 });

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" }, next: { revalidate: 600 } });
  if (!res.ok) return NextResponse.json({ error: `No bars for ${symbol}` }, { status: 502 });
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const closes: number[] = (r?.indicators?.quote?.[0]?.close ?? []).filter((v: unknown): v is number => typeof v === "number");
  if (!closes.length) return NextResponse.json({ error: "No data" }, { status: 502 });
  const change_pct = closes.length >= 2 ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100 : 0;
  return NextResponse.json({ symbol, closes, change_pct: Number(change_pct.toFixed(2)) });
}
