// Personal three-bucket trading system config. Tickers + thresholds + alerts
// are hard-coded against the owner's strategy and updated by hand when their
// positions change. The /api/morning-brief/cowork route reads from here.

export const B1_TICKERS = [
  "VOO", "NVDA", "MSFT", "QQQM", "SMH", "XLF",
  "XLU", "SCHD", "VXUS", "AMZN", "XOM", "XLV",
] as const;

// PYPL is permanently approved — never omit. SPCX added Jun 19 (B2 CSP after Jul 19).
// GUSH: limit orders only (no market orders). Order otherwise doesn't matter.
export const B2_TICKERS = [
  "SOXL", "TQQQ", "TNA", "NVDL", "TSLL", "PYPL", "GUSH", "SPCX",
] as const;

// PATH must always render last in the B3 scan. Insertion order matters.
export const B3_TICKERS = [
  "NVDA", "META", "GOOGL", "AMZN", "AVGO",
  "MSFT", "AMD", "VRT", "ARM", "PATH",
] as const;

// CRDO and ALAB are B3 pipeline tickers — tracked but not yet in the main scan.
export const B3_PIPELINE = ["CRDO", "ALAB"] as const;

// RKLB is extra watch (not in any bucket). SPCX moved to B2 (Jun 29 update).
export const EXTRA_WATCH = ["RKLB"] as const;

// General watchlist — surfaced in every morning report and on /cowork,
// regardless of which bucket a name also lives in. Added Sep 4 2026.
export const WATCHLIST = ["META", "VRT", "XOM", "JPM", "PATH"] as const;

// ───── B4 — Day Trading (MasiTrades framework) ─────
// Individual Z33181037 ONLY. Documented Jul 6–7 2026, NOT yet live (4 open
// go-live decisions). B4 is the fourth bucket: B1 accumulates · B2 sells
// premium · B3 owns LEAPS · B4 day-trades intraday. Always scanned LAST.

// Default single-stock catalyst watchlist (recommended launch instrument).
// SPY charts the SPX roadmap (SPX options are the pending primary instrument).
export const B4_WATCHLIST = ["SPY", "NVDA", "TSLA", "META", "AMZN"] as const;

// Futures Yahoo symbols — ES (S&P 500) and NQ (Nasdaq 100) lead direction.
export const B4_FUTURES = { es: "ES=F", nq: "NQ=F" } as const;

// Session windows in ET minutes-from-midnight. Hard, no exceptions.
export const B4_SESSION = {
  entryOpen: 10 * 60,          // 10:00 — R4.G1: no entries before 10 AM
  morningClose: 11 * 60 + 30,  // 11:30 — morning entry window ends
  afternoonOpen: 13 * 60 + 30, // 13:30 — afternoon entry window opens
  afternoonClose: 15 * 60 + 30,// 15:30 — last entry, wind-down begins
  hardClose: 15 * 60 + 45,     // 15:45 — HR.3: all positions flat
} as const;

// 70/20/10 scale-out plan (exit sizes at Target 1/2/3).
export const B4_SCALE_OUT = [
  { exit: 1, size: 70, where: "Target 1 (options ~40–60% up) — lock the bulk" },
  { exit: 2, size: 20, where: "Target 2 — add to locked profit" },
  { exit: 3, size: 10, where: "Target 3 — runners" },
] as const;

// The 8 pre-entry gates. `auto` = computed by evaluateB4; the rest are
// manual-confirm (charting, catalyst, order flow all require the owner's eye).
export const B4_GATES = [
  { id: "R4.G1", label: "10:00 AM rule", auto: true,  detail: "No entries before 10 AM ET." },
  { id: "R4.G2", label: "Futures alignment", auto: true,  detail: "ES + NQ both above VWAP+9EMA = calls; both below = puts; mixed = skip." },
  { id: "R4.G3", label: "Key level break", auto: false, detail: "Price must BREAK a pre-mapped S/R level + close. Not just approach." },
  { id: "R4.G4", label: "Volume confirmation", auto: false, detail: "Volume rises significantly at the break. Low volume = fake = skip." },
  { id: "R4.G5", label: "Catalyst check", auto: false, detail: "News strengthens setup. Never enter on catalyst alone." },
  { id: "R4.G6", label: "Liquidity check", auto: false, detail: "Options spread ≤ $0.20 · shares spread ≤ $0.10. Wide = no trade." },
  { id: "R4.G7", label: "Order flow", auto: false, detail: "Confirm absorption at entry zone (Bookmap / volume-spike proxy)." },
  { id: "R4.G8", label: "Daily loss cap", auto: true,  detail: "Confirm cap not hit before entering. Hit → session ends." },
] as const;

// Hard session rules (HR.1–HR.6) — always displayed.
export const B4_HARD_RULES = [
  "HR.1 — No trades before 10 AM ET",
  "HR.2 — No trades 11:30 AM–1:30 PM (midday dead zone)",
  "HR.3 — All positions flat by 3:45 PM ET",
  "HR.4 — Stop trading after daily max loss is hit",
  "HR.5 — No forced trades. 0 trades = discipline pass",
  "HR.6 — B4 never interferes with B2/B3 capital",
] as const;

// The 4 open go-live decisions. B4 places no live trade until (1) is set,
// (2)+(3) have at least a default, and (4) is decided.
export const B4_GOLIVE_DECISIONS = [
  { id: 1, key: "loss_cap",   label: "Daily loss cap ($)", required: true,  note: "Hard R4.2/R4.G8/HR.4 number. Stops you emotionally without touching B2/B3." },
  { id: 2, key: "flow_tool",  label: "Order-flow tool",    required: false, note: "Bookmap vs Fidelity ATP proxy vs volume-spike proxy (default)." },
  { id: 3, key: "instrument", label: "Launch instrument",  required: false, note: "SPX 0DTE vs single-stock. Recommended: single-stock first, add SPX after track record." },
  { id: 4, key: "validation", label: "Paper-trade validation", required: true, note: "Paper-trade first (define window + criteria) or go live with small cap as guardrail." },
] as const;

export type B3Alert = {
  alert?: number;
  alerts?: number[]; // PATH has multiple alert levels
  floor?: number;
  hardExit?: string; // ISO date
  reentryWindow?: { start: string; end: string };
  fired?: { price: number; window: string };
};

// Personal alert + exit calendar for B3 LEAPS. Update when positions change.
// Also includes pipeline tickers (CRDO) for alert tracking.
export const B3_ALERTS: Record<string, B3Alert> = {
  NVDA:  { alert: 265,    floor: 33.32,  hardExit: "2026-08-22" },
  META:  { reentryWindow: { start: "2026-07-01", end: "2026-07-10" }, hardExit: "2026-07-25" },
  GOOGL: { alert: 408.61, hardExit: "2026-07-18" },
  AMZN:  { fired: { price: 250.70, window: "open" }, hardExit: "2026-07-26" },
  AVGO:  { alert: 445,    floor: 371.25, hardExit: "2026-08-30" },
  MSFT:  { alert: 349.20, floor: 349.20, hardExit: "2026-07-25" }, // alert updated Jun 29 (52-wk low)
  AMD:   { alert: 489.64, floor: 409.83, hardExit: "2026-08-01" },
  VRT:   { alert: 341,    floor: 304,    hardExit: "2026-07-25" }, // floor breached Jun 29 ($300.50)
  ARM:   { alert: 342.39, floor: 320.99 },
  PATH:  { alerts: [13.50, 14.88, 17.86] },
  // Pipeline — tracked but not in main B3 scan
  CRDO:  { alert: 247.41, hardExit: "2026-08-30" },
};

// Special notes the brief always honors.
export const SPECIAL_NOTES = {
  PYPL_FOREVER:    "PYPL: permanently approved · always scan",
  PATH_LAST:       "PATH: always scanned last in B3",
  NVDL_LEVERAGE:   "NVDL is 2x NVDA — moves are amplified (NVDA -2.34% ≈ NVDL -5.44%)",
  NVDL_STOP_TEST:  "NVDL: R1 MA5010 Fidelity stop test required at 9:55 AM before every entry. Error = no entry that session.",
  GUSH_LIMIT:      "GUSH: limit orders only — no market orders (thin OI). Added Jun 3.",
  IRA_NO_GTC:      "IRA accounts cannot place GTC stops. B2/B3 IRA positions need manual stop management.",
  SPCX_B2:         "SPCX: B2 ticker (IPO Jun 19). CSP entry only after Jul 19 stabilization. Daily stop at 9:55 AM.",
  RKLB_NOTE:       "RKLB: SpaceX ecosystem play. Check price.",
  CRDO_PIPELINE:   "CRDO: B3 pipeline — approved. Entry fires at $247.41 alert ($250C Jan28, stop fill×0.55, hard exit Aug 30).",
  ALAB_PIPELINE:   "ALAB: B3 pipeline — deferred post-Aug 3 earnings. No entry on price spikes (inclusion spike rule).",
  MSFT_B3:         "MSFT: alert updated to $349.20 (52-wk low Jun 25). Deferred Aug 1–10 (earnings Jul 28). Target $350C Jan28.",
  VRT_BREACH:      "VRT: $304 floor breached Jun 29 ($300.50). Conditional: evaluate $310C Jan28 on recovery. Aug 1 re-eval.",
  B4_NOT_LIVE:     "B4: documented, NOT live. No live trade until loss cap set, tool+instrument defaulted, paper-trade decided.",
  B4_ACCOUNT:      "B4: Individual Z33181037 ONLY. IRAs blocked (PDT, no margin). Capital ring-fenced from B1/B2/B3.",
  B4_10AM:         "B4: no entries before 10 AM ET. Dead zone 11:30 AM–1:30 PM. All flat by 3:45 PM. 0 trades = pass.",
};

// SPCX IPO / CSP stabilization dates (30 days post-IPO).
export const SPCX_IPO_DATE = "2026-06-19";
export const SPCX_CSP_READY_DATE = "2026-07-19";

// VIX gates for B2.
export const VIX_PRIME = { lo: 18, hi: 25 };

// All trigger phrases the owner uses in chat that should run a brief. The API
// route doesn't read this — it's exported for any chat surface that wires up
// detection. "all" is the default; partial-bucket calls override.
export const TRIGGER_PHRASES = [
  "morning brief",
  "run my brief",
  "what do we have today",
  "session start",
  "check my buckets",
];

export const PARTIAL_TRIGGERS: Record<string, "b1" | "b2" | "b3"> = {
  "b1 check": "b1",
  "b2 check": "b2",
  "b3 scan": "b3",
};
