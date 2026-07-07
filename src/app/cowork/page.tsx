"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Diagnostics = {
  regime: string;
  regime_confidence: number;
  vix: number | null;
  b1_flagged: number;
  b2_go_count: number;
  b3_exits_within_30d: { ticker: string; days: number }[];
};

type Candle = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Growth = Record<"1d" | "1w" | "1m" | "3m" | "6m" | "1y", number | null>;
type Range = "1w" | "1m" | "3m" | "6m" | "1y";

type B1Status = { ticker: string; price: number | null; flag: boolean; pctFromHigh: number | null };
type B2Status = { ticker: string; price: number | null; verdict: "GO" | "CAUTION" | "SKIP"; rsi: number | null; vixGate: string };
type B3Status = { ticker: string; price: number | null; verdict: "MONITOR" | "NEAR ENTRY" | "EXIT APPROACHING" | "HOLD" | "FIRED"; alertRef: string; daysToHardExit: number | null; pullbackGate: "PASS" | "CAUTION" | "FAIL" | "UNKNOWN"; vixB3Gate: "PASS" | "FAIL" | "UNKNOWN"; pullbackPct: number | null };
type OwnedOptionStatus = { symbol: string; type: string; side: string; strike: number; expiry: string; account: string; contracts: number; daysToExpiry: number; daysToHardExit: number | null; underlyingPrice: number | null; costBasis: number; status: "green" | "amber" | "red"; note: string };
type OwnedStockStatus = { symbol: string; account: string; shares: number; livePrice: number | null; pnlPct: number | null; stop: number | null; status: "green" | "amber" | "red"; note: string };
type ReentryStatus = { symbol: string; windowStatus: "open" | "upcoming" | "passed"; daysToWindowOpen: number | null; daysToWindowClose: number | null; daysToGoNogo: number | null; trigger: string; status: "green" | "amber" | "neutral" };
type ScalpStatus = { ticker: string; status: "clear" | "blocked" | "caution"; reason: string };
type B4Gate = { id: string; label: string; state: "PASS" | "FAIL" | "MANUAL" | "UNKNOWN"; detail: string };
type B4GoLive = { id: number; label: string; status: "OPEN" | "SET"; value: string | null };
type B4Watch = { ticker: string; price: number | null; bullLevel: number | null; bearLevel: number | null; targets: number[]; stop: number | null };
type B4Status = {
  live: boolean;
  readyToGoLive: boolean;
  sessionWindow: string;
  sessionLabel: string;
  etTime: string;
  entriesAllowed: boolean;
  weeklyTask: string;
  futures: {
    es: { price: number | null; pctFromEma: number | null; bias: "BULL" | "BEAR" | "UNKNOWN" };
    nq: { price: number | null; pctFromEma: number | null; bias: "BULL" | "BEAR" | "UNKNOWN" };
    combinedBias: "CALLS" | "PUTS" | "MIXED" | "UNKNOWN";
  };
  gates: B4Gate[];
  goLive: B4GoLive[];
  watchlist: B4Watch[];
  lossCap: number | null;
  maxTrades: number;
  notes: string[];
};
type Status = {
  regime: string;
  regime_confidence: number;
  vix: number | null;
  has_portfolio: boolean;
  owned_options: OwnedOptionStatus[];
  owned_stocks: OwnedStockStatus[];
  reentry: ReentryStatus[];
  scalp: ScalpStatus | null;
  b1: B1Status[];
  b2: B2Status[];
  b3: B3Status[];
  b4: B4Status | null;
};

const RANGES: { key: Range; label: string }[] = [
  { key: "1w", label: "1W" },
  { key: "1m", label: "1M" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
];

export default function CoworkPage() {
  const [brief, setBrief] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<Status | null>(null);
  const [statusBusy, setStatusBusy] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"portfolio" | "b1" | "b2" | "b3" | "b4">("portfolio");

  const [chartSymbol, setChartSymbol] = useState<string>("NVDA");
  const [chartRange, setChartRange] = useState<Range>("3m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [chartBusy, setChartBusy] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setStatusBusy(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/cowork-status");
      const j = await res.json();
      if (!res.ok) {
        setStatusError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus(j);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Network error");
    } finally {
      setStatusBusy(false);
    }
  }, []);

  const loadChart = useCallback(async () => {
    setChartBusy(true);
    setChartError(null);
    try {
      const res = await fetch(`/api/cowork-chart?symbol=${encodeURIComponent(chartSymbol)}&range=${chartRange}`);
      const j = await res.json();
      if (!res.ok) {
        setChartError(j.error ?? `HTTP ${res.status}`);
        setCandles([]);
        setGrowth(null);
        return;
      }
      setCandles(j.candles ?? []);
      setGrowth(j.growth ?? null);
    } catch (e) {
      setChartError(e instanceof Error ? e.message : "Network error");
    } finally {
      setChartBusy(false);
    }
  }, [chartSymbol, chartRange]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadChart(); }, [loadChart]);

  // PWA / desktop-shortcut entry point. When launched from the installed
  // shortcut (which uses start_url=/cowork?run=all), auto-run the full brief
  // so the owner sees a fresh report the moment the window opens.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const bucket = url.searchParams.get("run") as "all" | "b1" | "b2" | "b3" | null;
    if (bucket === "all" || bucket === "b1" || bucket === "b2" || bucket === "b3") {
      url.searchParams.delete("run");
      window.history.replaceState(null, "", url.pathname + url.search);
      run(bucket);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(bucket: "all" | "b1" | "b2" | "b3") {
    setBusy(bucket);
    setError(null);
    setBrief(null);
    setDiag(null);
    try {
      const res = await fetch("/api/morning-brief/cowork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setBrief(j.brief);
      setDiag(j.diagnostics ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: "30px auto", padding: 20, fontFamily: "system-ui, sans-serif", color: "#dde4ef" }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>Cowork brief</h1>
      <p style={{ color: "#888", fontSize: 13, marginTop: 4 }}>
        Three-bucket morning brief + per-ticker candle scan. Click any ticker chip to chart it.{" "}
        <a href="/cowork/portfolio" style={{ color: "#7fb", textDecoration: "none" }}>Manage portfolio →</a>
      </p>

      {/* Status grid */}
      <div style={{ background: "#0f1118", border: "1px solid #2a3142", borderRadius: 10, padding: 20, marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5 }}>Today's status</div>
          <button onClick={loadStatus} disabled={statusBusy} style={chipBtnStyle(false)}>
            {statusBusy ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

        {statusError && (
          <div style={{ color: "#ff8a8a", fontSize: 13, padding: 12 }}>Status error: {statusError}</div>
        )}

        {status && (
          <>
            {/* Market conditions bar */}
            <div style={{ fontSize: 12, color: "#9aa4b8", paddingBottom: 12, marginBottom: 14, borderBottom: "1px solid #1a1f2e" }}>
              Regime: <span style={{ color: "#dde4ef", fontWeight: 600 }}>{status.regime}</span> ({(status.regime_confidence * 100).toFixed(0)}%) · VIX: <span style={{ color: "#dde4ef", fontWeight: 600 }}>{status.vix?.toFixed(2) ?? "n/a"}</span>
              {status.has_portfolio && <span style={{ marginLeft: 10, color: "#5fb6ff", fontSize: 11 }}>● portfolio loaded</span>}
            </div>

            {/* Tab navigation */}
            <div style={{ display: "flex", gap: 4, marginBottom: 18, flexWrap: "wrap" }}>
              {(["portfolio", "b1", "b2", "b3", "b4"] as const).map((tab) => {
                const labels = { portfolio: "Portfolio", b1: "B1 — Autofill", b2: "B2 — CSP", b3: "B3 — LEAPS", b4: "B4 — Day Trade" };
                const badgeCount = {
                  portfolio: (status.owned_options?.length ?? 0) + (status.owned_stocks?.length ?? 0),
                  b1: status.b1.filter((r) => r.flag).length,
                  b2: status.b2.filter((r) => r.verdict === "GO").length,
                  b3: status.b3.filter((r) => r.verdict === "NEAR ENTRY").length,
                  b4: status.b4?.entriesAllowed ? 1 : 0,
                }[tab];
                const badgeColor = tab === "b1" ? { bg: "#5e2a32", fg: "#ff7070" } : { bg: "#1f5f4d", fg: "#3fdc8a" };
                const isActive = activeTab === tab;
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    style={{
                      padding: "7px 16px", fontSize: 12, fontWeight: 600, borderRadius: 7,
                      border: `1px solid ${isActive ? "#4a5f8a" : "#2a3142"}`,
                      background: isActive ? "#1a2540" : "transparent",
                      color: isActive ? "#dde4ef" : "#9aa4b8",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                    }}
                  >
                    {labels[tab]}
                    {badgeCount > 0 && (
                      <span style={{ background: badgeColor.bg, color: badgeColor.fg, borderRadius: 10, padding: "1px 6px", fontSize: 10 }}>
                        {badgeCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Portfolio tab */}
            {activeTab === "portfolio" && (
              <>
                {!status.has_portfolio && (
                  <div style={{ color: "#666", fontSize: 13, padding: "20px 0" }}>
                    No portfolio loaded. <a href="/cowork/portfolio" style={{ color: "#7fb", textDecoration: "none" }}>Add your positions →</a>
                  </div>
                )}
                {status.owned_options.length > 0 && (
                  <BucketGrid
                    title="Owned — LEAPS options"
                    tickers={status.owned_options.map((r) => ({
                      ticker: r.symbol,
                      price: r.underlyingPrice,
                      color: r.status,
                      label: r.daysToHardExit != null && r.daysToHardExit >= 0 ? `EXIT ${r.daysToHardExit}d` : `DTE ${r.daysToExpiry}`,
                      sub: `$${r.strike}${r.type[0]} ×${r.contracts} [${r.account.split(" ")[0]}]`,
                    }))}
                    active={chartSymbol}
                    onPick={setChartSymbol}
                  />
                )}
                {status.owned_stocks.length > 0 && (
                  <BucketGrid
                    title="Owned — Stocks"
                    tickers={status.owned_stocks.map((r) => ({
                      ticker: r.symbol,
                      price: r.livePrice,
                      color: r.status,
                      label: r.pnlPct != null ? `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(1)}%` : "—",
                      sub: `${r.shares}sh · ${r.account.split(" ")[0]}`,
                    }))}
                    active={chartSymbol}
                    onPick={setChartSymbol}
                  />
                )}
                {status.reentry.length > 0 && (
                  <BucketGrid
                    title="Re-entry"
                    tickers={status.reentry.map((r) => ({
                      ticker: r.symbol,
                      price: null,
                      color: r.status === "green" ? "green" : r.status === "amber" ? "amber" : "neutral",
                      label: r.windowStatus === "open" ? "WINDOW OPEN" : r.windowStatus === "passed" ? "PASSED" : r.daysToWindowOpen != null ? `in ${r.daysToWindowOpen}d` : "UPCOMING",
                      sub: r.daysToGoNogo != null ? `Go/No-Go ${r.daysToGoNogo >= 0 ? `in ${r.daysToGoNogo}d` : "PAST"}` : "",
                    }))}
                    active={chartSymbol}
                    onPick={setChartSymbol}
                  />
                )}
                {status.scalp && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Scalp</div>
                    <div style={{
                      display: "inline-block", padding: "8px 14px", borderRadius: 8, fontSize: 12,
                      border: `1px solid ${status.scalp.status === "clear" ? "#1f5f4d" : status.scalp.status === "blocked" ? "#5e2a32" : "#5e4a1f"}`,
                      background: status.scalp.status === "clear" ? "#0e2620" : status.scalp.status === "blocked" ? "#2a1417" : "#2a2010",
                    }}>
                      <span style={{ fontWeight: 700, color: status.scalp.status === "clear" ? "#3fdc8a" : status.scalp.status === "blocked" ? "#ff7070" : "#f5b400" }}>
                        {status.scalp.ticker} — {status.scalp.status.toUpperCase()}
                      </span>
                      <span style={{ color: "#9aa4b8", marginLeft: 8 }}>{status.scalp.reason}</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* B1 tab */}
            {activeTab === "b1" && (
              <BucketGrid
                title="B1 — Autofill (IRA)"
                tickers={status.b1.map((r) => ({
                  ticker: r.ticker,
                  price: r.price,
                  color: r.flag ? "red" : "neutral",
                  label: r.flag ? "FLAGGED" : "OK",
                  sub: r.pctFromHigh != null ? `${r.pctFromHigh >= 0 ? "+" : ""}${r.pctFromHigh.toFixed(1)}% from 52w high` : "",
                }))}
                active={chartSymbol}
                onPick={setChartSymbol}
              />
            )}

            {/* B2 tab */}
            {activeTab === "b2" && (
              <BucketGrid
                title="B2 — CSP"
                tickers={status.b2.map((r) => ({
                  ticker: r.ticker,
                  price: r.price,
                  color: r.verdict === "GO" ? "green" : r.verdict === "CAUTION" ? "amber" : "red",
                  label: r.verdict,
                  sub: r.rsi != null ? `RSI ${r.rsi.toFixed(0)}` : "",
                }))}
                active={chartSymbol}
                onPick={setChartSymbol}
              />
            )}

            {/* B3 tab */}
            {activeTab === "b3" && (
              <BucketGrid
                title="B3 — LEAPS (PATH last)"
                tickers={status.b3.map((r) => ({
                  ticker: r.ticker,
                  price: r.price,
                  color:
                    r.verdict === "NEAR ENTRY" ? "green" :
                    r.verdict === "EXIT APPROACHING" ? "amber" :
                    r.verdict === "HOLD" ? "red" :
                    r.verdict === "FIRED" ? "blue" : "neutral",
                  label: r.verdict,
                  sub: r.daysToHardExit != null && r.daysToHardExit >= 0 && r.daysToHardExit <= 30
                    ? `${r.daysToHardExit}d to exit`
                    : [
                        r.pullbackPct != null ? `PB ${r.pullbackPct.toFixed(1)}% (${r.pullbackGate})` : null,
                        r.vixB3Gate !== "UNKNOWN" ? `VIX ${r.vixB3Gate}` : null,
                      ].filter(Boolean).join(" · ") || r.alertRef,
                }))}
                active={chartSymbol}
                onPick={setChartSymbol}
              />
            )}

            {/* B4 tab */}
            {activeTab === "b4" && status.b4 && (
              <B4Panel b4={status.b4} active={chartSymbol} onPick={setChartSymbol} />
            )}
          </>
        )}
      </div>

      {/* Chart */}
      <div style={{ background: "#0f1118", border: "1px solid #2a3142", borderRadius: 10, padding: 20, marginTop: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{chartSymbol}</div>
          <div style={{ display: "flex", gap: 4 }}>
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setChartRange(r.key)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  borderRadius: 6,
                  border: "1px solid #2a3550",
                  background: chartRange === r.key ? "#1f2a40" : "#181d28",
                  color: chartRange === r.key ? "#7fb" : "#9aa4b8",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {growth && <GrowthStrip growth={growth} />}

        <div style={{ marginTop: 14, minHeight: 220 }}>
          {chartBusy ? (
            <div style={{ color: "#666", fontSize: 13, padding: 20 }}>Loading {chartSymbol}…</div>
          ) : chartError ? (
            <div style={{ color: "#ff8a8a", fontSize: 13, padding: 20 }}>Chart error: {chartError}</div>
          ) : candles.length ? (
            <CandleChart candles={candles} symbol={chartSymbol} />
          ) : (
            <div style={{ color: "#666", fontSize: 13, padding: 20 }}>No data</div>
          )}
        </div>
      </div>

      {/* SR.5 — Session Opening Protocol */}
      <SessionProtocol status={status} />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "24px 0 16px", alignItems: "center" }}>
        <button onClick={() => run("all")} disabled={busy !== null} style={btnStyle(busy === "all")}>
          {busy === "all" ? "Generating…" : "▶ Full brief"}
        </button>
        <button onClick={() => { setActiveTab("b1"); run("b1"); }} disabled={busy !== null} style={btnStyle(busy === "b1" || (busy === null && activeTab === "b1"))}>
          {busy === "b1" ? "Generating…" : "B1 brief"}
        </button>
        <button onClick={() => { setActiveTab("b2"); run("b2"); }} disabled={busy !== null} style={btnStyle(busy === "b2" || (busy === null && activeTab === "b2"))}>
          {busy === "b2" ? "Generating…" : "B2 brief"}
        </button>
        <button onClick={() => { setActiveTab("b3"); run("b3"); }} disabled={busy !== null} style={btnStyle(busy === "b3" || (busy === null && activeTab === "b3"))}>
          {busy === "b3" ? "Generating…" : "B3 brief"}
        </button>
      </div>

      {error && (
        <div style={{ background: "#3a1a1a", color: "#ff8a8a", border: "1px solid #5a2a2a", padding: 12, borderRadius: 6, marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      {diag && (
        <div style={{ background: "#1a1f2e", color: "#9fb", border: "1px solid #2a3550", padding: 12, borderRadius: 6, marginBottom: 16, fontFamily: "monospace", fontSize: 12 }}>
          regime={diag.regime} ({(diag.regime_confidence * 100).toFixed(0)}%) · vix={diag.vix ?? "n/a"} · b1_flagged={diag.b1_flagged} · b2_go={diag.b2_go_count} · b3_exits_30d={diag.b3_exits_within_30d.length}
        </div>
      )}

      {brief && <pre style={preStyle}>{brief}</pre>}
    </div>
  );
}

type ChipColor = "green" | "red" | "amber" | "blue" | "neutral";

function BucketGrid({
  title,
  tickers,
  active,
  onPick,
}: {
  title: string;
  tickers: { ticker: string; price: number | null; color: ChipColor; label: string; sub: string }[];
  active: string;
  onPick: (t: string) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {tickers.map((t) => (
          <TickerChip key={t.ticker} {...t} active={active === t.ticker} onClick={() => onPick(t.ticker)} />
        ))}
      </div>
    </div>
  );
}

function TickerChip({
  ticker,
  price,
  color,
  label,
  sub,
  active,
  onClick,
}: {
  ticker: string;
  price: number | null;
  color: ChipColor;
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  const palette: Record<ChipColor, { bg: string; border: string; accent: string }> = {
    green:   { bg: "#0e2620", border: "#1f5f4d", accent: "#3fdc8a" },
    red:     { bg: "#2a1417", border: "#5e2a32", accent: "#ff7070" },
    amber:   { bg: "#2a2010", border: "#5e4a1f", accent: "#f5b400" },
    blue:    { bg: "#10212e", border: "#1f4a6e", accent: "#5fb6ff" },
    neutral: { bg: "#181d28", border: "#2a3550", accent: "#9aa4b8" },
  };
  const p = palette[color];
  return (
    <button
      onClick={onClick}
      style={{
        background: p.bg,
        border: `1px solid ${active ? p.accent : p.border}`,
        boxShadow: active ? `0 0 0 1px ${p.accent} inset` : "none",
        borderRadius: 8,
        padding: "8px 10px",
        cursor: "pointer",
        textAlign: "left",
        minWidth: 130,
        color: "#dde4ef",
      }}
      title={`${ticker} · ${label} · ${sub}`}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.accent, display: "inline-block" }} />
        <span style={{ fontWeight: 700, fontSize: 13 }}>{ticker}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#9aa4b8" }}>{price != null ? `$${price.toFixed(2)}` : "—"}</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 10, color: p.accent, fontWeight: 600, letterSpacing: 0.3 }}>{label}</div>
      {sub && <div style={{ marginTop: 1, fontSize: 10, color: "#7d8699" }}>{sub}</div>}
    </button>
  );
}

function GrowthStrip({ growth }: { growth: Growth }) {
  const order: (keyof Growth)[] = ["1d", "1w", "1m", "3m", "6m", "1y"];
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {order.map((k) => {
        const v = growth[k];
        const color = v == null ? "#888" : v >= 0 ? "#3fdc8a" : "#ff7070";
        return (
          <div key={k} style={{ flex: "1 1 100px", minWidth: 90, background: "#181d28", border: "1px solid #2a3550", borderRadius: 6, padding: "8px 12px" }}>
            <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5 }}>{k}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color }}>
              {v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CandleChart({ candles, symbol }: { candles: Candle[]; symbol: string }) {
  const W = 1000;
  const H = 280;
  const padTop = 10;
  const padBottom = 30;
  const padLeft = 50;
  const padRight = 10;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const n = candles.length;

  const yMax = Math.max(...candles.map((c) => c.high)) * 1.005;
  const yMin = Math.min(...candles.map((c) => c.low)) * 0.995;
  const yRange = yMax - yMin || 1;

  const slot = plotW / n;
  const candleWidth = Math.max(2, slot * 0.7);

  const yPx = (price: number) => padTop + (1 - (price - yMin) / yRange) * plotH;

  const last = candles[n - 1];
  const first = candles[0];
  const periodChange = ((last.close - first.open) / first.open) * 100;
  const periodColor = periodChange >= 0 ? "#3fdc8a" : "#ff7070";

  const ticks: number[] = [];
  for (let i = 0; i <= 4; i++) ticks.push(yMin + (yRange * i) / 4);

  return (
    <div>
      <div style={{ display: "flex", gap: 16, alignItems: "baseline", marginBottom: 8 }}>
        <div style={{ fontSize: 14, color: "#9aa4b8" }}>${last.close.toFixed(2)}</div>
        <div style={{ fontSize: 13, color: periodColor, fontWeight: 600 }}>
          {periodChange >= 0 ? "+" : ""}{periodChange.toFixed(2)}% over window
        </div>
        <div style={{ fontSize: 11, color: "#666", marginLeft: "auto" }}>
          {first.date} → {last.date} · {n} bars
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", background: "#0a0c12", borderRadius: 6 }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={padLeft} x2={W - padRight} y1={yPx(t)} y2={yPx(t)} stroke="#1a1f2e" strokeWidth={1} />
            <text x={padLeft - 6} y={yPx(t) + 3} textAnchor="end" fontSize={10} fill="#666">{t.toFixed(2)}</text>
          </g>
        ))}

        {candles.map((c, i) => {
          const cx = padLeft + slot * i + slot / 2;
          const isUp = c.close >= c.open;
          const color = isUp ? "#3fdc8a" : "#ff7070";
          const bodyTop = yPx(Math.max(c.open, c.close));
          const bodyBot = yPx(Math.min(c.open, c.close));
          const bodyH = Math.max(1, bodyBot - bodyTop);
          return (
            <g key={i}>
              <line x1={cx} x2={cx} y1={yPx(c.high)} y2={yPx(c.low)} stroke={color} strokeWidth={1} />
              <rect x={cx - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyH} fill={color} opacity={isUp ? 0.85 : 0.95} />
            </g>
          );
        })}

        {[0, Math.floor(n / 2), n - 1].map((i) => (
          <text key={i} x={padLeft + slot * i + slot / 2} y={H - 10} textAnchor="middle" fontSize={10} fill="#666">{candles[i].date}</text>
        ))}
      </svg>
    </div>
  );
}

// ───── B4 — Day Trading panel ─────

const B4_SCALE = [
  { exit: "Exit 1", size: "70%", where: "Target 1 (options ~40–60% up) — lock the bulk" },
  { exit: "Exit 2", size: "20%", where: "Target 2 — add to locked profit" },
  { exit: "Exit 3", size: "10%", where: "Target 3 — runners" },
];

const B4_HARD_RULES = [
  "HR.1 — No trades before 10 AM ET",
  "HR.2 — No trades 11:30 AM–1:30 PM (dead zone)",
  "HR.3 — All positions flat by 3:45 PM ET",
  "HR.4 — Stop after daily max loss is hit",
  "HR.5 — No forced trades. 0 trades = discipline pass",
  "HR.6 — B4 never touches B2/B3 capital",
];

function B4Panel({ b4, active, onPick }: { b4: B4Status; active: string; onPick: (t: string) => void }) {
  const gateColor: Record<B4Gate["state"], { bg: string; border: string; fg: string }> = {
    PASS:    { bg: "#0e2620", border: "#1f5f4d", fg: "#3fdc8a" },
    FAIL:    { bg: "#2a1417", border: "#5e2a32", fg: "#ff7070" },
    MANUAL:  { bg: "#2a2010", border: "#5e4a1f", fg: "#f5b400" },
    UNKNOWN: { bg: "#181d28", border: "#2a3550", fg: "#9aa4b8" },
  };
  const biasColor = (b: "BULL" | "BEAR" | "UNKNOWN" | "CALLS" | "PUTS" | "MIXED") =>
    b === "BULL" || b === "CALLS" ? "#3fdc8a" : b === "BEAR" || b === "PUTS" ? "#ff7070" : b === "MIXED" ? "#f5b400" : "#9aa4b8";

  return (
    <div>
      {/* Live / not-live banner */}
      <div style={{
        padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 12,
        border: `1px solid ${b4.live ? "#1f5f4d" : "#5e4a1f"}`,
        background: b4.live ? "#0e2620" : "#2a2010",
      }}>
        <span style={{ fontWeight: 700, color: b4.live ? "#3fdc8a" : "#f5b400" }}>
          {b4.live ? "● B4 LIVE" : "○ B4 NOT LIVE — documented only"}
        </span>
        <span style={{ color: "#9aa4b8", marginLeft: 8 }}>
          {b4.live ? "Go-live gate met." : `${b4.goLive.filter((d) => d.status === "OPEN").length} of 4 decisions open. Individual Z33181037 only.`}
        </span>
      </div>

      {/* Session clock */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Session</div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            border: `1px solid ${b4.entriesAllowed ? "#1f5f4d" : "#5e2a32"}`,
            background: b4.entriesAllowed ? "#0e2620" : "#2a1417",
            color: b4.entriesAllowed ? "#3fdc8a" : "#ff7070",
          }}>
            {b4.entriesAllowed ? "ENTRIES OPEN" : "NO ENTRIES"}
          </span>
          <span style={{ fontSize: 13, color: "#dde4ef", fontWeight: 600 }}>{b4.etTime}</span>
          <span style={{ fontSize: 12, color: "#9aa4b8" }}>{b4.sessionLabel}</span>
        </div>
        <div style={{ fontSize: 11, color: "#5fb6ff", marginTop: 6, fontStyle: "italic" }}>→ {b4.weeklyTask}</div>
      </div>

      {/* Futures */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>
          Futures bias <span style={{ textTransform: "none", color: "#666" }}>(daily 9-EMA proxy — confirm intraday VWAP+9EMA)</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[{ k: "ES", f: b4.futures.es }, { k: "NQ", f: b4.futures.nq }].map(({ k, f }) => (
            <div key={k} style={{ background: "#181d28", border: "1px solid #2a3550", borderRadius: 8, padding: "8px 12px", minWidth: 130 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{k} <span style={{ color: biasColor(f.bias), fontSize: 11 }}>{f.bias}</span></div>
              <div style={{ fontSize: 11, color: "#9aa4b8", marginTop: 2 }}>
                {f.price != null ? f.price.toFixed(2) : "—"} · {f.pctFromEma != null ? `${f.pctFromEma >= 0 ? "+" : ""}${f.pctFromEma.toFixed(2)}% vs 9EMA` : "no data"}
              </div>
            </div>
          ))}
          <div style={{ background: "#10212e", border: "1px solid #1f4a6e", borderRadius: 8, padding: "8px 12px", minWidth: 130 }}>
            <div style={{ fontSize: 11, color: "#9aa4b8" }}>Combined</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: biasColor(b4.futures.combinedBias) }}>{b4.futures.combinedBias}</div>
          </div>
        </div>
      </div>

      {/* Gate stack */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Gate stack — all must pass before entry</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {b4.gates.map((g) => {
            const c = gateColor[g.state];
            return (
              <div key={g.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 6, padding: "7px 10px" }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: c.fg, minWidth: 52 }}>{g.state}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#dde4ef" }}>{g.id} · {g.label}</span>
                  <div style={{ fontSize: 11, color: "#7d8699", marginTop: 1 }}>{g.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Watchlist with mapped levels */}
      {b4.watchlist.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Watchlist — pre-mapped levels</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {b4.watchlist.map((w) => (
              <button key={w.ticker} onClick={() => onPick(w.ticker)} style={{
                background: "#181d28", border: `1px solid ${active === w.ticker ? "#4a5f8a" : "#2a3550"}`,
                borderRadius: 8, padding: "8px 10px", cursor: "pointer", textAlign: "left", minWidth: 150, color: "#dde4ef",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{w.ticker}</span>
                  <span style={{ fontSize: 11, color: "#9aa4b8" }}>{w.price != null ? `$${w.price.toFixed(2)}` : "—"}</span>
                </div>
                <div style={{ fontSize: 10, color: "#7d8699", marginTop: 3 }}>
                  {w.bullLevel != null || w.bearLevel != null
                    ? `▲ ${w.bullLevel ?? "—"} · ▼ ${w.bearLevel ?? "—"}`
                    : "levels not mapped"}
                </div>
                {w.targets.length > 0 && (
                  <div style={{ fontSize: 10, color: "#5fb6ff", marginTop: 1 }}>T: {w.targets.join(" → ")}</div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 70/20/10 exit plan */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Exit — 70 / 20 / 10 scale-out</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {B4_SCALE.map((s) => (
            <div key={s.exit} style={{ display: "flex", gap: 10, fontSize: 12, background: "#181d28", border: "1px solid #2a3550", borderRadius: 6, padding: "6px 10px" }}>
              <span style={{ color: "#3fdc8a", fontWeight: 700, minWidth: 40 }}>{s.size}</span>
              <span style={{ color: "#9aa4b8" }}>{s.where}</span>
            </div>
          ))}
          <div style={{ fontSize: 11, color: "#f5b400", marginTop: 4 }}>
            ⚠ Momentum exit overrides all targets: futures reject / wicky price / opposing order flow → exit now.
          </div>
        </div>
      </div>

      {/* Go-live decisions */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Go-live decisions</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {b4.goLive.map((d) => (
            <div key={d.id} style={{
              background: d.status === "SET" ? "#0e2620" : "#2a2010",
              border: `1px solid ${d.status === "SET" ? "#1f5f4d" : "#5e4a1f"}`,
              borderRadius: 8, padding: "8px 12px", minWidth: 150,
            }}>
              <div style={{ fontSize: 10, color: d.status === "SET" ? "#3fdc8a" : "#f5b400", fontWeight: 700 }}>{d.id}. {d.status}</div>
              <div style={{ fontSize: 12, color: "#dde4ef", marginTop: 2 }}>{d.label}</div>
              <div style={{ fontSize: 11, color: "#9aa4b8", marginTop: 1 }}>{d.value ?? "—"}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Hard rules */}
      <div>
        <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Hard session rules</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {B4_HARD_RULES.map((r) => (
            <span key={r} style={{ fontSize: 11, color: "#9aa4b8", background: "#181d28", border: "1px solid #2a3550", borderRadius: 6, padding: "4px 8px" }}>{r}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───── SR.5 Session Opening Protocol ─────

const SR5_STEPS = [
  {
    id: "market",
    label: "Market conditions",
    detail: "Check regime (Bull/Neutral/Bear/Crash) + VIX vs 18/25 prime window. Bear or Crash = selective entries only.",
  },
  {
    id: "owned_exits",
    label: "Owned LEAPS — exit review",
    detail: "Any hard exit within 14 days? Any DTE < 30? Flag immediately, prioritize over new entries.",
  },
  {
    id: "nvdl_stop",
    label: "NVDL stop test (9:55 AM)",
    detail: "If NVDL position active: run R1 MA50/10 Fidelity stop test at 9:55 AM. Error = no NVDL entry this session.",
  },
  {
    id: "b2_csp",
    label: "B2 CSP scan",
    detail: "VIX 18–25 = prime window. Check GO verdicts — RSI < 35, weekly MACD positive. PYPL always included. SPCX: no CSP before 2026-07-19.",
  },
  {
    id: "b3_leaps",
    label: "B3 LEAPS scan",
    detail: "NEAR ENTRY requires: regime bull/neutral + VIX < 22 (R3.3) + pullback 10–25% from 52w high (R3.2). PATH always scanned last.",
  },
  {
    id: "reentry",
    label: "Re-entry + IRA stops",
    detail: "Check open re-entry windows. IRA accounts: no GTC stops — manual stop management required at open and close.",
  },
];

function SessionProtocol({ status }: { status: Status | null }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const storageKey = `sr5-${new Date().toISOString().slice(0, 10)}`;
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setChecked(JSON.parse(saved));
    } catch {}
  }, [storageKey]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const done = SR5_STEPS.filter((s) => checked[s.id]).length;
  const allDone = done === SR5_STEPS.length;

  // Derive context-aware hints from live status.
  function hint(step: typeof SR5_STEPS[0]): string | null {
    if (!status) return null;
    if (step.id === "market") {
      const r = status.regime;
      const v = status.vix;
      return `Regime: ${r} · VIX: ${v?.toFixed(2) ?? "n/a"}${v != null && v > 25 ? " ⚠ elevated — no B2" : v != null && v < 18 ? " ⚠ low premium" : " ✓ prime"}`;
    }
    if (step.id === "owned_exits") {
      const urgent = status.owned_options.filter((o) => o.daysToHardExit != null && o.daysToHardExit >= 0 && o.daysToHardExit <= 14);
      return urgent.length ? `⚑ ${urgent.map((o) => `${o.symbol} ${o.daysToHardExit}d`).join(", ")} — EXIT SOON` : "No hard exits within 14 days.";
    }
    if (step.id === "b2_csp") {
      const gos = status.b2.filter((r) => r.verdict === "GO");
      return gos.length ? `GO: ${gos.map((r) => r.ticker).join(", ")}` : "No GO verdicts today.";
    }
    if (step.id === "b3_leaps") {
      const near = status.b3.filter((r) => r.verdict === "NEAR ENTRY");
      return near.length ? `NEAR ENTRY: ${near.map((r) => r.ticker).join(", ")}` : "No NEAR ENTRY tickers today.";
    }
    if (step.id === "reentry") {
      const open2 = status.reentry.filter((r) => r.windowStatus === "open");
      return open2.length ? `Windows open: ${open2.map((r) => r.symbol).join(", ")}` : "No re-entry windows open.";
    }
    return null;
  }

  return (
    <div style={{ background: "#0f1118", border: `1px solid ${allDone ? "#1f5f4d" : "#2a3142"}`, borderRadius: 10, padding: "14px 20px", marginTop: 20 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ background: "none", border: "none", cursor: "pointer", width: "100%", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 10 }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: allDone ? "#3fdc8a" : "#dde4ef" }}>
          {open ? "▾" : "▸"} SR.5 — Session Opening Protocol
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: allDone ? "#3fdc8a" : "#9aa4b8" }}>
          {done}/{SR5_STEPS.length} {allDone ? "✓ complete" : "steps"}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          {SR5_STEPS.map((step, i) => {
            const h = hint(step);
            const isDone = !!checked[step.id];
            return (
              <div
                key={step.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom: i < SR5_STEPS.length - 1 ? "1px solid #1a1f2e" : "none",
                }}
              >
                <button
                  onClick={() => toggle(step.id)}
                  style={{
                    width: 20, height: 20, marginTop: 1, flexShrink: 0,
                    borderRadius: 4, border: `2px solid ${isDone ? "#3fdc8a" : "#3a4250"}`,
                    background: isDone ? "#3fdc8a" : "transparent",
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  }}
                >
                  {isDone && <span style={{ color: "#0e2620", fontSize: 12, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                </button>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isDone ? "#9aa4b8" : "#dde4ef", textDecoration: isDone ? "line-through" : "none" }}>
                    {i + 1}. {step.label}
                  </div>
                  <div style={{ fontSize: 11, color: "#7d8699", marginTop: 2 }}>{step.detail}</div>
                  {h && (
                    <div style={{ fontSize: 11, color: isDone ? "#555" : "#5fb6ff", marginTop: 4, fontFamily: "monospace" }}>→ {h}</div>
                  )}
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: 10, textAlign: "right" }}>
            <button
              onClick={() => {
                setChecked({});
                try { localStorage.removeItem(storageKey); } catch {}
              }}
              style={{ fontSize: 10, color: "#555", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              Reset checklist
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function btnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "10px 18px",
    border: "1px solid #3a4250",
    background: active ? "#1f2a40" : "#181d28",
    color: active ? "#7fb" : "#dde4ef",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
  };
}

function chipBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    border: "1px solid #2a3550",
    background: active ? "#1f2a40" : "#181d28",
    color: active ? "#7fb" : "#9aa4b8",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 500,
  };
}

const preStyle: React.CSSProperties = {
  background: "#0f1118",
  color: "#dde4ef",
  border: "1px solid #2a3142",
  borderRadius: 8,
  padding: 20,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 13,
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
