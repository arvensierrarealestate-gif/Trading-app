"""Bid-package checklist builder.

Combines three sources into one actionable list per opportunity:
1. Standard Maryland forms and their usual timing (docs/maryland_procurement_notes.md).
2. Submission, meeting, bond, insurance and experience items the document reader found (with page refs).
3. Profile gaps from the latest qualification run (items to resolve before bidding).
Every item records where it came from. Nothing here is a legal determination; the
solicitation's own attachment table controls.
"""
from __future__ import annotations

import re
from typing import Optional

from . import db

STAGES = ("before_bid", "with_bid", "at_award", "after_award")
STAGE_LABELS = {"before_bid": "Before you bid", "with_bid": "Submit with the bid", "at_award": "At award", "after_award": "After award"}

STATE_SIGNS = ("maryland", "state of", "department of", "university", "usm", "mdot", "dgs", "administration", "commission", "authority", "public schools", "board of education")


def _is_state_or_emma(opp: dict) -> bool:
    text = " ".join(str(opp.get(k) or "") for k in ("agency", "jurisdiction", "source_id", "source_url")).lower()
    return "emma" in text or any(s in text for s in STATE_SIGNS)


def build_items(opp: dict, requirements: list[dict], evaluation: Optional[dict]) -> list[dict]:
    items: list[dict] = []

    def add(text: str, stage: str, source: str, note: str = ""):
        key = (stage, text.strip().lower()[:120])
        if any((i["stage"], i["text"].strip().lower()[:120]) == key for i in items):
            return
        items.append({"text": text.strip(), "stage": stage, "source": source, "note": note})

    reqs = requirements or []
    cats = {r.get("category") for r in reqs}
    alltext = " ".join((r.get("text") or "") + " " + (r.get("quote") or "") for r in reqs).lower()
    state = _is_state_or_emma(opp)
    std = "Standard Maryland form" if state else "Standard form (confirm local equivalent)"

    # --- profile gaps first: these decide whether to bid at all
    if evaluation:
        for c in evaluation.get("checks", []):
            if c.get("mandatory") and c.get("result") in ("NOT_MET", "UNKNOWN"):
                where = f"{c.get('document', '')} {c.get('page_ref', '')}".strip()
                add(f"Resolve: {c.get('requirement', '')[:140]}", "before_bid", f"Qualification check ({c.get('result')})" + (f", {where}" if where else ""), c.get("remedy", ""))

    # --- meetings and deadlines
    for r in reqs:
        if r.get("category") == "meeting":
            add(("Attend mandatory " if r.get("mandatory") else "Consider attending ") + "pre-bid meeting / site visit: " + (r.get("text") or "")[:160],
                "before_bid", f"Solicitation {r.get('document', '')} {r.get('page_ref', '')}".strip())
    if opp.get("bid_deadline_local"):
        add(f"Submit before the deadline: {opp['bid_deadline_local']} ({opp.get('deadline_tz') or 'local'})", "with_bid", "Solicitation deadline on file")
    else:
        add("Confirm the bid deadline and submission method (not found in the documents)", "before_bid", "Deadline MISSING")

    # --- standard forms
    add("Bid/Proposal Affidavit, signed by the authorized signer", "with_bid", std)
    add("Price form / bid schedule, completed exactly as issued", "with_bid", std)
    add("Acknowledge all amendments/addenda on the bid form", "with_bid", std, "The bot logs amendments on the Documents & changes tab")
    if re.search(r"\bmbe\b", alltext) or "minority business" in alltext:
        add("MBE Utilization and Fair Solicitation Affidavit (Attachment D-1A) with MBE participation schedule", "with_bid", std, "Line up certified MBE subs before bidding if a goal applies")
        add("MBE Outreach Efforts (D-2) and Subcontractor Project Participation (D-3) forms", "at_award", std, "Usually due within ~10 working days of recommended award")
        add("Monthly MBE payment reports (D-4 prime, D-5 subcontractor)", "after_award", std)
    if "living wage" in alltext or "prevailing wage" in alltext:
        add("Living Wage Requirements Affidavit of Agreement (or prevailing-wage certification as stated)", "with_bid", std)
    if "mercury" in alltext:
        add("Mercury Affidavit", "with_bid", std)
    add("Contract Affidavit", "at_award", std, "Often due within 5 working days of notice of recommended award")
    add("Certificate of Insurance naming the agency as additional insured at the required limits", "at_award", std, "Ask the agent as soon as the bid is submitted")
    if re.search(r"\bbid (bond|security|guaranty)", alltext) and not re.search(r"\bno bid (bond|security|guaranty)", alltext):
        add("Bid bond / bid security in the stated percentage", "with_bid", "Solicitation bond clause")
    if re.search(r"\b(performance|payment) bond", alltext) and not re.search(r"\bno (performance|payment) bond", alltext):
        add("Performance and payment bonds in the stated percentage", "at_award", "Solicitation bond clause", "Needs a surety relationship in place before bidding")

    # --- document-specific submission items
    for r in reqs:
        cat = r.get("category")
        src = f"Solicitation {r.get('document', '')} {r.get('page_ref', '')}".strip()
        txt = (r.get("text") or "").strip()
        if cat == "submission":
            add(txt[:180], "with_bid", src)
        elif cat == "experience":
            add("Experience/references package: " + txt[:150], "with_bid", src)
        elif cat == "financial":
            add("Financial documentation: " + txt[:150], "with_bid", src)
        elif cat == "license":
            add("Copy of required license/certification: " + txt[:150], "with_bid", src)
        elif cat == "staffing":
            add("Staffing plan / key personnel / background-check evidence: " + txt[:140], "with_bid", src)
    if state:
        add("Confirm eMMA vendor registration is active and the bid is submitted through the method the solicitation names", "before_bid", "eMMA requirement")
    if "small business reserve" in alltext or re.search(r"\bsbr\b", alltext):
        add("Confirm SBR self-certification is current in the eMMA profile (renews annually)", "before_bid", "SBR designation in solicitation")
    add("Executed contract, W-9 and payment set-up (vendor registration with the paying agency)", "at_award", std)
    order = {s: i for i, s in enumerate(STAGES)}
    items.sort(key=lambda i: order.get(i["stage"], 9))
    return items


def sync(conn, opp_id: int, items: list[dict]) -> int:
    """Insert new items, keep done-state on existing ones (matched by stage+text). Returns count on file."""
    existing = {(r["stage"], r["text"].strip().lower()[:120]): r for r in db.list_checklist(conn, opp_id)}
    n = 0
    for it in items:
        key = (it["stage"], it["text"].strip().lower()[:120])
        if key not in existing:
            db.add_checklist_item(conn, opp_id, it["text"], it["stage"], it["source"], it.get("note", ""))
            n += 1
    return len(db.list_checklist(conn, opp_id))


def as_markdown(opp: dict, items: list[dict]) -> str:
    lines = [f"# Bid package checklist: {opp.get('title')}", f"Solicitation {opp.get('solicitation_number') or 'n/a'} | {opp.get('agency') or ''} | due {opp.get('bid_deadline_local') or 'unknown'}", ""]
    for stage in STAGES:
        group = [i for i in items if i["stage"] == stage]
        if not group:
            continue
        lines.append(f"## {STAGE_LABELS[stage]}")
        for i in group:
            box = "[x]" if i.get("done") else "[ ]"
            lines.append(f"- {box} {i['text']}  _({i['source']})_" + (f" {i['note']}" if i.get("note") else ""))
        lines.append("")
    lines.append("Generated by Maryland Contract Scout. The solicitation's own attachment table controls; verify each item against it.")
    return "\n".join(lines)
