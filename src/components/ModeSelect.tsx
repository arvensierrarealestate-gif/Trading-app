"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import type { TradingMode } from "@/lib/types";

const SHIELD = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);
const CHART = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" />
  </svg>
);

const OPTIONS: {
  mode: TradingMode;
  accent: "teal" | "purple";
  icon: React.ReactNode;
  badge: string;
  title: string;
  desc: string;
}[] = [
  {
    mode: "learner",
    accent: "teal",
    icon: SHIELD,
    badge: "Recommended for beginners",
    title: "Learning to trade",
    desc: "Build your system first. No real money until you are ready.",
  },
  {
    mode: "trader",
    accent: "purple",
    icon: CHART,
    badge: "Requires trade history verification",
    title: "Experienced trader",
    desc: "Full technical tools. Upload your trade history to unlock.",
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
      setErr(errorMessage(e, "Could not save mode"));
      setSaving(null);
    }
  }

  return (
    <div className="mode-shell">
      <div className="mode-head">
        <div className="mode-eyebrow">Step 01 · Profile</div>
        <h1 className="mode-headline">How do you trade?</h1>
        <div className="mode-subhead">Pick the path that matches your experience. You can switch later.</div>
      </div>
      <div className="mode-grid">
        {OPTIONS.map((o) => {
          const active = current === o.mode;
          return (
            <button
              key={o.mode}
              className={`mode-card accent-${o.accent} ${active ? "current" : ""}`}
              onClick={() => choose(o.mode)}
              disabled={saving !== null}
              type="button"
            >
              <span className={`mode-icon accent-${o.accent}`}>{o.icon}</span>
              <span className={`mode-badge accent-${o.accent}`}>{o.badge}</span>
              <span className="mode-card-title">{o.title}</span>
              <span className="mode-card-desc">{o.desc}</span>
              <span className="mode-card-foot">
                <span className="mode-select-cta">{saving === o.mode ? "Saving…" : active ? "Current" : "Click to select"}</span>
                <span className={`mode-radio ${active ? "on" : ""}`} />
              </span>
            </button>
          );
        })}
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
