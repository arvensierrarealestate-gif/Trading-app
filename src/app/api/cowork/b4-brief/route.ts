import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCowork, type CoworkAuth } from "@/lib/cowork-auth";
import { B4_WATCHLIST } from "@/lib/cowork-brief";
import { buildB4Brief } from "@/lib/b4-brief";
import { type SessionContext, type MacroEvent, type Bias, type B4Levels } from "@/lib/b4-rules";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { coworkPortfolioSchema, type CoworkPortfolio } from "@/lib/cowork-portfolio";

export const runtime = "nodejs";

// Per-symbol live observations (same shape as b4-evaluate; conservative defaults).
const obsSchema = z.object({
  symbol: z.string().min(1).max(12),
  esBias: z.enum(["bullish", "bearish", "mixed"]).default("mixed"),
  nqBias: z.enum(["bullish", "bearish", "mixed"]).default("mixed"),
  esBrokeLevel: z.boolean().default(false),
  nqBrokeLevel: z.boolean().default(false),
  instrumentBroke: z.boolean().default(false),
  volumeRoseAtBreak: z.boolean().default(false),
  aggressiveFlowFollows: z.boolean().default(false),
  hasCatalyst: z.boolean().default(false),
  spread: z.number().default(999),
  spreadType: z.enum(["option", "share"]).default("option"),
  wallFullyAbsorbed: z.boolean().default(false),
  dailyLossCapHit: z.boolean().default(false),
  tradesToday: z.number().int().default(0),
  roundTripsLast5Days: z.number().int().default(0),
  accountValue: z.number().default(0),
  contracts: z.number().int().default(1),
});

const bodySchema = z.object({
  macroEventToday: z.enum(["FOMC_DECISION", "FOMC_MINUTES", "CPI", "PCE", "NFP"]).nullable().default(null),
  releaseConfirmed: z.boolean().default(false),
  symbols: z.array(obsSchema).default([]),
});

async function loadPortfolio(auth: CoworkAuth): Promise<CoworkPortfolio | null> {
  if (!auth.ok) return null;
  try {
    let document: unknown = null;
    if (auth.source === "session") {
      const supabase = await createClient();
      const { data } = await supabase.from("cowork_portfolio").select("document").eq("user_id", auth.userId).maybeSingle();
      document = data?.document ?? null;
    } else {
      const userId = process.env.COWORK_USER_ID;
      if (!userId) return null;
      const admin = createAdminClient();
      const { data } = await admin.from("cowork_portfolio").select("document").eq("user_id", userId).maybeSingle();
      document = data?.document ?? null;
    }
    const parsed = coworkPortfolioSchema.safeParse(document ?? {});
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function etParts(now: Date): { hhmm: string; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hh = get("hour");
  if (hh === "24") hh = "00";
  const wd: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return { hhmm: `${hh}:${get("minute")}`, dow: wd[get("weekday")] ?? 0 };
}

function levelsFrom(w: { bull_level?: number | null; bear_level?: number | null; targets?: number[]; stop?: number | null }): B4Levels {
  const t = w.targets ?? [];
  return {
    bull: w.bull_level ?? 0,
    bear: w.bear_level ?? 0,
    target1: t[0] ?? 0,
    target2: t[1] ?? 0,
    target3: t[2] ?? 0,
    stopReclaim: w.stop ?? 0,
    esLevel: 0,
    nqLevel: 0,
  };
}

export async function POST(req: Request) {
  const auth = await authorizeCowork(req);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  }
  const body = parsed.data;

  const portfolio = await loadPortfolio(auth);
  const b4 = portfolio?.monitor_B4_daytrade ?? null;

  type WLItem = { ticker: string; bull_level?: number | null; bear_level?: number | null; targets?: number[]; stop?: number | null };
  const wl: WLItem[] = b4?.watchlist ?? Array.from(B4_WATCHLIST).map((s) => ({ ticker: s }));
  const obsBySymbol = new Map(body.symbols.map((s) => [s.symbol.toUpperCase(), s]));

  const { hhmm, dow } = etParts(new Date());

  const watchlist = wl.map((w) => {
    const sym = w.ticker.toUpperCase();
    const o = obsBySymbol.get(sym);
    const ctx: SessionContext = {
      nowET: new Date(),
      macroEventToday: body.macroEventToday as MacroEvent | null,
      releaseConfirmed: body.releaseConfirmed,
      esBias: (o?.esBias ?? "mixed") as Bias,
      nqBias: (o?.nqBias ?? "mixed") as Bias,
      esBrokeLevel: o?.esBrokeLevel ?? false,
      nqBrokeLevel: o?.nqBrokeLevel ?? false,
      instrumentBroke: o?.instrumentBroke ?? false,
      volumeRoseAtBreak: o?.volumeRoseAtBreak ?? false,
      aggressiveFlowFollows: o?.aggressiveFlowFollows ?? false,
      hasCatalyst: o?.hasCatalyst ?? false,
      spread: o?.spread ?? 999,
      spreadType: o?.spreadType ?? "option",
      wallFullyAbsorbed: o?.wallFullyAbsorbed ?? false,
      dailyLossCapHit: o?.dailyLossCapHit ?? false,
      tradesToday: o?.tradesToday ?? 0,
      roundTripsLast5Days: o?.roundTripsLast5Days ?? 0,
      accountValue: o?.accountValue ?? 0,
      contracts: o?.contracts ?? 1,
    };
    return {
      symbol: sym,
      levels: levelsFrom(w),
      ctx,
    };
  });

  const section = buildB4Brief({
    nowET: hhmm,
    dayOfWeek: dow,
    macroEventToday: body.macroEventToday as MacroEvent | null,
    releaseConfirmed: body.releaseConfirmed,
    live: b4?.live ?? false, // per-user flag — single truth with the UI (fix #4)
    watchlist,
  });

  return NextResponse.json(section);
}
