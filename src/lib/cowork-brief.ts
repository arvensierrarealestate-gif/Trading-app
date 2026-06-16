// Personal three-bucket trading system config. Tickers + thresholds + alerts
// are hard-coded against the owner's strategy and updated by hand when their
// positions change. The /api/morning-brief/cowork route reads from here.

export const B1_TICKERS = [
  "VOO", "NVDA", "MSFT", "QQQM", "SMH", "XLF",
  "XLU", "SCHD", "VXUS", "AMZN", "XOM", "XLV",
] as const;

// PYPL is permanently approved — never omit. Order otherwise doesn't matter.
export const B2_TICKERS = [
  "SOXL", "TQQQ", "TNA", "NVDL", "TSLL", "PYPL", "GUSH",
] as const;

// PATH must always render last in the B3 scan. Insertion order matters.
export const B3_TICKERS = [
  "NVDA", "META", "GOOGL", "AMZN", "AVGO",
  "MSFT", "AMD", "VRT", "ARM", "PATH",
] as const;

// Surfaced in every brief regardless of bucket selection.
export const EXTRA_WATCH = ["SPCX", "RKLB"] as const;

export type B3Alert = {
  alert?: number;
  alerts?: number[]; // PATH has multiple alert levels
  floor?: number;
  hardExit?: string; // ISO date
  reentryWindow?: { start: string; end: string };
  fired?: { price: number; window: string };
};

// Personal alert + exit calendar for B3 LEAPS. Update when positions change.
export const B3_ALERTS: Record<string, B3Alert> = {
  NVDA:  { alert: 265,    floor: 33.32,  hardExit: "2026-08-22" },
  META:  { reentryWindow: { start: "2026-07-01", end: "2026-07-10" }, hardExit: "2026-07-25" },
  GOOGL: { alert: 408.61, hardExit: "2026-07-18" },
  AMZN:  { fired: { price: 250.70, window: "open" }, hardExit: "2026-07-26" },
  AVGO:  { alert: 445,    floor: 371.25, hardExit: "2026-08-30" },
  MSFT:  { alert: 499.90, floor: 416.59, hardExit: "2026-07-25" },
  AMD:   { alert: 489.64, floor: 409.83, hardExit: "2026-08-01" },
  VRT:   { alert: 341,    floor: 304,    hardExit: "2026-07-25" },
  ARM:   { alert: 342.39, floor: 320.99 },
  PATH:  { alerts: [13.50, 14.88, 17.86] },
};

// Special notes the brief always honors.
export const SPECIAL_NOTES = {
  PYPL_FOREVER: "PYPL: permanently approved · always scan",
  PATH_LAST: "PATH: always scanned last in B3",
  NVDL_LEVERAGE: "NVDL is 2x NVDA — moves are amplified (NVDA -2.34% ≈ NVDL -5.44%)",
  IRA_NO_GTC: "IRA accounts cannot place GTC stops. Any B2/B3 IRA position needs manual stop management.",
  SPCX_WINDOW: "SPCX: 30-day post-IPO window, buy window ~Jul 10. Check price daily.",
  RKLB_NOTE: "RKLB: SpaceX ecosystem play. Check price.",
};

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
