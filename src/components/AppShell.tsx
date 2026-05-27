"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SOP, Trade, TradingMode, TraderStats } from "@/lib/types";
import { parseRegimes, type Regime } from "@/lib/regime";
import { type ThemeId } from "@/lib/themes";
import RegimeTab from "./RegimeTab";
import MorningBrief from "./MorningBrief";
import ModeSelect from "./ModeSelect";
import TraderVerify from "./TraderVerify";
import TraderProtectionBanners, { computeTraderWarnings } from "./TraderProtection";
import ThemeSwitcher from "./ThemeSwitcher";
import Sidebar, { type DashView } from "./Sidebar";
import HomeDashboard from "./HomeDashboard";
import SettingsView from "./SettingsView";
import AcademyView from "./AcademyView";
import { AcademyProvider, useAcademy } from "./AcademyContext";
import Stage1Sop from "./Stage1Sop";
import Stage2Paper from "./Stage2Paper";
import Stage3GoLive from "./Stage3GoLive";

type Props = {
  email: string;
  initialSop: SOP;
  hasSavedSop: boolean;
  initialTrades: Trade[];
  initialManualChecks: boolean[];
  initialMode: TradingMode | null;
  initialVerified: boolean;
  initialStats: TraderStats | null;
  initialTheme: ThemeId;
};

export default function AppShell(props: Props) {
  return (
    <AcademyProvider>
      <AppShellInner {...props} />
    </AcademyProvider>
  );
}

function AppShellInner({
  email,
  initialSop,
  hasSavedSop,
  initialTrades,
  initialManualChecks,
  initialMode,
  initialVerified,
  initialStats,
  initialTheme,
}: Props) {
  const academy = useAcademy();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [sop, setSop] = useState<SOP>(initialSop);
  const [sopSaved, setSopSaved] = useState(hasSavedSop);
  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const [manualChecks, setManualChecks] = useState<boolean[]>(initialManualChecks);
  const [stage, setStage] = useState<number>(hasSavedSop ? 1 : 0);
  const [currentRegime, setCurrentRegime] = useState<Regime | null>(null);
  const [mode, setMode] = useState<TradingMode | null>(initialMode);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [verified, setVerified] = useState(initialVerified);
  const [traderStats, setTraderStats] = useState<TraderStats | null>(initialStats);
  const [theme, setTheme] = useState<ThemeId>(initialTheme);
  const [view, setView] = useState<DashView>("home");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const eligibleTrades = mode === "learner" ? trades.filter((t) => (t.protection_score ?? 0) >= 70) : trades;
  const avgScore = eligibleTrades.length
    ? Math.round(eligibleTrades.reduce((a, t) => a + t.score, 0) / eligibleTrades.length)
    : 0;
  const goLiveUnlocked = eligibleTrades.length >= 5 && avgScore >= 70;

  const gotoStage = useCallback(
    (n: number) => {
      if (!sopSaved && n > 0) return;
      if (!goLiveUnlocked && n > 1) return;
      setStage(n);
    },
    [sopSaved, goLiveUnlocked],
  );

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (mode === null) return <ModeSelect current={null} onChosen={(m) => setMode(m)} />;

  if (mode === "trader" && !verified) {
    return (
      <TraderVerify
        onVerified={(s) => {
          setTraderStats(s);
          setVerified(true);
        }}
      />
    );
  }

  // ───── Trader shell: left sidebar + top bar + view router ─────
  if (mode === "trader") {
    const warnings = computeTraderWarnings(traderStats, sop);
    return (
      <div className={`app trader-shell ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Sidebar
          active={academy.open ? "academy" : view}
          onSelect={(v) => {
            setSidebarOpen(false);
            if (v === "academy") {
              academy.openAcademy();
            } else {
              academy.closeAcademy();
              setView(v);
            }
          }}
          email={email}
        />
        {sidebarOpen && <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />}

        <div className="trader-main">
          <div className="trader-topbar">
            <button className="mobile-toggle" onClick={() => setSidebarOpen((v) => !v)} type="button" aria-label="Toggle navigation">☰</button>
            <div className="trader-topbar-spacer" />
            {warnings.length > 0 && (
              <div className="shield-badge danger" title={warnings.map((w) => w.text).join("\n")}>
                <span aria-hidden>⚠</span>
                {warnings.length} risk alert{warnings.length === 1 ? "" : "s"}
              </div>
            )}
            <ThemeSwitcher value={theme} onChange={setTheme} />
            <button type="button" className="mode-pill trader" onClick={() => setSwitchingMode(true)}>
              Trader mode <span>· switch</span>
            </button>
            <div className="user-pill">
              <span>{email}</span>
              <button type="button" onClick={signOut}>Sign out</button>
            </div>
          </div>

          {warnings.length > 0 && <TraderProtectionBanners warnings={warnings} />}

          <div className="trader-view">
            {academy.open ? (
              <AcademyView anchorTermId={academy.anchorTermId} />
            ) : (
              <>
            {view === "home" && <HomeDashboard sop={sop} />}
            {view === "brief" && <MorningBrief sop={sop} mode={mode} stats={traderStats} />}
            {view === "stage1" && (
              <Stage1Sop
                sop={sop}
                mode={mode}
                sopSaved={sopSaved}
                onChange={setSop}
                onSaved={() => {
                  setSopSaved(true);
                  router.refresh();
                }}
              />
            )}
            {view === "stage2" && (
              <Stage2Paper
                sop={sop}
                trades={trades}
                goLiveUnlocked={goLiveUnlocked}
                currentRegime={currentRegime}
                mode={mode}
                traderStats={traderStats}
                onTradeAdded={(t) => setTrades((prev) => [...prev, t])}
                onUnlock={() => setView("stage3")}
              />
            )}
            {view === "stage3" && (
              <Stage3GoLive
                trades={trades}
                manualChecks={manualChecks}
                onManualChecksChange={setManualChecks}
                onBack={() => setView("stage2")}
                mode={mode}
              />
            )}
            {view === "regime" && <RegimeTab sopRegimes={parseRegimes(sop.regimes)} onRegime={setCurrentRegime} mode={mode} />}
            {view === "settings" && (
              <SettingsView
                email={email}
                theme={theme}
                onTheme={setTheme}
                mode={mode}
                onSwitchMode={() => setSwitchingMode(true)}
                onSignOut={signOut}
              />
            )}
              </>
            )}
          </div>
        </div>

        {switchingMode && (
          <div className="modal-overlay" onClick={() => setSwitchingMode(false)}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: "100%" }}>
              <ModeSelect
                current={mode}
                onChosen={(m) => {
                  setMode(m);
                  setSwitchingMode(false);
                }}
                onCancel={() => setSwitchingMode(false)}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  // ───── Learner shell (unchanged stage flow) ─────
  const learner = true;
  const riskExceeded = parseFloat(sop.risk) > 1;

  return (
    <div className="app">
      <div className="header">
        <div className="logo">
          <div className="logo-dot" />
          TradeReady
        </div>
        <div className="header-right">
          <div className="progress-row">
            {(["SOP", "Paper trade", "Go live"] as const).map((label, i) => {
              const cls = i < stage ? "done" : i === stage ? "current" : "";
              return (
                <div key={label} style={{ display: "contents" }}>
                  <div className={`progress-step ${cls}`}>
                    <div className={`progress-circle ${cls}`}>{i < stage ? "✓" : i + 1}</div>
                    <span>{label}</span>
                  </div>
                  {i < 2 && <div className={`progress-line ${i < stage ? "done" : ""}`} />}
                </div>
              );
            })}
          </div>
          <div className={`shield-badge ${riskExceeded ? "danger" : ""}`}>
            <span aria-hidden>🛡</span>
            {riskExceeded ? "Warning — risk limit exceeded" : "Protected — 1% max risk per trade"}
          </div>
          <button type="button" className="header-academy" onClick={() => academy.openAcademy()} title="Open Trading Academy">
            <span aria-hidden>📖</span> Academy
          </button>
          <ThemeSwitcher value={theme} onChange={setTheme} />
          <button type="button" className="mode-pill learner" onClick={() => setSwitchingMode(true)}>
            Learner mode <span>· switch</span>
          </button>
          <div className="user-pill">
            <span>{email}</span>
            <button type="button" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>

      {academy.open ? (
        <div className="learner-academy-wrap">
          <button type="button" className="btn" onClick={() => academy.closeAcademy()}>← Back to your stages</button>
          <AcademyView anchorTermId={academy.anchorTermId} />
        </div>
      ) : (
      <>
      <MorningBrief sop={sop} mode={mode} stats={traderStats} />

      <RegimeTab sopRegimes={parseRegimes(sop.regimes)} onRegime={setCurrentRegime} mode={mode} />

      <div className="stage-nav">
        {[
          { num: "01", name: "Build your SOP", desc: "Define your trading rules" },
          { num: "02", name: "Paper trade", desc: "Practice with AI grading" },
          { num: "03", name: "Go live", desc: "Real money, real trades" },
        ].map((s, i) => {
          const locked = (i === 1 && !sopSaved) || (i === 2 && !goLiveUnlocked);
          const active = stage === i;
          let badge = "locked";
          let badgeClass = "locked-badge";
          if (i === 0) {
            badge = sopSaved ? "done" : "in progress";
            badgeClass = sopSaved ? "done" : "active-badge";
          } else if (i === 1) {
            if (sopSaved) {
              badge = goLiveUnlocked ? "done" : "unlocked";
              badgeClass = goLiveUnlocked ? "done" : "active-badge";
            }
          } else if (i === 2) {
            if (goLiveUnlocked) {
              badge = "unlocked";
              badgeClass = "active-badge";
            }
          }
          return (
            <div
              key={s.num}
              className={`stage-tab ${active ? "active" : ""} ${locked ? "locked" : ""}`}
              onClick={() => gotoStage(i)}
            >
              <div className="stage-num">Stage {s.num}</div>
              <div className="stage-name">{s.name}</div>
              <div className="stage-desc">{s.desc}</div>
              <span className={`stage-badge ${badgeClass}`}>{badge}</span>
            </div>
          );
        })}
      </div>

      <div className={`stage-panel ${stage === 0 ? "active" : ""}`}>
        <Stage1Sop
          sop={sop}
          mode={mode}
          sopSaved={sopSaved}
          onChange={setSop}
          onSaved={() => {
            setSopSaved(true);
            setStage(1);
            router.refresh();
          }}
        />
      </div>

      <div className={`stage-panel ${stage === 1 ? "active" : ""}`}>
        <Stage2Paper
          sop={sop}
          trades={trades}
          goLiveUnlocked={goLiveUnlocked}
          currentRegime={currentRegime}
          mode={mode}
          traderStats={traderStats}
          onTradeAdded={(t) => setTrades((prev) => [...prev, t])}
          onUnlock={() => setStage(2)}
        />
      </div>

      <div className={`stage-panel ${stage === 2 ? "active" : ""}`}>
        <Stage3GoLive
          trades={trades}
          manualChecks={manualChecks}
          onManualChecksChange={setManualChecks}
          onBack={() => setStage(1)}
          mode={mode}
        />
      </div>
      </>
      )}

      {switchingMode && (
        <div className="modal-overlay" onClick={() => setSwitchingMode(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%" }}>
            <ModeSelect
              current={mode}
              onChosen={(m) => {
                setMode(m);
                setSwitchingMode(false);
              }}
              onCancel={() => setSwitchingMode(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
