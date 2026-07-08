/**
 * b4-rules.ts
 * ---------------------------------------------------------------------------
 * B4 Day-Trade bucket — encoded ruleset (MasiTrades framework + FOMC/Bookmap refinements)
 * Single source of truth for the Cowork agent + TradeReady UI.
 *
 * Account: Individual Z33181037 only. Ring-fenced from B1/B2/B3.
 * Status: NOT live until the four go-live decisions are locked (see GO_LIVE).
 *
 * Encoded: 2026-07-08
 * ---------------------------------------------------------------------------
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type GateStatus = "pass" | "fail" | "pending" | "na";
export type Bias = "bullish" | "bearish" | "mixed";
export type MacroEvent = "FOMC_DECISION" | "FOMC_MINUTES" | "CPI" | "PCE" | "NFP";

export interface Gate {
  code: string;
  name: string;
  order: number;
  manual: boolean;        // true = requires human confirmation, not an auto signal
  description: string;
}

export interface B4Levels {
  bull: number;           // bullish trigger level (rounded to 5/10)
  bear: number;           // bearish trigger level (rounded to 5/10)
  target1: number;
  target2: number;
  target3: number;
  stopReclaim: number;    // level-reclaim structure stop
  esLevel: number;        // ES futures level that must break in confluence
  nqLevel: number;        // NQ futures level that must break in confluence
}

export interface SessionContext {
  nowET: Date;
  macroEventToday: MacroEvent | null;
  releaseConfirmed: boolean;      // event released AND price picked a side and held
  esBias: Bias;                   // from VWAP + 9EMA
  nqBias: Bias;
  esBrokeLevel: boolean;          // ES broke its mapped level
  nqBrokeLevel: boolean;          // NQ broke its mapped level
  instrumentBroke: boolean;       // primary instrument broke its level (close-confirmed)
  volumeRoseAtBreak: boolean;
  aggressiveFlowFollows: boolean; // order flow followed in the break direction
  hasCatalyst: boolean;
  spread: number;
  spreadType: "option" | "share";
  wallFullyAbsorbed: boolean;
  dailyLossCapHit: boolean;
  tradesToday: number;
  roundTripsLast5Days: number;
  accountValue: number;
  contracts: number;
}

// ── Constants ─────────────────────────────────────────────────────────────

export const B4_ACCOUNT = "Z33181037";
export const MARKET_OPEN_ET = "10:00";       // R4.G1 / HR.1
export const DEAD_ZONE = { start: "11:30", end: "13:30" }; // HR.2
export const HARD_CLOSE_ET = "15:45";        // HR.3
export const ENTRY_WINDOWS = [
  { start: "10:00", end: "11:30" },
  { start: "13:30", end: "15:30" },
];
export const MAX_TRADES_PER_DAY = 2;         // R4.4
export const PDT_LIMIT = 3;                  // R4.5 (per 5 rolling days)
export const PDT_EXEMPT_ABOVE = 25_000;      // R4.5
export const MIN_CONTRACTS_TO_SCALE = 7;     // R4.9
export const LIQUIDITY_MAX = { option: 0.20, share: 0.10 }; // R4.G6

export const SCALE_RATIOS = {
  normal: [0.70, 0.20, 0.10] as const,       // 70/20/10
  event: [0.80, 0.10, 0.10] as const,        // 80/10/10 — reversals come faster
};

// ── Gate stack (ordered; G0 checked first) ──────────────────────────────────

export const GATES: Gate[] = [
  {
    code: "R4.G0", name: "Event lock", order: 0, manual: true,
    description:
      "On FOMC/CPI/PCE/NFP days: no entry until after the release AND price confirms direction. " +
      "FOMC = two events (2PM release + 2:30 Powell). Checked before all other gates.",
  },
  {
    code: "R4.G1", name: "10 AM rule", order: 1, manual: false,
    description: "No entries before 10:00 AM ET. Hard.",
  },
  {
    code: "R4.G2", name: "Futures confluence", order: 2, manual: false,
    description:
      "ES AND NQ must BREAK their own mapped S/R levels in confluence with the instrument level — " +
      "not just sit on one side of VWAP.",
  },
  {
    code: "R4.G3", name: "Key level break", order: 3, manual: false,
    description: "Price must BREAK a pre-mapped S/R level (break + close), not approach it.",
  },
  {
    code: "R4.G4", name: "Volume + fake-breakout filter", order: 4, manual: false,
    description:
      "Volume rises at the break AND aggressive order flow follows in the break direction. " +
      "No follow-through = fake, even on decent volume → skip.",
  },
  {
    code: "R4.G5", name: "Catalyst check", order: 5, manual: true,
    description: "News strengthens the setup; no catalyst = higher bar. Never enter on catalyst alone.",
  },
  {
    code: "R4.G6", name: "Liquidity check", order: 6, manual: false,
    description: "Options spread ≤ $0.20 · shares ≤ $0.10. Wide = no trade.",
  },
  {
    code: "R4.G7", name: "Wait for absorption", order: 7, manual: true,
    description:
      "Wait for the defending wall to be COMPLETELY absorbed before entry. " +
      "Trigger = wall gone, not wall present.",
  },
  {
    code: "R4.G8", name: "Daily loss cap", order: 8, manual: false,
    description: "Confirm cap not hit before entering. If hit → no entry.",
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────

/** Round to nearest 5 or 10 — never trade exact pennies (charting rounding rule). */
export function roundToZone(price: number, step: 5 | 10 = 5): number {
  return Math.round(price / step) * step;
}

/** Directional bias from the two futures. Both aligned = that bias; else mixed. */
export function futuresBias(es: Bias, nq: Bias): Bias {
  if (es === nq) return es;
  return "mixed";
}

/** Which scale-out ratio applies today. */
export function scaleRatio(macroEventToday: MacroEvent | null) {
  return macroEventToday ? SCALE_RATIOS.event : SCALE_RATIOS.normal;
}

/** True if now (ET "HH:MM") falls inside an entry window and outside the dead zone. */
export function inEntryWindow(hhmm: string): boolean {
  const t = (s: string) => Number(s.replace(":", ""));
  const now = t(hhmm);
  if (now >= t(DEAD_ZONE.start) && now < t(DEAD_ZONE.end)) return false;
  return ENTRY_WINDOWS.some((w) => now >= t(w.start) && now <= t(w.end));
}

// ── Gate evaluation ─────────────────────────────────────────────────────────

export interface GateResult {
  code: string;
  name: string;
  status: GateStatus;
  reason: string;
}

/**
 * Evaluate the full stack in order. Returns every gate's result so the UI can
 * render the whole checklist; `allPass` is true only when every non-NA gate passes.
 */
export function evaluateGates(ctx: SessionContext, hhmmET: string): {
  results: GateResult[];
  allPass: boolean;
  bias: Bias;
} {
  const bias = futuresBias(ctx.esBias, ctx.nqBias);
  const results: GateResult[] = [];

  // R4.G0 — Event lock (above everything)
  if (ctx.macroEventToday) {
    results.push({
      code: "R4.G0", name: "Event lock",
      status: ctx.releaseConfirmed ? "pass" : "fail",
      reason: ctx.releaseConfirmed
        ? `${ctx.macroEventToday} released and price confirmed`
        : `${ctx.macroEventToday} today — wait for release + price confirmation`,
    });
  } else {
    results.push({ code: "R4.G0", name: "Event lock", status: "na", reason: "No macro event today" });
  }

  // R4.G1 — 10 AM rule
  results.push({
    code: "R4.G1", name: "10 AM rule",
    status: hhmmET >= MARKET_OPEN_ET ? "pass" : "fail",
    reason: hhmmET >= MARKET_OPEN_ET ? "After 10:00 AM ET" : "Before 10:00 AM — no entries",
  });

  // R4.G2 — Futures confluence (break own levels, in confluence with instrument)
  const confluence = ctx.esBrokeLevel && ctx.nqBrokeLevel && ctx.instrumentBroke && bias !== "mixed";
  results.push({
    code: "R4.G2", name: "Futures confluence",
    status: confluence ? "pass" : "fail",
    reason: bias === "mixed"
      ? "ES/NQ bias mixed — skip"
      : confluence ? "ES + NQ + instrument all broke their levels" : "Not all three levels broke",
  });

  // R4.G3 — Key level break
  results.push({
    code: "R4.G3", name: "Key level break",
    status: ctx.instrumentBroke ? "pass" : "fail",
    reason: ctx.instrumentBroke ? "Level broke + closed through" : "Level not broken",
  });

  // R4.G4 — Volume + fake-breakout filter
  const realBreak = ctx.volumeRoseAtBreak && ctx.aggressiveFlowFollows;
  results.push({
    code: "R4.G4", name: "Volume + fake-breakout filter",
    status: realBreak ? "pass" : "fail",
    reason: !ctx.volumeRoseAtBreak
      ? "No volume rise at break"
      : !ctx.aggressiveFlowFollows ? "No aggressive follow-through — fake break" : "Volume + flow confirm",
  });

  // R4.G5 — Catalyst check (manual, soft — informational)
  results.push({
    code: "R4.G5", name: "Catalyst check",
    status: ctx.hasCatalyst ? "pass" : "pending",
    reason: ctx.hasCatalyst ? "Catalyst present" : "No catalyst — higher bar, confirm manually",
  });

  // R4.G6 — Liquidity
  const maxSpread = LIQUIDITY_MAX[ctx.spreadType];
  results.push({
    code: "R4.G6", name: "Liquidity check",
    status: ctx.spread <= maxSpread ? "pass" : "fail",
    reason: `Spread ${ctx.spread.toFixed(2)} vs max ${maxSpread.toFixed(2)}`,
  });

  // R4.G7 — Wait for absorption
  results.push({
    code: "R4.G7", name: "Wait for absorption",
    status: ctx.wallFullyAbsorbed ? "pass" : "fail",
    reason: ctx.wallFullyAbsorbed ? "Defending wall fully absorbed" : "Wall still present — do not front-run",
  });

  // R4.G8 — Daily loss cap
  results.push({
    code: "R4.G8", name: "Daily loss cap",
    status: ctx.dailyLossCapHit ? "fail" : "pass",
    reason: ctx.dailyLossCapHit ? "Loss cap hit — session over" : "Cap not hit",
  });

  const allPass = results.every((r) => r.status === "pass" || r.status === "na");
  return { results, allPass, bias };
}

// ── Trade-management guards (R4.4, R4.5, R4.9, R4.10, stops) ──────────────────

export function canOpenTrade(ctx: SessionContext, hhmmET: string): { ok: boolean; reason: string } {
  if (!inEntryWindow(hhmmET)) return { ok: false, reason: "Outside entry window / in dead zone" };
  if (ctx.tradesToday >= MAX_TRADES_PER_DAY) return { ok: false, reason: "Max 2 trades/day reached (R4.4)" };
  if (ctx.accountValue < PDT_EXEMPT_ABOVE && ctx.roundTripsLast5Days >= PDT_LIMIT) {
    return { ok: false, reason: "PDT limit — 3 round trips / 5 days under $25K (R4.5)" };
  }
  return { ok: true, reason: "Clear to open if gates pass" };
}

/** R4.9 — below 7 contracts, do not scale; exit 100% at Target 1. */
export function exitPlan(contracts: number, macroEventToday: MacroEvent | null): {
  scaling: boolean;
  legs: { pct: number; target: 1 | 2 | 3 }[];
  note: string;
} {
  if (contracts < MIN_CONTRACTS_TO_SCALE) {
    return { scaling: false, legs: [{ pct: 1.0, target: 1 }], note: "R4.9: <7 contracts — exit 100% at T1" };
  }
  const [a, b, c] = scaleRatio(macroEventToday);
  return {
    scaling: true,
    legs: [{ pct: a, target: 1 }, { pct: b, target: 2 }, { pct: c, target: 3 }],
    note: macroEventToday ? "Event-day 80/10/10" : "Normal 70/20/10",
  };
}

/** Paired stop check — exit if either the dollar cap or the level-reclaim triggers. */
export function shouldStopOut(args: {
  dailyLossCapHit: boolean;
  entryLevel: number;
  currentPrice: number;
  direction: "long" | "short";
}): { stop: boolean; reason: string } {
  if (args.dailyLossCapHit) return { stop: true, reason: "Daily dollar loss cap hit (R4.2)" };
  const reclaimed =
    args.direction === "short" ? args.currentPrice > args.entryLevel : args.currentPrice < args.entryLevel;
  if (reclaimed) return { stop: true, reason: "Level-reclaim structure stop — broken level reclaimed" };
  return { stop: false, reason: "Holding" };
}

/**
 * R4.10 — pullback retest read after a break.
 * "add"      → retest failed (level defended), valid second entry/add
 * "exit"     → retest reclaimed the level, break is failing
 * "hold"     → no clean retest yet
 */
export function retestSignal(args: {
  brokeLevel: number;
  retestPrice: number;
  retestRejected: boolean;   // wall defended and price rejected
  direction: "long" | "short";
}): "add" | "exit" | "hold" {
  const reclaimed =
    args.direction === "short" ? args.retestPrice > args.brokeLevel : args.retestPrice < args.brokeLevel;
  if (reclaimed) return "exit";
  if (args.retestRejected) return "add";
  return "hold";
}

// ── Go-live gate (still open) ────────────────────────────────────────────────

export const GO_LIVE = {
  live: false,
  decisions: {
    dailyLossCapUSD: null as number | null,   // (1)
    orderFlowTool: null as "bookmap" | "fidelity_atp" | "volume_proxy" | null, // (2)
    launchInstrument: null as "spx_0dte" | "single_stock" | null, // (3)
    paperTradeValidation: null as boolean | null, // (4)
  },
  /** B4 may place a live trade only when all four are resolved. */
  isReady(): boolean {
    const d = this.decisions;
    return (
      d.dailyLossCapUSD != null &&
      d.orderFlowTool != null &&
      d.launchInstrument != null &&
      d.paperTradeValidation != null
    );
  },
};
