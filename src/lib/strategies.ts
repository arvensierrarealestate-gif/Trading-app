// Strategy templates shown to learners on first entry to Stage 1. Each template
// pre-fills the SOP form and exposes per-field "why this value" reasons used by
// the info icons.

import type { SOP } from "./types";

export type StrategyId = "premium-selling" | "leaps" | "momentum-swing" | "custom";

export type StrategyTemplate = {
  id: StrategyId;
  name: string;
  subtitle: string;
  risk: "Conservative" | "Moderate" | "Advanced";
  accountRange: string | null;
  accent: "teal" | "amber" | "purple" | "gray";
  defaults: Omit<SOP, "strategy_type"> | null;
  fieldReasons: Partial<Record<keyof SOP, string>>;
  // Grade criteria shown in the Stage 2 info card / customize checklist.
  criteria: string[];
};

export const STRATEGIES: StrategyTemplate[] = [
  {
    id: "premium-selling",
    name: "Premium selling",
    subtitle: "Sell options and collect income. Time works in your favor.",
    risk: "Conservative",
    accountRange: "$500 to $5,000",
    accent: "teal",
    criteria: [
      "Implied volatility (IV rank) is above 30%",
      "Strike chosen 1-2% out of the money",
      "Underlying is a stock you'd be happy to own",
      "Stop set to exit if the position doubles in loss",
      "Plan to close at 50% profit or 21 days to expiry",
    ],
    defaults: {
      assets: "SPY, AAPL, MSFT",
      tf: "1d",
      sessions: "New York",
      entry_signals: "IV rank above 30%, sell put or call",
      entry_confirm: "2+ signals align",
      entry_notes:
        "Sell options when implied volatility is elevated. Collect premium. Let time decay work.",
      tp: "Buy back at 50% profit",
      sl: "Exit if position doubles in loss",
      rr: "1:2",
      risk: "1%",
      max_trades: "2",
      drawdown: "2%",
      regimes: "neutral, bull",
    },
    fieldReasons: {
      assets:
        "Set to SPY, AAPL, MSFT because these are highly liquid with tight option spreads. Always tradeable, never stuck in a bad fill.",
      tf:
        "Set to 1d because option strategies care about expiry cycles, not minute-by-minute price.",
      sessions:
        "Set to New York because US option markets have the deepest liquidity and tightest spreads.",
      entry_signals:
        "Set to IV rank above 30% because option premiums are only worth selling when implied volatility is elevated.",
      entry_notes:
        "This is the core idea behind premium selling — get paid for taking on volatility risk when it's mispriced high.",
      tp:
        "Set to buy back at 50% profit because greed is the enemy of premium sellers. Closing early avoids gamma risk near expiry.",
      sl:
        "Set to exit if position doubles in loss because options can lose value fast. A pre-committed exit keeps premium selling profitable long term.",
      rr:
        "Set to 1:2 because option premiums are smaller than directional bets. You need at least 2x risk on winners to make the math work.",
      risk:
        "Set to 1% because on a $10,000 account that limits any single trade to $100 of loss. Premium selling has small consistent wins — capital preservation is the priority.",
      max_trades:
        "Set to 2 to prevent over-exposure if implied volatility spikes across multiple positions at once.",
      drawdown:
        "Set to 2% daily limit to prevent a string of bad assignments from blowing up your account on a single bad day.",
      regimes:
        "This strategy only runs in neutral and bull markets where options decay reliably. In a bear regime the setup will be blocked automatically.",
    },
  },
  {
    id: "leaps",
    name: "LEAPS",
    subtitle: "Buy long-term options that behave like stock but cost less capital.",
    risk: "Moderate",
    accountRange: "$1,000 to $10,000",
    accent: "amber",
    criteria: [
      "A company you believe in long-term",
      "Entry on a pullback to weekly support",
      "Call delta is 0.70 or higher",
      "Expiry is 12+ months out",
      "Risk is no more than 2% of account",
      "Exit plan: 100% gain or 6 months before expiry",
    ],
    defaults: {
      assets: "SPY, QQQ, AAPL, MSFT, NVDA",
      tf: "1w",
      sessions: "New York",
      entry_signals:
        "Pullback to weekly support, delta 0.70 or higher, expiry 12+ months",
      entry_confirm: "2+ signals align",
      entry_notes:
        "Buy calls with high delta and long expiry at support. Think like an owner, not a gambler.",
      tp: "Sell at 100% gain or 6 months before expiry",
      sl: "Exit if position loses 30% of value",
      rr: "1:3",
      risk: "2%",
      max_trades: "2",
      drawdown: "3%",
      regimes: "neutral, bull",
    },
    fieldReasons: {
      assets:
        "Set to mega-cap names (SPY, QQQ, AAPL, MSFT, NVDA) because LEAPS require companies with proven longevity over the option's 12+ month life.",
      tf:
        "Set to 1w because LEAPS plays span months. Daily noise is irrelevant — only weekly structure matters for entries.",
      sessions:
        "Set to New York because US option markets have the deepest LEAPS liquidity.",
      entry_signals:
        "Delta 0.70+ makes the option move like stock. Expiry 12+ months gives the thesis time to play out without theta crushing the position.",
      entry_notes:
        "This is the core idea — LEAPS are a leveraged substitute for owning quality stock. Treat them like ownership, not a lottery ticket.",
      tp:
        "Set to 100% gain or 6 months before expiry because theta decay accelerates inside 6 months — sell before time eats the position.",
      sl:
        "Set to 30% value loss because LEAPS shouldn't be 'all or nothing'. If the trade is 30% down, the thesis is probably wrong.",
      rr:
        "Set to 1:3 because LEAPS are leveraged — you need a bigger reward target to justify the time and capital tied up.",
      risk:
        "Set to 2% because LEAPS positions are higher conviction and held longer. Still never more than 2% on a single position.",
      max_trades:
        "Set to 2 because LEAPS tie up capital for months. Concentration is fine; over-diversification dilutes conviction.",
      drawdown:
        "Set to 3% daily limit to give breathing room for normal pullbacks in long-term holdings, but cap disaster days.",
      regimes:
        "This strategy only runs in neutral and bull markets where long-term uptrends persist. In a bear regime the setup will be blocked automatically.",
    },
  },
  {
    id: "momentum-swing",
    name: "Momentum swing",
    subtitle: "Ride strong trends for 3 to 10 days. Cut losses fast and let winners run.",
    risk: "Moderate",
    accountRange: "$2,000 and up",
    accent: "purple",
    criteria: [
      "EMA crossover is present",
      "Volume confirms the move",
      "RSI is above 50",
      "Trading with the trend, not against it",
      "Stop set below the entry candle's low",
      "Plan to hold 3-10 days maximum",
    ],
    defaults: {
      assets: "SPY, QQQ, high volume stocks",
      tf: "4h",
      sessions: "New York, London",
      entry_signals: "EMA crossover with volume confirmation, RSI above 50",
      entry_confirm: "2+ signals align",
      entry_notes:
        "Enter on momentum breakouts with volume. Hold 3 to 10 days maximum. No counter-trend trades.",
      tp: "Trail stop or fixed 3R target",
      sl: "Below entry candle low",
      rr: "1:3",
      risk: "1%",
      max_trades: "3",
      drawdown: "2%",
      regimes: "neutral, bull",
    },
    fieldReasons: {
      assets:
        "Set to high-volume liquid names so slippage on stops doesn't eat your edge. Momentum strategies need clean fills.",
      tf:
        "Set to 4h because it catches swing setups without intraday noise. Holds are 3 to 10 days max.",
      sessions:
        "Set to New York and London — the two sessions where momentum breakouts have enough volume to follow through.",
      entry_signals:
        "EMA crossover signals trend change. Volume confirms commitment. RSI above 50 keeps you on the strong side of momentum.",
      entry_notes:
        "This is the core idea — only trade with the trend, only with volume, never against the prevailing momentum.",
      tp:
        "Set to trail or fixed 3R because riding trends matters more than perfect exits. Let winners run; cut losers fast.",
      sl:
        "Set to below entry candle low because breakouts that fail back into the range usually go much further down. Exit fast.",
      rr:
        "Set to 1:3 because momentum win rate is around 40%. You need 3x payouts on winners to be profitable at that hit rate.",
      risk:
        "Set to 1% because momentum strategies have many small losses and a few big wins. The 1% rule survives losing streaks.",
      max_trades:
        "Set to 3 because momentum scans produce many false signals. Overtrading is the killer of momentum traders.",
      drawdown:
        "Set to 2% daily limit to force a cooldown if a chop day kills three setups in a row.",
      regimes:
        "This strategy only runs in neutral and bull markets. Bear-regime breakouts fail more often than they succeed.",
    },
  },
  {
    id: "custom",
    name: "Build my own",
    subtitle: "I know what I am doing. Let me define my own rules.",
    risk: "Advanced",
    accountRange: null,
    accent: "gray",
    criteria: [],
    defaults: null,
    fieldReasons: {},
  },
];

export function getStrategy(id: string): StrategyTemplate | undefined {
  return STRATEGIES.find((s) => s.id === id);
}

// Critical fields show a warning when the learner changes them away from the
// strategy template default.
export const CRITICAL_FIELDS: (keyof SOP)[] = [
  "risk",
  "drawdown",
  "rr",
  "sl",
  "tp",
  "max_trades",
  "regimes",
];
