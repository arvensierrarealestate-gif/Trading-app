// Price-derived ticker intelligence. Options fields (IV rank, put/call,
// options liquidity) are intentionally null — there is no reliable free feed,
// and we never fabricate them.

export type TickerMetrics = {
  symbol: string;
  price: number | null;
  atr_pct: number | null;
  beta: number | null;
  volume_ratio: number | null; // recent vs 90d average
  gap_freq: number | null; // fraction of days with >1% open gap
  worst_drawdown_pct: number | null; // largest peak-to-trough drawdown over the lookback
  aggression_score: number; // 1-10
  scalp_suitable: boolean;
  swing_suitable: boolean;
  scalp_window_min: number | null;
  swing_duration_days: number | null;
  // Options metrics — unavailable without a provider.
  iv_rank: number | null;
  put_call_ratio: number | null;
  calls_available: boolean;
  puts_available: boolean;
  options_available: boolean;
};

export function aggressionLabel(score: number): string {
  if (score <= 3) return "Conservative";
  if (score <= 6) return "Moderate";
  if (score <= 8) return "Aggressive";
  return "Highly aggressive";
}

export function aggressionColor(score: number): string {
  if (score <= 3) return "#00d4aa";
  if (score <= 6) return "#f59e0b";
  if (score <= 8) return "#f97316";
  return "#ef4444";
}

// Compute aggression 1-10 from price-based inputs.
export function scoreAggression(atrPct: number, beta: number, gapFreq: number): number {
  // ATR% dominates; beta and gap frequency nudge it.
  const atrComponent = Math.min(8, atrPct * 1.6); // ~5% ATR -> 8
  const betaComponent = Math.max(0, (Math.abs(beta) - 1) * 2); // beta 2 -> +2
  const gapComponent = Math.min(2, gapFreq * 10); // 20% gap days -> +2
  const raw = 1 + atrComponent + betaComponent + gapComponent;
  return Math.max(1, Math.min(10, Math.round(raw)));
}
