"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import { THEMES, type ThemeId } from "@/lib/themes";

export default function ThemeSwitcher({ value, onChange }: { value: ThemeId; onChange: (t: ThemeId) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = THEMES.find((t) => t.id === value) ?? THEMES[0];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  async function pick(id: ThemeId) {
    onChange(id); // optimistic — apply the theme immediately
    setErr(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setErr("Not signed in — theme not saved.");
      return;
    }
    const { error } = await supabase.from("profiles").upsert({ id: user.id, theme: id });
    if (error) {
      setErr(errorMessage(error, "Could not save theme"));
      return; // keep the menu open so the error is visible
    }
    setOpen(false);
  }

  return (
    <div className="theme-switch" ref={ref}>
      <button className="theme-trigger" onClick={() => setOpen((v) => !v)} type="button" aria-label="Change theme">
        <span className="theme-dot" style={{ background: current.swatch }} />
        <span className="theme-label">{current.label}</span>
        <span aria-hidden style={{ opacity: 0.5 }}>▾</span>
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-item ${t.id === value ? "active" : ""}`} onClick={() => pick(t.id)} type="button" role="menuitem">
              <span className="theme-dot" style={{ background: t.swatch }} />
              <span>{t.label}</span>
              {t.id === value && <span style={{ marginLeft: "auto", opacity: 0.6 }}>✓</span>}
            </button>
          ))}
          {err && <div className="theme-err">{err}</div>}
        </div>
      )}
    </div>
  );
}
