"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SOP, Trade, TradingMode } from "@/lib/types";
import { parseRegimes, type Regime } from "@/lib/regime";
import RegimeTab from "./RegimeTab";
import MorningBrief from "./MorningBrief";
import ModeSelect from "./ModeSelect";
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
};

export default function AppShell({ email, initialSop, hasSavedSop, initialTrades, initialManualChecks, initialMode }: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [sop, setSop] = useState<SOP>(initialSop);
  const [sopSaved, setSopSaved] = useState(hasSavedSop);
  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const [manualChecks, setManualChecks] = useState<boolean[]>(initialManualChecks);
  const [stage, setStage] = useState<number>(hasSavedSop ? (initialTrades.length >= 5 ? 1 : 1) : 0);
  const [currentRegime, setCurrentRegime] = useState<Regime | null>(null);
  const [mode, setMode] = useState<TradingMode | null>(initialMode);
  const [switchingMode, setSwitchingMode] = useState(false);

  // Learner trades only count toward go-live if capital was protected.
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

  // New users (no mode yet) must choose before entering the app.
  if (mode === null) {
    return <ModeSelect current={null} onChosen={(m) => setMode(m)} />;
  }

  const learner = mode === "learner";
  const riskExceeded = learner && parseFloat(sop.risk) > 1;

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
          {learner && (
            <div className={`shield-badge ${riskExceeded ? "danger" : ""}`}>
              <span aria-hidden>🛡</span>
              {riskExceeded ? "Warning — risk limit exceeded" : "Protected — 1% max risk per trade"}
            </div>
          )}
          <button type="button" className={`mode-pill ${learner ? "learner" : "trader"}`} onClick={() => setSwitchingMode(true)}>
            {learner ? "Learner mode" : "Trader mode"} <span>· switch</span>
          </button>
          <div className="user-pill">
            <span>{email}</span>
            <button type="button" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>

      {learner && <MorningBrief sop={sop} />}

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
