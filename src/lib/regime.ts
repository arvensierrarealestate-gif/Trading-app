export const REGIMES = ["crash", "bear", "neutral", "bull"] as const;
export type Regime = (typeof REGIMES)[number];

export const REGIME_COLORS: Record<Regime, string> = {
  crash: "#ef4444",
  bear: "#f59e0b",
  neutral: "#8b90a0",
  bull: "#00d4aa",
};

export const REGIME_LABELS: Record<Regime, string> = {
  crash: "Crash",
  bear: "Bear",
  neutral: "Neutral",
  bull: "Bull",
};

export type RegimePoint = { date: string; regime: Regime; return: number };

export type RegimeResponse = {
  symbol: string;
  asOf: string;
  current: { regime: Regime; confidence: number };
  timeline: RegimePoint[];
  means: Record<Regime, number>;
};

export function parseRegimes(s: string | undefined | null): Regime[] {
  if (!s) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x): x is Regime => (REGIMES as readonly string[]).includes(x));
}
