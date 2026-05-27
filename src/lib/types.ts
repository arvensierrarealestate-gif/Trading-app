export type TradingMode = "learner" | "trader";

export type TraderStats = {
  total_trades: number | null;
  win_rate: number | null; // percent 0-100
  avg_win: number | null; // currency per winning trade
  avg_loss: number | null; // currency per losing trade (magnitude)
  max_single_loss: number | null; // percent of account
  max_drawdown: number | null; // percent
  primary_assets: string | null;
  avg_hold_time: string | null;
};

export type SOP = {
  assets: string;
  tf: string;
  sessions: string;
  entry_signals: string;
  entry_confirm: string;
  entry_notes: string;
  tp: string;
  sl: string;
  rr: string;
  risk: string;
  max_trades: string;
  drawdown: string;
  regimes: string;
  strategy_type: string;
};

export type RuleCheck = {
  rule: string;
  status: "pass" | "fail" | "warn";
  note: string;
};

export type Protection = {
  stop_loss_placement: number; // 0-30, AI judged from the chart
  position_size_ok: boolean;
  placement_note: string;
};

export type Grade = {
  score: number;
  verdict: "SOP followed" | "Partial" | "SOP violated";
  rule_checks: RuleCheck[];
  what_you_did_well: string;
  what_to_improve: string;
  coach_note: string;
  protection?: Protection;
};

export type Trade = {
  id?: string;
  asset: string;
  dir: "Long" | "Short";
  outcome: "Win" | "Loss" | "Break even";
  entry?: string;
  exit?: string;
  stop_loss?: string;
  score: number;
  verdict: Grade["verdict"];
  grade?: Grade;
  protection_score?: number;
  stop_loss_set?: boolean;
  stop_loss_placement?: number;
  position_size_ok?: boolean;
};

// A learner trade only counts toward go-live if capital was protected.
export const PROTECTION_PASS = 70;
export function protectionScore(t: {
  stop_loss_set?: boolean;
  stop_loss_placement?: number;
  position_size_ok?: boolean;
}): number {
  return (t.stop_loss_set ? 40 : 0) + (t.stop_loss_placement ?? 0) + (t.position_size_ok ? 30 : 0);
}

export const SOP_DEFAULTS: SOP = {
  assets: "BTC/USD, ETH/USD",
  tf: "4h",
  sessions: "London, New York",
  entry_signals: "EMA crossover, RSI oversold",
  entry_confirm: "2+ signals align",
  entry_notes: "",
  tp: "Fixed R/R ratio",
  sl: "ATR-based",
  rr: "1:2",
  risk: "1%",
  max_trades: "2",
  drawdown: "3%",
  regimes: "neutral, bull",
  strategy_type: "custom",
};

export type GoLiveItem = {
  text: string;
  tag: string;
  tagClass: string;
  auto: boolean;
  key?: "trades5" | "score70";
};

export const GL_ITEMS: GoLiveItem[] = [
  { text: "Completed at least 5 paper trades", tag: "required", tagClass: "ct-req", auto: true, key: "trades5" },
  { text: "Average SOP compliance score ≥ 70%", tag: "required", tagClass: "ct-req", auto: true, key: "score70" },
  { text: "I know my entry rules without looking at my SOP", tag: "discipline", tagClass: "ct-disc", auto: false },
  { text: "I set my stop loss before entering every trade", tag: "discipline", tagClass: "ct-disc", auto: false },
  { text: "I will stop trading if I hit my daily loss limit", tag: "risk", tagClass: "ct-risk", auto: false },
  { text: "I will never risk more than my SOP allows per trade", tag: "risk", tagClass: "ct-risk", auto: false },
  { text: "I only trade during my designated session hours", tag: "discipline", tagClass: "ct-disc", auto: false },
  { text: "I accept losses as part of the process — no revenge trading", tag: "mindset", tagClass: "ct-mind", auto: false },
];

// Learner-only: appended at the end so manual-check indexing stays stable.
export const LEARNER_PROTECTION_ITEM: GoLiveItem = {
  text: "I understand that a stop loss is mandatory on every single trade I place — no exceptions.",
  tag: "protection",
  tagClass: "ct-prot",
  auto: false,
};
