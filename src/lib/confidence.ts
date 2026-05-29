// How well a ticker matches the user's risk profile. Pure, deterministic, and
// honest about being a price-based heuristic — no fabricated data.

import type { SOP } from "./types";
import { parseRegimes, type Regime } from "./regime";
import { aggressionLabel } from "./ticker";

export type ConfidenceInput = {
  symbol: string;
  aggression: number; // 1-10
  beta: number | null;
  worstDrawdownPct: number | null;
  scalpSuitable: boolean;
  swingSuitable: boolean;
  sop: SOP;
  regime: string | null; // current SPY regime
};

export type ConfidenceResult = {
  symbol: string;
  score: number; // 0-100 match to SOP
  recommended: boolean;
  survivesStress: boolean;
  reason: string; // one-line "why" for recommended
  warning: string | null; // red warning for not-recommended
};

function num(s: string, fallback: number): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : fallback;
}

// Max aggression the user's per-trade risk tolerance comfortably supports.
function toleranceCeiling(riskPct: number): number {
  if (riskPct <= 1) return 4;
  if (riskPct <= 1.5) return 5;
  if (riskPct <= 2) return 6;
  if (riskPct <= 3) return 8;
  return 9;
}

export function computeConfidence(input: ConfidenceInput): ConfidenceResult {
  const { aggression, beta, sop, regime } = input;
  const riskPct = num(sop.risk, 1);
  const dailyLimit = num(sop.drawdown, 2);
  const ceiling = toleranceCeiling(riskPct);

  const tf = sop.tf.toLowerCase();
  const wantsSwing = /d|w/.test(tf) || tf === "4h";
  const wantsScalp = !wantsSwing && (/m\b|m$/.test(tf) || tf.endsWith("m") || tf === "1h");

  const allowed = parseRegimes(sop.regimes);
  const regimeBlocked = regime != null && allowed.length > 0 && !allowed.includes(regime as Regime);

  // Beta-projected move if the broad market drops 20%.
  const stressMovePct = Math.abs(beta ?? 1) * 20;
  const survivesStress = stressMovePct <= dailyLimit * 3;

  let score = 100;
  if (aggression > ceiling) score -= (aggression - ceiling) * 9;
  if (regimeBlocked) score -= 40;
  if (wantsSwing && !input.swingSuitable) score -= 15;
  if (wantsScalp && !input.scalpSuitable) score -= 15;
  if (!survivesStress) score -= 15;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const styleWord = wantsSwing ? "swing" : wantsScalp ? "scalp" : "trading";
  const reason = `Matches your ${styleWord} SOP · ${aggressionLabel(aggression).toLowerCase()} (${aggression}/10) today`;

  let warning: string | null = null;
  if (score < 45 || regimeBlocked || aggression > ceiling) {
    const bits: string[] = [];
    if (aggression > ceiling) bits.push(`Aggression rating ${aggression}/10 exceeds your comfort zone for a ${sop.risk} risk profile.`);
    if (regimeBlocked) bits.push(`Current market regime (${regime}) is outside your SOP's allowed regimes.`);
    if (!survivesStress) bits.push(`A 20% market drop implies ~${stressMovePct.toFixed(1)}% on this position (beta ${(beta ?? 1).toFixed(2)}) — above your ${sop.drawdown} daily limit.`);
    warning = bits.join(" ") || `Below your SOP comfort threshold.`;
  }

  const recommended = score >= 55 && !regimeBlocked;
  return { symbol: input.symbol, score, recommended, survivesStress, reason, warning };
}
