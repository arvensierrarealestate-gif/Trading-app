"use client";

import { useCallback, useEffect, useState } from "react";
import { B1_TICKERS, B2_TICKERS, B3_TICKERS, EXTRA_WATCH } from "@/lib/cowork-brief";

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

const ALL_TICKERS = Array.from(
  new Set(
    [
      ...B1_TICKERS.map((t) => ({ t, b: "B1" as const })),
      ...B2_TICKERS.map((t) => ({ t, b: "B2" as const })),
      ...B3_TICKERS.map((t) => ({ t, b: "B3" as const })),
      ...EXTRA_WATCH.map((t) => ({ t, b: "Extra" as const })),
    ].map((x) => JSON.stringify(x)),
  ),
).map((s) => JSON.parse(s) as { t: string; b: string });

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

  const [chartSymbol, setChartSymbol] = useState<string>("NVDA");
  const [chartRange, setChartRange] = useState<Range>("3m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [chartBusy, setChartBusy] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

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

  useEffect(() => { loadChart(); }, [loadChart]);

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
        Three-bucket morning brief + per-ticker candle scan.
      </p>

      <div style={{ background: "#0f1118", border: "1px solid #2a3142", borderRadius: 10, padding: 20, marginTop: 20 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <label style={{ fontSize: 12, color: "#9aa4b8" }}>Ticker</label>
          <select
            value={chartSymbol}
            onChange={(e) => setChartSymbol(e.target.value)}
            style={{ padding: "6px 10px", background: "#181d28", color: "#dde4ef", border: "1px solid #2a3550", borderRadius: 6, fontSize: 13 }}
          >
            {(["B1", "B2", "B3", "Extra"] as const).map((bucket) => (
              <optgroup key={bucket} label={bucket}>
                {ALL_TICKERS.filter((x) => x.b === bucket).map((x) => (
                  <option key={`${bucket}-${x.t}`} value={x.t}>{x.t}</option>
                ))}
              </optgroup>
            ))}
          </select>

          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
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
        <div style={{ fontSize: 18, fontWeight: 700 }}>{symbol}</div>
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
