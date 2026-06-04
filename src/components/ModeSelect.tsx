"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { isPaid, type SubscriptionInfo } from "@/lib/subscription";
import type { TradingMode } from "@/lib/types";
import ProGate from "./ProGate";

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
  subscription,
}: {
  current: TradingMode | null;
  onChosen: (m: TradingMode) => void;
  onCancel?: () => void;
  subscription?: SubscriptionInfo;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [saving, setSaving] = useState<TradingMode | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTraderGate, setShowTraderGate] = useState(false);

  const free = !isPaid(subscription);

  async function choose(mode: TradingMode) {
    // Trader mode is a Pro feature. Free users see the upgrade prompt instead
    // of switching — they can still keep working in Learner.
    if (mode === "trader" && free) {
      setShowTraderGate(true);
      return;
    }
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

  if (showTraderGate) {
    return (
      <div className="mode-shell">
        <div className="mode-head">
          <div className="mode-eyebrow">Step 01 · Profile</div>
          <h1 className="mode-headline">Experienced trader is a Pro feature</h1>
          <div className="mode-subhead">The learning path is fully free. Live trading tools are reserved for Pro.</div>
        </div>
        <ProGate
          title="Experienced trader mode is a Pro feature"
          description="Trader mode unlocks the live dashboard, scalp monitor, recommendations rail, ticker detail panel, and the full regime tab — built for active traders placing real money trades."
          onBack={() => setShowTraderGate(false)}
          backLabel="Continue with Learner"
        />
      </div>
    );
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
