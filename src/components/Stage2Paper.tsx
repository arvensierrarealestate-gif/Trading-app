"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isMySopTrade, type Grade, type SOP, type Trade, type TradingMode, type TraderStats } from "@/lib/types";
import type { Regime } from "@/lib/regime";
import TickerCard from "./TickerCard";
import PositionSizer from "./PositionSizer";
import TermTip from "./TermTip";
import { errorMessage } from "@/lib/errors";
import { getStrategy, type StrategyId } from "@/lib/strategies";

type PillId = "my-sop" | "premium-selling" | "leaps" | "momentum-swing";
const STRATEGY_PILLS: { id: PillId; label: string; accent: string }[] = [
  { id: "premium-selling", label: "Premium selling", accent: "teal" },
  { id: "leaps", label: "LEAPS", accent: "amber" },
  { id: "momentum-swing", label: "Momentum swing", accent: "purple" },
  { id: "my-sop", label: "My SOP", accent: "teal" },
];
const PILL_LABEL: Record<string, string> = {
  "my-sop": "My SOP",
  "premium-selling": "Premium selling",
  leaps: "LEAPS",
  "momentum-swing": "Momentum swing",
};
const PILL_ACCENT: Record<string, string> = {
  "my-sop": "#00d4aa",
  "premium-selling": "#00d4aa",
  leaps: "#f59e0b",
  "momentum-swing": "#8b5cf6",
};

type LogLine = { kind: "ai" | "ok" | "err" | "tool"; msg: string };

type ProtectionResult = {
  stop_loss_set: boolean;
  stop_loss_placement: number;
  position_size_ok: boolean;
  protection_score: number;
};

type ImagePayload = { data: string; media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp" };

function fileToImagePayload(file: File): Promise<ImagePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [, mt = "image/png"] = /^data:(.+);base64,/.exec(result) ?? [];
      const data = result.split(",")[1] ?? "";
      const media_type = (mt as ImagePayload["media_type"]) || "image/png";
      resolve({ data, media_type });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Stage2Paper({
  sop,
  trades,
  goLiveUnlocked,
  currentRegime,
  mode,
  traderStats,
  onTradeAdded,
  onTradesReplace,
  onUnlock,
}: {
  sop: SOP;
  trades: Trade[];
  goLiveUnlocked: boolean;
  currentRegime: Regime | null;
  mode: TradingMode;
  traderStats: TraderStats | null;
  onTradeAdded: (t: Trade) => void;
  onTradesReplace?: (next: Trade[]) => void;
  onUnlock: () => void;
}) {
  const learner = mode === "learner";
  const supabase = useMemo(() => createClient(), []);
  const [asset, setAsset] = useState("");
  const [dir, setDir] = useState<"Long" | "Short">("Long");
  const [outcome, setOutcome] = useState<"Win" | "Loss" | "Break even">("Win");
  const [entry, setEntry] = useState("");
  const [exit, setExit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [chart, setChart] = useState<{ url: string; payload: ImagePayload } | null>(null);
  const [news, setNews] = useState<{ url: string; payload: ImagePayload } | null>(null);
  const [newsText, setNewsText] = useState("");
  const [grading, setGrading] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [grade, setGrade] = useState<{ grade: Grade; asset: string; dir: string; outcome: string; protection: ProtectionResult | null; strategyLabel: string } | null>(null);
  // Persisted-trade reconciliation: a visible banner the user can't miss when
  // the journal-insert silently failed or the local count drifted from DB.
  const [persistError, setPersistError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [refreshingJournal, setRefreshingJournal] = useState(false);
  const [usage, setUsage] = useState<{
    paid: boolean;
    grades: number;
    limit: number | null;
    remaining: number | null;
    resets_at: string;
    est_cost_usd: number;
  } | null>(null);
  const [reco, setReco] = useState<{ stop_loss_price: number; support_basis: string; drop_pct: number } | null>(null);
  const [recoBusy, setRecoBusy] = useState(false);
  const [showEdu, setShowEdu] = useState(false);
  const [hintCollapsed, setHintCollapsed] = useState(false);
  const [selectedStrategy, setSelectedStrategy] = useState<PillId>("my-sop");
  const [customizing, setCustomizing] = useState(false);
  const [criteriaChecked, setCriteriaChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (learner && typeof window !== "undefined" && !localStorage.getItem("tr_stoploss_edu_seen")) {
      setShowEdu(true);
    }
    if (typeof window !== "undefined" && localStorage.getItem("dismissed_sop_hint") === "1") {
      setHintCollapsed(true);
    }
  }, [learner]);

  function collapseHint() {
    setHintCollapsed(true);
    try {
      localStorage.setItem("dismissed_sop_hint", "1");
    } catch {
      /* ignore */
    }
  }

  function dismissEdu() {
    setShowEdu(false);
    try {
      localStorage.setItem("tr_stoploss_edu_seen", "1");
    } catch {
      // ignore
    }
  }

  const riskPct = sop.risk || "1%";

  const loadUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      const json = await res.json();
      if (res.ok) setUsage(json.today);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  function addLog(line: LogLine) {
    setLog((prev) => [...prev, line]);
  }

  async function handleFile(idx: 0 | 1, file?: File | null) {
    if (!file) return;
    const payload = await fileToImagePayload(file);
    const url = `data:${payload.media_type};base64,${payload.data}`;
    if (idx === 0) {
      setChart({ url, payload });
      if (learner) recommendStop(payload);
    } else {
      setNews({ url, payload });
    }
  }

  async function recommendStop(chartPayload: ImagePayload) {
    setRecoBusy(true);
    setReco(null);
    try {
      const res = await fetch("/api/recommend-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chart: chartPayload, asset: asset || "Unknown", dir, entry }),
      });
      const json = await res.json();
      if (res.ok && json.recommendation) setReco(json.recommendation);
    } catch {
      // non-critical; learner can still set their own stop
    } finally {
      setRecoBusy(false);
    }
  }

  function clearForm() {
    setChart(null);
    setNews(null);
    setNewsText("");
    setEntry("");
    setExit("");
    setStopLoss("");
    setAsset("");
    setLog([]);
    setGrade(null);
    setReco(null);
  }

  // Refresh the journal from the DB — used to recover from an insert failure
  // or when the local count drifted from the persisted truth.
  async function refreshJournal() {
    setRefreshingJournal(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPersistError("Not signed in.");
        return;
      }
      const { data, error } = await supabase
        .from("paper_trades")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (error) {
        setPersistError(`Could not refresh journal: ${errorMessage(error)}`);
        return;
      }
      const next: Trade[] = (data ?? []).map((row) => ({
        id: row.id,
        asset: row.asset,
        dir: row.dir as Trade["dir"],
        outcome: row.outcome as Trade["outcome"],
        entry: row.entry_price ?? undefined,
        exit: row.exit_price ?? undefined,
        stop_loss: row.stop_loss_price ?? undefined,
        score: row.score,
        verdict: row.verdict as Trade["verdict"],
        grade: row.grade,
        protection_score: row.protection_score ?? 0,
        stop_loss_set: row.stop_loss_set ?? false,
        stop_loss_placement: row.stop_loss_placement ?? 0,
        position_size_ok: row.position_size_ok ?? false,
        strategy_type: row.strategy_type ?? null,
      }));
      if (onTradesReplace) onTradesReplace(next);
      setPersistError(null);
      setSyncWarning(null);
      addLog({ kind: "ok", msg: `Journal refreshed from database — ${next.length} trade(s).` });
    } catch (e) {
      setPersistError(`Refresh failed: ${errorMessage(e)}`);
    } finally {
      setRefreshingJournal(false);
    }
  }

  async function gradeTrade() {
    if (!chart) {
      addLog({ kind: "err", msg: "Upload a chart screenshot first." });
      return;
    }
    if (!asset.trim()) {
      addLog({ kind: "err", msg: "Enter the asset / pair (e.g. BTC/USD) before grading." });
      return;
    }
    if (learner && !stopLoss.trim()) {
      addLog({ kind: "err", msg: "Set your stop loss before trading — this protects your money if the trade goes wrong." });
      return;
    }
    const assetName = asset.trim();
    const isMySop = selectedStrategy === "my-sop";
    const tpl = isMySop ? null : getStrategy(selectedStrategy);
    const gradeSop: SOP = isMySop || !tpl?.defaults ? sop : { ...tpl.defaults, strategy_type: selectedStrategy };
    const strategyLabel = isMySop ? "My SOP" : tpl?.name ?? "My SOP";
    const checkedCriteria = customizing ? currentCriteria.filter((c) => criteriaChecked[c] !== false) : undefined;

    setGrading(true);
    setLog([]);
    setGrade(null);
    addLog({ kind: "ai", msg: "Reading chart screenshot…" });
    addLog({ kind: "tool", msg: `Comparing vs ${strategyLabel} rules…` });

    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sop: gradeSop,
          asset: assetName,
          dir,
          outcome,
          entry,
          exit,
          stop_loss: stopLoss,
          chart: chart.payload,
          news: news?.payload ?? null,
          news_text: newsText.trim() || undefined,
          current_regime: currentRegime,
          mode,
          strategy_label: strategyLabel,
          criteria: checkedCriteria,
        }),
      });
      const json = await res.json();
      loadUsage();
      if (!res.ok) {
        addLog({ kind: "err", msg: json.error || "Grading failed" });
        return;
      }
      const g: Grade = json.grade;
      const prot: ProtectionResult | null = json.protection ?? null;
      const cost = json.usage ? ` · ${json.usage.input_tokens + json.usage.output_tokens} tok` : "";
      addLog({ kind: "ok", msg: `Score: ${g.score}/100 — ${g.verdict}${cost}` });
      if (prot) {
        addLog({
          kind: prot.protection_score >= 70 ? "ok" : "err",
          msg: `Protection score: ${prot.protection_score}/100${prot.protection_score < 70 ? " — does not count toward go-live" : ""}`,
        });
      }
      if (isMySop) {
        addLog({ kind: "ok", msg: "Counts toward go-live (graded against My SOP)." });
      } else {
        addLog({ kind: "tool", msg: `Practice trade — graded as ${strategyLabel}, does not count toward go-live.` });
      }
      setGrade({ grade: g, asset: assetName, dir, outcome, protection: prot, strategyLabel });

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const payload = {
          user_id: user.id,
          asset: assetName,
          dir,
          outcome,
          entry_price: entry || null,
          exit_price: exit || null,
          stop_loss_price: stopLoss || null,
          score: g.score,
          verdict: g.verdict,
          grade: g,
          protection_score: prot?.protection_score ?? 0,
          stop_loss_set: prot?.stop_loss_set ?? false,
          stop_loss_placement: prot?.stop_loss_placement ?? 0,
          position_size_ok: prot?.position_size_ok ?? false,
          strategy_type: selectedStrategy,
        };

        // Insert with one transparent retry on a transient failure. Surfaces
        // any persistent error via a prominent banner so it can't be missed.
        async function insertOnce() {
          return supabase.from("paper_trades").insert(payload).select().single();
        }
        let { data: inserted, error } = await insertOnce();
        if (error) {
          addLog({ kind: "tool", msg: `Retrying database insert (${errorMessage(error)})…` });
          await new Promise((r) => setTimeout(r, 700));
          ({ data: inserted, error } = await insertOnce());
        }

        if (error || !inserted) {
          const msg = error ? errorMessage(error) : "no row returned";
          setPersistError(`This trade was graded but did NOT save to your journal: ${msg}. Click "Refresh journal" below to retry.`);
          addLog({ kind: "err", msg: `Database error: ${msg}` });
        } else {
          // Reconcile: confirm the row really exists and bump local state.
          const newTrade: Trade = {
            id: inserted.id,
            asset: inserted.asset,
            dir: inserted.dir as Trade["dir"],
            outcome: inserted.outcome as Trade["outcome"],
            entry: inserted.entry_price ?? undefined,
            exit: inserted.exit_price ?? undefined,
            stop_loss: inserted.stop_loss_price ?? undefined,
            score: inserted.score,
            verdict: inserted.verdict as Trade["verdict"],
            grade: inserted.grade,
            protection_score: inserted.protection_score ?? 0,
            stop_loss_set: inserted.stop_loss_set ?? false,
            stop_loss_placement: inserted.stop_loss_placement ?? 0,
            position_size_ok: inserted.position_size_ok ?? false,
            strategy_type: inserted.strategy_type ?? selectedStrategy,
          };
          onTradeAdded(newTrade);
          setPersistError(null);

          // Post-insert reconciliation: count the rows in DB and compare with
          // the (now incremented) local view. If they disagree the user sees a
          // warning + a one-click refresh that reloads from the DB.
          try {
            const { count: dbCount, error: countErr } = await supabase
              .from("paper_trades")
              .select("id", { count: "exact", head: true })
              .eq("user_id", user.id);
            if (!countErr && dbCount != null) {
              const expected = trades.length + 1;
              if (dbCount !== expected) {
                setSyncWarning(`Journal shows ${expected} trade(s) but the database has ${dbCount}. Click Refresh journal to re-sync.`);
              } else {
                setSyncWarning(null);
              }
            }
          } catch {
            /* non-critical */
          }
        }
      }
    } catch (e) {
      addLog({ kind: "err", msg: errorMessage(e, "Could not grade or save this trade") });
    } finally {
      setGrading(false);
    }
  }

  // In learner mode only protected trades (protection score >= 70) count toward go-live.
  const currentCriteria = useMemo(() => {
    if (selectedStrategy === "my-sop") {
      const sig = sop.entry_signals.split(",").map((s) => s.trim()).filter(Boolean);
      return [
        ...sig.map((s) => `Entry signal: ${s}`),
        `Stop loss is set (${sop.sl || "your rule"})`,
        `Take profit plan (${sop.tp || "your rule"})`,
        `Reward:risk at least ${sop.rr}`,
      ];
    }
    return getStrategy(selectedStrategy)?.criteria ?? [];
  }, [selectedStrategy, sop.entry_signals, sop.sl, sop.tp, sop.rr]);

  const eligible = learner ? trades.filter((t) => isMySopTrade(t) && (t.protection_score ?? 0) >= 70) : trades;
  const n = eligible.length;
  const avg = n ? Math.round(eligible.reduce((a, t) => a + t.score, 0) / n) : 0;
  const comp = n ? Math.round((eligible.filter((t) => t.verdict === "SOP followed").length / n) * 100) : 0;
  const ready = n >= 5 && avg >= 70;

  // Average score grouped by the strategy each trade was graded against.
  const byStrategy = useMemo(() => {
    const groups: Record<string, { sum: number; count: number }> = {};
    for (const t of trades) {
      const key = t.strategy_type ?? "my-sop";
      groups[key] = groups[key] ?? { sum: 0, count: 0 };
      groups[key].sum += t.score;
      groups[key].count += 1;
    }
    return Object.entries(groups)
      .map(([key, g]) => ({ key, label: PILL_LABEL[key] ?? "My SOP", avg: Math.round(g.sum / g.count), count: g.count }))
      .sort((a, b) => b.avg - a.avg);
  }, [trades]);
  const bestStrategy = byStrategy[0] ?? null;

  const stratLabel = getStrategy(sop.strategy_type ?? "custom")?.name ?? "Custom";

  return (
    <>
      {persistError && (
        <div className="persist-error-banner">
          <span aria-hidden style={{ fontSize: 18 }}>⚠</span>
          <span style={{ flex: 1 }}>{persistError}</span>
          <button type="button" className="btn" onClick={refreshJournal} disabled={refreshingJournal}>
            {refreshingJournal ? "Refreshing…" : "Refresh journal"}
          </button>
        </div>
      )}
      {syncWarning && !persistError && (
        <div className="sync-warning-banner">
          <span aria-hidden>↻</span>
          <span style={{ flex: 1 }}>{syncWarning}</span>
          <button type="button" className="btn" onClick={refreshJournal} disabled={refreshingJournal}>
            {refreshingJournal ? "Refreshing…" : "Refresh journal"}
          </button>
        </div>
      )}

      <div className="sop-hint">
        {hintCollapsed ? (
          <button type="button" className="sop-hint-collapsed" onClick={() => setHintCollapsed(false)}>
            Using {stratLabel} strategy · tap to expand
          </button>
        ) : (
          <div className="sop-hint-expanded">
            <div className="sop-hint-text">
              Your current SOP uses the <strong>{stratLabel}</strong> strategy. Trades you log here are graded
              against these saved rules — keep trading your plan and watch how it performs over your 5 paper trades.
            </div>
            <button type="button" className="sop-hint-chevron" onClick={collapseHint} aria-label="Collapse this hint">
              ⌄
            </button>
          </div>
        )}
      </div>

      {learner && showEdu && (
        <div className="edu-banner">
          <div className="edu-banner-body">
            <strong>Before your first trade:</strong> a stop loss is a price level where you automatically exit if
            the trade goes against you. It is the single most important thing that separates traders who survive from
            traders who blow up their account. TradeReady will always ask for your stop loss first.
          </div>
          <button type="button" className="btn" onClick={dismissEdu}>Got it</button>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div className="card-title">
            <div className="card-title-icon">◎</div> Paper trade stats
          </div>
          <div className="card-meta">{n} trade{n === 1 ? "" : "s"} graded</div>
        </div>
        <div className="stats-bar">
          <div className="stat"><div className="stat-label">Trades</div><div className="stat-val">{n}</div></div>
          <div className="stat"><div className="stat-label">Avg score</div><div className={`stat-val ${avg >= 70 ? "green" : avg >= 50 ? "amber" : avg ? "red" : ""}`}>{n ? `${avg}/100` : "—"}</div></div>
          <div className="stat"><div className="stat-label">SOP compliance</div><div className="stat-val">{n ? `${comp}%` : "—"}</div></div>
          <div className="stat">
            <div className="stat-label">Best strategy</div>
            <div className="stat-val" style={{ fontSize: 13 }}>
              {bestStrategy ? `${bestStrategy.label} · ${bestStrategy.avg}` : "—"}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Grades today</div>
            {usage ? (
              usage.paid ? (
                <div className="stat-val green" style={{ fontSize: 13 }}>Unlimited</div>
              ) : (() => {
                const used = usage.grades;
                const cap = usage.limit ?? 5;
                const left = usage.remaining ?? Math.max(0, cap - used);
                const cls = left === 0 ? "red" : left === 1 ? "amber" : "green";
                return <div className={`stat-val ${cls}`} style={{ fontSize: 13 }}>{used} of {cap}</div>;
              })()
            ) : (
              <div className="stat-val">—</div>
            )}
          </div>
          <div className="stat"><div className="stat-label">Go-live ready</div><div className={`stat-val ${ready ? "green" : n >= 5 ? "red" : ""}`}>{n >= 5 ? (ready ? "Yes ✓" : "Not yet") : "—"}</div></div>
        </div>
      </div>

      <div className="stage2-grid">
      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">↑</div> Submit paper trade</div>
          <div className="card-meta">
            {usage?.paid
              ? "Unlimited AI grading · against your SOP"
              : `${usage?.limit ?? 5} free grades per day · against your SOP`}
          </div>
        </div>

        <div className="section-block">
          <div className="section-label">Grade against</div>
          <div className="strategy-pills">
            {STRATEGY_PILLS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`strategy-pill accent-${p.accent} ${selectedStrategy === p.id ? "active" : ""}`}
                onClick={() => setSelectedStrategy(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="criteria-card">
            <div className="criteria-head">
              <span>
                {selectedStrategy === "my-sop"
                  ? "Graded against your saved SOP — counts toward go-live."
                  : `Practice grade against the ${PILL_LABEL[selectedStrategy]} playbook — does not count toward go-live.`}
              </span>
              <button type="button" className="criteria-toggle" onClick={() => setCustomizing((v) => !v)}>
                {customizing ? "Done" : "Customize criteria"}
              </button>
            </div>
            <ul className="criteria-list">
              {currentCriteria.map((c) => {
                const checked = criteriaChecked[c] !== false;
                return (
                  <li key={c} className={`criteria-item ${checked ? "" : "off"}`}>
                    {customizing ? (
                      <label className="criteria-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setCriteriaChecked((m) => ({ ...m, [c]: !checked }))}
                        />
                        <span>{c}</span>
                      </label>
                    ) : (
                      <span>• {c}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div className="section-block">
          <div className="section-label">Trade details</div>
          <div className="form-grid three">
            <div className="field">
              <label>Asset / pair <span style={{ color: "var(--red)" }}>*</span></label>
              <input
                type="text"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                placeholder="BTC/USD"
                required
                aria-required="true"
              />
            </div>
            <div className="field">
              <label>Direction</label>
              <select value={dir} onChange={(e) => setDir(e.target.value as "Long" | "Short")}>
                <option>Long</option>
                <option>Short</option>
              </select>
            </div>
            <div className="field">
              <label>Outcome</label>
              <select value={outcome} onChange={(e) => setOutcome(e.target.value as Trade["outcome"])}>
                <option>Win</option>
                <option>Loss</option>
                <option>Break even</option>
              </select>
            </div>
          </div>
          <div className="form-grid three">
            <div className="field">
              <label>Entry price</label>
              <input type="text" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="67,450" />
            </div>
            <div className="field">
              <label>
                <TermTip term="stop-loss">Stop loss</TermTip> {learner && <span style={{ color: "var(--accent)" }}>· required</span>}
              </label>
              <input
                type="text"
                value={stopLoss}
                onChange={(e) => setStopLoss(e.target.value)}
                placeholder="where you exit if wrong"
                style={learner && !stopLoss.trim() ? { borderColor: "rgba(0,212,170,0.5)" } : undefined}
              />
            </div>
            <div className="field">
              <label>Exit price</label>
              <input type="text" value={exit} onChange={(e) => setExit(e.target.value)} placeholder="69,200" />
            </div>
          </div>

          {!learner && asset.trim() && (
            <TickerCard symbol={asset} sop={sop} stats={traderStats} regime={currentRegime} />
          )}

          {learner && (recoBusy || reco) && (
            <div className="reco-box">
              <div className="reco-eyebrow">AI suggestion</div>
              {recoBusy ? (
                <div className="reco-title">Reading your chart for a safe stop loss…</div>
              ) : reco ? (
                <>
                  <div className="reco-title">Suggested stop loss: {reco.stop_loss_price}</div>
                  <div className="reco-body">
                    {reco.support_basis} If price drops to this level you&apos;d exit, and by sizing your position to your{" "}
                    {riskPct} rule your loss stays limited to about {riskPct} of your account.
                  </div>
                  <button type="button" className="btn" style={{ marginTop: 10, padding: "5px 12px", fontSize: 12 }} onClick={() => setStopLoss(String(reco.stop_loss_price))}>
                    Use this stop loss
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>

        <div className="section-label" style={{ padding: "0 20px", marginBottom: 0 }}>Screenshots</div>
        <div className="upload-grid">
          <div className="upload-cell">
            <div className="upload-label">
              📈 Price chart{" "}
              <span className={`upload-badge ${chart ? "ok" : ""}`}>{chart ? "ready" : "required"}</span>
            </div>
            <div className={`dropzone ${chart ? "filled" : ""}`}>
              <input type="file" accept="image/*" onChange={(e) => handleFile(0, e.target.files?.[0])} />
              {chart ? (
                <img src={chart.url} alt="chart upload" />
              ) : (
                <>
                  <div className="dropzone-icon">⬆</div>
                  <div className="dropzone-text">Chart screenshot</div>
                  <div className="dropzone-hint">TradingView · Binance</div>
                </>
              )}
            </div>
          </div>
          <div className="upload-cell">
            <div className="upload-label">
              📰 News / sentiment <span className="upload-badge ok">optional</span>
            </div>
            <div className={`dropzone ${news ? "filled" : ""}`}>
              <input type="file" accept="image/*" onChange={(e) => handleFile(1, e.target.files?.[0])} />
              {news ? (
                <img src={news.url} alt="news upload" />
              ) : (
                <>
                  <div className="dropzone-icon">⬆</div>
                  <div className="dropzone-text">News screenshot</div>
                  <div className="dropzone-hint">CryptoPanic · Twitter</div>
                </>
              )}
            </div>
            <div className="news-paste">
              <div className="news-paste-or">or paste the catalyst text</div>
              <textarea
                value={newsText}
                onChange={(e) => setNewsText(e.target.value)}
                placeholder="Paste headlines or the catalyst sentences from the source (e.g. an earnings note, a CryptoPanic blurb, an analyst comment)…"
              />
            </div>
          </div>
        </div>

        {usage && !usage.paid && usage.remaining === 0 ? (
          <GradeLimitCard cap={usage.limit ?? 5} resetsAt={usage.resets_at} />
        ) : (
          <div className="btn-row">
            {learner && !stopLoss.trim() && (
              <span className="btn-hint" style={{ color: "var(--accent)" }}>
                Set your stop loss before trading — this protects your money if the trade goes wrong.
              </span>
            )}
            {usage && !usage.paid && usage.remaining === 1 && (
              <span className="btn-hint" style={{ color: "var(--amber)" }}>
                Last free grade today — Pro unlocks unlimited grading.
              </span>
            )}
            <button className="btn" onClick={clearForm} type="button">↺ Clear</button>
            <button
              className="btn primary"
              onClick={gradeTrade}
              disabled={grading || (learner && !stopLoss.trim())}
              type="button"
            >
              {grading ? "⏳ Grading…" : "⚡ Grade this trade"}
            </button>
          </div>
        )}
        {log.length > 0 && (
          <div className="log-strip">
            {log.map((l, i) => (
              <div key={i} className="log-line">
                <span className={`log-badge lb-${l.kind}`}>{l.kind}</span>
                <span>{l.msg}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="stage2-right">
        {grade ? (
          <GradeCard data={grade} learner={learner} />
        ) : (
          <div className="card grade-placeholder">
            <div className="grade-placeholder-icon">★</div>
            <div>Grade report will render here.</div>
            <div className="grade-placeholder-sub">Fill in the trade and tap Grade this trade.</div>
          </div>
        )}
        {!learner && <PositionSizer sop={sop} entry={entry} stop={stopLoss} />}
      </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">≡</div> Trade journal</div>
          <button
            type="button"
            className="btn"
            style={{ padding: "5px 12px", fontSize: 12 }}
            onClick={refreshJournal}
            disabled={refreshingJournal}
            title="Re-load trades from the database"
          >
            {refreshingJournal ? "↻ Refreshing…" : "↻ Refresh journal"}
          </button>
        </div>
        {trades.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <div>No trades graded yet</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>Submit your first paper trade above</div>
          </div>
        ) : (
          <div>
            <div className="trade-row header">
              <span>#</span><span>pair</span><span>strategy</span><span>direction</span><span>outcome</span><span>score</span><span>verdict</span>
            </div>
            {trades.map((t, i) => {
              const vc = t.verdict === "SOP followed" ? "tv-pass" : t.verdict === "Partial" ? "tv-part" : "tv-fail";
              const sc = t.score >= 70 ? "var(--accent)" : t.score >= 50 ? "var(--amber)" : "var(--red)";
              const sKey = t.strategy_type ?? "my-sop";
              const accent = PILL_ACCENT[sKey] ?? "var(--text3)";
              return (
                <div key={t.id ?? i} className="trade-row">
                  <span style={{ color: "var(--text3)", fontSize: 11 }}>#{i + 1}</span>
                  <span className="trade-pair">{t.asset}</span>
                  <span><span className="trade-strategy-pill" style={{ color: accent, borderColor: accent }}>{PILL_LABEL[sKey] ?? "My SOP"}</span></span>
                  <span><span className={`trade-dir ${t.dir === "Long" ? "long" : "short"}`}>{t.dir}</span></span>
                  <span style={{ color: "var(--text2)" }}>{t.outcome}</span>
                  <span className="trade-score" style={{ color: sc }}>{t.score}</span>
                  <span><span className={`trade-verdict ${vc}`}>{t.verdict}</span></span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {byStrategy.length > 0 && (
        <div className="card">
          <div className="card-header">
            <div className="card-title"><div className="card-title-icon">⊞</div> Your strategy performance</div>
            <div className="card-meta">See which strategy you execute best</div>
          </div>
          <div className="section-block strategy-compare">
            {byStrategy.map((s) => {
              const accent = PILL_ACCENT[s.key] ?? "var(--text3)";
              return (
                <div key={s.key} className="compare-row">
                  <span className="compare-label"><span className="compare-dot" style={{ background: accent }} />{s.label}</span>
                  <div className="compare-track">
                    <div className="compare-fill" style={{ width: `${s.avg}%`, background: accent }} />
                  </div>
                  <span className="compare-val" style={{ color: accent }}>{s.avg}</span>
                  <span className="compare-count">{s.count} trade{s.count === 1 ? "" : "s"}</span>
                </div>
              );
            })}
            {bestStrategy && byStrategy.length >= 2 && (
              <div className="compare-insight">
                You score highest on <strong>{bestStrategy.label.toLowerCase()}</strong> trades. Consider making this your primary strategy for go-live.
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: "var(--text2)", marginBottom: 3 }}>
            Need 5 graded trades with avg score ≥ 70 to unlock go-live
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>
            {n < 5
              ? `${5 - n} more trade${5 - n === 1 ? "" : "s"} needed`
              : ready
              ? "Ready! Unlock go-live →"
              : "Avg score too low — keep practicing"}
          </div>
        </div>
        <button className="btn primary" onClick={onUnlock} disabled={!goLiveUnlocked}>Unlock go-live →</button>
      </div>
    </>
  );
}

// Shown in place of the Grade button when a Free user has used all 5 of
// their daily grades. Tone is encouraging — they get back tomorrow OR
// upgrade now.
function GradeLimitCard({ cap, resetsAt }: { cap: number; resetsAt: string }) {
  const [busy, setBusy] = useState(false);

  async function upgrade() {
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/checkout", { method: "POST" });
      const j = await res.json();
      if (j.url) window.location.href = j.url;
      else setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  const resetDate = new Date(resetsAt);
  const localTime = resetDate.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });

  return (
    <div className="grade-limit-card">
      <div className="grade-limit-icon" aria-hidden>🎯</div>
      <div className="grade-limit-title">You've used all {cap} free grades today</div>
      <div className="grade-limit-sub">
        Grades reset at midnight UTC (<span style={{ color: "var(--text2)" }}>{localTime} your time</span>).
        Upgrade to Pro for unlimited grading whenever you want it.
      </div>
      <div className="grade-limit-actions">
        <button type="button" className="btn primary" onClick={upgrade} disabled={busy}>
          {busy ? "Opening Stripe…" : "Upgrade to Pro · $19/mo"}
        </button>
        <button type="button" className="btn" disabled>
          Come back tomorrow
        </button>
      </div>
    </div>
  );
}

function GradeCard({ data, learner }: { data: { grade: Grade; asset: string; dir: string; outcome: string; protection: ProtectionResult | null; strategyLabel: string }; learner: boolean }) {
  const r = data.grade;
  const vClass = r.verdict === "SOP followed" ? "gv-pass" : r.verdict === "Partial" ? "gv-part" : "gv-fail";
  const scoreColor = r.score >= 70 ? "var(--accent)" : r.score >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">★</div> {learner ? "Your feedback" : "AI grade report"}</div>
        <span className="grade-strategy-badge">Graded as: {data.strategyLabel}</span>
      </div>
      <div className="grade-header">
        <div className="grade-score" style={{ color: scoreColor }}>{r.score}<span>/100</span></div>
        <div className="grade-meta">
          <div className="grade-pair">
            {data.asset} <span style={{ color: "var(--text3)", fontWeight: 400, fontSize: 13 }}>{data.dir} · {data.outcome}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{learner ? "Based on your trading plan" : "AI grade based on your SOP"}</div>
        </div>
        <span className={`grade-verdict-badge ${vClass}`}>{r.verdict}</span>
      </div>
      {data.protection && (
        <div className={`protection-bar ${data.protection.protection_score >= 70 ? "ok" : "low"}`}>
          <div className="shield" aria-hidden>🛡</div>
          <div className="protection-meta">
            <div className="protection-score-line">
              Protection score <strong>{data.protection.protection_score}/100</strong>
            </div>
            <div className="protection-sub">
              Stop loss set {data.protection.stop_loss_set ? "✓" : "✗"} · Stop placement {data.protection.stop_loss_placement}/30 · Position size {data.protection.position_size_ok ? "ok" : "too big"}
            </div>
            {data.protection.protection_score < 70 && (
              <div className="protection-warn">
                This trade does not count toward your go-live progress because your capital was not protected. Always set your stop loss first — this keeps you safe.
              </div>
            )}
          </div>
        </div>
      )}
      {!learner && (
        <div className="rule-checks">
          {(r.rule_checks ?? []).map((rc, i) => {
            const ico = rc.status === "pass" ? "✓" : rc.status === "fail" ? "✗" : "△";
            const col = rc.status === "pass" ? "var(--accent)" : rc.status === "fail" ? "var(--red)" : "var(--amber)";
            return (
              <div key={i} className="rc-item">
                <div className="rc-icon" style={{ color: col }}>{ico}</div>
                <div>
                  <div className="rc-rule">{rc.rule}</div>
                  <div className="rc-note">{rc.note}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="detail-section">
        <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>What you did well</div>
        <div className="summary-box">{r.what_you_did_well}</div>
        <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>What to improve</div>
        <div className="summary-box">{r.what_to_improve}</div>
        <div className="coach-note">&ldquo;{r.coach_note}&rdquo;</div>
      </div>
    </div>
  );
}
