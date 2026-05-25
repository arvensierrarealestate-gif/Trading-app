"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TradingMode } from "@/lib/types";

const OPTIONS: { mode: TradingMode; title: string; tagline: string; points: string[] }[] = [
  {
    mode: "learner",
    title: "Learning to trade",
    tagline: "Simple, guided, plain English.",
    points: [
      "Step-by-step with no jargon",
      "Simplified SOP builder",
      "Grade reports in plain language",
      "Encouraging, beginner-friendly tone",
    ],
  },
  {
    mode: "trader",
    title: "Experienced trader",
    tagline: "Full technical experience.",
    points: [
      "All SOP fields unlocked",
      "Full 6-gate grade results",
      "Regime tab with HMM details",
      "Technical reports and data",
    ],
  },
];

export default function ModeSelect({
  current,
  onChosen,
  onCancel,
}: {
  current: TradingMode | null;
  onChosen: (m: TradingMode) => void;
  onCancel?: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saving, setSaving] = useState<TradingMode | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function choose(mode: TradingMode) {
    setSaving(mode);
    setErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("profiles").upsert({ id: user.id, trading_mode: mode });
      if (error) throw error;
      onChosen(mode);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save mode");
      setSaving(null);
    }
  }

  return (
    <div className="mode-shell">
      <div className="mode-head">
        <div className="auth-title"><span className="logo-dot" /> Choose your experience</div>
        <div className="auth-sub">You can switch anytime from the header. This tailors the whole app to you.</div>
      </div>
      <div className="mode-grid">
        {OPTIONS.map((o) => (
          <button
            key={o.mode}
            className={`mode-card ${current === o.mode ? "current" : ""}`}
            onClick={() => choose(o.mode)}
            disabled={saving !== null}
            type="button"
          >
            <div className="mode-card-title">{o.title}</div>
            <div className="mode-card-tag">{o.tagline}</div>
            <ul className="mode-card-list">
              {o.points.map((p) => <li key={p}>{p}</li>)}
            </ul>
            <span className="mode-card-cta">
              {saving === o.mode ? "Saving…" : current === o.mode ? "Current — keep" : "Choose"}
            </span>
          </button>
        ))}
      </div>
      {err && <div className="auth-msg err" style={{ maxWidth: 760, margin: "12px auto 0" }}>{err}</div>}
      {onCancel && current && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button className="btn" onClick={onCancel} type="button" disabled={saving !== null}>Cancel</button>
        </div>
      )}
    </div>
  );
}
