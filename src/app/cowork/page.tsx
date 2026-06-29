"use client";

import { useCallback, useEffect, useState } from "react";

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
type B3Status = { ticker: string; price: number | null; verdict: "MONITOR" | "NEAR ENTRY" | "EXIT APPROACHING" | "HOLD" | "FIRED"; alertRef: string; daysToHardExit: number | null };
type OwnedOptionStatus = { symbol: string; type: string; side: string; strike: number; expiry: string; account: string; contracts: number; daysToExpiry: number; daysToHardExit: number | null; underlyingPrice: number | null; costBasis: number; status: "green" | "amber" | "red"; note: string };
type OwnedStockStatus = { symbol: string; account: string; shares: number; livePrice: number | null; pnlPct: number | null; stop: number | null; status: "green" | "amber" | "red"; note: string };
type ReentryStatus = { symbol: string; windowStatus: "open" | "upcoming" | "passed"; daysToWindowOpen: number | null; daysToWindowClose: number | null; daysToGoNogo: number | null; trigger: string; status: "green" | "amber" | "neutral" };
type ScalpStatus = { ticker: string; status: "clear" | "blocked" | "caution"; reason: string };
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
            <div style={{ fontSize: 12, color: "#9aa4b8", marginBottom: 10 }}>
              Regime: <span style={{ color: "#dde4ef", fontWeight: 600 }}>{status.regime}</span> ({(status.regime_confidence * 100).toFixed(0)}%) · VIX: <span style={{ color: "#dde4ef", fontWeight: 600 }}>{status.vix?.toFixed(2) ?? "n/a"}</span>
              {status.has_portfolio && <span style={{ marginLeft: 10, color: "#5fb6ff", fontSize: 11 }}>● portfolio loaded</span>}
            </div>

            {status.has_portfolio && (status.owned_options.length > 0 || status.owned_stocks.length > 0) && (
              <>
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
              </>
            )}

            {status.has_portfolio && status.reentry.length > 0 && (
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
                  display: "inline-block",
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: `1px solid ${status.scalp.status === "clear" ? "#1f5f4d" : status.scalp.status === "blocked" ? "#5e2a32" : "#5e4a1f"}`,
                  background: status.scalp.status === "clear" ? "#0e2620" : status.scalp.status === "blocked" ? "#2a1417" : "#2a2010",
                  fontSize: 12,
                }}>
                  <span style={{ fontWeight: 700, color: status.scalp.status === "clear" ? "#3fdc8a" : status.scalp.status === "blocked" ? "#ff7070" : "#f5b400" }}>
                    {status.scalp.ticker} — {status.scalp.status.toUpperCase()}
                  </span>
                  <span style={{ color: "#9aa4b8", marginLeft: 8 }}>{status.scalp.reason}</span>
                </div>
              </div>
            )}

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
                sub: r.daysToHardExit != null && r.daysToHardExit >= 0 && r.daysToHardExit <= 30 ? `${r.daysToHardExit}d to exit` : r.alertRef,
              }))}
              active={chartSymbol}
              onPick={setChartSymbol}
            />
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "24px 0 16px" }}>
        <button onClick={() => run("all")} disabled={busy !== null} style={btnStyle(busy === "all")}>
          {busy === "all" ? "Generating…" : "▶ Full brief"}
        </button>
        <button onClick={() => run("b1")} disabled={busy !== null} style={btnStyle(busy === "b1")}>
          {busy === "b1" ? "Generating…" : "B1 — Autofill"}
        </button>
        <button onClick={() => run("b2")} disabled={busy !== null} style={btnStyle(busy === "b2")}>
          {busy === "b2" ? "Generating…" : "B2 — CSP"}
        </button>
        <button onClick={() => run("b3")} disabled={busy !== null} style={btnStyle(busy === "b3")}>
          {busy === "b3" ? "Generating…" : "B3 — LEAPS"}
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
