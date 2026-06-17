import { fitGaussianHMM } from "@/lib/hmm";
import { REGIMES, type Regime } from "@/lib/regime";
import { B3_ALERTS, SPECIAL_NOTES, VIX_PRIME } from "@/lib/cowork-brief";

export type Bars = { close: number[]; volume: number[]; high: number[]; low: number[] };

// ───── Data fetcher ─────

export async function fetchBars(symbol: string, range = "1y"): Promise<Bars | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" } });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart: { result?: Array<{ timestamp?: number[]; indicators: { quote: Array<{ close?: (number | null)[]; volume?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[] }> } }> };
    };
    const r = j.chart.result?.[0];
    const q = r?.indicators.quote[0];
    if (!r?.timestamp || !q?.close) return null;
    const close: number[] = [];
    const volume: number[] = [];
    const high: number[] = [];
    const low: number[] = [];
    for (let i = 0; i < r.timestamp.length; i++) {
      const c = q.close[i];
      if (typeof c === "number" && Number.isFinite(c)) {
        close.push(c);
        volume.push(q.volume?.[i] ?? 0);
        high.push(typeof q.high?.[i] === "number" ? (q.high[i] as number) : c);
        low.push(typeof q.low?.[i] === "number" ? (q.low[i] as number) : c);
      }
    }
    return close.length ? { close, volume, high, low } : null;
  } catch {
    return null;
  }
}

// ───── Indicator math ─────

export function emaSeries(vals: number[], period: number): number[] {
  if (!vals.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [vals[0]];
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i - 1] * (1 - k));
  return out;
}

export function rsi(close: number[], period = 14): number {
  if (close.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = close.length - period; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    if (d > 0) gains += d;
    else losses -= d;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function toWeekly(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 4; i < close.length; i += 5) out.push(close[i]);
  return out;
}

export function macd(close: number[]): { macd: number; signal: number; aboveSignal: boolean; aboveZero: boolean } {
  if (close.length < 35) return { macd: 0, signal: 0, aboveSignal: false, aboveZero: false };
  const e12 = emaSeries(close, 12);
  const e26 = emaSeries(close, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const last = macdLine[macdLine.length - 1];
  const sig = signalLine[signalLine.length - 1];
  return { macd: last, signal: sig, aboveSignal: last > sig, aboveZero: last > 0 };
}

export function hv30(close: number[]): number {
  if (close.length < 31) return 0;
  const last31 = close.slice(-31);
  const rets: number[] = [];
  for (let i = 1; i < last31.length; i++) rets.push(Math.log(last31[i] / last31[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export function week52Range(high: number[], low: number[], close: number[]) {
  const days = Math.min(252, high.length);
  const h = Math.max(...high.slice(-days));
  const l = Math.min(...low.slice(-days));
  const c = close[close.length - 1];
  return { high52: h, low52: l, last: c, pctFromHigh: ((c - h) / h) * 100 };
}

export function regimeFromCloses(close: number[]): { regime: Regime; confidence: number } {
  const rets: number[] = [];
  for (let i = 1; i < close.length; i++) rets.push(Math.log(close[i] / close[i - 1]) * 100);
  const model = fitGaussianHMM(rets, 4, { restarts: 12, seed: 42 });
  const order = model.means
    .map((m, i) => [m, i] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .map((p) => p[1]);
  const stateToRegime: Regime[] = new Array(4);
  order.forEach((idx, rank) => (stateToRegime[idx] = REGIMES[rank]));
  const lastIdx = rets.length - 1;
  const lastState = model.states[lastIdx];
  const confidence = model.posteriors[lastIdx]?.[lastState] ?? 0;
  return { regime: stateToRegime[lastState], confidence: Number(confidence.toFixed(3)) };
}

// ───── Bucket evaluation ─────

export type B1Row = {
  ticker: string;
  price: number | null;
  high52: number | null;
  low52: number | null;
  pctFromHigh: number | null;
  flag: boolean;
  note?: string;
};

export function evaluateB1(ticker: string, bars: Bars | null): B1Row {
  if (!bars) return { ticker, price: null, high52: null, low52: null, pctFromHigh: null, flag: false, note: "no data" };
  const { last, high52, low52, pctFromHigh } = week52Range(bars.high, bars.low, bars.close);
  return { ticker, price: last, high52, low52, pctFromHigh, flag: pctFromHigh <= -10 };
}

export type B2Verdict = "GO" | "CAUTION" | "SKIP";
export type B2Row = {
  ticker: string;
  price: number | null;
  rsi: number | null;
  hv30: number | null;
  macdAboveSignal: boolean | null;
  macdAboveZero: boolean | null;
  vixGate: "PRIME" | "CAUTION" | "NO TRADE" | "UNKNOWN";
  rsiGate: "BEST" | "ACCEPTABLE" | "CAUTION" | "WAIT" | "SKIP" | "UNKNOWN";
  macdGate: "PASS" | "CAUTION" | "SKIP";
  verdict: B2Verdict;
  notes: string[];
};

export function evaluateB2(ticker: string, bars: Bars | null, vix: number | null): B2Row {
  const notes: string[] = [];
  if (ticker === "NVDL") notes.push(SPECIAL_NOTES.NVDL_LEVERAGE);
  if (ticker === "PYPL") notes.push(SPECIAL_NOTES.PYPL_FOREVER);

  if (!bars) {
    return {
      ticker, price: null, rsi: null, hv30: null,
      macdAboveSignal: null, macdAboveZero: null,
      vixGate: "UNKNOWN", rsiGate: "UNKNOWN", macdGate: "SKIP",
      verdict: "SKIP", notes: [...notes, "no price data"],
    };
  }

  const price = bars.close[bars.close.length - 1];
  const rsiVal = rsi(bars.close, 14);
  const hvVal = hv30(bars.close);
  const weekly = toWeekly(bars.close);
  const m = macd(weekly);

  let vixGate: B2Row["vixGate"];
  if (vix == null) vixGate = "UNKNOWN";
  else if (vix >= VIX_PRIME.lo && vix <= VIX_PRIME.hi) vixGate = "PRIME";
  else if (vix < VIX_PRIME.lo) vixGate = "CAUTION";
  else vixGate = "NO TRADE";

  let rsiGate: B2Row["rsiGate"];
  if (rsiVal >= 30 && rsiVal <= 40) rsiGate = "BEST";
  else if (rsiVal > 40 && rsiVal <= 55) rsiGate = "ACCEPTABLE";
  else if (rsiVal > 55 && rsiVal <= 70) rsiGate = "CAUTION";
  else if (rsiVal < 30) rsiGate = "WAIT";
  else rsiGate = "SKIP";

  let macdGate: B2Row["macdGate"];
  if (m.aboveSignal) macdGate = "PASS";
  else if (m.aboveZero) macdGate = rsiVal < 40 ? "PASS" : "CAUTION";
  else macdGate = "SKIP";

  let verdict: B2Verdict = "GO";
  if (vixGate === "NO TRADE" || rsiGate === "WAIT" || rsiGate === "SKIP" || macdGate === "SKIP") verdict = "SKIP";
  else if (vixGate === "CAUTION" || rsiGate === "CAUTION" || macdGate === "CAUTION") verdict = "CAUTION";

  return {
    ticker, price, rsi: rsiVal, hv30: hvVal,
    macdAboveSignal: m.aboveSignal, macdAboveZero: m.aboveZero,
    vixGate, rsiGate, macdGate, verdict, notes,
  };
}

export type B3Verdict = "MONITOR" | "NEAR ENTRY" | "EXIT APPROACHING" | "HOLD" | "FIRED";
export type B3Row = {
  ticker: string;
  price: number | null;
  alertRef: string;
  daysToHardExit: number | null;
  regimeMatch: boolean;
  verdict: B3Verdict;
  notes: string[];
};

export function evaluateB3(ticker: string, bars: Bars | null, regime: Regime, todayISO: string): B3Row {
  const alert = B3_ALERTS[ticker];
  const notes: string[] = [];
  if (!bars || !alert) {
    return { ticker, price: null, alertRef: "—", daysToHardExit: null, regimeMatch: false, verdict: "MONITOR", notes: ["no data"] };
  }
  const price = bars.close[bars.close.length - 1];

  let alertRef = "—";
  if (alert.alert) {
    const diff = ((price - alert.alert) / alert.alert) * 100;
    alertRef = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}% vs $${alert.alert} alert`;
  } else if (alert.alerts?.length) {
    const nearest = alert.alerts.reduce((best, a) => (Math.abs(price - a) < Math.abs(price - best) ? a : best), alert.alerts[0]);
    const diff = ((price - nearest) / nearest) * 100;
    alertRef = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}% vs $${nearest} (nearest of ${alert.alerts.map((a) => `$${a}`).join(", ")})`;
  } else if (alert.fired) {
    alertRef = `FIRED at $${alert.fired.price} · window ${alert.fired.window}`;
  } else if (alert.reentryWindow) {
    alertRef = `re-entry ${alert.reentryWindow.start} → ${alert.reentryWindow.end}`;
  }

  if (alert.floor && price <= alert.floor) notes.push(`Price at/below floor $${alert.floor}`);

  let daysToHardExit: number | null = null;
  if (alert.hardExit) {
    const today = new Date(todayISO);
    const exit = new Date(alert.hardExit);
    daysToHardExit = Math.round((exit.getTime() - today.getTime()) / 86_400_000);
  }

  const regimeMatch = regime === "bull" || regime === "neutral";

  let verdict: B3Verdict = "MONITOR";
  if (daysToHardExit != null && daysToHardExit <= 30 && daysToHardExit >= 0) verdict = "EXIT APPROACHING";
  else if (alert.fired) verdict = "FIRED";
  else if (alert.alert && price >= alert.alert) verdict = "NEAR ENTRY";
  else if (!regimeMatch) verdict = "HOLD";

  return { ticker, price, alertRef, daysToHardExit, regimeMatch, verdict, notes };
}
