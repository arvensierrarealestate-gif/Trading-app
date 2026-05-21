"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Grade, SOP, Trade } from "@/lib/types";

type LogLine = { kind: "ai" | "ok" | "err" | "tool"; msg: string };

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
  onTradeAdded,
  onUnlock,
}: {
  sop: SOP;
  trades: Trade[];
  goLiveUnlocked: boolean;
  onTradeAdded: (t: Trade) => void;
  onUnlock: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [asset, setAsset] = useState("");
  const [dir, setDir] = useState<"Long" | "Short">("Long");
  const [outcome, setOutcome] = useState<"Win" | "Loss" | "Break even">("Win");
  const [entry, setEntry] = useState("");
  const [exit, setExit] = useState("");
  const [chart, setChart] = useState<{ url: string; payload: ImagePayload } | null>(null);
  const [news, setNews] = useState<{ url: string; payload: ImagePayload } | null>(null);
  const [grading, setGrading] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [grade, setGrade] = useState<{ grade: Grade; asset: string; dir: string; outcome: string } | null>(null);
  const [usage, setUsage] = useState<{ grades: number; limit: number; remaining: number; est_cost_usd: number } | null>(null);

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
    if (idx === 0) setChart({ url, payload });
    else setNews({ url, payload });
  }

  function clearForm() {
    setChart(null);
    setNews(null);
    setEntry("");
    setExit("");
    setAsset("");
    setLog([]);
    setGrade(null);
  }

  async function gradeTrade() {
    if (!chart) {
      addLog({ kind: "err", msg: "Upload a chart screenshot first." });
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
          chart: chart.payload,
          news: news?.payload ?? null,
        }),
      });
      const json = await res.json();
      loadUsage();
      if (!res.ok) {
        addLog({ kind: "err", msg: json.error || "Grading failed" });
        return;
      }
      const g: Grade = json.grade;
      const cost = json.usage ? ` · ${json.usage.input_tokens + json.usage.output_tokens} tok` : "";
      addLog({ kind: "ok", msg: `Score: ${g.score}/100 — ${g.verdict}${cost}` });
      setGrade({ grade: g, asset: asset || "Unknown", dir, outcome });

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
            score: g.score,
            verdict: g.verdict,
            grade: g,
          })
          .select()
          .single();
        if (error) {
          addLog({ kind: "err", msg: `Saved locally only: ${error.message}` });
        } else if (inserted) {
          onTradeAdded({
            id: inserted.id,
            asset: inserted.asset,
            dir: inserted.dir as Trade["dir"],
            outcome: inserted.outcome as Trade["outcome"],
            entry: inserted.entry_price ?? undefined,
            exit: inserted.exit_price ?? undefined,
            score: inserted.score,
            verdict: inserted.verdict as Trade["verdict"],
            grade: inserted.grade,
          });
        }
      }
    } catch (e) {
      addLog({ kind: "err", msg: e instanceof Error ? e.message : "Network error" });
    } finally {
      setGrading(false);
    }
  }

  const n = trades.length;
  const avg = n ? Math.round(trades.reduce((a, t) => a + t.score, 0) / n) : 0;
  const comp = n ? Math.round((trades.filter((t) => t.verdict === "SOP followed").length / n) * 100) : 0;
  const ready = n >= 5 && avg >= 70;

  return (
    <>
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
          <div className="form-grid">
            <div className="field">
              <label>Entry price</label>
              <input type="text" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="67,450" />
            </div>
            <div className="field">
              <label>Exit price</label>
              <input type="text" value={exit} onChange={(e) => setExit(e.target.value)} placeholder="69,200" />
            </div>
          </div>
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
          {usage && usage.remaining === 0 && (
            <span className="btn-hint" style={{ color: "var(--amber)" }}>Daily grading limit reached — resets tomorrow.</span>
          )}
          <button className="btn" onClick={clearForm} type="button">↺ Clear</button>
          <button className="btn primary" onClick={gradeTrade} disabled={grading || (usage?.remaining === 0)} type="button">
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

      {grade && <GradeCard data={grade} />}

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

function GradeCard({ data }: { data: { grade: Grade; asset: string; dir: string; outcome: string } }) {
  const r = data.grade;
  const vClass = r.verdict === "SOP followed" ? "gv-pass" : r.verdict === "Partial" ? "gv-part" : "gv-fail";
  const scoreColor = r.score >= 70 ? "var(--accent)" : r.score >= 50 ? "var(--amber)" : "var(--red)";
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">★</div> AI grade report</div>
      </div>
      <div className="grade-header">
        <div className="grade-score" style={{ color: scoreColor }}>{r.score}<span>/100</span></div>
        <div className="grade-meta">
          <div className="grade-pair">
            {data.asset} <span style={{ color: "var(--text3)", fontWeight: 400, fontSize: 13 }}>{data.dir} · {data.outcome}</span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>AI grade based on your SOP</div>
        </div>
        <span className={`grade-verdict-badge ${vClass}`}>{r.verdict}</span>
      </div>
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
