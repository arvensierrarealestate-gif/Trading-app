import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { authorizeCowork, type CoworkAuth } from "@/lib/cowork-auth";
import { type Regime } from "@/lib/regime";
import {
  B1_TICKERS,
  B2_TICKERS,
  B3_TICKERS,
  EXTRA_WATCH,
  WATCHLIST,
  B4_WATCHLIST,
  B4_FUTURES,
  SPECIAL_NOTES,
  VIX_PRIME,
} from "@/lib/cowork-brief";
import {
  fetchBars,
  regimeFromCloses,
  evaluateB1,
  evaluateB2,
  evaluateB3,
  evaluateOwnedOption,
  evaluateOwnedStock,
  evaluateReentry,
  evaluateScalp,
  evaluateB4,
  type B1Row,
  type B2Row,
  type B3Row,
  type OwnedOptionRow,
  type OwnedStockRow,
  type ReentryRow,
  type ScalpRow,
  type B4Status,
} from "@/lib/cowork-eval";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { coworkPortfolioSchema, type CoworkPortfolio } from "@/lib/cowork-portfolio";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-6";

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
    const gates = [
      r.pullbackGate !== "UNKNOWN" ? `Pullback ${r.pullbackPct != null ? r.pullbackPct.toFixed(1) + "%" : "?"} (${r.pullbackGate})` : null,
      r.vixB3Gate !== "UNKNOWN" ? `VIX gate ${r.vixB3Gate}` : null,
    ].filter(Boolean).join(" · ");
    lines.push(`${r.ticker} — ${fmtPrice(r.price)} — ${r.alertRef} — ${r.verdict}${r.daysToHardExit != null ? ` (hard exit in ${r.daysToHardExit}d)` : ""}`);
    if (gates) lines.push(`  Gates: ${gates}`);
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

function formatExtras(rklb: B1Row): string {
  return `RKLB — ${fmtPrice(rklb.price)} · ${SPECIAL_NOTES.RKLB_NOTE}`;
}

function formatWatchlist(rows: B1Row[]): string {
  return rows
    .map((r) => {
      if (r.price == null) return `${r.ticker} — no data`;
      const pos = r.pctFromHigh != null ? ` (${r.pctFromHigh >= 0 ? "+" : ""}${r.pctFromHigh.toFixed(1)}% from 52w high)` : "";
      return `${r.ticker} — ${fmtPrice(r.price)}${pos}${r.flag ? " ⚑" : ""}`;
    })
    .join("\n");
}

function formatOwnedPositions(options: OwnedOptionRow[], stocks: OwnedStockRow[], reentry: ReentryRow[], scalp: ScalpRow | null): string {
  const lines: string[] = [];

  if (options.length) {
    lines.push("── Options (LEAPS)");
    for (const o of options) {
      const urgency = o.status === "red" ? " ⚑ EXIT SOON" : o.status === "amber" ? " ⚠" : "";
      lines.push(`  ${o.symbol} $${o.strike}${o.type[0]} ${o.expiry.slice(0, 7)} ×${o.contracts} [${o.account}]${urgency}`);
      lines.push(`    ${o.note}`);
    }
  }

  if (stocks.length) {
    lines.push("── Stocks");
    const flagged = stocks.filter((s) => s.status !== "green");
    if (flagged.length) {
      for (const s of flagged) {
        lines.push(`  ${s.symbol} ${s.shares}sh [${s.account}] — ${s.note}`);
      }
      lines.push(`  (${stocks.length - flagged.length} of ${stocks.length} stocks at/above cost basis — OK)`);
    } else {
      lines.push(`  All ${stocks.length} stocks at/above cost basis.`);
    }
  }

  if (reentry.length) {
    lines.push("── Re-entry");
    for (const r of reentry) {
      const label =
        r.windowStatus === "open" ? "WINDOW OPEN" :
        r.windowStatus === "passed" ? "window passed" :
        r.daysToWindowOpen != null ? `window in ${r.daysToWindowOpen}d` : "upcoming";
      lines.push(`  ${r.symbol} — ${label}${r.daysToGoNogo != null ? ` · Go/No-Go ${r.daysToGoNogo >= 0 ? `in ${r.daysToGoNogo}d` : "PAST"}` : ""}`);
    }
  }

  if (scalp) {
    const icon = scalp.status === "blocked" ? "🚫" : scalp.status === "caution" ? "⚠" : "✓";
    lines.push(`── Scalp (${scalp.ticker}): ${icon} ${scalp.status.toUpperCase()} — ${scalp.reason}`);
  }

  return lines.length ? lines.join("\n") : "No owned positions loaded.";
}

function formatB4(b4: B4Status): string {
  const lines: string[] = [];
  lines.push(b4.live ? "● B4 LIVE" : `○ B4 NOT LIVE — ${b4.goLive.filter((d) => d.status === "OPEN").length}/4 go-live decisions open`);
  lines.push(`Session: ${b4.etTime} · ${b4.sessionLabel}`);
  lines.push(`Entries: ${b4.entriesAllowed ? "OPEN" : "CLOSED"} · ${b4.weeklyTask}`);
  lines.push(`Futures (daily 9-EMA proxy): ES ${b4.futures.es.bias} · NQ ${b4.futures.nq.bias} → ${b4.futures.combinedBias}`);
  const autoGates = b4.gates.filter((g) => g.state === "PASS" || g.state === "FAIL");
  if (autoGates.length) {
    lines.push("Auto gates:");
    for (const g of autoGates) lines.push(`  ${g.state === "PASS" ? "✓" : "✗"} ${g.id} ${g.label} — ${g.detail}`);
  }
  lines.push("Manual gates still required: level break, volume, catalyst, liquidity, order flow.");
  const mapped = b4.watchlist.filter((w) => w.bullLevel != null || w.bearLevel != null);
  if (mapped.length) {
    lines.push("Mapped levels:");
    for (const w of mapped) lines.push(`  ${w.ticker} ${w.price != null ? `$${w.price.toFixed(2)}` : "—"} · ▲${w.bullLevel ?? "—"} ▼${w.bearLevel ?? "—"}${w.targets.length ? ` · T ${w.targets.join("→")}` : ""}`);
  }
  return lines.join("\n");
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
  ownedExitsSoon: { symbol: string; days: number }[];
  reentryOpen: string[];
  scalpStatus: string | null;
}): Promise<{ priority: string; reminder: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const prompt = `Build the "TODAY'S PRIORITY" and "DISCIPLINE REMINDER" sections of the owner's morning brief from these computed signals. Be specific, terse, and actionable.

Signals:
- Regime: ${input.regime}
- VIX: ${input.vix ?? "n/a"}
- Owned LEAPS hard exits within 14d: ${input.ownedExitsSoon.length ? input.ownedExitsSoon.map((e) => `${e.symbol} (${e.days}d)`).join(", ") : "none"}
- B1 flagged (down >10% from 52w high): ${input.b1Flagged}
- B2 GO verdicts: ${input.b2GoCount}${input.b2Top ? ` (top: ${input.b2Top})` : ""}
- B3 near-entry candidate: ${input.b3NearEntry ?? "none"}
- B3 hard exits within 30d: ${input.b3Exits.length ? input.b3Exits.map((e) => `${e.ticker} (${e.days}d)`).join(", ") : "none"}
- Re-entry windows open: ${input.reentryOpen.length ? input.reentryOpen.join(", ") : "none"}
- Scalp status: ${input.scalpStatus ?? "n/a"}
- IRA accounts forbid GTC stops — flag if relevant.

Output exactly two sections, no header, no preamble, plain markdown:

PRIORITY:
1. [most urgent — owned LEAPS exit within 14d beats everything, then B3 hard exits, then re-entry window, then B2 GO]
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

// ───── Portfolio loader (shared with status route) ─────

async function loadPortfolio(auth: CoworkAuth): Promise<CoworkPortfolio | null> {
  if (!auth.ok) return null;
  try {
    if (auth.source === "session") {
      const supabase = await createClient();
      const { data } = await supabase
        .from("cowork_portfolio")
        .select("document")
        .eq("user_id", auth.userId)
        .maybeSingle();
      if (!data?.document) return null;
      const parsed = coworkPortfolioSchema.safeParse(data.document);
      return parsed.success ? parsed.data : null;
    }
    const userId = process.env.COWORK_USER_ID;
    if (!userId) return null;
    const admin = createAdminClient();
    const { data } = await admin
      .from("cowork_portfolio")
      .select("document")
      .eq("user_id", userId)
      .maybeSingle();
    if (!data?.document) return null;
    const parsed = coworkPortfolioSchema.safeParse(data.document);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// ───── Route ─────

type Body = { user_id?: string; bucket?: "all" | "b1" | "b2" | "b3"; tickers?: string[] };

export async function POST(req: Request) {
  const auth = await authorizeCowork(req);
  if (!auth.ok) return auth.response;

  const body: Body = await req.json().catch(() => ({} as Body));
  const bucket = body.bucket ?? "all";
  const overrideTickers = Array.isArray(body.tickers) && body.tickers.length ? body.tickers.map((t) => t.toUpperCase()) : null;

  // Load portfolio for Layer 1 (owned positions) and portfolio-driven tickers.
  const portfolio = await loadPortfolio(auth);

  // Decide which tickers to fetch.
  const needB1 = bucket === "all" || bucket === "b1";
  const needB2 = bucket === "all" || bucket === "b2";
  const needB3 = bucket === "all" || bucket === "b3";
  const needB4 = bucket === "all"; // B4 (day trade) only in the full brief

  const b1List = needB1 ? (overrideTickers ?? portfolio?.monitor_B1_autofill?.tickers ?? Array.from(B1_TICKERS)) : [];
  const b2List = needB2 ? (overrideTickers ?? portfolio?.monitor_B2_csp?.tickers ?? Array.from(B2_TICKERS)) : [];
  const b3List = needB3 ? (overrideTickers ?? portfolio?.monitor_B3_leaps?.scan_order ?? Array.from(B3_TICKERS)) : [];
  const b4List = needB4 ? (portfolio?.monitor_B4_daytrade?.watchlist?.map((w) => w.ticker) ?? Array.from(B4_WATCHLIST)) : [];

  // Owned symbols for Layer 1.
  const ownedSymbols = portfolio
    ? [...portfolio.owned_options.map((o) => o.symbol), ...portfolio.owned_stocks.map((s) => s.symbol)]
    : [];

  const extras = Array.from(EXTRA_WATCH);
  const watchlistTickers = Array.from(WATCHLIST);
  const b4Futures = needB4 ? [B4_FUTURES.es, B4_FUTURES.nq] : [];
  const universe = Array.from(new Set([...b1List, ...b2List, ...b3List, ...b4List, ...b4Futures, ...extras, ...watchlistTickers, ...ownedSymbols, "SPY", "^VIX"]));

  const fetched = await Promise.all(universe.map((sym) => fetchBars(sym).then((b) => [sym, b] as const)));
  const barsMap = new Map(fetched);

  const spy = barsMap.get("SPY");
  const vixBars = barsMap.get("^VIX");
  const spyClose = spy?.close[spy.close.length - 1] ?? null;
  const spyPrev = spy?.close[spy.close.length - 2] ?? null;
  const spyChangePct = spyClose != null && spyPrev != null ? ((spyClose - spyPrev) / spyPrev) * 100 : 0;
  const vix = vixBars ? vixBars.close[vixBars.close.length - 1] : null;

  if (!spy) return NextResponse.json({ error: "Could not fetch SPY market data" }, { status: 502 });
  const { regime, confidence } = regimeFromCloses(spy.close);

  const today = new Date().toISOString().slice(0, 10);

  // Layer 1 — owned positions.
  const ownedOptionRows: OwnedOptionRow[] = portfolio
    ? portfolio.owned_options.map((o) => evaluateOwnedOption(o, barsMap.get(o.symbol) ?? null, today))
    : [];
  const ownedStockRows: OwnedStockRow[] = portfolio
    ? portfolio.owned_stocks.map((s) => evaluateOwnedStock(s, barsMap.get(s.symbol) ?? null))
    : [];
  const reentryRows: ReentryRow[] = portfolio
    ? portfolio.monitor_reentry.map((e) => evaluateReentry(e, today))
    : [];
  const scalpTicker = portfolio?.monitor_scalp?.ticker;
  const scalpRow: ScalpRow | null = evaluateScalp(
    portfolio?.monitor_scalp ?? null,
    portfolio?.owned_options ?? [],
    scalpTicker ? (barsMap.get(scalpTicker) ?? null) : null,
    vix,
  );

  // Layer 2 — monitoring scans.
  const b1Rows: B1Row[] = b1List.map((t) => evaluateB1(t, barsMap.get(t) ?? null));
  const b2Rows: B2Row[] = b2List.map((t) => evaluateB2(t, barsMap.get(t) ?? null, vix));
  const b3Rows: B3Row[] = b3List.map((t) => evaluateB3(t, barsMap.get(t) ?? null, regime, today, vix));

  // B4 — day trading (always last). Only in the full brief.
  const b4Status: B4Status | null = needB4
    ? evaluateB4(
        portfolio?.monitor_B4_daytrade ?? null,
        barsMap.get(B4_FUTURES.es) ?? null,
        barsMap.get(B4_FUTURES.nq) ?? null,
        new Map(b4List.map((t) => [t, barsMap.get(t) ?? null] as const)),
        new Date(),
      )
    : null;

  const rklbRow = evaluateB1("RKLB", barsMap.get("RKLB") ?? null);
  const watchlistRows: B1Row[] = watchlistTickers.map((t) => evaluateB1(t, barsMap.get(t) ?? null));

  // Header.
  const headerDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const headerTime = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
  const market = buildMarketLine(regime, confidence, vix, spyChangePct, spyClose ?? 0);

  // Narrative inputs.
  const b2Gos = b2Rows.filter((r) => r.verdict === "GO");
  const b2Top = b2Gos.length ? b2Gos.sort((a, b) => (a.rsi ?? 100) - (b.rsi ?? 100))[0].ticker : null;
  const b3Exits = b3Rows
    .filter((r) => r.daysToHardExit != null && r.daysToHardExit >= 0 && r.daysToHardExit <= 30)
    .map((r) => ({ ticker: r.ticker, days: r.daysToHardExit! }));
  const b3NearEntry = b3Rows.find((r) => r.verdict === "NEAR ENTRY" && r.regimeMatch)?.ticker ?? null;
  const ownedExitsSoon = ownedOptionRows
    .filter((r) => r.daysToHardExit != null && r.daysToHardExit >= 0 && r.daysToHardExit <= 14)
    .map((r) => ({ symbol: r.symbol, days: r.daysToHardExit! }));
  const reentryOpen = reentryRows.filter((r) => r.windowStatus === "open").map((r) => r.symbol);

  const narrative = await generateNarrative({
    regime,
    vix,
    b1Flagged: b1Rows.filter((r) => r.flag).length,
    b2GoCount: b2Gos.length,
    b2Top,
    b3Exits,
    b3NearEntry,
    ownedExitsSoon,
    reentryOpen,
    scalpStatus: scalpRow ? `${scalpRow.ticker} ${scalpRow.status}` : null,
  });

  // Assemble brief.
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

  if (portfolio) {
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push("LAYER 1 — OWNED POSITIONS");
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push(formatOwnedPositions(ownedOptionRows, ownedStockRows, reentryRows, scalpRow));
    sections.push("");
  }

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("LAYER 2 — MONITORING SCANS");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("");

  if (needB1) {
    sections.push("B1 — AUTOFILL CHECK");
    sections.push("─────────────────────────");
    sections.push(formatB1(b1Rows));
    sections.push("");
  }

  if (needB2) {
    sections.push("B2 — CSP OPPORTUNITIES");
    sections.push("─────────────────────────");
    sections.push(formatB2(b2Rows, vix));
    sections.push("");
  }

  if (needB3) {
    sections.push("B3 — LEAPS SCAN (PATH last)");
    sections.push("─────────────────────────");
    sections.push(formatB3(b3Rows, regime));
    sections.push("");
  }

  if (needB4 && b4Status) {
    sections.push("B4 — DAY TRADE (always last)");
    sections.push("─────────────────────────");
    sections.push(formatB4(b4Status));
    sections.push("");
  }

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("WATCHLIST");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(formatWatchlist(watchlistRows));
  sections.push("");

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("EXTRA WATCH");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(formatExtras(rklbRow));
  sections.push("");

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("TODAY'S PRIORITY");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(narrative?.priority ?? "1. Review owned LEAPS hard exits.\n2. Re-check B2 entries if VIX shifts.\n3. Monitor re-entry windows.");
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
