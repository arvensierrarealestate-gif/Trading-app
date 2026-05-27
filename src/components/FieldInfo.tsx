"use client";

import { useEffect, useRef, useState } from "react";

export default function FieldInfo({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (!text) return null;

  return (
    <span ref={root} className="field-info-wrap">
      <button
        type="button"
        className={`field-info-btn ${open ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Why this value"
      >
        ⓘ
      </button>
      {open && (
        <span className="field-info-pop" role="dialog">
          {text}
        </span>
      )}
    </span>
  );
}
