import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fitGaussianHMM } from "@/lib/hmm";
import { REGIMES, parseRegimes, type Regime } from "@/lib/regime";
import type { SOP } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

// Schedule context: this route is hit GET by Vercel Cron at 12:30 UTC Mon-Fri
// (7:30 EST / 8:30 EDT). Manual POST is hit from the UI with the user's
// session cookie to regenerate today's brief on demand.

const REMINDER_SEEDS: Array<(s: SOP, regime: Regime, allowed: Regime[]) => string> = [
  (s) => `Your max risk today is ${s.risk} per trade. Stick to it.`,
  (s) => `Your daily loss limit is ${s.drawdown}. Stop trading the moment you hit it.`,
  (s, regime, allowed) =>
    allowed.length
      ? `Only trade in ${allowed.join(", ")}. Today is ${regime} — ${allowed.includes(regime) ? "you're cleared." : "stand aside."}`
      : `Today's regime is ${regime}. Match your edge to the conditions.`,
  (s) => `Max ${s.max_trades} trades today. Quality over quantity.`,
  (s) => `Your minimum R/R is ${s.rr}. Don't take low-reward setups.`,
  (s) => `Trade only during your sessions: ${s.sessions}. Outside those hours is no-man's-land.`,
];

type Bars = { close: number[]; volume: number[] };

async function fetchSpy(): Promise<Bars> {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/SPY?range=1y&interval=1d";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (TradeReady)" } });
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);
  const j = (await res.json()) as {
    chart: { result?: Array<{ timestamp?: number[]; indicators: { quote: Array<{ close?: (number | null)[]; volume?: (number | null)[] }> } }> };
  };
  const r = j.chart.result?.[0];
  const q = r?.indicators.quote[0];
  if (!r?.timestamp || !q?.close) throw new Error("Malformed SPY data");
  const close: number[] = [];
  const volume: number[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = q.close[i];
    if (typeof c === "number" && Number.isFinite(c)) {
      close.push(c);
      volume.push(q.volume?.[i] ?? 0);
    }
  }
  if (!close.length) throw new Error("No SPY closes returned");
  return { close, volume };
}

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
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

function recentEmaCrossover(close: number[], windowDays = 5): boolean {
  if (close.length < 50 + windowDays) return false;
  let prevAbove = false;
  for (let i = close.length - windowDays - 1; i < close.length; i++) {
    const slice = close.slice(0, i + 1);
    const above = ema(slice, 20) > ema(slice, 50);
    if (i > close.length - windowDays - 1 && above && !prevAbove) return true;
    prevAbove = above;
  }
  return false;
}

function computeRegime(close: number[]): { regime: Regime; confidence: number } {
  const returns: number[] = [];
  for (let i = 1; i < close.length; i++) returns.push(Math.log(close[i] / close[i - 1]) * 100);
  if (returns.length < 20) throw new Error("Insufficient history for regime detection");
  const model = fitGaussianHMM(returns, 4, { restarts: 12, seed: 42 });
  const order = model.means
    .map((m, i) => [m, i] as [number, number])
    .sort((a, b) => a[0] - b[0])
    .map((p) => p[1]);
  const stateToRegime: Regime[] = new Array(4);
  order.forEach((stateIdx, rank) => (stateToRegime[stateIdx] = REGIMES[rank]));
  const lastIdx = returns.length - 1;
  const lastState = model.states[lastIdx];
  const confidence = model.posteriors[lastIdx]?.[lastState] ?? 0;
  return { regime: stateToRegime[lastState], confidence: Number(confidence.toFixed(3)) };
}

type Gate = { name: string; status: "pass" | "fail" | "info"; note: string };

function evaluateGates(sop: SOP, regime: Regime, bars: Bars): { gates: Gate[]; passing: number } {
  const close = bars.close;
  const volume = bars.volume;
  const e20 = ema(close, 20);
  const e50 = ema(close, 50);
  const trendPass = e20 > e50;
  const rsiVal = rsi(close, 14);
  const rsiPass = rsiVal >= 30 && rsiVal <= 70;
  const last20Vol = volume.slice(-20);
  const avg20Vol = last20Vol.reduce((s, v) => s + v, 0) / Math.max(1, last20Vol.length);
  const todayVol = volume[volume.length - 1] ?? 0;
  const volRatio = avg20Vol ? todayVol / avg20Vol : 0;
  const volPass = volRatio >= 1;
  const allowed = parseRegimes(sop.regimes ?? "");
  const regimePass = allowed.length === 0 || allowed.includes(regime);

  const gates: Gate[] = [
    { name: "Trend", status: trendPass ? "pass" : "fail", note: `SPY 20-EMA ${trendPass ? "above" : "below"} 50-EMA` },
    { name: "RSI", status: rsiPass ? "pass" : "fail", note: `SPY RSI(14) at ${rsiVal.toFixed(0)} (neutral 30-70)` },
    { name: "Volume", status: volPass ? "pass" : "fail", note: `Today ${volRatio.toFixed(2)}× 20-day average` },
    { name: "Regime", status: regimePass ? "pass" : "fail", note: regimePass ? `${regime} matches your allowed regimes` : `${regime} is outside your allowed regimes` },
    { name: "R/R", status: "info", note: `Reminder: minimum ${sop.rr}` },
    { name: "Risk", status: "info", note: `Reminder: max ${sop.risk} per trade` },
  ];
  // Info reminders always count toward the passing total as long as the SOP has them set.
  const passing = gates.filter((g) => g.status === "pass").length + gates.filter((g) => g.status === "info" && g.note.length > 0).length;
  return { gates, passing };
}

function strategySignal(sop: SOP, regime: Regime, bars: Bars): string {
  const close = bars.close;
  const last = close[close.length - 1];
  const strat = sop.strategy_type ?? "custom";
  if (strat === "premium-selling") {
    // IV rank requires options data; until Polygon is wired up, fall back to regime guidance.
    if (regime === "neutral") return "IV rank requires options data (Polygon). Neutral regime usually favors premium selling — verify IV before entering.";
    if (regime === "bull") return "Bull regime tends to compress IV. Premium selling will pay less today — be selective.";
    return `Regime is ${regime}. Premium selling carries elevated tail risk in this state — consider standing aside.`;
  }
  if (strat === "leaps") {
    const recentLow = Math.min(...close.slice(-40));
    const pctAboveLow = ((last - recentLow) / recentLow) * 100;
    const atSupport = pctAboveLow <= 3;
    return atSupport
      ? `SPY is at weekly support (+${pctAboveLow.toFixed(1)}% from 8-week low). Good LEAPS entry conditions.`
      : `SPY is +${pctAboveLow.toFixed(1)}% above the 8-week low. Wait for a pullback to support before entering LEAPS.`;
  }
  if (strat === "momentum-swing") {
    const e20 = ema(close, 20);
    const e50 = ema(close, 50);
    const cross = recentEmaCrossover(close, 5);
    const above = e20 > e50;
    const last20Vol = bars.volume.slice(-20);
    const avg20Vol = last20Vol.reduce((s, v) => s + v, 0) / Math.max(1, last20Vol.length);
    const volRatio = avg20Vol ? (bars.volume[bars.volume.length - 1] ?? 0) / avg20Vol : 0;
    const volStrong = volRatio >= 1.2;
    return `EMA crossover ${cross ? "detected this week" : above ? "active (20-EMA above 50-EMA)" : "not detected"} on SPY with ${volStrong ? "strong" : "weak"} volume (${volRatio.toFixed(2)}× avg). ${cross && volStrong ? "Momentum favorable." : "Wait for a stronger signal."}`;
  }
  return `Custom strategy — verify your own entry signals against today's tape. Regime is ${regime}.`;
}

function pickReminder(sop: SOP, regime: Regime, allowed: Regime[]): string {
  const dayOfYear = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86_400_000);
  const idx = dayOfYear % REMINDER_SEEDS.length;
  return REMINDER_SEEDS[idx](sop, regime, allowed);
}

async function generateForUser(userId: string, admin: ReturnType<typeof createAdminClient>): Promise<{ ok: boolean; brief?: unknown; error?: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "ANTHROPIC_API_KEY not configured" };

  const { data: sopRow } = await admin.from("sops").select("*").eq("user_id", userId).maybeSingle();
  if (!sopRow) return { ok: false, error: "No SOP saved" };

  const sop: SOP = {
    assets: sopRow.assets,
    tf: sopRow.tf,
    sessions: sopRow.sessions,
    entry_signals: sopRow.entry_signals,
    entry_confirm: sopRow.entry_confirm,
    entry_notes: sopRow.entry_notes ?? "",
    tp: sopRow.tp,
    sl: sopRow.sl,
    rr: sopRow.rr,
    risk: sopRow.risk,
    max_trades: sopRow.max_trades,
    drawdown: sopRow.drawdown,
    regimes: sopRow.regimes ?? "",
    strategy_type: sopRow.strategy_type ?? "custom",
  };

  let bars: Bars;
  let regime: Regime;
  let confidence: number;
  try {
    bars = await fetchSpy();
    const r = computeRegime(bars.close);
    regime = r.regime;
    confidence = r.confidence;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Market data failed" };
  }

  const { gates, passing } = evaluateGates(sop, regime, bars);
  const sigText = strategySignal(sop, regime, bars);
  const allowed = parseRegimes(sop.regimes);
  const reminder = pickReminder(sop, regime, allowed);

  // Recent paper trades — use what's available in the schema (no "open" status,
  // so we summarize the last week's graded trades instead).
  const sevenAgo = new Date();
  sevenAgo.setUTCDate(sevenAgo.getUTCDate() - 7);
  const { data: tradesRows } = await admin
    .from("paper_trades")
    .select("asset, score, verdict, outcome, created_at")
    .eq("user_id", userId)
    .gte("created_at", sevenAgo.toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  const trades = tradesRows ?? [];
  const tradesSummary = trades.length
    ? `${trades.length} graded in last 7 days. Best score ${Math.max(...trades.map((t) => t.score))}, worst ${Math.min(...trades.map((t) => t.score))}. Most recent: ${trades[0].asset} ${trades[0].outcome} (${trades[0].score}/100, ${trades[0].verdict}).`
    : "No paper trades graded in the last 7 days.";

  let recommendation: string;
  if (passing >= 5) recommendation = "Conditions look favorable. Review your watchlist before entering.";
  else if (passing >= 3) recommendation = "Mixed conditions. Be selective — only A+ setups today.";
  else recommendation = "Poor conditions. Consider sitting out today. Protect your capital.";

  const today = new Date();
  const dayName = today.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const dateStr = today.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  const system = `You are a strict but supportive trading discipline coach. Generate a concise morning brief in markdown, exactly 6 sections, scannable. Use the structured data verbatim where given — don't invent numbers. Tone: short, encouraging, honest, no fluff.`;

  const userPrompt = `Generate today's brief in exactly this structure. Plain markdown. No preamble.

## 1. Today
Date: ${dateStr} (${dayName}). SPY regime: ${regime} (confidence ${(confidence * 100).toFixed(0)}%). One sentence on what this means for trading today.

## 2. SOP gates (${passing}/6 passing)
${gates.map((g) => `- **${g.name}** — ${g.status === "pass" ? "✓ pass" : g.status === "fail" ? "✗ fail" : "ℹ︎ reminder"}: ${g.note}`).join("\n")}

## 3. Strategy signal
Strategy: ${sop.strategy_type ?? "custom"}. ${sigText}

## 4. Open positions
${tradesSummary}

## 5. Discipline reminder
${reminder}

## 6. Recommendation
${recommendation}

Output ONLY the 6 sections, no header, no footer.`;

  const anthropic = new Anthropic({ apiKey });
  let briefText: string;
  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    briefText = msg.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Model call failed" };
  }

  const todayDate = today.toISOString().slice(0, 10);
  const row = {
    user_id: userId,
    generated_at: new Date().toISOString(),
    date: todayDate,
    regime,
    regime_confidence: confidence,
    gates_passing: passing,
    strategy_signal: sigText,
    recommendation,
    full_brief: briefText,
  };
  const { data: saved, error: upErr } = await admin
    .from("morning_briefs")
    .upsert(row, { onConflict: "user_id,date" })
    .select()
    .single();
  if (upErr) return { ok: false, error: `Could not save brief: ${upErr.message}` };

  return { ok: true, brief: saved };
}

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

// Vercel Cron sends GET. Runs for every user with a saved SOP.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: sopRows, error } = await admin.from("sops").select("user_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const userIds = Array.from(new Set((sopRows ?? []).map((r) => r.user_id as string)));

  const results: Array<{ user_id: string; ok: boolean; error?: string }> = [];
  for (const uid of userIds) {
    const r = await generateForUser(uid, admin);
    results.push({ user_id: uid, ok: r.ok, error: r.error });
  }
  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: true, generated: ok, total: userIds.length, results });
}

// Manual regenerate from the UI — runs for the authenticated user only.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const r = await generateForUser(user.id, admin);
  if (!r.ok) return NextResponse.json({ error: r.error ?? "Generation failed" }, { status: 500 });
  return NextResponse.json({ brief: r.brief });
}
