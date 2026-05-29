"use client";

import { useEffect, useMemo, useState } from "react";
import { RULES, STRATEGIES, TERMS, type Term } from "@/lib/academy";

type Section = "terms" | "strategies" | "rules";

const CATEGORY_LABEL: Record<Term["category"], string> = {
  indicator: "Indicators",
  concept: "Concepts",
  options: "Options",
  risk: "Risk management",
  regime: "Market regime",
};

const READ_KEY = "academy_read";

export default function AcademyView({ anchorTermId }: { anchorTermId?: string | null }) {
  const [section, setSection] = useState<Section>("terms");
  const [query, setQuery] = useState("");
  const [read, setRead] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(READ_KEY);
      if (raw) setRead(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  function toggleRead(id: string) {
    setRead((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(READ_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  const readCount = TERMS.filter((t) => read.has(t.id)).length;

  // When opened via TermTip "Learn more", jump to the Terms tab + scroll to that anchor.
  useEffect(() => {
    if (!anchorTermId) return;
    setSection("terms");
    setQuery("");
    const t = setTimeout(() => {
      const el = document.getElementById(`term-${anchorTermId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        el.classList.add("term-highlight");
        setTimeout(() => el.classList.remove("term-highlight"), 1800);
      }
    }, 40);
    return () => clearTimeout(t);
  }, [anchorTermId]);

  const filteredTerms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TERMS;
    return TERMS.filter(
      (t) => t.name.toLowerCase().includes(q) || t.short.toLowerCase().includes(q) || t.why.toLowerCase().includes(q),
    );
  }, [query]);

  const grouped = useMemo(() => {
    const out: Record<Term["category"], Term[]> = { indicator: [], concept: [], options: [], risk: [], regime: [] };
    for (const t of filteredTerms) out[t.category].push(t);
    return out;
  }, [filteredTerms]);

  return (
    <div className="academy-view">
      <div className="academy-head">
        <div className="academy-title">
          <span className="card-title-icon">📖</span>
          <span>Trading Academy</span>
        </div>
        <div className="academy-sub">Plain-English definitions, playbooks, and the reasoning behind every rule in this app.</div>
        <div className="academy-progress">
          <div className="academy-progress-track">
            <div className="academy-progress-fill" style={{ width: `${Math.round((readCount / TERMS.length) * 100)}%` }} />
          </div>
          <span className="academy-progress-label">{readCount} / {TERMS.length} terms read</span>
        </div>
      </div>

      <div className="academy-tabs" role="tablist">
        {(["terms", "strategies", "rules"] as Section[]).map((s) => (
          <button
            key={s}
            className={`academy-tab ${section === s ? "active" : ""}`}
            onClick={() => setSection(s)}
            type="button"
            role="tab"
          >
            {s === "terms" ? "Terms" : s === "strategies" ? "Strategy guides" : "Rules & guidelines"}
          </button>
        ))}
      </div>

      {section === "terms" && (
        <>
          <input
            className="academy-search"
            type="search"
            placeholder="Search terms — e.g. delta, drawdown, regime…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filteredTerms.length === 0 ? (
            <div className="empty-state"><div>No terms match &ldquo;{query}&rdquo;.</div></div>
          ) : (
            (Object.keys(grouped) as Term["category"][]).map((cat) =>
              grouped[cat].length === 0 ? null : (
                <div key={cat} className="academy-group">
                  <div className="academy-group-label">{CATEGORY_LABEL[cat]}</div>
                  <div className="academy-terms">
                    {grouped[cat].map((t) => (
                      <div key={t.id} id={`term-${t.id}`} className="academy-term">
                        <div className="academy-term-top">
                          <div className="academy-term-name">{t.name}</div>
                          <button
                            type="button"
                            className={`academy-read-btn ${read.has(t.id) ? "done" : ""}`}
                            onClick={() => toggleRead(t.id)}
                          >
                            {read.has(t.id) ? "✓ Read" : "Mark read"}
                          </button>
                        </div>
                        <div className="academy-term-def">{t.short}</div>
                        <div className="academy-term-why"><strong>Why it matters · </strong>{t.why}</div>
                        <div className="academy-term-ex"><strong>Example · </strong>{t.example}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            )
          )}
        </>
      )}

      {section === "strategies" && (
        <div className="academy-strategies">
          {STRATEGIES.map((s) => (
            <div key={s.id} id={`strategy-${s.id}`} className="academy-strategy">
              <div className="academy-strategy-name">{s.name}</div>
              <div className="academy-strategy-summary">{s.summary}</div>
              <ol className="academy-steps">
                {s.steps.map((step, i) => (
                  <li key={i}><span className="academy-step-num">Step {i + 1}</span><span>{step}</span></li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {section === "rules" && (
        <div className="academy-rules">
          {RULES.map((r) => (
            <div key={r.id} id={`rule-${r.id}`} className="academy-rule">
              <div className="academy-rule-title">{r.title}</div>
              <div className="academy-rule-body">{r.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
