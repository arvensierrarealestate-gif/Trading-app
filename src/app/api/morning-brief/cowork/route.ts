import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { fitGaussianHMM } from "@/lib/hmm";
import { REGIMES, type Regime } from "@/lib/regime";
import {
  B1_TICKERS,
  B2_TICKERS,
  B3_TICKERS,
  B3_ALERTS,
  EXTRA_WATCH,
  SPECIAL_NOTES,
  VIX_PRIME,
} from "@/lib/cowork-brief";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

// ───── Data fetchers ─────

type Bars = { close: number[]; volume: number[]; high: number[]; low: number[] };

async function fetchBars(symbol: string, range = "1y"): Promise<Bars | null> {
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

function emaSeries(vals: number[], period: number): number[] {
  if (!vals.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [vals[0]];
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi(close: number[], period = 14): number {
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

// Aggregate daily closes to weekly by taking every Friday-equivalent close.
function toWeekly(close: number[]): number[] {
  const out: number[] = [];
  for (let i = 4; i < close.length; i += 5) out.push(close[i]);
  return out;
}

function macd(close: number[]): { macd: number; signal: number; aboveSignal: boolean; aboveZero: boolean } {
  if (close.length < 35) return { macd: 0, signal: 0, aboveSignal: false, aboveZero: false };
  const e12 = emaSeries(close, 12);
  const e26 = emaSeries(close, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const signalLine = emaSeries(macdLine, 9);
  const last = macdLine[macdLine.length - 1];
  const sig = signalLine[signalLine.length - 1];
  return { macd: last, signal: sig, aboveSignal: last > sig, aboveZero: last > 0 };
}

function hv30(close: number[]): number {
  if (close.length < 31) return 0;
  const last31 = close.slice(-31);
  const rets: number[] = [];
  for (let i = 1; i < last31.length; i++) rets.push(Math.log(last31[i] / last31[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function week52Range(high: number[], low: number[], close: number[]) {
  const days = Math.min(252, high.length);
  const h = Math.max(...high.slice(-days));
  const l = Math.min(...low.slice(-days));
  const c = close[close.length - 1];
  return { high52: h, low52: l, last: c, pctFromHigh: ((c - h) / h) * 100 };
}

function regimeFromCloses(close: number[]): { regime: Regime; confidence: number } {
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

type B1Row = {
  ticker: string;
  price: number | null;
  high52: number | null;
  low52: number | null;
  pctFromHigh: number | null;
  flag: boolean; // true if price is down >10% from 52-week high
  note?: string;
};

function evaluateB1(ticker: string, bars: Bars | null): B1Row {
  if (!bars) return { ticker, price: null, high52: null, low52: null, pctFromHigh: null, flag: false, note: "no data" };
  const { last, high52, low52, pctFromHigh } = week52Range(bars.high, bars.low, bars.close);
  return {
    ticker,
    price: last,
    high52,
    low52,
    pctFromHigh,
    flag: pctFromHigh <= -10,
  };
}

type B2Verdict = "GO" | "CAUTION" | "SKIP";
type B2Row = {
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

function evaluateB2(ticker: string, bars: Bars | null, vix: number | null): B2Row {
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

type B3Verdict = "MONITOR" | "NEAR ENTRY" | "EXIT APPROACHING" | "HOLD" | "FIRED";
type B3Row = {
  ticker: string;
  price: number | null;
  alertRef: string;
  daysToHardExit: number | null;
  regimeMatch: boolean;
  verdict: B3Verdict;
  notes: string[];
};

function evaluateB3(ticker: string, bars: Bars | null, regime: Regime, todayISO: string): B3Row {
  const alert = B3_ALERTS[ticker];
  const notes: string[] = [];
  if (!bars || !alert) {
    return { ticker, price: null, alertRef: "—", daysToHardExit: null, regimeMatch: false, verdict: "MONITOR", notes: ["no data"] };
  }
  const price = bars.close[bars.close.length - 1];

  // Distance to alert.
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

  // Floor / stop zone.
  if (alert.floor && price <= alert.floor) notes.push(`Price at/below floor $${alert.floor}`);

  // Hard exit countdown.
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

// ───── Brief formatting ─────

function fmtPrice(p: number | null): string {
  return p == null ? "—" : `$${p.toFixed(2)}`;
}

function buildMarketLine(regime: Regime, conf: number, vix: number | null, spyChangePct: number, spyPrice: number) {
  const vixState = vix == null ? "unknown" : vix < VIX_PRIME.lo ? "Caution (low premium)" : vix > VIX_PRIME.hi ? "No trade (elevated)" : "Prime window";
  let rec: string;
  if (regime === "crash") rec = "Sit out";
  else if (regime === "bear") rec = "Selective only";
  else if (vix != null && vix > VIX_PRIME.hi) rec = "Selective only";
  else rec = "Trade with discipline";
  return {
    regimeLine: `Regime: ${regime[0].toUpperCase()}${regime.slice(1)} · ${(conf * 100).toFixed(0)}% confidence`,
    vixLine: vix == null ? "VIX: unavailable" : `VIX: ${vix.toFixed(2)} · ${vixState}`,
    spyLine: `SPY: ${fmtPrice(spyPrice)} ${spyChangePct >= 0 ? "+" : ""}${spyChangePct.toFixed(2)}%`,
    recLine: `Recommendation: ${rec}`,
  };
}

function formatB1(rows: B1Row[]): string {
  const lines = rows.map((r) => {
    if (r.price == null) return `${r.ticker} — no data`;
    const pos52 = r.high52 && r.low52 ? `52w: $${r.low52.toFixed(2)} – $${r.high52.toFixed(2)}` : "";
    const flag = r.flag ? "⚑ down >10% from 52w high" : "";
    return `${r.ticker} — ${fmtPrice(r.price)} ${pos52 ? `(${pos52})` : ""}${flag ? ` — ${flag}` : ""}`.trim();
  });
  const flagged = rows.filter((r) => r.flag).length;
  const summary = flagged ? `Overall: ${flagged} item${flagged === 1 ? "" : "s"} to review` : "Overall: All clear";
  return [...lines, "", summary].join("\n");
}

function formatB2(rows: B2Row[], vix: number | null): string {
  const vixHeader = vix == null
    ? "VIX unavailable — gate cannot be evaluated"
    : `VIX at ${vix.toFixed(2)} — ${vix >= VIX_PRIME.lo && vix <= VIX_PRIME.hi ? "Prime window" : vix < VIX_PRIME.lo ? "Caution (thin premium)" : "No trade (elevated)"}`;

  const lines: string[] = [vixHeader, ""];
  for (const r of rows) {
    if (r.price == null) {
      lines.push(`${r.ticker} — no data`);
      continue;
    }
    lines.push(
      `${r.ticker} — ${fmtPrice(r.price)} — RSI ${r.rsi?.toFixed(0) ?? "—"} (${r.rsiGate}) — HV30 ${r.hv30?.toFixed(1) ?? "—"}% · IV30 n/a`,
    );
    lines.push(`  Weekly MACD: ${r.macdGate}${r.macdAboveZero ? " · above zero" : " · below zero"}${r.macdAboveSignal ? " · above signal" : " · below signal"}`);
    lines.push(`  Verdict: **${r.verdict}**`);
    if (r.notes.length) lines.push(...r.notes.map((n) => `  · ${n}`));
    lines.push("");
  }
  const gos = rows.filter((r) => r.verdict === "GO" && r.price != null);
  const top = gos.length ? gos.sort((a, b) => (a.rsi ?? 100) - (b.rsi ?? 100))[0] : null;
  if (top) lines.push(`Top opportunity: ${top.ticker} (RSI ${top.rsi!.toFixed(0)} · ${top.rsiGate}).`);
  else lines.push("No B2 entries today — VIX / RSI / MACD blocks.");
  return lines.join("\n");
}

function formatB3(rows: B3Row[], regime: Regime): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (r.price == null) {
      lines.push(`${r.ticker} — no data`);
      continue;
    }
    lines.push(`${r.ticker} — ${fmtPrice(r.price)} — ${r.alertRef} — ${r.verdict}${r.daysToHardExit != null ? ` (hard exit in ${r.daysToHardExit}d)` : ""}`);
    if (r.notes.length) lines.push(...r.notes.map((n) => `  · ${n}`));
  }
  const exitsSoon = rows.filter((r) => r.daysToHardExit != null && r.daysToHardExit >= 0 && r.daysToHardExit <= 30);
  lines.push("");
  lines.push("⚑ Hard exit alerts:");
  if (exitsSoon.length) {
    for (const r of exitsSoon) lines.push(`  ${r.ticker} — ${r.daysToHardExit}d to hard exit`);
  } else {
    lines.push("  None within 30 days.");
  }
  // Top entry candidate: prefer NEAR ENTRY with regime match.
  const candidates = rows.filter((r) => r.verdict === "NEAR ENTRY" && r.regimeMatch);
  if (candidates.length) lines.push(`\nTop B3 setup: ${candidates[0].ticker}.`);
  else if (regime === "bear" || regime === "crash") lines.push(`\nTop B3 setup: none — regime ${regime} blocks new entries. Hold existing.`);
  else lines.push("\nTop B3 setup: none today.");
  return lines.join("\n");
}

function formatExtras(spcx: B1Row, rklb: B1Row): string {
  return [
    `SPCX — ${fmtPrice(spcx.price)} · ${SPECIAL_NOTES.SPCX_WINDOW}`,
    `RKLB — ${fmtPrice(rklb.price)} · ${SPECIAL_NOTES.RKLB_NOTE}`,
  ].join("\n");
}

// ───── Narrative sections via Sonnet ─────

async function generateNarrative(input: {
  regime: Regime;
  vix: number | null;
  b1Flagged: number;
  b2GoCount: number;
  b2Top: string | null;
  b3Exits: { ticker: string; days: number }[];
  b3NearEntry: string | null;
  spcxPrice: number | null;
}): Promise<{ priority: string; reminder: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `Build the "TODAY'S PRIORITY" and "DISCIPLINE REMINDER" sections of the owner's morning brief from these computed signals. Be specific, terse, and actionable.

Signals:
- Regime: ${input.regime}
- VIX: ${input.vix ?? "n/a"}
- B1 flagged (down >10% from 52w high): ${input.b1Flagged}
- B2 GO verdicts: ${input.b2GoCount}${input.b2Top ? ` (top: ${input.b2Top})` : ""}
- B3 near-entry candidate: ${input.b3NearEntry ?? "none"}
- B3 hard exits within 30d: ${input.b3Exits.length ? input.b3Exits.map((e) => `${e.ticker} (${e.days}d)`).join(", ") : "none"}
- SPCX price: ${input.spcxPrice ?? "n/a"} (30-day post-IPO window, buy ~Jul 10)
- IRA accounts forbid GTC stops — flag if relevant.

Output exactly two sections, no header, no preamble, plain markdown:

PRIORITY:
1. [most urgent — typically a hard exit within 30d, then a NEAR ENTRY in matching regime, then top B2 GO]
2. [second item if any]
3. [third item if any]

REMINDER:
[one sentence, tailored to today's regime/VIX state]`;

  try {
    const anthropic = new Anthropic({ apiKey });
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: "You are the owner's personal trading coach. Concise, honest, no filler. Output only the requested sections.",
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    const [priorityBlock, reminderBlock] = text.split(/REMINDER:/i);
    const priority = priorityBlock.replace(/^PRIORITY:\s*/i, "").trim();
    const reminder = (reminderBlock ?? "").trim();
    return { priority, reminder };
  } catch {
    return null;
  }
}

// ───── Route ─────

type Body = { user_id?: string; bucket?: "all" | "b1" | "b2" | "b3"; tickers?: string[] };

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body: Body = await req.json().catch(() => ({} as Body));
  const bucket = body.bucket ?? "all";
  const overrideTickers = Array.isArray(body.tickers) && body.tickers.length ? body.tickers.map((t) => t.toUpperCase()) : null;

  // Decide which tickers to fetch.
  const needB1 = bucket === "all" || bucket === "b1";
  const needB2 = bucket === "all" || bucket === "b2";
  const needB3 = bucket === "all" || bucket === "b3";

  const b1List = needB1 ? (overrideTickers ?? Array.from(B1_TICKERS)) : [];
  const b2List = needB2 ? (overrideTickers ?? Array.from(B2_TICKERS)) : [];
  const b3List = needB3 ? (overrideTickers ?? Array.from(B3_TICKERS)) : [];

  // Always fetch SPY + ^VIX + extras (SPCX/RKLB) for the header / context lines.
  const extras = Array.from(EXTRA_WATCH);
  const universe = Array.from(new Set([...b1List, ...b2List, ...b3List, ...extras, "SPY", "^VIX"]));

  const fetched = await Promise.all(universe.map((sym) => fetchBars(sym).then((b) => [sym, b] as const)));
  const barsMap = new Map(fetched);

  const spy = barsMap.get("SPY");
  const vixBars = barsMap.get("^VIX");
  const spyClose = spy?.close[spy.close.length - 1] ?? null;
  const spyPrev = spy?.close[spy.close.length - 2] ?? null;
  const spyChangePct = spyClose != null && spyPrev != null ? ((spyClose - spyPrev) / spyPrev) * 100 : 0;
  const vix = vixBars?.close[vixBars.close.length - 1] ?? null;

  if (!spy) return NextResponse.json({ error: "Could not fetch SPY market data" }, { status: 502 });
  const { regime, confidence } = regimeFromCloses(spy.close);

  // Evaluate buckets.
  const b1Rows: B1Row[] = b1List.map((t) => evaluateB1(t, barsMap.get(t) ?? null));
  const b2Rows: B2Row[] = b2List.map((t) => evaluateB2(t, barsMap.get(t) ?? null, vix));
  const today = new Date().toISOString().slice(0, 10);
  const b3Rows: B3Row[] = b3List.map((t) => evaluateB3(t, barsMap.get(t) ?? null, regime, today));

  // Extras.
  const spcxRow = evaluateB1("SPCX", barsMap.get("SPCX") ?? null);
  const rklbRow = evaluateB1("RKLB", barsMap.get("RKLB") ?? null);

  // Header.
  const headerDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const headerTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
  const market = buildMarketLine(regime, confidence, vix, spyChangePct, spyClose ?? 0);

  // Narrative sections.
  const b2Gos = b2Rows.filter((r) => r.verdict === "GO");
  const b2Top = b2Gos.length ? b2Gos.sort((a, b) => (a.rsi ?? 100) - (b.rsi ?? 100))[0].ticker : null;
  const b3Exits = b3Rows
    .filter((r) => r.daysToHardExit != null && r.daysToHardExit >= 0 && r.daysToHardExit <= 30)
    .map((r) => ({ ticker: r.ticker, days: r.daysToHardExit! }));
  const b3NearEntry = b3Rows.find((r) => r.verdict === "NEAR ENTRY" && r.regimeMatch)?.ticker ?? null;

  const narrative = await generateNarrative({
    regime,
    vix,
    b1Flagged: b1Rows.filter((r) => r.flag).length,
    b2GoCount: b2Gos.length,
    b2Top,
    b3Exits,
    b3NearEntry,
    spcxPrice: spcxRow.price,
  });

  // Assemble.
  const sections: string[] = [];
  sections.push(`MORNING BRIEF — ${headerDate} · ${headerTime}`);
  sections.push("");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("MARKET CONDITIONS");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(market.regimeLine);
  sections.push(market.vixLine);
  sections.push(market.spyLine);
  sections.push(market.recLine);
  sections.push("");

  if (needB1) {
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push("B1 — AUTOFILL CHECK");
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push(formatB1(b1Rows));
    sections.push("");
  }

  if (needB2) {
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push("B2 — CSP OPPORTUNITIES");
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push(formatB2(b2Rows, vix));
    sections.push("");
  }

  if (needB3) {
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push("B3 — LEAPS SCAN (PATH last)");
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push(formatB3(b3Rows, regime));
    sections.push("");
  }

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("EXTRA WATCH");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(formatExtras(spcxRow, rklbRow));
  sections.push("");

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("TODAY'S PRIORITY");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(narrative?.priority ?? "1. Review B3 hard exits.\n2. Re-check B2 entries if VIX shifts.\n3. Verify SPCX window timing.");
  sections.push("");

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("DISCIPLINE REMINDER");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(narrative?.reminder ?? SPECIAL_NOTES.IRA_NO_GTC);
  sections.push("");

  const brief = sections.join("\n");

  return NextResponse.json({
    brief,
    bucket,
    generated_at: new Date().toISOString(),
    diagnostics: {
      regime,
      regime_confidence: confidence,
      vix,
      b1_flagged: b1Rows.filter((r) => r.flag).length,
      b2_go_count: b2Gos.length,
      b3_exits_within_30d: b3Exits,
    },
  });
}
