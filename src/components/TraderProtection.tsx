"use client";

import type { SOP, TraderStats } from "@/lib/types";

export type TraderWarning = { id: string; level: "warn" | "danger"; text: string };

export function computeTraderWarnings(stats: TraderStats | null, sop: SOP): TraderWarning[] {
  if (!stats) return [];
  const out: TraderWarning[] = [];

  if (stats.max_single_loss != null && stats.max_single_loss > 5) {
    out.push({
      id: "single-loss",
      level: "warn",
      text: `Your history shows a single loss of ${stats.max_single_loss}% of account. Your current SOP limits risk to ${sop.risk} per trade. Stay disciplined.`,
    });
  }

  if (stats.win_rate != null && stats.win_rate < 50) {
    const p = stats.win_rate / 100;
    const minRR = p > 0 ? (1 - p) / p : 0; // breakeven reward:risk
    out.push({
      id: "win-rate",
      level: "warn",
      text: `Your verified win rate is ${stats.win_rate}%. Your reward:risk must stay above 1:${minRR.toFixed(2)} to remain profitable at this win rate. Current SOP R/R: ${sop.rr}.`,
    });
  }

  if (stats.max_drawdown != null && stats.max_drawdown > 10) {
    out.push({
      id: "drawdown",
      level: "warn",
      text: `Your verified max drawdown was ${stats.max_drawdown}%. Your daily loss limit is set to ${sop.drawdown}. The app will alert you if you approach this level.`,
    });
  }

  return out;
}

export default function TraderProtectionBanners({ warnings }: { warnings: TraderWarning[] }) {
  if (!warnings.length) return null;
  return (
    <div className="trader-warnings">
      {warnings.map((w) => (
        <div key={w.id} className={`trader-warning ${w.level}`}>
          <span aria-hidden>⚠</span>
          <span>{w.text}</span>
        </div>
      ))}
    </div>
  );
}
