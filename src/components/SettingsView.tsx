"use client";

import { THEMES, type ThemeId } from "@/lib/themes";
import { getStrategy } from "@/lib/strategies";
import type { SOP, TradingMode } from "@/lib/types";

const ACCENT_HEX: Record<string, string> = {
  teal: "#00d4aa",
  amber: "#f59e0b",
  purple: "#8b5cf6",
  gray: "#4a5068",
};

export default function SettingsView({
  email,
  theme,
  onTheme,
  mode,
  sop,
  sopSaved,
  sopUpdatedAt,
  onEditSop,
  onSwitchMode,
  onSignOut,
}: {
  email: string;
  theme: ThemeId;
  onTheme: (t: ThemeId) => void;
  mode: TradingMode;
  sop: SOP;
  sopSaved: boolean;
  sopUpdatedAt: string | null;
  onEditSop: () => void;
  onSwitchMode: () => void;
  onSignOut: () => void;
}) {
  const strategy = getStrategy(sop.strategy_type ?? "custom");
  const updated = sopUpdatedAt
    ? new Date(sopUpdatedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";

  return (
    <div className="settings-view">
      {sopSaved && (
        <div className="dash-card">
          <div className="card-header">
            <div className="card-title"><div className="card-title-icon">📋</div> Your SOP</div>
            <button className="btn" onClick={onEditSop} type="button">Edit SOP</button>
          </div>
          <div className="section-block">
            <div className="kv">
              <span>Strategy type</span>
              <strong>
                <span className="strategy-badge" style={{ borderColor: ACCENT_HEX[strategy?.accent ?? "gray"], color: ACCENT_HEX[strategy?.accent ?? "gray"] }}>
                  {strategy?.name ?? "Custom"}
                </span>
              </strong>
            </div>
            <div className="kv"><span>Last updated</span><strong>{updated}</strong></div>
            <div className="sop-summary-rules">
              <div className="kv"><span>Assets</span><strong>{sop.assets || "—"}</strong></div>
              <div className="kv"><span>Max risk per trade</span><strong>{sop.risk || "—"}</strong></div>
              <div className="kv"><span>Daily loss limit</span><strong>{sop.drawdown || "—"}</strong></div>
              <div className="kv"><span>Allowed regimes</span><strong>{sop.regimes || "any"}</strong></div>
            </div>
          </div>
        </div>
      )}

      <div className="dash-card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">🎨</div> Theme</div>
        </div>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-card ${t.id === theme ? "active" : ""}`} onClick={() => onTheme(t.id)} type="button">
              <span className="theme-dot" style={{ background: t.swatch }} />
              <span>{t.label}</span>
              {t.id === theme && <span style={{ marginLeft: "auto", color: "var(--accent)" }}>✓</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="dash-card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">👤</div> Account</div>
        </div>
        <div className="section-block">
          <div className="kv"><span>Email</span><strong>{email}</strong></div>
          <div className="kv"><span>Mode</span><strong>{mode === "trader" ? "Experienced trader" : "Learner"}</strong></div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={onSwitchMode} type="button">Switch trading mode</button>
            <button className="btn" onClick={onSignOut} type="button">Sign out</button>
          </div>
        </div>
      </div>
    </div>
  );
}
