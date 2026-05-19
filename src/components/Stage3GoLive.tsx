"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GL_ITEMS } from "@/lib/types";
import type { Trade } from "@/lib/types";

type AlpacaAccount = {
  account_number: string;
  status: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  buying_power: string;
};

export default function Stage3GoLive({
  trades,
  manualChecks,
  onManualChecksChange,
  onBack,
}: {
  trades: Trade[];
  manualChecks: boolean[];
  onManualChecksChange: (next: boolean[]) => void;
  onBack: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [account, setAccount] = useState<AlpacaAccount | null>(null);
  const [acctErr, setAcctErr] = useState<string | null>(null);
  const [acctLoading, setAcctLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alpaca/account");
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) setAcctErr(json.error || "Alpaca request failed");
        else setAccount(json.account);
      } catch (e) {
        if (!cancelled) setAcctErr(e instanceof Error ? e.message : "Network error");
      } finally {
        if (!cancelled) setAcctLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const n = trades.length;
  const avg = n ? Math.round(trades.reduce((a, t) => a + t.score, 0) / n) : 0;
  const autoVals = { trades5: n >= 5, score70: avg >= 70 };

  const allChecks = GL_ITEMS.map((item, i) => {
    if (item.auto) {
      const key = item.key as "trades5" | "score70";
      return autoVals[key];
    }
    return manualChecks[i - 2] ?? false;
  });

  async function toggle(i: number) {
    const item = GL_ITEMS[i];
    if (item.auto) return;
    const idx = i - 2;
    const next = manualChecks.slice();
    next[idx] = !next[idx];
    onManualChecksChange(next);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("go_live_checks").upsert({
        user_id: user.id,
        manual_checks: next,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const total = GL_ITEMS.length;
  const done = allChecks.filter(Boolean).length;
  const allPassed = done === total;

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">🚀</div> Go-live readiness checklist</div>
          <div className="card-meta">{done} / {total} complete</div>
        </div>

        <div className="checklist">
          {GL_ITEMS.map((item, i) => {
            const checked = allChecks[i];
            return (
              <div
                key={i}
                className={`check-item ${item.auto ? "auto-check" : ""}`}
                onClick={() => toggle(i)}
              >
                <div className={`checkbox ${checked ? "checked" : ""}`}>{checked ? "✓" : ""}</div>
                <div className={`check-text ${checked ? "checked" : ""}`}>{item.text}</div>
                <span className={`check-tag ${item.tagClass}`}>{item.tag}</span>
              </div>
            );
          })}
        </div>

        <div className="verdict-bar">
          <div className={`verdict-pill ${allPassed ? "execute" : "pending"}`}>
            {allPassed ? "Ready to trade live" : `${done}/${total} checks done`}
          </div>
          <div className="score-pips">
            {allChecks.map((c, i) => <div key={i} className={`pip ${c ? "pass" : ""}`} />)}
          </div>
          <span style={{ fontSize: 12, color: allPassed ? "var(--accent)" : "var(--text3)", marginLeft: 8 }}>
            {allPassed
              ? "All checks passed. Your system is tested, your rules are set. Trade with confidence."
              : `${total - done} item${total - done === 1 ? "" : "s"} remaining before you are ready to go live.`}
          </span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">$</div> Alpaca paper account</div>
          <div className="card-meta">paper-api.alpaca.markets</div>
        </div>
        {acctLoading ? (
          <div className="empty-state"><div>Loading account…</div></div>
        ) : acctErr ? (
          <div className="empty-state">
            <div>Could not load account</div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>{acctErr}</div>
            <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
              Add <code>ALPACA_KEY_ID</code> and <code>ALPACA_SECRET_KEY</code> to your environment.
            </div>
          </div>
        ) : account ? (
          <div className="acct-grid">
            <div className="acct-cell">
              <div className="acct-label">Account</div>
              <div className="acct-val">{account.account_number}</div>
            </div>
            <div className="acct-cell">
              <div className="acct-label">Status</div>
              <div className="acct-val">{account.status}</div>
            </div>
            <div className="acct-cell">
              <div className="acct-label">Equity</div>
              <div className="acct-val">${Number(account.equity).toLocaleString()}</div>
            </div>
            <div className="acct-cell">
              <div className="acct-label">Cash</div>
              <div className="acct-val">${Number(account.cash).toLocaleString()}</div>
            </div>
            <div className="acct-cell">
              <div className="acct-label">Buying power</div>
              <div className="acct-val">${Number(account.buying_power).toLocaleString()}</div>
            </div>
            <div className="acct-cell">
              <div className="acct-label">Portfolio</div>
              <div className="acct-val">${Number(account.portfolio_value).toLocaleString()}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
        <button className="btn" onClick={onBack}>← Back to paper trading</button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", padding: "0 16px", background: "var(--bg1)", border: "1px solid rgba(0,212,170,0.15)", borderRadius: 10, fontSize: 12, color: "var(--text3)" }}>
          Once all checks pass, you can place live orders through Alpaca from this account
        </div>
      </div>
    </>
  );
}
