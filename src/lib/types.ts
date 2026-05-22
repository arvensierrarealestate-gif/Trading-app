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
};

export type RuleCheck = {
  rule: string;
  status: "pass" | "fail" | "warn";
  note: string;
};

export type Grade = {
  score: number;
  verdict: "SOP followed" | "Partial" | "SOP violated";
  rule_checks: RuleCheck[];
  what_you_did_well: string;
  what_to_improve: string;
  coach_note: string;
};

export type Trade = {
  id?: string;
  asset: string;
  dir: "Long" | "Short";
  outcome: "Win" | "Loss" | "Break even";
  entry?: string;
  exit?: string;
  score: number;
  verdict: Grade["verdict"];
  grade?: Grade;
};

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
};

export const GL_ITEMS = [
  { text: "Completed at least 5 paper trades", tag: "required", tagClass: "ct-req", auto: true, key: "trades5" },
  { text: "Average SOP compliance score ≥ 70%", tag: "required", tagClass: "ct-req", auto: true, key: "score70" },
  { text: "I know my entry rules without looking at my SOP", tag: "discipline", tagClass: "ct-disc", auto: false },
  { text: "I set my stop loss before entering every trade", tag: "discipline", tagClass: "ct-disc", auto: false },
  { text: "I will stop trading if I hit my daily loss limit", tag: "risk", tagClass: "ct-risk", auto: false },
  { text: "I will never risk more than my SOP allows per trade", tag: "risk", tagClass: "ct-risk", auto: false },
  { text: "I only trade during my designated session hours", tag: "discipline", tagClass: "ct-disc", auto: false },
  { text: "I accept losses as part of the process — no revenge trading", tag: "mindset", tagClass: "ct-mind", auto: false },
] as const;
