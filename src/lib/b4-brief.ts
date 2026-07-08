// lib/b4-brief.ts
// The B4 section of the Cowork morning brief.
// The agent calls buildB4Brief() after B1/B2/B3. It assembles a SessionContext from
// your data sources, runs the refined MasiTrades ruleset, and returns a brief block.
//
// It produces GUIDANCE, never orders. autoTrade is always false.

import {
  evaluateGates,
  canOpenTrade,
  exitPlan,
  GATES,
  GO_LIVE,
  type SessionContext,
  type MacroEvent,
  type B4Levels,
} from "./b4-rules";

// ── Inputs the agent gathers from live sources ───────────────────────────────

export interface B4BriefInputs {
  nowET: string;                       // "HH:MM" (24h; normalized defensively)
  dayOfWeek: number;                   // 0=Sun … 6=Sat  (Monday = weekly map-build day)
  macroEventToday: MacroEvent | null;  // from economic calendar
  releaseConfirmed: boolean;           // event out AND price picked a side
  live?: boolean;                      // per-user go-live flag; falls back to GO_LIVE.isReady()
  watchlist: {
    symbol: string;
    levels: B4Levels;                  // mapped levels (Monday build / daily refine)
    ctx: SessionContext;               // live gate inputs for this symbol
  }[];
}

export interface B4BriefSection {
  header: string;
  live: boolean;
  weeklyMapDue: boolean;               // true on Monday
  eventLockActive: boolean;
  lines: string[];                     // human-readable brief lines
  perSymbol: {
    symbol: string;
    clearedToEnter: boolean;
    verdict: string;
    exitPlanNote: string;
    scaleRatio: readonly number[];
  }[];
  autoTrade: false;                    // hard-coded — the agent never trades
}

// Zero-pad "H:MM" → "0H:MM" so G1's string comparison (>= "10:00") is safe.
function padHHMM(s: string): string {
  const [h = "00", m = "00"] = s.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}

// ── Brief builder ────────────────────────────────────────────────────────────

export function buildB4Brief(inp: B4BriefInputs): B4BriefSection {
  const nowET = padHHMM(inp.nowET);
  const live = inp.live ?? GO_LIVE.isReady();
  const weeklyMapDue = inp.dayOfWeek === 1; // Monday
  const eventLockActive = inp.macroEventToday != null && !inp.releaseConfirmed;

  const lines: string[] = [];
  lines.push(`B4 Day Trade — ${live ? "LIVE" : "NOT LIVE (go-live decisions open)"}`);

  if (!live) {
    const d = GO_LIVE.decisions;
    const open: string[] = [];
    if (d.dailyLossCapUSD == null) open.push("daily loss cap");
    if (d.orderFlowTool == null) open.push("order-flow tool");
    if (d.launchInstrument == null) open.push("launch instrument");
    if (d.paperTradeValidation == null) open.push("paper-trade decision");
    if (open.length) lines.push(`  Open decisions: ${open.join(", ")}. No live entries until locked.`);
  }

  if (weeklyMapDue) {
    lines.push("  ⚑ Monday: build the full week's roadmap (up + down) before trading. Allow extra pre-market time.");
  }

  if (eventLockActive) {
    lines.push(
      `  🔒 R4.G0 event lock: ${inp.macroEventToday} today — no entry until after the release AND price confirms. ` +
        `FOMC = watch 2 PM release + 2:30 Powell.`,
    );
  }

  const perSymbol = inp.watchlist.map((w) => {
    // Keep the symbol's context in sync with today's event flags.
    const ctx: SessionContext = {
      ...w.ctx,
      macroEventToday: inp.macroEventToday,
      releaseConfirmed: inp.releaseConfirmed,
    };

    const gates = evaluateGates(ctx, nowET);
    const guard = canOpenTrade(ctx, nowET);
    const plan = exitPlan(ctx.contracts, inp.macroEventToday);

    // A FAIL blocks; a PENDING (e.g. no catalyst — a "higher bar", not a veto)
    // is allowed but surfaced. Never enter on catalyst alone, but its absence
    // does not veto a setup (R4.G5).
    const blocking = gates.results.find((r) => r.status === "fail");
    const pending = gates.results.filter((r) => r.status === "pending");
    const cleared = !blocking && guard.ok && live;

    const verdict = !live
      ? "B4 not live"
      : !guard.ok
      ? guard.reason
      : blocking
      ? `Blocked at ${blocking.code}: ${blocking.reason}`
      : pending.length
      ? `Cleared — confirm manually: ${pending.map((p) => p.code).join(", ")}`
      : "All gates green — manual entry cleared";

    lines.push(
      `  • ${w.symbol}: ${cleared ? "GO" : "no-go"} — ${verdict} ` +
        `(bias ${gates.bias}; bull ${w.levels.bull} / bear ${w.levels.bear})`,
    );

    return {
      symbol: w.symbol,
      clearedToEnter: cleared,
      verdict,
      exitPlanNote: plan.note,
      // Derive from the actual plan so the <7-contract 100%@T1 override is
      // reflected here too (not just in the note).
      scaleRatio: plan.legs.map((l) => l.pct),
    };
  });

  if (inp.watchlist.length === 0) {
    lines.push("  No B4 watchlist symbols mapped today. 0 trades is a valid session (HR.5).");
  }

  return {
    header: `B4 Day Trade  ·  ${GATES.length} gates  ·  ${nowET} ET`,
    live,
    weeklyMapDue,
    eventLockActive,
    lines,
    perSymbol,
    autoTrade: false,
  };
}
