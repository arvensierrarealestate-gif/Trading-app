"use client";

import { THEMES, type ThemeId } from "@/lib/themes";
import type { TradingMode } from "@/lib/types";

export default function SettingsView({
  email,
  theme,
  onTheme,
  mode,
  onSwitchMode,
  onSignOut,
}: {
  email: string;
  theme: ThemeId;
  onTheme: (t: ThemeId) => void;
  mode: TradingMode;
  onSwitchMode: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="settings-view">
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
