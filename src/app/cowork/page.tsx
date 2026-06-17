"use client";

import { useState } from "react";

type Diagnostics = {
  regime: string;
  regime_confidence: number;
  vix: number | null;
  b1_flagged: number;
  b2_go_count: number;
  b3_exits_within_30d: { ticker: string; days: number }[];
};

export default function CoworkPage() {
  const [brief, setBrief] = useState<string | null>(null);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 20, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ margin: 0, fontSize: 24 }}>Cowork brief — test page</h1>
      <p style={{ color: "#888", fontSize: 13, marginTop: 4 }}>
        Hits <code>POST /api/morning-brief/cowork</code> and renders the response.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
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
          Diagnostics: regime={diag.regime} ({(diag.regime_confidence * 100).toFixed(0)}%) · vix={diag.vix ?? "n/a"} · b1_flagged={diag.b1_flagged} · b2_go={diag.b2_go_count} · b3_exits_30d={diag.b3_exits_within_30d.length}
        </div>
      )}

      {brief && (
        <pre
          style={{
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
          }}
        >
          {brief}
        </pre>
      )}

      {!brief && !error && !busy && (
        <div style={{ color: "#666", fontSize: 13, marginTop: 24 }}>
          Click a button above to run the brief. Output renders below.
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
