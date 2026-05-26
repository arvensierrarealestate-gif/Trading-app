// Pure stress-test math. Inputs come from /api/ticker (beta, drawdown) and
// /api/alpaca (positions, account equity). No network here.

import type { SOP } from "@/lib/types";

export type StressInputs = {
  position_value: number;
  beta: number | null;
  worst_drawdown_pct: number | null;
  account_equity: number;
  sop: SOP;
};

export type StressLevel = "ok" | "warn" | "danger";

export type StressResult = {
  // Dollar losses if the broad market drops X%, projected via beta.
  loss_10pct: number;
  loss_20pct: number;
  worst_drawdown_pct: number | null;
  // Loss as percentage of the entire account at the -20% scenario.
  pct_of_account_20: number;
  level: StressLevel;
  passes_sop: boolean;
};

function pct(s: string | null | undefined): number {
  const n = parseFloat(s ?? "");
  return Number.isFinite(n) ? n : 0;
}

export function computeStress({
  position_value,
  beta,
  worst_drawdown_pct,
  account_equity,
  sop,
}: StressInputs): StressResult {
  const b = beta ?? 1;
  const loss_10pct = b * 0.1 * position_value;
  const loss_20pct = b * 0.2 * position_value;
  const pct_of_account_20 = account_equity > 0 ? (loss_20pct / account_equity) * 100 : 0;

  const dailyLimit = pct(sop.drawdown);
  const tradeRisk = pct(sop.risk);

  let level: StressLevel = "ok";
  if (pct_of_account_20 > dailyLimit) level = "danger";
  else if (pct_of_account_20 > dailyLimit * 0.7 || pct_of_account_20 > tradeRisk * 2) level = "warn";

  return {
    loss_10pct,
    loss_20pct,
    worst_drawdown_pct,
    pct_of_account_20,
    level,
    passes_sop: level !== "danger",
  };
}

export function stressColor(level: StressLevel): string {
  if (level === "ok") return "var(--accent)";
  if (level === "warn") return "var(--amber)";
  return "var(--red)";
}
