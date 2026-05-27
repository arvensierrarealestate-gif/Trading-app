"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { TraderStats } from "@/lib/types";

type ExtractedStats = TraderStats & { confidence?: string; summary?: string };
type UploadFile =
  | { kind: "pdf"; name: string; data: string }
  | { kind: "image"; name: string; media_type: string; data: string }
  | { kind: "csv"; name: string; text: string };

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export default function TraderVerify({ onVerified }: { onVerified: (s: TraderStats | null) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<ExtractedStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);

  function errorMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    if (typeof e === "object" && e !== null && "message" in e) return String((e as { message: unknown }).message);
    return "Could not save verification";
  }

  async function analyze() {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    setStats(null);
    try {
      const payload: UploadFile[] = [];
      for (const f of files) {
        const lower = f.name.toLowerCase();
        if (f.type === "application/pdf" || lower.endsWith(".pdf")) {
          payload.push({ kind: "pdf", name: f.name, data: await readAsBase64(f) });
        } else if (f.type.startsWith("image/")) {
          payload.push({ kind: "image", name: f.name, media_type: f.type, data: await readAsBase64(f) });
        } else {
          payload.push({ kind: "csv", name: f.name, text: await readAsText(f) });
        }
      }
      const res = await fetch("/api/verify-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: payload }),
      });
      const json = await res.json();
      if (!res.ok) setErr(json.error || "Could not read your files");
      else setStats(json.stats);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!stats) return;
    setSaving(true);
    setErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const row = {
        user_id: user.id,
        total_trades: stats.total_trades,
        win_rate: stats.win_rate,
        avg_win: stats.avg_win,
        avg_loss: stats.avg_loss,
        max_single_loss: stats.max_single_loss,
        max_drawdown: stats.max_drawdown,
        primary_assets: stats.primary_assets,
        avg_hold_time: stats.avg_hold_time,
        verified: true,
        verified_at: new Date().toISOString(),
        verification_summary: stats,
      };
      const [s, p] = await Promise.all([
        supabase.from("trader_stats").upsert(row),
        supabase.from("profiles").upsert({ id: user.id, verified: true }),
      ]);
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      onVerified(stats);
    } catch (e) {
      setErr(errorMessage(e));
      setSaving(false);
    }
  }

  async function skipVerification() {
    setSkipping(true);
    setErr(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("profiles").upsert({ id: user.id, verified: true });
      if (error) throw error;
      onVerified(null);
    } catch (e) {
      setErr(errorMessage(e));
      setSkipping(false);
    }
  }

  return (
    <div className="mode-shell">
      <div className="mode-head">
        <div className="auth-title"><span className="logo-dot" /> Unlock experienced trader mode</div>
        <div className="auth-sub">Upload your trading history to personalize the safety layer — or skip and unlock with full responsibility.</div>
      </div>

      {!stats ? (
        <>
          <div className="verify-options">
            <div className="verify-opt">
              <div className="verify-opt-title">1 · Broker statement</div>
              <div className="verify-opt-body">PDF or CSV from Fidelity, Schwab, Alpaca, or any broker — at least 3 months of trade history.</div>
            </div>
            <div className="verify-opt">
              <div className="verify-opt-title">2 · Trade journal export</div>
              <div className="verify-opt-body">CSV from TraderVue, Edgewonk, or any journal — at least 20 completed trades with entry, exit, P&amp;L.</div>
            </div>
            <div className="verify-opt">
              <div className="verify-opt-title">3 · Screenshot proof</div>
              <div className="verify-opt-body">Screenshots of account history, realized P&amp;L, and trade log — at least 3 months.</div>
            </div>
          </div>

          <div className="card" style={{ maxWidth: 760, margin: "16px auto 0" }}>
            <div className="section-block">
              <div className="dropzone" style={{ minHeight: 110 }}>
                <input type="file" multiple accept=".pdf,.csv,text/csv,image/*" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                <div className="dropzone-icon">⬆</div>
                <div className="dropzone-text">{files.length ? `${files.length} file(s) selected` : "Drop broker statements, journal CSVs, or screenshots"}</div>
                <div className="dropzone-hint">PDF · CSV · PNG/JPG · up to 8 files</div>
              </div>
              {files.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 10 }}>
                  {files.map((f) => f.name).join(" · ")}
                </div>
              )}
            </div>
            <div className="btn-row">
              <span className="btn-hint">The AI reads your files and extracts your verified stats. Nothing is shared.</span>
              <button className="btn primary" onClick={analyze} disabled={busy || skipping || !files.length} type="button">
                {busy ? "Reading your history…" : "Analyze & extract stats"}
              </button>
            </div>
          </div>

          <div className="skip-verify">
            <span className="skip-verify-text">In a hurry? Unlock trader mode without uploading — you accept full responsibility for risk decisions and the history-based protection banners stay off.</span>
            <button className="btn" onClick={skipVerification} type="button" disabled={busy || skipping}>
              {skipping ? "Unlocking…" : "Skip and unlock"}
            </button>
          </div>
        </>
      ) : (
        <div className="card profile-card" style={{ maxWidth: 620, margin: "0 auto" }}>
          <div className="card-header">
            <div className="card-title"><div className="card-title-icon">✓</div> Trader profile</div>
            {stats.confidence && <div className="card-meta">confidence: {stats.confidence}</div>}
          </div>
          <div className="profile-grid">
            <Stat label="Total trades" v={stats.total_trades} />
            <Stat label="Win rate" v={stats.win_rate} suffix="%" />
            <Stat label="Avg win" v={stats.avg_win} prefix="$" />
            <Stat label="Avg loss" v={stats.avg_loss} prefix="$" />
            <Stat label="Max single loss" v={stats.max_single_loss} suffix="%" />
            <Stat label="Max drawdown" v={stats.max_drawdown} suffix="%" />
            <Stat label="Primary assets" v={stats.primary_assets} />
            <Stat label="Avg hold time" v={stats.avg_hold_time} />
          </div>
          {stats.summary && <div className="summary-box" style={{ margin: "0 20px 16px" }}>{stats.summary}</div>}
          <div className="btn-row">
            <button className="btn" onClick={() => setStats(null)} type="button" disabled={saving}>← Re-upload</button>
            <button className="btn primary" onClick={confirm} type="button" disabled={saving}>
              {saving ? "Unlocking…" : "Confirm — this is accurate, unlock trader mode"}
            </button>
          </div>
        </div>
      )}

      {err && <div className="auth-msg err" style={{ maxWidth: 620, margin: "12px auto 0" }}>{err}</div>}
    </div>
  );
}

function Stat({ label, v, prefix = "", suffix = "" }: { label: string; v: string | number | null | undefined; prefix?: string; suffix?: string }) {
  const display = v === null || v === undefined || v === "" ? "—" : `${prefix}${v}${suffix}`;
  return (
    <div className="profile-stat">
      <div className="profile-stat-label">{label}</div>
      <div className="profile-stat-val">{display}</div>
    </div>
  );
}
