"use client";

export type DashView = "home" | "brief" | "stage1" | "stage2" | "stage3" | "regime" | "settings";

const NAV: { id: DashView; label: string; icon: string }[] = [
  { id: "home", label: "Home", icon: "▦" },
  { id: "brief", label: "Morning brief", icon: "☀" },
  { id: "stage1", label: "Stage 1 — SOP", icon: "①" },
  { id: "stage2", label: "Stage 2 — Paper journal", icon: "②" },
  { id: "stage3", label: "Stage 3 — Go-live", icon: "③" },
  { id: "regime", label: "Regime", icon: "≋" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export default function Sidebar({
  active,
  onSelect,
  email,
  collapsed,
}: {
  active: DashView;
  onSelect: (v: DashView) => void;
  email: string;
  collapsed?: boolean;
}) {
  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-brand">
        <span className="logo-dot" />
        <span>TradeReady</span>
      </div>
      <nav className="sidebar-nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`sidebar-item ${active === item.id ? "active" : ""}`}
            onClick={() => onSelect(item.id)}
            type="button"
          >
            <span className="sidebar-icon" aria-hidden>{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="sidebar-email" title={email}>{email}</div>
      </div>
    </aside>
  );
}
