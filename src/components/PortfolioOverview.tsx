"use client";

import { useEffect, useState } from "react";
import PortfolioChart from "./PortfolioChart";
import { errorMessage } from "@/lib/errors";

type Range = "LIVE" | "1D" | "1W" | "1M" | "3M" | "YTD" | "1Y" | "ALL";
const RANGES: Range[] = ["LIVE", "1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"];

type History = { timestamp: number[]; equity: (number | null)[]; profit_loss: (number | null)[]; profit_loss_pct: (number | null)[]; base_value: number };

type Account = { equity: string; portfolio_value: string; buying_power: string; cash: string };

export default function PortfolioOverview() {
  const [range, setRange] = useState<Range>("1D");
  const [history, setHistory] = useState<History | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/alpaca/account");
        const j = await res.json();
        if (!cancelled && res.ok) setAccount(j.account);
      } catch {
        // tolerated; chart still attempts
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const res = await fetch(`/api/alpaca/portfolio?range=${range}`);
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setErr(j.error || "Could not load portfolio history");
          setHistory(null);
        } else {
          setHistory(j.history);
        }
      } catch (e) {
        if (!cancelled) setErr(errorMessage(e, "Network error"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [range]);

  const equity = account ? Number(account.equity) : null;
  const equityFmt = equity != null ? equity.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
  const buyingPower = account ? Number(account.buying_power).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";

  let dailyPl = 0;
  let dailyPct = 0;
  if (history?.equity?.length) {
    const eq = history.equity.filter((v): v is number => typeof v === "number");
    if (eq.length >= 2 && history.base_value) {
      dailyPl = eq[eq.length - 1] - history.base_value;
      dailyPct = (dailyPl / history.base_value) * 100;
    }
  }
  const up = dailyPl >= 0;

  return (
    <div className="dash-card overview-card">
      <div className="overview-head">
        <div>
          <div className="overview-value">${equityFmt}</div>
          <div className={`overview-pl ${up ? "up" : "down"}`}>
            {up ? "+" : ""}${dailyPl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            <span className="overview-pl-pct">({up ? "+" : ""}{dailyPct.toFixed(2)}%)</span>
            <span className="overview-pl-range">· {range === "LIVE" ? "today" : range}</span>
          </div>
        </div>
        <div className="range-tabs" role="tablist">
          {RANGES.map((r) => (
            <button key={r} className={`range-tab ${r === range ? "active" : ""}`} onClick={() => setRange(r)} type="button" role="tab" aria-selected={r === range}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {loading && !history ? (
        <div className="chart-empty" style={{ height: 220 }}>Loading portfolio history…</div>
      ) : err ? (
        <div className="chart-empty error" style={{ height: 220 }}>{err}</div>
      ) : history ? (
        <PortfolioChart series={{ timestamp: history.timestamp, equity: history.equity }} />
      ) : null}

      <div className="overview-foot">
        <div className="kv"><span>Buying power</span><strong>${buyingPower}</strong></div>
        <div className="kv"><span>Cash</span><strong>${account ? Number(account.cash).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—"}</strong></div>
      </div>
    </div>
  );
}
