import { fitGaussianHMM } from "@/lib/hmm";
import { REGIMES, type Regime } from "@/lib/regime";
import { B3_ALERTS, SPECIAL_NOTES, VIX_PRIME, SPCX_CSP_READY_DATE, B4_SESSION } from "@/lib/cowork-brief";
import { GATES as B4_GATE_DEFS } from "@/lib/b4-rules";
import { type CoworkPortfolio } from "@/lib/cowork-portfolio";

export type Bars = { close: number[]; volume: number[]; high: number[]; low: number[] };

// ───── Data fetcher ─────

export async function fetchBars(symbol: string, range = "1y", interval = "1d"): Promise<Bars | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  // Per-symbol timeout so one slow/hanging quote (e.g. a futures symbol) can't
  // stall the whole batch until the route's maxDuration kills it.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" }, signal: controller.signal });
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
  } finally {
    clearTimeout(timer);
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
  if (ticker === "NVDL") { notes.push(SPECIAL_NOTES.NVDL_LEVERAGE); notes.push(SPECIAL_NOTES.NVDL_STOP_TEST); }
  if (ticker === "PYPL") notes.push(SPECIAL_NOTES.PYPL_FOREVER);
  if (ticker === "GUSH") notes.push(SPECIAL_NOTES.GUSH_LIMIT);
  if (ticker === "SPCX") notes.push(SPECIAL_NOTES.SPCX_B2);

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

  // SPCX: CSP entry blocked until post-IPO stabilization window.
  if (ticker === "SPCX") {
    const today = new Date().toISOString().slice(0, 10);
    if (today < SPCX_CSP_READY_DATE) {
      notes.push(`CSP window opens ${SPCX_CSP_READY_DATE} — share buy only until then`);
      return {
        ticker, price, rsi: rsiVal, hv30: hvVal,
        macdAboveSignal: m.aboveSignal, macdAboveZero: m.aboveZero,
        vixGate: "CAUTION", rsiGate: "CAUTION", macdGate: "CAUTION",
        verdict: "CAUTION", notes,
      };
    }
  }

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
  pullbackPct: number | null;        // % below 52w high (positive = below high)
  pullbackGate: "PASS" | "CAUTION" | "FAIL" | "UNKNOWN"; // R3.2
  vixB3Gate: "PASS" | "FAIL" | "UNKNOWN";                // R3.3
  verdict: B3Verdict;
  notes: string[];
};

// R3.3: VIX must be below 22 for B3 LEAPS entry.
export const B3_VIX_LIMIT = 22;

export function evaluateB3(
  ticker: string,
  bars: Bars | null,
  regime: Regime,
  todayISO: string,
  vix: number | null = null,
): B3Row {
  const alert = B3_ALERTS[ticker];
  const notes: string[] = [];
  if (!bars || !alert) {
    return {
      ticker, price: null, alertRef: "—", daysToHardExit: null, regimeMatch: false,
      pullbackPct: null, pullbackGate: "UNKNOWN", vixB3Gate: "UNKNOWN",
      verdict: "MONITOR", notes: ["no data"],
    };
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

  // R3.2 Pullback gate: blood-in-streets zone is 10–25% below 52w high.
  const { pctFromHigh } = week52Range(bars.high, bars.low, bars.close);
  const pullbackPct = Math.abs(pctFromHigh); // positive = % below high
  let pullbackGate: B3Row["pullbackGate"] = "UNKNOWN";
  if (pullbackPct >= 10 && pullbackPct <= 25) pullbackGate = "PASS";
  else if (pullbackPct > 25) pullbackGate = "CAUTION"; // steep drop — borderline
  else pullbackGate = "FAIL"; // < 10% off high — chasing strength

  // R3.3 VIX gate: VIX must be below 22 for new B3 entries.
  const vixB3Gate: B3Row["vixB3Gate"] = vix == null ? "UNKNOWN" : vix < B3_VIX_LIMIT ? "PASS" : "FAIL";
  if (vixB3Gate === "FAIL") notes.push(`VIX ${vix?.toFixed(1)} ≥ ${B3_VIX_LIMIT} — R3.3 blocks new entry`);
  if (pullbackGate === "FAIL") notes.push(`Only ${pullbackPct.toFixed(1)}% below 52w high — R3.2 needs 10-25% pullback`);

  // Verdict priority:
  // 1. EXIT APPROACHING — existing position warning (always show regardless of entry gates)
  // 2. FIRED — existing position
  // 3. HOLD — regime blocks new entries
  // 4. HOLD — VIX too high (R3.3)
  // 5. NEAR ENTRY — price at alert, pullback OK, regime matches
  // 6. MONITOR — default
  let verdict: B3Verdict = "MONITOR";
  if (daysToHardExit != null && daysToHardExit <= 30 && daysToHardExit >= 0) {
    verdict = "EXIT APPROACHING";
  } else if (alert.fired) {
    verdict = "FIRED";
  } else if (!regimeMatch) {
    verdict = "HOLD";
  } else if (vixB3Gate === "FAIL") {
    verdict = "HOLD"; // VIX gate blocks new B3 entries
  } else if (alert.alert && price >= alert.alert) {
    // Price at/above alert — now check pullback quality
    verdict = (pullbackGate === "PASS" || pullbackGate === "CAUTION") ? "NEAR ENTRY" : "MONITOR";
  }

  return { ticker, price, alertRef, daysToHardExit, regimeMatch, pullbackPct, pullbackGate, vixB3Gate, verdict, notes };
}

// ───── Owned positions evaluation ─────

export type OwnedOptionRow = {
  symbol: string;
  type: "CALL" | "PUT";
  side: "LONG" | "SHORT";
  strike: number;
  expiry: string;
  account: string;
  contracts: number;
  daysToExpiry: number;
  daysToHardExit: number | null;
  underlyingPrice: number | null;
  costBasis: number;
  stopInfo: string;
  status: "green" | "amber" | "red";
  note: string;
};

export function evaluateOwnedOption(
  opt: CoworkPortfolio["owned_options"][0],
  underlyingBars: Bars | null,
  todayISO: string,
): OwnedOptionRow {
  const today = new Date(todayISO);
  const expiry = new Date(opt.expiry);
  const daysToExpiry = Math.round((expiry.getTime() - today.getTime()) / 86_400_000);

  let daysToHardExit: number | null = null;
  if (opt.hard_exit) {
    const exit = new Date(opt.hard_exit);
    daysToHardExit = Math.round((exit.getTime() - today.getTime()) / 86_400_000);
  }

  const underlyingPrice = underlyingBars ? underlyingBars.close[underlyingBars.close.length - 1] : null;

  const stopInfo = opt.gtc_stop != null
    ? `GTC stop $${opt.gtc_stop}`
    : opt.stop_manual != null
    ? `Manual stop $${opt.stop_manual}`
    : "No stop set";

  let status: "green" | "amber" | "red" = "green";
  if (daysToHardExit != null && daysToHardExit >= 0 && daysToHardExit <= 14) status = "red";
  else if (daysToHardExit != null && daysToHardExit >= 0 && daysToHardExit <= 30) status = "amber";

  const parts: string[] = [];
  if (daysToHardExit != null) {
    parts.push(daysToHardExit < 0 ? "Hard exit PASSED" : `Hard exit ${daysToHardExit}d`);
  }
  parts.push(`DTE ${daysToExpiry}`);
  parts.push(stopInfo);
  const note = parts.join(" · ");

  return {
    symbol: opt.symbol,
    type: opt.type,
    side: opt.side,
    strike: opt.strike,
    expiry: opt.expiry,
    account: opt.account,
    contracts: opt.contracts,
    daysToExpiry,
    daysToHardExit,
    underlyingPrice,
    costBasis: opt.cost_basis,
    stopInfo,
    status,
    note,
  };
}

export type OwnedStockRow = {
  symbol: string;
  account: string;
  shares: number;
  costBasis: number;
  livePrice: number | null;
  pnlPct: number | null;
  stop: number | null;
  status: "green" | "amber" | "red";
  note: string;
};

export function evaluateOwnedStock(
  stock: CoworkPortfolio["owned_stocks"][0],
  bars: Bars | null,
): OwnedStockRow {
  const livePrice = bars ? bars.close[bars.close.length - 1] : null;
  const pnlPct =
    livePrice != null && stock.cost_basis > 0
      ? ((livePrice - stock.cost_basis) / stock.cost_basis) * 100
      : null;

  let status: "green" | "amber" | "red" = "green";
  if (pnlPct != null && pnlPct < -10) status = "red";
  else if (pnlPct != null && pnlPct < 0) status = "amber";

  const note = [
    pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—",
    stock.stop != null ? `Stop $${stock.stop}` : "",
  ].filter(Boolean).join(" · ");

  return {
    symbol: stock.symbol,
    account: stock.account,
    shares: stock.shares,
    costBasis: stock.cost_basis,
    livePrice,
    pnlPct,
    stop: stock.stop ?? null,
    status,
    note,
  };
}

// ───── Re-entry evaluation ─────

export type ReentryRow = {
  symbol: string;
  windowStatus: "open" | "upcoming" | "passed";
  daysToWindowOpen: number | null;
  daysToWindowClose: number | null;
  daysToGoNogo: number | null;
  trigger: string;
  status: "green" | "amber" | "neutral";
};

export function evaluateReentry(
  entry: CoworkPortfolio["monitor_reentry"][0],
  todayISO: string,
): ReentryRow {
  const today = new Date(todayISO);

  let daysToWindowOpen: number | null = null;
  let daysToWindowClose: number | null = null;
  let daysToGoNogo: number | null = null;

  if (entry.window_open) {
    daysToWindowOpen = Math.round((new Date(entry.window_open).getTime() - today.getTime()) / 86_400_000);
  }
  if (entry.window_close) {
    daysToWindowClose = Math.round((new Date(entry.window_close).getTime() - today.getTime()) / 86_400_000);
  }
  if (entry.go_nogo_date) {
    daysToGoNogo = Math.round((new Date(entry.go_nogo_date).getTime() - today.getTime()) / 86_400_000);
  }

  let windowStatus: ReentryRow["windowStatus"] = "upcoming";
  if (daysToWindowClose != null && daysToWindowClose < 0) windowStatus = "passed";
  else if (daysToWindowOpen != null && daysToWindowOpen <= 0) windowStatus = "open";

  let status: "green" | "amber" | "neutral" = "neutral";
  if (windowStatus === "open") status = "green";
  else if (daysToWindowOpen != null && daysToWindowOpen <= 7) status = "amber";

  return {
    symbol: entry.symbol,
    windowStatus,
    daysToWindowOpen,
    daysToWindowClose,
    daysToGoNogo,
    trigger: entry.trigger ?? "",
    status,
  };
}

// ───── Scalp evaluation ─────

export type ScalpRow = {
  ticker: string;
  status: "clear" | "blocked" | "caution";
  reason: string;
};

export function evaluateScalp(
  scalp: CoworkPortfolio["monitor_scalp"] | null,
  ownedOptions: CoworkPortfolio["owned_options"],
  underlyingBars: Bars | null,
  vix: number | null,
): ScalpRow | null {
  if (!scalp) return null;
  const { ticker } = scalp;

  // Breakeven guard: if any owned LEAPS for this ticker has a mark, check it vs cost basis.
  const relatedLeaps = ownedOptions.filter(
    (o) => o.symbol === ticker && o.type === "CALL" && o.side === "LONG",
  );
  for (const leaps of relatedLeaps) {
    if (leaps.mark != null && leaps.mark < leaps.cost_basis / (leaps.contracts * 100)) {
      return { ticker, status: "blocked", reason: `${ticker} LEAPS mark below cost basis — breakeven guard (SR.10)` };
    }
  }

  // VIX gate
  const vixCfg = scalp.gates?.vix;
  if (vix != null && vixCfg) {
    if (vix > vixCfg.skip_above) {
      return { ticker, status: "blocked", reason: `VIX ${vix.toFixed(1)} > ${vixCfg.skip_above} skip threshold` };
    }
    if (vix > vixCfg.ok[1]) {
      return { ticker, status: "caution", reason: `VIX ${vix.toFixed(1)} — elevated (ideal <${vixCfg.ideal_below})` };
    }
  }

  // RSI gate for underlying
  if (underlyingBars && scalp.gates?.rsi) {
    const rsiVal = rsi(underlyingBars.close, 14);
    const [rsiLo, rsiHi] = scalp.gates.rsi;
    if (rsiVal < rsiLo || rsiVal > rsiHi) {
      return { ticker, status: "caution", reason: `${ticker} RSI ${rsiVal.toFixed(0)} outside ideal [${rsiLo}–${rsiHi}]` };
    }
  }

  return { ticker, status: "clear", reason: "All automated gates pass — manual gates (price, MACD, spy_macro) still apply" };
}

// ───── B4 — Day Trading evaluation ─────
// B4 is heavily discretionary (charting, catalyst, order flow are the owner's
// eye). This evaluator computes only what's honestly automatable: the session
// clock (10 AM rule / dead zone / 3:45 close), a daily futures-bias proxy, and
// go-live readiness. Everything else is surfaced as MANUAL-confirm.

export type B4SessionWindow =
  | "PRE_MARKET" | "PRE_10AM" | "MORNING_ENTRY" | "DEAD_ZONE"
  | "AFTERNOON_ENTRY" | "WIND_DOWN" | "CLOSED" | "WEEKEND";

export type B4GateState = "PASS" | "FAIL" | "MANUAL" | "UNKNOWN";
export type B4Bias = "BULL" | "BEAR" | "UNKNOWN";

export type B4Status = {
  live: boolean;                 // config.live AND go-live gate satisfied
  readyToGoLive: boolean;        // all required decisions locked
  sessionWindow: B4SessionWindow;
  sessionLabel: string;
  etTime: string;                // "10:23 AM ET"
  etMinutes: number;
  entriesAllowed: boolean;
  weeklyTask: string;
  futures: {
    es: { price: number | null; pctFromEma: number | null; bias: B4Bias };
    nq: { price: number | null; pctFromEma: number | null; bias: B4Bias };
    combinedBias: "CALLS" | "PUTS" | "MIXED" | "UNKNOWN";
  };
  gates: { id: string; label: string; state: B4GateState; detail: string }[];
  goLive: { id: number; label: string; status: "OPEN" | "SET"; value: string | null }[];
  watchlist: { ticker: string; price: number | null; bullLevel: number | null; bearLevel: number | null; targets: number[]; stop: number | null }[];
  lossCap: number | null;
  maxTrades: number;
  notes: string[];
};

// Derive ET hour/minute/weekday from a Date without external tz libs.
function etParts(now: Date): { minutes: number; weekday: number; label: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // en-US hour12:false can emit "24" at midnight
  const minute = parseInt(get("minute"), 10);
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = wdMap[get("weekday")] ?? 0;
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", minute: "2-digit",
  }).format(now) + " ET";
  return { minutes: hour * 60 + minute, weekday, label };
}

function futureBias(bars: Bars | null): { price: number | null; pctFromEma: number | null; bias: B4Bias } {
  if (!bars || bars.close.length < 10) return { price: null, pctFromEma: null, bias: "UNKNOWN" };
  const price = bars.close[bars.close.length - 1];
  const ema = emaSeries(bars.close, 9);
  const e = ema[ema.length - 1];
  const pctFromEma = ((price - e) / e) * 100;
  return { price, pctFromEma, bias: price > e ? "BULL" : price < e ? "BEAR" : "UNKNOWN" };
}

export function evaluateB4(
  b4: CoworkPortfolio["monitor_B4_daytrade"] | null,
  esBars: Bars | null,
  nqBars: Bars | null,
  watchBars: Map<string, Bars | null>,
  now: Date,
): B4Status {
  const { minutes, weekday, label } = etParts(now);
  const notes: string[] = [SPECIAL_NOTES.B4_NOT_LIVE];

  // Session window from ET clock.
  let sessionWindow: B4SessionWindow;
  if (weekday === 0 || weekday === 6) sessionWindow = "WEEKEND";
  else if (minutes < 570) sessionWindow = "PRE_MARKET";                       // < 9:30
  else if (minutes < B4_SESSION.entryOpen) sessionWindow = "PRE_10AM";         // 9:30–9:59
  else if (minutes < B4_SESSION.morningClose) sessionWindow = "MORNING_ENTRY"; // 10:00–11:29
  else if (minutes < B4_SESSION.afternoonOpen) sessionWindow = "DEAD_ZONE";    // 11:30–13:29
  else if (minutes < B4_SESSION.afternoonClose) sessionWindow = "AFTERNOON_ENTRY"; // 13:30–15:29
  else if (minutes < B4_SESSION.hardClose) sessionWindow = "WIND_DOWN";        // 15:30–15:44
  else sessionWindow = "CLOSED";                                              // 15:45+

  const sessionLabels: Record<B4SessionWindow, string> = {
    WEEKEND: "Weekend — market closed",
    PRE_MARKET: "Pre-market — set levels, read futures, no entries",
    PRE_10AM: "Open but pre-10 AM — no entries yet (R4.G1)",
    MORNING_ENTRY: "Morning entry window (10:00–11:30)",
    DEAD_ZONE: "Midday dead zone — manage only, no new entries (HR.2)",
    AFTERNOON_ENTRY: "Afternoon entry window (1:30–3:30)",
    WIND_DOWN: "Wind-down — close positions, no new (flat by 3:45)",
    CLOSED: "Session closed — all B4 positions must be flat (HR.3)",
  };
  const entriesAllowed = sessionWindow === "MORNING_ENTRY" || sessionWindow === "AFTERNOON_ENTRY";

  // Weekly cadence (Mon rebuild, Tue–Thu refine, Fri close-out note).
  const weeklyTask =
    weekday === 1 ? "Monday — build the week's roadmap (upside + downside levels, gaps, round numbers), then trade." :
    weekday === 5 ? "Friday — trade, then an optional 5-min close-out note on where the map ended." :
    weekday >= 2 && weekday <= 4 ? "Confirm + refine Monday's map, trade the breaks. No rebuild." :
    "Weekend — no B4 work.";

  // Futures bias (DAILY 9-EMA proxy — true rule is intraday VWAP+9EMA).
  const es = futureBias(esBars);
  const nq = futureBias(nqBars);
  let combinedBias: B4Status["futures"]["combinedBias"] = "UNKNOWN";
  if (es.bias !== "UNKNOWN" && nq.bias !== "UNKNOWN") {
    if (es.bias === "BULL" && nq.bias === "BULL") combinedBias = "CALLS";
    else if (es.bias === "BEAR" && nq.bias === "BEAR") combinedBias = "PUTS";
    else combinedBias = "MIXED";
  }
  notes.push("Futures bias is a DAILY 9-EMA proxy — confirm intraday VWAP + 9 EMA before any entry (R4.G2).");

  // Go-live decisions.
  const lossCap = b4?.daily_loss_cap ?? null;
  const flowTool = b4?.order_flow_tool ?? null;
  const instrument = b4?.launch_instrument ?? null;
  const paperMode = b4?.paper_trade?.mode ?? null;
  const goLive: B4Status["goLive"] = [
    { id: 1, label: "Daily loss cap ($)", status: lossCap != null ? "SET" : "OPEN", value: lossCap != null ? `$${lossCap}` : null },
    { id: 2, label: "Order-flow tool", status: flowTool != null ? "SET" : "OPEN", value: flowTool },
    { id: 3, label: "Launch instrument", status: instrument != null ? "SET" : "OPEN", value: instrument },
    { id: 4, label: "Paper-trade validation", status: paperMode != null ? "SET" : "OPEN", value: paperMode },
  ];
  const readyToGoLive = lossCap != null && instrument != null && paperMode != null;
  const live = !!b4?.live && readyToGoLive;

  // Gate stack (G0–G8) from the canonical ruleset (b4-rules.ts). The app can
  // only auto-evaluate the gates it has data for — G1 (clock), G2 (futures
  // proxy), G8 (loss cap). Everything else — event lock, level break,
  // volume+flow, catalyst, liquidity, absorption — needs live/manual inputs
  // (Bookmap, live spread, the owner's eye) and renders as MANUAL.
  const gates = B4_GATE_DEFS.map((g) => {
    let state: B4GateState = "MANUAL";
    let detail: string = g.description;
    if (g.code === "R4.G0") {
      state = "MANUAL";
      detail = "FOMC/CPI/PCE/NFP days: no entry until release + price confirms. FOMC = 2PM + 2:30 Powell. Confirm none today.";
    } else if (g.code === "R4.G1") {
      state = entriesAllowed ? "PASS" : "FAIL";
      detail = entriesAllowed ? `In entry window (${label}).` : `${sessionLabels[sessionWindow]}.`;
    } else if (g.code === "R4.G2") {
      state = combinedBias === "UNKNOWN" ? "UNKNOWN" : combinedBias === "MIXED" ? "FAIL" : "MANUAL";
      detail = combinedBias === "UNKNOWN" ? "Futures data unavailable." :
        combinedBias === "MIXED" ? "ES/NQ bias mixed vs 9-EMA — skip (proxy)." :
        `ES/NQ lean ${combinedBias} (daily 9-EMA proxy) — confirm BOTH break their mapped levels in confluence with the instrument.`;
    } else if (g.code === "R4.G8") {
      state = lossCap != null ? "MANUAL" : "FAIL";
      detail = lossCap != null ? `Cap $${lossCap} — confirm not hit before entering.` : "Loss cap not set (go-live decision 1).";
    }
    return { id: g.code, label: g.name, state, detail };
  });

  // Watchlist with live prices + pre-mapped levels.
  const watchlist = (b4?.watchlist ?? []).map((w) => {
    const bars = watchBars.get(w.ticker) ?? null;
    return {
      ticker: w.ticker,
      price: bars ? bars.close[bars.close.length - 1] : null,
      bullLevel: w.bull_level ?? null,
      bearLevel: w.bear_level ?? null,
      targets: w.targets ?? [],
      stop: w.stop ?? null,
    };
  });

  if (!readyToGoLive) notes.push(`Go-live gate NOT met — ${goLive.filter((d) => d.status === "OPEN").map((d) => d.label).join(", ")} still open.`);

  return {
    live, readyToGoLive, sessionWindow, sessionLabel: sessionLabels[sessionWindow],
    etTime: label, etMinutes: minutes, entriesAllowed, weeklyTask,
    futures: { es, nq, combinedBias },
    gates, goLive, watchlist,
    lossCap, maxTrades: b4?.max_trades_per_day ?? 2, notes,
  };
}

// ───── B4 multi-timeframe success scoring (2m / 5m / 15m / 30m) ─────
// MasiTrades: trade level-to-level on the low timeframes, and the strongest
// setups are where timeframes STACK. We score each timeframe for how strongly
// it supports a directional setup, then weight higher timeframes more (a 30m
// read is stronger than a 2m read) and reward multi-timeframe agreement.

export const B4_TIMEFRAMES = ["2m", "5m", "15m", "30m"] as const;
export type B4Timeframe = (typeof B4_TIMEFRAMES)[number];

// Yahoo range per interval — enough bars for MACD(35) while staying intraday.
export const B4_TF_RANGE: Record<B4Timeframe, string> = { "2m": "1d", "5m": "1d", "15m": "5d", "30m": "5d" };
// Regular-session bar counts (6.5h) for slicing a single-session VWAP.
const B4_TF_SESSION_BARS: Record<B4Timeframe, number> = { "2m": 195, "5m": 78, "15m": 26, "30m": 13 };
// Higher timeframe = stronger signal.
const B4_TF_WEIGHT: Record<B4Timeframe, number> = { "2m": 1, "5m": 2, "15m": 3, "30m": 4 };

export type TfBias = "CALLS" | "PUTS" | "NEUTRAL";

export type TfScore = {
  tf: B4Timeframe;
  price: number | null;
  score: number;       // 0-100 conviction this TF supports a setup
  bias: TfBias;
  aboveEma9: boolean | null;
  aboveVwap: boolean | null;
  rsi: number | null;
  macdUp: boolean | null;
  volRatio: number | null; // last bar volume vs 20-bar average
};

export type B4MtfRow = {
  ticker: string;
  timeframes: TfScore[];
  confluence: number;      // # of timeframes agreeing with overall bias (0-4)
  overallBias: TfBias;
  overallScore: number;    // weighted 0-100
  grade: "A+" | "A" | "B" | "C" | "—";
};

function sliceBars(b: Bars, n: number): Bars {
  return { close: b.close.slice(-n), volume: b.volume.slice(-n), high: b.high.slice(-n), low: b.low.slice(-n) };
}

export function vwap(bars: Bars): number | null {
  let pv = 0, v = 0;
  for (let i = 0; i < bars.close.length; i++) {
    const tp = (bars.high[i] + bars.low[i] + bars.close[i]) / 3;
    pv += tp * bars.volume[i];
    v += bars.volume[i];
  }
  return v > 0 ? pv / v : null;
}

export function evaluateTimeframe(tf: B4Timeframe, bars: Bars | null): TfScore {
  const empty: TfScore = { tf, price: null, score: 0, bias: "NEUTRAL", aboveEma9: null, aboveVwap: null, rsi: null, macdUp: null, volRatio: null };
  if (!bars || bars.close.length < 20) return empty;

  const price = bars.close[bars.close.length - 1];
  const emaArr = emaSeries(bars.close, 9);
  const ema9 = emaArr[emaArr.length - 1];
  const vw = vwap(sliceBars(bars, B4_TF_SESSION_BARS[tf]));
  const rsiVal = rsi(bars.close, 14);
  const m = macd(bars.close);

  const win = Math.min(20, bars.volume.length);
  const avgVol = bars.volume.slice(-win).reduce((a, b) => a + b, 0) / win;
  const lastVol = bars.volume[bars.volume.length - 1];
  const volRatio = avgVol > 0 ? lastVol / avgVol : null;

  const aboveEma9 = price > ema9;
  const aboveVwap = vw != null ? price > vw : null;
  const macdUp = m.aboveSignal;

  // Directional vote across EMA9 / VWAP / RSI / MACD.
  let net = 0;
  let maxNet = 0;
  net += aboveEma9 ? 1 : -1; maxNet += 1;
  if (aboveVwap != null) { net += aboveVwap ? 1 : -1; maxNet += 1; }
  net += rsiVal > 50 ? 1 : -1; maxNet += 1;
  net += macdUp ? 1 : -1; maxNet += 1;

  // Volume confirmation scales conviction (fake breakouts have thin volume).
  const volFactor = volRatio == null ? 0.7 : volRatio >= 1.5 ? 1 : volRatio >= 1 ? 0.85 : 0.6;
  const score = Math.round((Math.abs(net) / maxNet) * 100 * volFactor);
  const bias: TfBias = net > 0 ? "CALLS" : net < 0 ? "PUTS" : "NEUTRAL";

  return { tf, price, score, bias, aboveEma9, aboveVwap, rsi: rsiVal, macdUp, volRatio };
}

export function evaluateB4Mtf(ticker: string, tfBars: Partial<Record<B4Timeframe, Bars | null>>): B4MtfRow {
  const timeframes = B4_TIMEFRAMES.map((tf) => evaluateTimeframe(tf, tfBars[tf] ?? null));

  let callW = 0, putW = 0, totalW = 0, scoreAcc = 0;
  for (const t of timeframes) {
    const w = B4_TF_WEIGHT[t.tf];
    if (t.bias === "CALLS") callW += w;
    else if (t.bias === "PUTS") putW += w;
    totalW += w;
    scoreAcc += t.score * w;
  }
  const overallBias: TfBias = callW > putW ? "CALLS" : putW > callW ? "PUTS" : "NEUTRAL";
  const confluence = overallBias === "NEUTRAL" ? 0 : timeframes.filter((t) => t.bias === overallBias).length;
  const overallScore = totalW > 0 ? Math.round(scoreAcc / totalW) : 0;

  // Grade rewards alignment: A+ needs full 4/4 confluence AND real conviction.
  const hasData = timeframes.some((t) => t.price != null);
  let grade: B4MtfRow["grade"] = "—";
  if (hasData) {
    if (confluence === 4 && overallScore >= 70) grade = "A+";
    else if (confluence >= 3 && overallScore >= 55) grade = "A";
    else if (confluence >= 2 && overallScore >= 40) grade = "B";
    else grade = "C";
  }

  return { ticker, timeframes, confluence, overallBias, overallScore, grade };
}
