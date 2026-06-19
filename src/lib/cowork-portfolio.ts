import { z } from "zod";

// Cowork portfolio document — owned positions + 5 monitoring lists. Matches
// the schema in `schema_redacted.md`. Strict shape, lenient on optional
// fields so partial saves don't 400.

const lotSchema = z.object({
  contracts: z.number().int().nonnegative(),
  fill_price: z.number(),
  gtc: z.number().nullable().optional(),
  stop: z.number().nullable().optional(),
});

const ownedOptionSchema = z.object({
  symbol: z.string().min(1),
  type: z.enum(["CALL", "PUT"]),
  side: z.enum(["LONG", "SHORT"]),
  strike: z.number(),
  expiry: z.string(), // ISO date
  contracts: z.number().int().nonnegative(),
  account: z.string(),
  cost_basis: z.number(),
  mark: z.number().nullable().optional(), // refreshed live
  pnl_pct: z.number().nullable().optional(), // computed live
  gtc_stop: z.number().nullable().optional(),
  stop_manual: z.number().nullable().optional(),
  hard_exit: z.string().nullable().optional(),
  premium_collected: z.number().nullable().optional(),
  lots: z.array(lotSchema).optional(),
  notes: z.string().optional(),
});

const ownedStockSchema = z.object({
  symbol: z.string().min(1),
  account: z.string(),
  shares: z.number(),
  cost_basis: z.number(),
  mark: z.number().nullable().optional(),
  pnl_pct: z.number().nullable().optional(),
  has_stop: z.boolean().optional(),
  stop: z.number().nullable().optional(),
  alerts: z.array(z.number()).optional(),
  bucket_tag: z.enum(["B1", "none"]).optional(),
  notes: z.string().optional(),
});

const b1MonitorSchema = z.object({
  tickers: z.array(z.string()),
  check: z.string().optional(),
  action: z.string().optional(),
});

const tickerFlagsSchema = z.object({
  always_include: z.boolean().optional(),
  limit_only: z.boolean().optional(),
  leverage: z.number().nullable().optional(),
  collateral: z.number().nullable().optional(),
  account_restrict: z.string().nullable().optional(),
  special: z.string().nullable().optional(),
});

const b2MonitorSchema = z.object({
  tickers: z.array(z.string()),
  per_ticker_flags: z.record(z.string(), tickerFlagsSchema).optional(),
  gates: z
    .object({
      vix: z
        .object({
          prime: z.tuple([z.number(), z.number()]),
          caution_below: z.number(),
          no_trade_above: z.number(),
        })
        .optional(),
      rsi: z
        .object({
          best: z.tuple([z.number(), z.number()]),
          ok: z.tuple([z.number(), z.number()]),
          caution: z.tuple([z.number(), z.number()]),
          wait_below: z.number(),
          skip_above: z.number(),
        })
        .optional(),
      iv_vs_hv: z.string().optional(),
      macd_weekly: z.string().optional(),
      roi_annualized: z
        .object({
          formula: z.string(),
          min_pct: z.number(),
          min_absolute_pct: z.number(),
        })
        .optional(),
    })
    .optional(),
});

const b3TickerSchema = z.object({
  alert_close: z.number().nullable().optional(),
  floor: z.number().nullable().optional(),
  r32_trigger: z.number().nullable().optional(),
  hard_exit: z.string().nullable().optional(),
  deferred_window: z.string().nullable().optional(),
  stop_mult: z.number().optional(),
  instrument: z.string().nullable().optional(),
});

const b3MonitorSchema = z.object({
  scan_order: z.array(z.string()), // PATH must be last — checked at runtime
  expiry_constraint: z.string().optional(),
  per_ticker: z.record(z.string(), b3TickerSchema).optional(),
  gates: z
    .object({
      regime: z.string().optional(),
      price_vs_alert: z.string().optional(),
      window_open: z.boolean().optional(),
    })
    .optional(),
});

const reentrySchema = z.object({
  symbol: z.string(),
  proceeds_parked: z.number().optional(),
  account: z.string().optional(),
  window_open: z.string().optional(), // ISO date
  window_close: z.string().optional(),
  instrument: z.string().optional(),
  go_nogo_date: z.string().optional(),
  trigger: z.string().optional(),
});

const scalpSchema = z.object({
  ticker: z.string(),
  rules: z
    .object({
      dte: z.tuple([z.number(), z.number()]),
      max_dollar: z.number(),
      contracts: z.number().int(),
      account_restrict: z.string().optional(),
      max_per_month: z.number().int(),
      stop_after_consec_losses: z.number().int(),
    })
    .optional(),
  gates: z
    .object({
      breakeven_guard: z.string().optional(),
      vix: z
        .object({
          ideal_below: z.number(),
          ok: z.tuple([z.number(), z.number()]),
          skip_above: z.number(),
        })
        .optional(),
      price: z.string().optional(),
      rsi: z.tuple([z.number(), z.number()]).optional(),
      spy_macro: z.string().optional(),
      earnings_blackout: z.string().nullable().optional(),
    })
    .optional(),
  staged_trade: z
    .object({
      instrument: z.string().optional(),
      gtc: z.number().nullable().optional(),
      stop: z.number().nullable().optional(),
    })
    .optional(),
});

const otherWatchSchema = z.object({
  symbol: z.string(),
  status: z.string().optional(),
  alerts: z.array(z.number()).optional(),
  approved: z.boolean().optional(),
});

export const coworkPortfolioSchema = z.object({
  portfolio_total: z.number().optional(),
  target: z.number().optional(),
  gap: z.number().optional(),
  pct_to_target: z.number().optional(),
  last_sync: z.string().optional(),
  cash_by_account: z.record(z.string(), z.number()).optional(),

  owned_options: z.array(ownedOptionSchema).default([]),
  owned_stocks: z.array(ownedStockSchema).default([]),

  monitor_B1_autofill: b1MonitorSchema.optional(),
  monitor_B2_csp: b2MonitorSchema.optional(),
  monitor_B3_leaps: b3MonitorSchema.optional(),
  monitor_reentry: z.array(reentrySchema).default([]),
  monitor_scalp: scalpSchema.optional(),
  other_watch: z.array(otherWatchSchema).default([]),
});

export type CoworkPortfolio = z.infer<typeof coworkPortfolioSchema>;

// Sample document — fill the values, paste, save. Numeric fields use 0
// placeholders, string fields use "TODO". Comments embedded as keys ending in
// "_note" are stripped at parse time (Zod's strict-but-default-friendly mode).
export const PORTFOLIO_TEMPLATE = `{
  "portfolio_total": 0,
  "target": 0,
  "gap": 0,
  "pct_to_target": 0,
  "last_sync": "2026-06-17",
  "cash_by_account": {
    "Roth IRA": 0,
    "Traditional IRA": 0,
    "Individual": 0
  },

  "owned_options": [
    {
      "symbol": "NVDA",
      "type": "CALL",
      "side": "LONG",
      "strike": 0,
      "expiry": "2028-01-21",
      "contracts": 0,
      "account": "Individual",
      "cost_basis": 0,
      "gtc_stop": null,
      "stop_manual": null,
      "hard_exit": "2026-08-22",
      "notes": ""
    }
  ],

  "owned_stocks": [
    {
      "symbol": "VOO",
      "account": "Roth IRA",
      "shares": 0,
      "cost_basis": 0,
      "has_stop": false,
      "stop": null,
      "alerts": [],
      "bucket_tag": "B1",
      "notes": ""
    }
  ],

  "monitor_B1_autofill": {
    "tickers": ["VOO","NVDA","MSFT","QQQM","SMH","XLF","XLU","SCHD","VXUS","AMZN","XOM","XLV"],
    "check": "price vs 52wk range; flag if down >10% from cost",
    "action": "none"
  },

  "monitor_B2_csp": {
    "tickers": ["SOXL","TQQQ","TNA","NVDL","TSLL","PYPL","GUSH"],
    "per_ticker_flags": {
      "PYPL": { "always_include": true },
      "NVDL": { "leverage": 2, "special": "NVDA -2.34% ≈ NVDL -5.44%" }
    },
    "gates": {
      "vix": { "prime": [18,25], "caution_below": 18, "no_trade_above": 25 },
      "rsi": { "best": [30,40], "ok": [40,55], "caution": [55,70], "wait_below": 30, "skip_above": 70 },
      "iv_vs_hv": "IV30 > HV30 favorable",
      "macd_weekly": "above signal=pass; below signal & zero=skip",
      "roi_annualized": { "formula": "(prem/strike)*(365/dte)*100", "min_pct": 30, "min_absolute_pct": 4 }
    }
  },

  "monitor_B3_leaps": {
    "scan_order": ["NVDA","META","GOOGL","AMZN","AVGO","MSFT","AMD","VRT","ARM","PATH"],
    "expiry_constraint": "Jan 2028 only",
    "per_ticker": {
      "NVDA": { "alert_close": 265, "floor": 33.32, "hard_exit": "2026-08-22", "stop_mult": 1 },
      "META": { "deferred_window": "2026-07-01 to 2026-07-10", "hard_exit": "2026-07-25", "stop_mult": 1 },
      "GOOGL": { "alert_close": 408.61, "hard_exit": "2026-07-18", "stop_mult": 1 },
      "AMZN": { "alert_close": 250.70, "hard_exit": "2026-07-26", "stop_mult": 1 },
      "AVGO": { "alert_close": 445, "floor": 371.25, "hard_exit": "2026-08-30", "stop_mult": 1 },
      "MSFT": { "alert_close": 499.90, "floor": 416.59, "hard_exit": "2026-07-25", "stop_mult": 1 },
      "AMD": { "alert_close": 489.64, "floor": 409.83, "hard_exit": "2026-08-01", "stop_mult": 1 },
      "VRT": { "alert_close": 341, "floor": 304, "hard_exit": "2026-07-25", "stop_mult": 1 },
      "ARM": { "alert_close": 342.39, "floor": 320.99, "stop_mult": 1 },
      "PATH": { "alert_close": 13.50, "stop_mult": 1 }
    },
    "gates": { "regime": "Bull or Neutral for new entry", "price_vs_alert": "near alert = candidate", "window_open": true }
  },

  "monitor_reentry": [
    {
      "symbol": "TODO",
      "proceeds_parked": 0,
      "account": "Individual",
      "window_open": "2026-07-01",
      "window_close": "2026-07-31",
      "instrument": "TODO",
      "go_nogo_date": "2026-07-15",
      "trigger": "TODO"
    }
  ],

  "monitor_scalp": {
    "ticker": "NVDA",
    "rules": { "dte": [7,21], "max_dollar": 500, "contracts": 1, "account_restrict": "Individual", "max_per_month": 2, "stop_after_consec_losses": 2 },
    "gates": {
      "breakeven_guard": "Underlying LEAPS mark must be >= cost basis",
      "vix": { "ideal_below": 20, "ok": [20,25], "skip_above": 25 },
      "price": "above strike AND above 5d MA for 2 consec days",
      "rsi": [45,65],
      "spy_macro": "above accumulation level",
      "earnings_blackout": null
    },
    "staged_trade": { "instrument": "", "gtc": null, "stop": null }
  },

  "other_watch": [
    { "symbol": "SPCX", "status": "30-day post-IPO window, buy ~Jul 10", "alerts": [], "approved": true },
    { "symbol": "RKLB", "status": "SpaceX ecosystem play", "alerts": [], "approved": true }
  ]
}`;

// Runtime invariants beyond the Zod schema.
export function checkInvariants(p: CoworkPortfolio): string[] {
  const errs: string[] = [];

  // PATH must be last in B3 scan order.
  const order = p.monitor_B3_leaps?.scan_order ?? [];
  if (order.length > 0 && order.includes("PATH") && order[order.length - 1] !== "PATH") {
    errs.push("monitor_B3_leaps.scan_order: PATH must be the LAST ticker.");
  }

  // IRA accounts forbid GTC stops.
  for (const o of p.owned_options) {
    const inIRA = /ira|roth/i.test(o.account);
    if (inIRA && o.gtc_stop != null) {
      errs.push(`owned_options[${o.symbol}]: GTC stop set on IRA account "${o.account}" — IRAs cannot place GTC stops. Use stop_manual instead.`);
    }
  }
  for (const s of p.owned_stocks) {
    if (/ira|roth/i.test(s.account) && s.has_stop && s.stop != null) {
      // Not strictly an error — stocks can have stops in IRAs in some brokers — leave as info.
    }
  }

  return errs;
}
