"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isMySopTrade, type SOP, type Trade, type TradingMode, type TraderStats } from "@/lib/types";
import { parseRegimes, type Regime } from "@/lib/regime";
import { type ThemeId } from "@/lib/themes";
import type { SubscriptionInfo } from "@/lib/subscription";
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
import { TickerPanelProvider } from "./TickerPanelContext";
import TickerDetailPanel from "./TickerDetailPanel";
import BrandLogo from "./BrandLogo";
import RiskBadge from "./RiskBadge";
import ScalpMonitor from "./ScalpMonitor";
import Stage1Sop from "./Stage1Sop";
import Stage2Paper from "./Stage2Paper";
import Stage3GoLive from "./Stage3GoLive";
import StrategyPicker from "./StrategyPicker";
import SopReviewGate from "./SopReviewGate";
import { getStrategy, type StrategyId } from "@/lib/strategies";

type Props = {
  email: string;
  initialSop: SOP;
  hasSavedSop: boolean;
  initialSopUpdatedAt: string | null;
  initialTrades: Trade[];
  initialManualChecks: boolean[];
  initialMode: TradingMode | null;
  initialVerified: boolean;
  initialStats: TraderStats | null;
  initialTheme: ThemeId;
  initialSubscription: SubscriptionInfo;
};

type Stage1Mode = "review" | "form" | "picker";

export default function AppShell(props: Props) {
  return (
    <AcademyProvider>
      <TickerPanelProvider>
        <AppShellInner {...props} />
      </TickerPanelProvider>
    </AcademyProvider>
  );
}

function AppShellInner({
  email,
  initialSop,
  hasSavedSop,
  initialSopUpdatedAt,
  initialTrades,
  initialManualChecks,
  initialMode,
  initialVerified,
  initialStats,
  initialTheme,
  initialSubscription,
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
  const [sopUpdatedAt] = useState<string | null>(initialSopUpdatedAt);
  const [presetJustApplied, setPresetJustApplied] = useState(false);
  // Stage 1 entry: returning learners with a saved SOP land on the review gate;
  // brand-new learners on the picker; traders go straight to the form.
  const [stage1Mode, setStage1Mode] = useState<Stage1Mode>(
    initialMode === "learner" ? (hasSavedSop ? "review" : "picker") : "form",
  );

  function applyStrategy(id: StrategyId) {
    const tpl = getStrategy(id);
    if (!tpl) return;
    if (tpl.defaults) {
      setSop({ ...tpl.defaults, strategy_type: id });
      setPresetJustApplied(true);
    } else {
      // "Build my own" — keep current sop values, just mark strategy_type=custom.
      setSop({ ...sop, strategy_type: "custom" });
      setPresetJustApplied(false);
    }
    setStage1Mode("form");
  }

  // Open Stage 1 on the review gate (used by the Settings "Edit SOP" button).
  function openSopReview() {
    setStage1Mode(sopSaved ? "review" : "picker");
    setPresetJustApplied(false);
    setView("stage1");
    setStage(0);
  }

  // Stage 1 has three faces: the review gate (returning users), the strategy
  // picker, and the SOP form. Shared between the learner and trader shells.
  function renderStage1(m: TradingMode, onSaved: () => void, goStage2: () => void) {
    if (stage1Mode === "review") {
      return (
        <SopReviewGate
          sop={sop}
          updatedAt={sopUpdatedAt}
          onContinue={goStage2}
          onReview={() => {
            setPresetJustApplied(false);
            setStage1Mode("form");
          }}
          onSwitchPreset={() => setStage1Mode("picker")}
        />
      );
    }
    if (stage1Mode === "picker") {
      return (
        <StrategyPicker
          initial={sop.strategy_type as StrategyId | undefined}
          hasSavedSop={sopSaved}
          onContinue={applyStrategy}
          onCancel={sopSaved ? () => setStage1Mode("review") : undefined}
        />
      );
    }
    return (
      <Stage1Sop
        sop={sop}
        mode={m}
        sopSaved={sopSaved}
        onChange={setSop}
        onSaved={onSaved}
        onSwitchStrategy={m === "learner" ? () => setStage1Mode("picker") : undefined}
        saveLabel={sopSaved ? "Update my SOP" : undefined}
        presetJustApplied={presetJustApplied}
      />
    );
  }

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const eligibleTrades = mode === "learner"
    ? trades.filter((t) => isMySopTrade(t) && (t.protection_score ?? 0) >= 70)
    : trades;
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
            {view === "home" && <HomeDashboard sop={sop} regime={currentRegime} />}
            {view === "brief" && <MorningBrief sop={sop} mode={mode} stats={traderStats} />}
            {view === "stage1" &&
              renderStage1(
                mode,
                () => {
                  setSopSaved(true);
                  setPresetJustApplied(false);
                  router.refresh();
                },
                () => setView("stage2"),
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
            {view === "scalp" && <ScalpMonitor sop={sop} />}
            {view === "settings" && (
              <SettingsView
                email={email}
                theme={theme}
                onTheme={setTheme}
                mode={mode}
                sop={sop}
                sopSaved={sopSaved}
                sopUpdatedAt={sopUpdatedAt}
                subscription={initialSubscription}
                onEditSop={openSopReview}
                onSwitchMode={() => setSwitchingMode(true)}
                onSignOut={signOut}
              />
            )}
              </>
            )}
          </div>
        </div>

        <TickerDetailPanel sop={sop} regime={currentRegime} />

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

  return (
    <div className="app">
      <div className="header">
        <BrandLogo size={26} />
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
          <RiskBadge sop={sop} sopSaved={sopSaved} onChange={setSop} />
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
        {renderStage1(
          mode,
          () => {
            setSopSaved(true);
            setPresetJustApplied(false);
            setStage(1);
            router.refresh();
          },
          () => setStage(1),
        )}
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

      <TickerDetailPanel sop={sop} regime={currentRegime} />

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
