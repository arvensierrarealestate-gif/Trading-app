"""Company-independent 100-point opportunity model.

Industry relevance and service accessibility 25 | Profitability potential 20 |
Qualification and entry barriers 20 | Operational feasibility 15 |
Financial exposure and working capital 10 | Competition and deadline readiness 10.

Insufficient information never earns points: it lowers the score and, past a
threshold, forces the class "Requires investigation".
"""
from __future__ import annotations

from typing import Optional

from . import deadlines, accessibility
from .models import INDUSTRIES

HIGH, MODERATE, LOW, INVESTIGATE = "High", "Moderate", "Low", "Requires investigation"


def score(opp: dict, requirements: list[dict], access: Optional[dict] = None, estimate: Optional[dict] = None, focus_industries: tuple[str, ...] = ()) -> dict:
    access = access or accessibility.analyze(opp, requirements)
    parts: list[dict] = []
    missing: list[str] = []

    def add(name, pts, maxpts, why):
        parts.append({"component": name, "points": round(pts, 1), "max": maxpts, "why": why})

    # 1. Industry relevance and service accessibility (25)
    ind = opp.get("industry") or "Other / Unclassified"
    known = ind in INDUSTRIES
    focus = (not focus_industries) or ind in focus_industries
    lic = next(a for a in access["answers"] if a["key"] == "licensing")
    base = 25 if (known and focus) else (15 if known else 8)
    if lic["barrier"] == "high":
        base -= 6
        lic_note = "; specialized licensing narrows who can bid"
    elif lic["barrier"] == "medium":
        base -= 3
        lic_note = "; a trade/business license is needed"
    else:
        lic_note = ""
    add("Industry relevance & accessibility", max(base, 0), 25, f"{ind}{' (tracked industry)' if known else ' (not a tracked industry)'}{lic_note}")

    # 2. Profitability potential (20)
    margin = (estimate or {}).get("gross_margin_pct")
    reliable = bool(estimate) and estimate.get("revenue") is not None and (estimate.get("total_cost_base") or 0) > 0
    if not reliable:
        add("Profitability potential", 6, 20, "No reliable estimate: revenue or costs missing; neutral-low until modeled")
        missing.append("cost/revenue model")
    elif margin >= 25:
        add("Profitability potential", 20, 20, f"Modeled base margin {margin}%")
    elif margin >= 15:
        add("Profitability potential", 14, 20, f"Modeled base margin {margin}%")
    elif margin >= 5:
        add("Profitability potential", 7, 20, f"Thin modeled margin {margin}%")
    else:
        add("Profitability potential", 0, 20, f"Modeled margin {margin}% is unprofitable")

    # 3. Qualification and entry barriers (20)
    eb = access["entry_barrier"]
    if eb == "low":
        add("Qualification & entry barriers", 20, 20, "Low barriers: no multi-year experience, professional license, or certification lock-out found")
    elif eb == "medium":
        add("Qualification & entry barriers", 12, 20, f"Medium barriers ({access['barrier_points']} barrier points)")
    elif eb == "high":
        add("Qualification & entry barriers", 3, 20, f"High barriers ({access['barrier_points']} barrier points)")
    else:
        add("Qualification & entry barriers", 6, 20, f"{access['unknown_count']} of 10 barrier questions unanswered by the documents")
        missing.append("qualification clauses")

    # 4. Operational feasibility (15)
    se = next(a for a in access["answers"] if a["key"] == "staffing_equipment")
    sub = next(a for a in access["answers"] if a["key"] == "subcontracting")
    value = opp.get("value_high") or opp.get("value_low")
    pts = 15
    why = []
    if se["barrier"] == "high":
        pts -= 7; why.append("heavy staffing/equipment")
    elif se["barrier"] == "medium":
        pts -= 3; why.append("some staffing/equipment rules")
    elif se["barrier"] == "unknown":
        pts -= 2; why.append("staffing not stated")
    if sub["barrier"] == "high":
        pts -= 5; why.append("subcontracting prohibited")
    elif sub["barrier"] == "low":
        why.append("subcontracting allowed")
    if value and value > 1_000_000:
        pts -= 3; why.append("large scale")
    add("Operational feasibility", max(pts, 0), 15, "; ".join(why) or "no operational obstacles found")

    # 5. Financial exposure and working capital (10)
    uc = next(a for a in access["answers"] if a["key"] == "upfront_capital")
    ib = next(a for a in access["answers"] if a["key"] == "insurance_bonds")
    pts = 10
    why = []
    if uc["barrier"] == "high":
        pts -= 5; why.append("large upfront commitment")
    elif uc["barrier"] == "medium":
        pts -= 2; why.append("30-60 day float")
    elif uc["barrier"] == "unknown":
        pts -= 3; why.append("value not published")
        missing.append("contract value")
    if ib["barrier"] == "high":
        pts -= 4; why.append("bonds/high insurance limits")
    elif ib["barrier"] == "medium":
        pts -= 1
    wc = (estimate or {}).get("working_capital_needed")
    if wc and value and wc > 0.25 * value:
        pts -= 2; why.append(f"working capital ~{100 * wc / value:.0f}% of value")
    add("Financial exposure & working capital", max(pts, 0), 10, "; ".join(why) or "limited exposure")

    # 6. Competition and deadline readiness (10)
    d = deadlines.days_until(opp.get("bid_deadline_utc"))
    sa = (opp.get("set_aside") or "").lower()
    ab = (opp.get("award_basis") or "").lower()
    pts = 10
    why = []
    if d is None:
        pts -= 4; why.append("deadline not on file")
        missing.append("deadline")
    elif d < 0:
        pts = 0; why.append("deadline passed")
    elif d < 7:
        pts -= 5; why.append(f"{d:.0f} days left")
    elif d < 14:
        pts -= 2; why.append(f"{d:.0f} days left")
    else:
        why.append(f"{d:.0f} days to prepare")
    if "small business reserve" in sa or "cbe" in sa:
        why.append("set-aside limits competition to certified firms")
    elif ab == "lowest price":
        why.append("low-bid award: price decides")
    elif ab == "best value":
        pts -= 1; why.append("best-value award favours proven firms")
    add("Competition & deadline readiness", max(pts, 0), 10, "; ".join(why))

    total = round(sum(p["points"] for p in parts), 1)
    unknown_q = access["unknown_count"]
    if (unknown_q >= 5) or (len(missing) >= 3) or not requirements:
        potential = INVESTIGATE
        total = min(total, 59.0)
    elif total >= 70 and access["entry_barrier"] in ("low", "medium"):
        potential = HIGH
    elif total >= 45:
        potential = MODERATE
    else:
        potential = LOW
    return {"score": total, "potential": potential, "parts": parts, "missing": missing, "access": access}
