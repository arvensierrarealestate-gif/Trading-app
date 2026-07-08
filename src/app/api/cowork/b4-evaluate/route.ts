import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeCowork, type CoworkAuth } from "@/lib/cowork-auth";
import {
  evaluateGates,
  canOpenTrade,
  exitPlan,
  shouldStopOut,
  retestSignal,
  GO_LIVE,
  type SessionContext,
  type MacroEvent,
  type Bias,
} from "@/lib/b4-rules";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { coworkPortfolioSchema } from "@/lib/cowork-portfolio";

export const runtime = "nodejs";

// Per-user B4 live flag — the single truth shared with the UI. Falls back to
// the static go-live gate when there's no portfolio.
async function isLive(auth: CoworkAuth): Promise<boolean> {
  if (!auth.ok) return false;
  try {
    let document: unknown = null;
    if (auth.source === "session") {
      const supabase = await createClient();
      const { data } = await supabase.from("cowork_portfolio").select("document").eq("user_id", auth.userId).maybeSingle();
      document = data?.document ?? null;
    } else {
      const userId = process.env.COWORK_USER_ID;
      if (userId) {
        const admin = createAdminClient();
        const { data } = await admin.from("cowork_portfolio").select("document").eq("user_id", userId).maybeSingle();
        document = data?.document ?? null;
      }
    }
    const parsed = coworkPortfolioSchema.safeParse(document ?? {});
    if (parsed.success && parsed.data.monitor_B4_daytrade) return !!parsed.data.monitor_B4_daytrade.live;
    return GO_LIVE.isReady();
  } catch {
    return GO_LIVE.isReady();
  }
}

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
  const live = await isLive(auth);

  // A FAIL blocks; a PENDING (no catalyst = higher bar, not a veto) is allowed
  // but surfaced. setup_ok = the setup itself is valid (useful for paper /
  // practice). clear_to_enter also requires B4 to be live.
  const blocking = gates.results.find((r) => r.status === "fail");
  const pending = gates.results.filter((r) => r.status === "pending");
  const setupOk = open.ok && !blocking;
  const clearToEnter = setupOk && live;

  const reason = !open.ok
    ? open.reason
    : blocking
    ? `Blocked at ${blocking.code} — ${blocking.reason}`
    : !live
    ? "Setup valid, but B4 is NOT live — go-live decisions still open"
    : pending.length
    ? `Cleared — confirm manually: ${pending.map((p) => p.code).join(", ")}`
    : "All gates green — cleared to place the order manually";

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
    live,
    setup_ok: setupOk,          // gate + guard quality (pending allowed) — paper-safe
    clear_to_enter: clearToEnter, // setup_ok AND B4 live
    reason,
    exit_plan: plan,
    stop,
    retest,
    auto_trade: false,          // informational — never places an order
  });
}
