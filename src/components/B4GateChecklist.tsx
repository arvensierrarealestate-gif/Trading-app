"use client";

// Presentational B4 gate checklist + verdict. Fed the result of
// /api/cowork/b4-evaluate by its parent (B4EntryCheck) — it does no fetching
// of its own. Dark inline theme to match the cowork tab.

type GateStatus = "pass" | "fail" | "pending" | "na";

export type B4EvalResult = {
  et_time: string;
  bias: string;
  gates: { code: string; name: string; status: GateStatus; reason: string }[];
  can_open: { ok: boolean; reason: string };
  live: boolean;
  setup_ok: boolean;
  clear_to_enter: boolean;
  reason: string;
  exit_plan: { scaling: boolean; note: string; legs: { pct: number; target: number }[] };
};

const STATUS: Record<GateStatus, { bg: string; border: string; fg: string; label: string }> = {
  pass:    { bg: "#0e2620", border: "#1f5f4d", fg: "#3fdc8a", label: "PASS" },
  fail:    { bg: "#2a1417", border: "#5e2a32", fg: "#ff7070", label: "FAIL" },
  pending: { bg: "#2a2010", border: "#5e4a1f", fg: "#f5b400", label: "CHECK" },
  na:      { bg: "#141a24", border: "#2a3550", fg: "#9aa4b8", label: "N/A" },
};

export default function B4GateChecklist({ result }: { result: B4EvalResult }) {
  return (
    <div>
      {/* Verdict banner */}
      <div style={{
        padding: "8px 14px", borderRadius: 8, marginBottom: 10, fontSize: 14, fontWeight: 700,
        border: `1px solid ${result.setup_ok ? "#1f5f4d" : "#5e2a32"}`,
        background: result.setup_ok ? "#0e2620" : "#2a1417",
        color: result.setup_ok ? "#3fdc8a" : "#ff7070",
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      }}>
        <span>{result.setup_ok ? "✓ SETUP VALID" : "✗ NO-GO"}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
          background: result.live ? "#0e2620" : "#2a2010",
          color: result.live ? "#3fdc8a" : "#f5b400",
          border: `1px solid ${result.live ? "#1f5f4d" : "#5e4a1f"}`,
        }}>
          {result.live ? "B4 LIVE" : "B4 NOT LIVE"}
        </span>
        <span style={{ color: "#9aa4b8", fontWeight: 400, fontSize: 12 }}>
          {result.reason} · bias {result.bias} · {result.et_time} ET
        </span>
      </div>

      {/* Gate checklist */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        {result.gates.map((g) => {
          const s = STATUS[g.status];
          return (
            <li key={g.code} style={{
              display: "flex", alignItems: "flex-start", gap: 10, fontSize: 12,
              background: s.bg, border: `1px solid ${s.border}`, borderRadius: 6, padding: "6px 10px",
            }}>
              <span style={{ width: 52, flexShrink: 0, fontWeight: 700, color: s.fg }}>{g.code}</span>
              <span style={{ flex: 1, color: "#dde4ef" }}>
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span style={{ color: "#9aa4b8", marginLeft: 8 }}>{g.reason}</span>
              </span>
              <span style={{ flexShrink: 0, fontWeight: 700, color: s.fg }}>{s.label}</span>
            </li>
          );
        })}
      </ul>

      {/* Exit plan */}
      <div style={{ marginTop: 10, fontSize: 12, color: "#9aa4b8" }}>
        <span style={{ color: "#5fb6ff", fontWeight: 600 }}>Exit:</span> {result.exit_plan.note} —{" "}
        {result.exit_plan.legs.map((l) => `${Math.round(l.pct * 100)}%@T${l.target}`).join(" · ")}
      </div>

      {/* Discipline footer */}
      <p style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid #1a1f2e", fontSize: 11, color: "#7d8699" }}>
        The engine never places orders — every entry and exit is your manual decision.
        {!result.live && " B4 is not live — 4 go-live decisions still open."}
      </p>
    </div>
  );
}
