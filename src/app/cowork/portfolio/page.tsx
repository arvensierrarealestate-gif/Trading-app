"use client";

import { useCallback, useEffect, useState } from "react";
import { PORTFOLIO_TEMPLATE, type CoworkPortfolio } from "@/lib/cowork-portfolio";

type Summary = {
  owned_options: number;
  owned_stocks: number;
  b1_tickers: number;
  b2_tickers: number;
  b3_tickers: number;
  reentry_count: number;
  scalp_ticker: string | null;
  other_watch: number;
};

export default function PortfolioPage() {
  const [text, setText] = useState<string>("");
  const [portfolio, setPortfolio] = useState<CoworkPortfolio | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(async () => {
    setBusy("load");
    setError(null);
    try {
      const res = await fetch("/api/cowork/portfolio");
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setPortfolio(j.portfolio);
      setUpdatedAt(j.updated_at);
      if (j.portfolio) setText(JSON.stringify(j.portfolio, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }, []);

  async function save() {
    setBusy("save");
    setError(null);
    setIssues([]);
    setSummary(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      setError(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
      setBusy(null);
      return;
    }
    try {
      const res = await fetch("/api/cowork/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        if (Array.isArray(j.issues)) setIssues(j.issues);
        return;
      }
      setSummary(j.summary);
      setUpdatedAt(j.saved_at);
      await load(); // re-fetch to confirm round-trip
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(null);
    }
  }

  function loadTemplate() {
    setText(PORTFOLIO_TEMPLATE);
    setError(null);
    setIssues([]);
    setSummary(null);
  }

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ maxWidth: 1100, margin: "30px auto", padding: 20, fontFamily: "system-ui, sans-serif", color: "#dde4ef" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Cowork portfolio</h1>
        <a href="/cowork" style={{ color: "#7fb", fontSize: 13, textDecoration: "none" }}>← Back to brief</a>
      </div>
      <p style={{ color: "#888", fontSize: 13, marginTop: 4 }}>
        Owned positions + 5 monitoring lists. Paste JSON below, save, and the brief will use it.
      </p>

      {updatedAt && (
        <div style={{ fontSize: 12, color: "#9aa4b8", marginTop: 8 }}>
          Last saved: {new Date(updatedAt).toLocaleString()}
        </div>
      )}

      <div style={{ background: "#0f1118", border: "1px solid #2a3142", borderRadius: 10, padding: 20, marginTop: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          <button onClick={save} disabled={busy !== null || !text.trim()} style={btnPrimary(busy === "save")}>
            {busy === "save" ? "Saving…" : "💾 Save portfolio"}
          </button>
          <button onClick={loadTemplate} disabled={busy !== null} style={btnGhost}>
            ↺ Load template
          </button>
          <button onClick={load} disabled={busy !== null} style={btnGhost}>
            {busy === "load" ? "Reloading…" : "Reload from DB"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#3a1a1a", color: "#ff8a8a", border: "1px solid #5a2a2a", padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            <strong>{error}</strong>
            {issues.length > 0 && (
              <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                {issues.map((i, idx) => (
                  <li key={idx} style={{ fontSize: 12, color: "#ffb0b0" }}>{i}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {summary && (
          <div style={{ background: "#10241a", color: "#9fc", border: "1px solid #1f5f4d", padding: 12, borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
            ✓ Saved · {summary.owned_options} owned options · {summary.owned_stocks} owned stocks · B1 {summary.b1_tickers} · B2 {summary.b2_tickers} · B3 {summary.b3_tickers} · re-entry {summary.reentry_count} · scalp {summary.scalp_ticker ?? "—"} · other {summary.other_watch}
          </div>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder="Paste portfolio JSON here, or click 'Load template' for the schema."
          style={{
            width: "100%",
            minHeight: 420,
            background: "#0a0c12",
            color: "#dde4ef",
            border: "1px solid #2a3550",
            borderRadius: 6,
            padding: 14,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            lineHeight: 1.55,
            resize: "vertical",
          }}
        />
      </div>

      {portfolio && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, margin: "0 0 12px" }}>Currently saved</h2>
          <SavedSummary portfolio={portfolio} />
        </div>
      )}
    </div>
  );
}

function SavedSummary({ portfolio }: { portfolio: CoworkPortfolio }) {
  const cash = portfolio.cash_by_account ? Object.entries(portfolio.cash_by_account) : [];
  return (
    <div style={{ background: "#0f1118", border: "1px solid #2a3142", borderRadius: 10, padding: 20 }}>
      <Section label="Header">
        <Row k="Portfolio total" v={fmt(portfolio.portfolio_total)} />
        <Row k="Target" v={fmt(portfolio.target)} />
        <Row k="Gap" v={fmt(portfolio.gap)} />
        <Row k="% to target" v={portfolio.pct_to_target != null ? `${portfolio.pct_to_target}%` : "—"} />
        <Row k="Last sync" v={portfolio.last_sync ?? "—"} />
        {cash.length > 0 && (
          <Row k="Cash by account" v={cash.map(([a, v]) => `${a}: ${fmt(v)}`).join(" · ")} />
        )}
      </Section>

      <Section label={`Owned options (${portfolio.owned_options.length})`}>
        {portfolio.owned_options.length === 0 && <div style={{ color: "#666", fontSize: 13 }}>None.</div>}
        {portfolio.owned_options.map((o, i) => (
          <div key={i} style={rowItemStyle}>
            <strong>{o.symbol}</strong> {o.side} {o.type} {o.strike} exp {o.expiry} · {o.contracts}c @ {fmt(o.cost_basis)} · {o.account}
            {o.gtc_stop != null && <span style={{ color: "#9aa4b8" }}> · GTC {fmt(o.gtc_stop)}</span>}
            {o.stop_manual != null && <span style={{ color: "#9aa4b8" }}> · stop {fmt(o.stop_manual)}</span>}
            {o.hard_exit && <span style={{ color: "#f5b400" }}> · ⚑ hard exit {o.hard_exit}</span>}
          </div>
        ))}
      </Section>

      <Section label={`Owned stocks (${portfolio.owned_stocks.length})`}>
        {portfolio.owned_stocks.length === 0 && <div style={{ color: "#666", fontSize: 13 }}>None.</div>}
        {portfolio.owned_stocks.map((s, i) => (
          <div key={i} style={rowItemStyle}>
            <strong>{s.symbol}</strong> · {s.shares} sh @ {fmt(s.cost_basis)} · {s.account}
            {s.has_stop && s.stop != null && <span style={{ color: "#9aa4b8" }}> · stop {fmt(s.stop)}</span>}
            {s.bucket_tag && s.bucket_tag !== "none" && <span style={{ color: "#7fb" }}> · {s.bucket_tag}</span>}
          </div>
        ))}
      </Section>

      <Section label="Monitoring lists">
        <Row k="B1 autofill" v={`${portfolio.monitor_B1_autofill?.tickers.length ?? 0} tickers`} />
        <Row k="B2 CSP" v={`${portfolio.monitor_B2_csp?.tickers.length ?? 0} tickers`} />
        <Row k="B3 LEAPS" v={`${portfolio.monitor_B3_leaps?.scan_order.length ?? 0} tickers (PATH last: ${portfolio.monitor_B3_leaps?.scan_order.slice(-1)[0] === "PATH" ? "✓" : "✗"})`} />
        <Row k="Re-entry" v={`${portfolio.monitor_reentry.length} planned`} />
        <Row k="Scalp" v={portfolio.monitor_scalp?.ticker ?? "—"} />
        <Row k="Other watch" v={`${portfolio.other_watch.length} symbols`} />
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#9aa4b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "4px 0", borderBottom: "1px solid #1a1f2e" }}>
      <span style={{ color: "#9aa4b8" }}>{k}</span>
      <span style={{ color: "#dde4ef" }}>{v}</span>
    </div>
  );
}

function fmt(n: number | undefined | null): string {
  return n == null ? "—" : `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

const btnPrimary = (active: boolean): React.CSSProperties => ({
  padding: "10px 18px",
  border: "1px solid #1f5f4d",
  background: active ? "#10241a" : "#0e2620",
  color: "#3fdc8a",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
});

const btnGhost: React.CSSProperties = {
  padding: "10px 14px",
  border: "1px solid #2a3550",
  background: "#181d28",
  color: "#dde4ef",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 13,
};

const rowItemStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "#dde4ef",
  padding: "4px 0",
  borderBottom: "1px solid #1a1f2e",
};
