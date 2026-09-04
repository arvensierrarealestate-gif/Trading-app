import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { B1_TICKERS, B2_TICKERS, B3_TICKERS, EXTRA_WATCH, WATCHLIST, B4_WATCHLIST, B4_FUTURES, SPECIAL_NOTES, VIX_PRIME } from "@/lib/cowork-brief";
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
  type Bars,
} from "@/lib/cowork-eval";
import { coworkPortfolioSchema, type CoworkPortfolio } from "@/lib/cowork-portfolio";
import { type Regime } from "@/lib/regime";

export const runtime = "nodejs";
export const maxDuration = 60;

// ───── Auth ─────

function authorizeCron(req: Request): boolean {
  // Vercel passes Authorization: Bearer <CRON_SECRET> on scheduled invocations.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${cronSecret}`;
}

// ───── Portfolio loader ─────

async function loadPortfolio(): Promise<CoworkPortfolio | null> {
  const userId = process.env.COWORK_USER_ID;
  if (!userId) return null;
  try {
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

// ───── Formatting helpers (mirrors morning-brief/cowork/route.ts) ─────

function fmtPrice(p: number | null): string {
  return p == null ? "—" : `$${p.toFixed(2)}`;
}

function formatB1(rows: B1Row[]): string {
  const lines = rows.map((r) => {
    if (r.price == null) return `${r.ticker} — no data`;
    const flag = r.flag ? " ⚑ down >10% from 52w high" : "";
    return `${r.ticker} — ${fmtPrice(r.price)}${flag}`;
  });
  const flagged = rows.filter((r) => r.flag).length;
  return [...lines, "", flagged ? `${flagged} items to review` : "All clear"].join("\n");
}

function formatB2(rows: B2Row[], vix: number | null): string {
  const vixHeader = vix == null
    ? "VIX unavailable"
    : `VIX ${vix.toFixed(2)} — ${vix >= VIX_PRIME.lo && vix <= VIX_PRIME.hi ? "Prime" : vix < VIX_PRIME.lo ? "Caution (thin)" : "No trade (elevated)"}`;
  const lines: string[] = [vixHeader, ""];
  for (const r of rows) {
    if (r.price == null) { lines.push(`${r.ticker} — no data`); continue; }
    lines.push(`${r.ticker} — ${fmtPrice(r.price)} — RSI ${r.rsi?.toFixed(0) ?? "—"} — ${r.verdict}`);
    if (r.notes.length) lines.push(...r.notes.map((n) => `  · ${n}`));
  }
  const gos = rows.filter((r) => r.verdict === "GO");
  lines.push("", gos.length ? `GO: ${gos.map((r) => r.ticker).join(", ")}` : "No B2 entries today.");
  return lines.join("\n");
}

function formatB3(rows: B3Row[], regime: Regime): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (r.price == null) { lines.push(`${r.ticker} — no data`); continue; }
    const gates = [
      r.pullbackGate !== "UNKNOWN" ? `PB ${r.pullbackPct != null ? r.pullbackPct.toFixed(1) + "%" : "?"} (${r.pullbackGate})` : null,
      r.vixB3Gate !== "UNKNOWN" ? `VIX gate ${r.vixB3Gate}` : null,
    ].filter(Boolean).join(" · ");
    lines.push(`${r.ticker} — ${fmtPrice(r.price)} — ${r.alertRef} — ${r.verdict}${r.daysToHardExit != null ? ` (${r.daysToHardExit}d)` : ""}`);
    if (gates) lines.push(`  Gates: ${gates}`);
    if (r.notes.length) lines.push(...r.notes.map((n) => `  · ${n}`));
  }
  const exitsSoon = rows.filter((r) => r.daysToHardExit != null && r.daysToHardExit >= 0 && r.daysToHardExit <= 30);
  lines.push("", "Hard exits within 30d:");
  if (exitsSoon.length) { for (const r of exitsSoon) lines.push(`  ${r.ticker} — ${r.daysToHardExit}d`); }
  else lines.push("  None.");
  const near = rows.filter((r) => r.verdict === "NEAR ENTRY" && r.regimeMatch);
  if (near.length) lines.push(`\nTop setup: ${near[0].ticker}`);
  else if (regime === "bear" || regime === "crash") lines.push(`\nNo entries — regime ${regime}.`);
  else lines.push("\nNo near-entry setups today.");
  return lines.join("\n");
}

function formatOwnedSummary(options: OwnedOptionRow[], stocks: OwnedStockRow[], reentry: ReentryRow[], scalp: ScalpRow | null): string {
  const lines: string[] = [];
  if (options.length) {
    lines.push("── Options");
    for (const o of options) {
      const urgency = o.status === "red" ? " ⚑ EXIT SOON" : o.status === "amber" ? " ⚠" : "";
      lines.push(`  ${o.symbol} $${o.strike}${o.type[0]} ${o.expiry.slice(0, 7)} ×${o.contracts}${urgency}`);
      lines.push(`    ${o.note}`);
    }
  }
  if (stocks.length) {
    lines.push("── Stocks");
    for (const s of stocks.filter((s) => s.status !== "green")) {
      lines.push(`  ${s.symbol} ${s.shares}sh — ${s.note}`);
    }
    const ok = stocks.filter((s) => s.status === "green").length;
    if (ok) lines.push(`  ${ok} stock${ok === 1 ? "" : "s"} at/above cost basis — OK`);
  }
  if (reentry.length) {
    const open = reentry.filter((r) => r.windowStatus === "open");
    if (open.length) lines.push(`── Re-entry: WINDOW OPEN — ${open.map((r) => r.symbol).join(", ")}`);
  }
  if (scalp) lines.push(`── Scalp (${scalp.ticker}): ${scalp.status.toUpperCase()} — ${scalp.reason}`);
  return lines.length ? lines.join("\n") : "No owned positions.";
}

function formatB4Cron(b4: B4Status): string {
  const lines: string[] = [];
  lines.push(b4.live ? "● B4 LIVE" : `○ B4 NOT LIVE — ${b4.goLive.filter((d) => d.status === "OPEN").length}/4 go-live decisions open`);
  lines.push(`Session: ${b4.etTime} · ${b4.sessionLabel}`);
  lines.push(`Entries: ${b4.entriesAllowed ? "OPEN" : "CLOSED"}`);
  lines.push(`Futures (daily 9-EMA proxy): ES ${b4.futures.es.bias} · NQ ${b4.futures.nq.bias} → ${b4.futures.combinedBias}`);
  lines.push(`${b4.weeklyTask}`);
  const mapped = b4.watchlist.filter((w) => w.bullLevel != null || w.bearLevel != null);
  if (mapped.length) {
    lines.push("Mapped levels:");
    for (const w of mapped) lines.push(`  ${w.ticker} ${w.price != null ? `$${w.price.toFixed(2)}` : "—"} · ▲${w.bullLevel ?? "—"} ▼${w.bearLevel ?? "—"}`);
  }
  lines.push("Manual gates required: level break, volume, catalyst, liquidity, order flow.");
  return lines.join("\n");
}

// ───── Route ─────

export async function GET(req: Request) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const portfolio = await loadPortfolio();

  const b1List = portfolio?.monitor_B1_autofill?.tickers ?? Array.from(B1_TICKERS);
  const b2List = portfolio?.monitor_B2_csp?.tickers ?? Array.from(B2_TICKERS);
  const b3List = portfolio?.monitor_B3_leaps?.scan_order ?? Array.from(B3_TICKERS);
  const b4List = portfolio?.monitor_B4_daytrade?.watchlist?.map((w) => w.ticker) ?? Array.from(B4_WATCHLIST);
  const ownedSymbols = portfolio
    ? [...portfolio.owned_options.map((o) => o.symbol), ...portfolio.owned_stocks.map((s) => s.symbol)]
    : [];

  const universe = Array.from(new Set([
    ...b1List, ...b2List, ...b3List, ...b4List, B4_FUTURES.es, B4_FUTURES.nq,
    ...Array.from(EXTRA_WATCH), ...Array.from(WATCHLIST), ...ownedSymbols, "SPY", "^VIX",
  ]));
  const fetched = await Promise.all(universe.map((sym) => fetchBars(sym).then((b) => [sym, b] as const)));
  const barsMap = new Map(fetched);

  const spy = barsMap.get("SPY");
  if (!spy) return NextResponse.json({ error: "Could not fetch SPY" }, { status: 502 });

  const vixBars = barsMap.get("^VIX");
  const vix = vixBars ? vixBars.close[vixBars.close.length - 1] : null;
  const { regime, confidence } = regimeFromCloses(spy.close);
  const spyClose = spy.close[spy.close.length - 1];
  const spyPrev = spy.close[spy.close.length - 2] ?? spyClose;
  const spyChangePct = ((spyClose - spyPrev) / spyPrev) * 100;
  const today = new Date().toISOString().slice(0, 10);

  // Layer 1.
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

  // Layer 2.
  const b1Rows: B1Row[] = b1List.map((t) => evaluateB1(t, barsMap.get(t) ?? null));
  const b2Rows: B2Row[] = b2List.map((t) => evaluateB2(t, barsMap.get(t) ?? null, vix));
  const b3Rows: B3Row[] = b3List.map((t) => evaluateB3(t, barsMap.get(t) ?? null, regime, today, vix));
  const b4Status: B4Status = evaluateB4(
    portfolio?.monitor_B4_daytrade ?? null,
    barsMap.get(B4_FUTURES.es) ?? null,
    barsMap.get(B4_FUTURES.nq) ?? null,
    new Map<string, Bars | null>((b4List as string[]).map((t) => [t, barsMap.get(t) ?? null])),
    new Date(),
  );
  const rklbRow = evaluateB1("RKLB", barsMap.get("RKLB") ?? null);

  // Assemble brief.
  const headerDate = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const vixState = vix == null ? "unavailable" : vix < VIX_PRIME.lo ? "low premium" : vix > VIX_PRIME.hi ? "elevated — no trade" : "prime window";
  const regRec = regime === "crash" || regime === "bear" ? "Selective only" : vix != null && vix > VIX_PRIME.hi ? "Selective only" : "Trade with discipline";

  const sections: string[] = [];
  sections.push(`MORNING BRIEF — ${headerDate}`);
  sections.push("");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("MARKET CONDITIONS");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(`Regime: ${regime[0].toUpperCase()}${regime.slice(1)} · ${(confidence * 100).toFixed(0)}% confidence`);
  sections.push(vix == null ? "VIX: unavailable" : `VIX: ${vix.toFixed(2)} · ${vixState}`);
  sections.push(`SPY: ${fmtPrice(spyClose)} ${spyChangePct >= 0 ? "+" : ""}${spyChangePct.toFixed(2)}%`);
  sections.push(`Recommendation: ${regRec}`);
  sections.push("");

  if (portfolio) {
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push("LAYER 1 — OWNED POSITIONS");
    sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
    sections.push(formatOwnedSummary(ownedOptionRows, ownedStockRows, reentryRows, scalpRow));
    sections.push("");
  }

  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("LAYER 2 — MONITORING SCANS");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("");
  sections.push("B1 — AUTOFILL");
  sections.push("─────────────────────────");
  sections.push(formatB1(b1Rows));
  sections.push("");
  sections.push("B2 — CSP");
  sections.push("─────────────────────────");
  sections.push(formatB2(b2Rows, vix));
  sections.push("");
  sections.push("B3 — LEAPS (PATH last)");
  sections.push("─────────────────────────");
  sections.push(formatB3(b3Rows, regime));
  sections.push("");
  sections.push("B4 — DAY TRADE (always last)");
  sections.push("─────────────────────────");
  sections.push(formatB4Cron(b4Status));
  sections.push("");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("WATCHLIST");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(
    Array.from(WATCHLIST)
      .map((t) => {
        const r = evaluateB1(t, barsMap.get(t) ?? null);
        if (r.price == null) return `${t} — no data`;
        const pos = r.pctFromHigh != null ? ` (${r.pctFromHigh >= 0 ? "+" : ""}${r.pctFromHigh.toFixed(1)}% from 52w high)` : "";
        return `${t} — ${fmtPrice(r.price)}${pos}${r.flag ? " ⚑" : ""}`;
      })
      .join("\n"),
  );
  sections.push("");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push("EXTRA WATCH");
  sections.push("━━━━━━━━━━━━━━━━━━━━━━━");
  sections.push(`RKLB — ${fmtPrice(rklbRow.price)} · ${SPECIAL_NOTES.RKLB_NOTE}`);
  sections.push("");

  const brief = sections.join("\n");
  const generatedAt = new Date().toISOString();

  // Persist to Supabase so the latest brief is readable without re-running.
  const userId = process.env.COWORK_USER_ID;
  if (userId) {
    try {
      const admin = createAdminClient();
      await admin.from("cowork_briefs").upsert(
        { user_id: userId, generated_at: generatedAt, brief, bucket: "all" },
        { onConflict: "user_id" },
      );
    } catch {
      // Non-fatal — log failure but still return brief.
    }
  }

  return NextResponse.json({
    brief,
    generated_at: generatedAt,
    diagnostics: { regime, vix, b1_flagged: b1Rows.filter((r) => r.flag).length, b2_go: b2Rows.filter((r) => r.verdict === "GO").map((r) => r.ticker) },
  });
}
