"use client";

import { useEffect, useState } from "react";
import PortfolioOverview from "./PortfolioOverview";
import PositionRow from "./PositionRow";
import type { SOP } from "@/lib/types";

type Position = {
  symbol: string;
  qty: string;
  side: string;
  avg_entry_price: string;
  current_price: string | null;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
};

export default function HomeDashboard({ sop }: { sop: SOP }) {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [equity, setEquity] = useState<number>(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pos, acct] = await Promise.allSettled([
        fetch("/api/alpaca/positions").then((r) => r.json()),
        fetch("/api/alpaca/account").then((r) => r.json()),
      ]);
      if (cancelled) return;
      if (pos.status === "fulfilled" && Array.isArray(pos.value.positions)) setPositions(pos.value.positions);
      else if (pos.status === "fulfilled" && pos.value.error) setErr(pos.value.error);
      if (acct.status === "fulfilled" && acct.value.account?.equity) setEquity(Number(acct.value.account.equity));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="home-dash">
      <PortfolioOverview />

      <div className="dash-card">
        <div className="card-header">
          <div className="card-title"><div className="card-title-icon">▦</div> Current positions</div>
          <div className="card-meta">{positions?.length ?? 0} open</div>
        </div>
        {err ? (
          <div className="empty-state error"><div>{err}</div></div>
        ) : positions === null ? (
          <div className="empty-state"><div>Loading positions…</div></div>
        ) : positions.length === 0 ? (
          <div className="empty-state"><div>No open positions in your Alpaca paper account.</div></div>
        ) : (
          <div className="positions-list">
            {positions.map((p) => (
              <PositionRow key={p.symbol} pos={p} sop={sop} accountEquity={equity} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
