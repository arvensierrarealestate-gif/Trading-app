"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Grade, SOP, Trade, TradingMode, TraderStats } from "@/lib/types";
import type { Regime } from "@/lib/regime";
import TickerCard from "./TickerCard";
import PositionSizer from "./PositionSizer";
import TermTip from "./TermTip";
import { errorMessage } from "@/lib/errors";
import { getStrategy } from "@/lib/strategies";

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
  onUnlock,
}: {
  sop: SOP;
  trades: Trade[];
  goLiveUnlocked: boolean;
  currentRegime: Regime | null;
  mode: TradingMode;
  traderStats: TraderStats | null;
  onTradeAdded: (t: Trade) => void;
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
  const [grading, setGrading] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [grade, setGrade] = useState<{ grade: Grade; asset: string; dir: string; outcome: string; protection: ProtectionResult | null } | null>(null);
  const [usage, setUsage] = useState<{ grades: number; limit: number; remaining: number; est_cost_usd: number } | null>(null);
  const [reco, setReco] = useState<{ stop_loss_price: number; support_basis: string; drop_pct: number } | null>(null);
  const [recoBusy, setRecoBusy] = useState(false);
  const [showEdu, setShowEdu] = useState(false);
  const [hintCollapsed, setHintCollapsed] = useState(false);

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
    setEntry("");
    setExit("");
    setStopLoss("");
    setAsset("");
    setLog([]);
    setGrade(null);
    setReco(null);
  }

  async function gradeTrade() {
    if (!chart) {
      addLog({ kind: "err", msg: "Upload a chart screenshot first." });
      return;
    }
    if (learner && !stopLoss.trim()) {
      addLog({ kind: "err", msg: "Set your stop loss before trading — this protects your money if the trade goes wrong." });
      return;
    }
    setGrading(true);
    setLog([]);
    setGrade(null);
    addLog({ kind: "ai", msg: "Reading chart screenshot…" });
    addLog({ kind: "tool", msg: "Comparing vs your SOP rules…" });

    try {
      const res = await fetch("/api/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sop,
          asset: asset || "Unknown",
          dir,
          outcome,
          entry,
          exit,
          stop_loss: stopLoss,
          chart: chart.payload,
          news: news?.payload ?? null,
          current_regime: currentRegime,
          mode,
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
      setGrade({ grade: g, asset: asset || "Unknown", dir, outcome, protection: prot });

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: inserted, error } = await supabase
          .from("paper_trades")
          .insert({
            user_id: user.id,
            asset: asset || "Unknown",
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
          })
          .select()
          .single();
        if (error) {
          addLog({ kind: "err", msg: `Saved locally only — database error: ${errorMessage(error)}` });
        } else if (inserted) {
          onTradeAdded({
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
          });
        }
      }
    } catch (e) {
      addLog({ kind: "err", msg: errorMessage(e, "Could not grade or save this trade") });
    } finally {
      setGrading(false);
    }
  }

  // In learner mode only protected trades (protection score >= 70) count toward go-live.
  const eligible = learner ? trades.filter((t) => (t.protection_score ?? 0) >= 70) : trades;
  const n = eligible.length;
  const avg = n ? Math.round(eligible.reduce((a, t) => a + t.score, 0) / n) : 0;
  const comp = n ? Math.round((eligible.filter((t) => t.verdict === "SOP followed").length / n) * 100) : 0;
  const ready = n >= 5 && avg >= 70;

  const stratLabel = getStrategy(sop.strategy_type ?? "custom")?.name ?? "Custom";

  return (
    <>
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
          <div className="stat"><div className="stat-label">Go-live ready</div><div className={`stat-val ${ready ? "green" : n >= 5 ? "red" : ""}`}>{n >= 5 ? (ready ? "Yes ✓" : "Not yet") : "—"}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">↑</div> Submit paper trade</div>
          <div className="card-meta">
            {usage
              ? `${usage.grades}/${usage.limit} grades today · ~$${usage.est_cost_usd.toFixed(2)}`
              : "AI grades against your SOP"}
          </div>
        </div>

        <div className="section-block">
          <div className="section-label">Trade details</div>
          <div className="form-grid three">
            <div className="field">
              <label>Asset / pair</label>
              <input type="text" value={asset} onChange={(e) => setAsset(e.target.value)} placeholder="BTC/USD" />
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
              {recoBusy ? (
                <div className="reco-title">Reading your chart for a safe stop loss…</div>
              ) : reco ? (
                <>
                  <div className="reco-title">Recommended stop loss: {reco.stop_loss_price}</div>
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
          </div>
        </div>

        <div className="btn-row">
          {learner && !stopLoss.trim() && (
            <span className="btn-hint" style={{ color: "var(--accent)" }}>
              Set your stop loss before trading — this protects your money if the trade goes wrong.
            </span>
          )}
          {usage && usage.remaining === 0 && (
            <span className="btn-hint" style={{ color: "var(--amber)" }}>Daily grading limit reached — resets tomorrow.</span>
          )}
          <button className="btn" onClick={clearForm} type="button">↺ Clear</button>
          <button
            className="btn primary"
            onClick={gradeTrade}
            disabled={grading || usage?.remaining === 0 || (learner && !stopLoss.trim())}
            type="button"
          >
            {grading ? "⏳ Grading…" : "⚡ Grade this trade"}
          </button>
        </div>
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

      {!learner && <PositionSizer sop={sop} entry={entry} stop={stopLoss} />}

      {grade && <GradeCard data={grade} learner={learner} />}

      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">≡</div> Trade journal</div>
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
              <span>#</span><span>pair</span><span>direction</span><span>outcome</span><span>score</span><span>verdict</span>
            </div>
            {trades.map((t, i) => {
              const vc = t.verdict === "SOP followed" ? "tv-pass" : t.verdict === "Partial" ? "tv-part" : "tv-fail";
              const sc = t.score >= 70 ? "var(--accent)" : t.score >= 50 ? "var(--amber)" : "var(--red)";
              return (
                <div key={t.id ?? i} className="trade-row">
                  <span style={{ color: "var(--text3)", fontSize: 11 }}>#{i + 1}</span>
                  <span className="trade-pair">{t.asset}</span>
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

function GradeCard({ data, learner }: { data: { grade: Grade; asset: string; dir: string; outcome: string; protection: ProtectionResult | null }; learner: boolean }) {
  const r = data.grade;
  const vClass = r.verdict === "SOP followed" ? "gv-pass" : r.verdict === "Partial" ? "gv-part" : "gv-fail";
  const scoreColor = r.score >= 70 ? "var(--accent)" : r.score >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">★</div> {learner ? "Your feedback" : "AI grade report"}</div>
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
