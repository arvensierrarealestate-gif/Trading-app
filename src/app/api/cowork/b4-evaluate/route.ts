import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCowork } from "@/lib/cowork-auth";
import {
  evaluateGates,
  canOpenTrade,
  exitPlan,
  shouldStopOut,
  retestSignal,
  type SessionContext,
  type MacroEvent,
  type Bias,
} from "@/lib/b4-rules";

export const runtime = "nodejs";

// Runs the canonical B4 engine (src/lib/b4-rules.ts) against observations the
// caller supplies — the skill/agent collects them (Bookmap wall, futures
// breaks, spread, contracts) and POSTs them here for an authoritative verdict.
// Missing fields default to the CONSERVATIVE value so a gate never passes on
// an unstated assumption.

const biasSchema = z.enum(["bullish", "bearish", "mixed"]).default("mixed");
const macroSchema = z.enum(["FOMC_DECISION", "FOMC_MINUTES", "CPI", "PCE", "NFP"]).nullable().default(null);

const bodySchema = z.object({
  macroEventToday: macroSchema,
  releaseConfirmed: z.boolean().default(false),
  esBias: biasSchema,
  nqBias: biasSchema,
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
  // Optional — enable the stop / retest reads when a position is open.
  entryLevel: z.number().optional(),
  currentPrice: z.number().optional(),
  direction: z.enum(["long", "short"]).optional(),
  brokeLevel: z.number().optional(),
  retestPrice: z.number().optional(),
  retestRejected: z.boolean().optional(),
});

function etHHMM(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  let hh = get("hour");
  if (hh === "24") hh = "00";
  return `${hh}:${get("minute")}`;
}

export async function POST(req: Request) {
  const auth = await authorizeCowork(req);
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  }
  const b = parsed.data;

  const now = new Date();
  const hhmm = etHHMM(now);

  const ctx: SessionContext = {
    nowET: now,
    macroEventToday: b.macroEventToday as MacroEvent | null,
    releaseConfirmed: b.releaseConfirmed,
    esBias: b.esBias as Bias,
    nqBias: b.nqBias as Bias,
    esBrokeLevel: b.esBrokeLevel,
    nqBrokeLevel: b.nqBrokeLevel,
    instrumentBroke: b.instrumentBroke,
    volumeRoseAtBreak: b.volumeRoseAtBreak,
    aggressiveFlowFollows: b.aggressiveFlowFollows,
    hasCatalyst: b.hasCatalyst,
    spread: b.spread,
    spreadType: b.spreadType,
    wallFullyAbsorbed: b.wallFullyAbsorbed,
    dailyLossCapHit: b.dailyLossCapHit,
    tradesToday: b.tradesToday,
    roundTripsLast5Days: b.roundTripsLast5Days,
    accountValue: b.accountValue,
    contracts: b.contracts,
  };

  const gates = evaluateGates(ctx, hhmm);
  const open = canOpenTrade(ctx, hhmm);
  const plan = exitPlan(ctx.contracts, ctx.macroEventToday);

  // A trade is clear ONLY when the account allows opening AND every gate passes.
  const clearToEnter = open.ok && gates.allPass;

  const stop =
    b.entryLevel != null && b.currentPrice != null && b.direction
      ? shouldStopOut({ dailyLossCapHit: b.dailyLossCapHit, entryLevel: b.entryLevel, currentPrice: b.currentPrice, direction: b.direction })
      : null;

  const retest =
    b.brokeLevel != null && b.retestPrice != null && b.direction
      ? retestSignal({ brokeLevel: b.brokeLevel, retestPrice: b.retestPrice, retestRejected: b.retestRejected ?? false, direction: b.direction })
      : null;

  return NextResponse.json({
    et_time: hhmm,
    bias: gates.bias,
    gates: gates.results,
    all_gates_pass: gates.allPass,
    can_open: open,
    clear_to_enter: clearToEnter,
    exit_plan: plan,
    stop,
    retest,
  });
}
