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
