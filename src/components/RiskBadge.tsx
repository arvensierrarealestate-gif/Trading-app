"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import type { SOP } from "@/lib/types";

const RISK_OPTIONS = ["1%", "1.5%", "2%", "3%"];

// Header risk badge that doubles as a quick risk-adjuster for learners.
// Clicking it opens a small menu (1% / 1.5% / 2% / 3%). Picking a value
// updates SOP state and, if the SOP is already saved, persists to Supabase
// on the fly so the change survives a refresh.
export default function RiskBadge({
  sop,
  sopSaved,
  onChange,
}: {
  sop: SOP;
  sopSaved: boolean;
  onChange: (next: SOP) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  async function pick(v: string) {
    const next = { ...sop, risk: v };
    onChange(next);
    setOpen(false);
    setErr(null);
    if (!sopSaved) return; // no DB row yet — local change is enough until they save
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from("sops")
        .upsert({ user_id: user.id, ...next, updated_at: new Date().toISOString() });
      if (error) setErr(errorMessage(error));
    } catch (e) {
      setErr(errorMessage(e));
    }
  }

  const aboveSafe = parseFloat(sop.risk) > 1;

  return (
    <div className="risk-badge-wrap" ref={ref}>
      <button
        type="button"
        className={`shield-badge risk-badge-trigger ${aboveSafe ? "warn" : ""} ${open ? "active" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden>🛡</span>
        {aboveSafe ? `${sop.risk} max risk per trade` : `Protected — ${sop.risk} max risk per trade`}
        <span aria-hidden style={{ opacity: 0.55 }}>▾</span>
      </button>
      {open && (
        <div className="risk-badge-menu" role="menu">
          {RISK_OPTIONS.map((v) => {
            const isAbove = v !== "1%";
            const active = sop.risk === v;
            return (
              <button
                key={v}
                type="button"
                role="menuitem"
                className={`risk-badge-item ${active ? "active" : ""} ${isAbove ? "above" : ""}`}
                onClick={() => pick(v)}
              >
                <span className="risk-badge-val">{v}</span>
                {isAbove && <span className="risk-badge-warn">↑ raises your risk</span>}
                {active && <span className="risk-badge-check">✓</span>}
              </button>
            );
          })}
          <div className="risk-badge-foot">
            1% is the protective default. Anything higher increases what you can lose on a single trade.
          </div>
        </div>
      )}
      {err && <div className="risk-badge-err">Could not save: {err}</div>}
    </div>
  );
}
