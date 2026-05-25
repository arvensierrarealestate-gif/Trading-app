"use client";

import { useEffect, useState } from "react";
import type { SOP } from "@/lib/types";

export default function PositionSizer({ sop, entry, stop }: { sop: SOP; entry: string; stop: string }) {
  const [account, setAccount] = useState("");

  // Pre-fill account size from Alpaca equity if available.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alpaca/account");
        const json = await res.json();
        if (!cancelled && res.ok && json.account?.equity) setAccount(String(Math.round(Number(json.account.equity))));
      } catch {
        // manual entry
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const riskPct = parseFloat(sop.risk) || 1; // percent
  const acct = Number(account);
  const e = Number(entry);
  const s = Number(stop);
  const valid = acct > 0 && e > 0 && s > 0 && e !== s;

  const perShare = valid ? Math.abs(e - s) : 0;
  const maxRiskDollars = valid ? (acct * riskPct) / 100 : 0;
  const maxShares = valid ? Math.floor(maxRiskDollars / perShare) : 0;
  const dollarRisk = maxShares * perShare;
  const pctOfAccount = valid && acct ? (dollarRisk / acct) * 100 : 0;
  const afterStop = valid ? acct - dollarRisk : 0;
  const withinSop = valid && pctOfAccount <= riskPct + 1e-9;

  return (
    <div className="card sizer-card">
      <div className="card-header">
        <div className="card-title"><div className="card-title-icon">∑</div> Position sizing</div>
        <div className="card-meta">{sop.risk} max risk rule</div>
      </div>
      <div className="section-block">
        <div className="form-grid three">
          <div className="field">
            <label>Account size ($)</label>
            <input type="number" value={account} onChange={(e2) => setAccount(e2.target.value)} placeholder="prefilled from Alpaca" />
          </div>
          <div className="field">
            <label>Entry price</label>
            <input type="number" value={entry} readOnly placeholder="set above" />
          </div>
          <div className="field">
            <label>Stop loss price</label>
            <input type="number" value={stop} readOnly placeholder="set above" />
          </div>
        </div>

        {valid ? (
          <div className={`sizer-out ${withinSop ? "ok" : "bad"}`}>
            <div className="sizer-line"><span>Max shares within your {sop.risk} rule</span><strong>{maxShares.toLocaleString()}</strong></div>
            <div className="sizer-line"><span>Dollar risk on this trade</span><strong>${dollarRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
            <div className="sizer-line"><span>As percentage of account</span><strong>{pctOfAccount.toFixed(2)}%</strong></div>
            <div className="sizer-line"><span>If the stop hits, account becomes</span><strong>${afterStop.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
            <div className="sizer-verdict">
              {withinSop ? "✓ Within your SOP risk limit" : "✕ Risk exceeds your SOP maximum — reduce size"}
            </div>
          </div>
        ) : (
          <div className="sizer-out muted">Enter account size, entry, and stop above to size this trade.</div>
        )}
      </div>
    </div>
  );
}
