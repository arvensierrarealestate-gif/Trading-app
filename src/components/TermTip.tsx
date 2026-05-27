"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { findTerm } from "@/lib/academy";
import { useAcademy } from "./AcademyContext";

export default function TermTip({ term, children }: { term: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const { openAcademy } = useAcademy();
  const entry = findTerm(term);

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

  if (!entry) return <>{children}</>;

  return (
    <span ref={root} className="term-tip-wrap">
      <button
        type="button"
        className={`term-tip-trigger ${open ? "active" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
      >
        {children}
      </button>
      {open && (
        <span className="term-tip-pop" role="dialog">
          <span className="term-tip-name">{entry.name}</span>
          <span className="term-tip-def">{entry.short}</span>
          <span className="term-tip-why">{entry.why}</span>
          <button
            type="button"
            className="term-tip-more"
            onClick={() => {
              setOpen(false);
              openAcademy(entry.id);
            }}
          >
            Learn more →
          </button>
        </span>
      )}
    </span>
  );
}
