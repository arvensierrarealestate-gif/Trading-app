import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { alpacaGet } from "@/lib/alpaca";

export const runtime = "nodejs";

type Range = "LIVE" | "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";

const PARAMS: Record<Range, { period: string; timeframe: string; extended?: boolean }> = {
  LIVE: { period: "1D", timeframe: "1Min", extended: true },
  "1D": { period: "1D", timeframe: "5Min" },
  "1W": { period: "1W", timeframe: "1H" },
  "1M": { period: "1M", timeframe: "1D" },
  "3M": { period: "3M", timeframe: "1D" },
  YTD: { period: "ytd", timeframe: "1D" },
  "1Y": { period: "1A", timeframe: "1D" },
  ALL: { period: "5A", timeframe: "1D" },
};

type AlpacaHistory = {
  timestamp: number[];
  equity: (number | null)[];
  profit_loss: (number | null)[];
  profit_loss_pct: (number | null)[];
  base_value: number;
  timeframe: string;
};

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const range = (new URL(req.url).searchParams.get("range") as Range | null) ?? "1D";
  const cfg = PARAMS[range] ?? PARAMS["1D"];
  const qs = new URLSearchParams({ period: cfg.period, timeframe: cfg.timeframe });
  if (cfg.extended) qs.set("extended_hours", "true");

  try {
    const history = await alpacaGet<AlpacaHistory>(`/account/portfolio/history?${qs.toString()}`);
    return NextResponse.json({ range, history });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Alpaca request failed" }, { status: 502 });
  }
}
