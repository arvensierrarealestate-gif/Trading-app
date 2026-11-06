"""Commercial attractiveness score (0-100), separate from the qualification class.

Qualification answers "may we and can we"; this answers "is it worth it". Every
component is explained so the number is never a black box. Inputs that are
missing score neutral, never favourable.
"""
from __future__ import annotations

from typing import Optional

from . import deadlines
from .models import STRONG, CONDITIONAL, POOR, VERIFIED

SMALL_PROCUREMENT_MAX = 100_000  # Maryland small-procurement ceiling (HB 543, 2023); DC small purchase rules differ


def score(opp: dict, evaluation: Optional[dict], estimate: Optional[dict], can_do: tuple[str, ...], profile: dict) -> tuple[float, list[dict]]:
    parts: list[dict] = []

    def add(name, pts, maxpts, why):
        parts.append({"component": name, "points": round(pts, 1), "max": maxpts, "why": why})

    # 1. Industry fit (25)
    ind = opp.get("industry") or ""
    if ind in can_do:
        add("Industry fit", 25, 25, f"{ind} is in the entity's can-do list")
    else:
        add("Industry fit", 5, 25, f"{ind or 'Unclassified'} is outside the can-do list")

    # 2. Contract size (20)
    value = opp.get("value_high") or opp.get("value_low")
    if value is None:
        add("Contract size", 8, 20, "Value not published; neutral")
    elif value < 25_000:
        add("Contract size", 10, 20, f"${value:,.0f} is small; low revenue but easy entry")
    elif value <= 250_000:
        add("Contract size", 20, 20, f"${value:,.0f} is in the sweet spot for a young entity")
    elif value <= 1_000_000:
        add("Contract size", 14, 20, f"${value:,.0f} is sizeable; needs bonding and working capital")
    else:
        add("Contract size", 8, 20, f"${value:,.0f} is large for current capacity")

    # 3. Margin (20)
    margin = (estimate or {}).get("gross_margin_pct")
    if margin is None:
        add("Estimated margin", 8, 20, "No cost estimate yet; neutral")
    elif margin >= 25:
        add("Estimated margin", 20, 20, f"Base margin {margin}%")
    elif margin >= 15:
        add("Estimated margin", 14, 20, f"Base margin {margin}%")
    elif margin >= 5:
        add("Estimated margin", 8, 20, f"Base margin {margin}% is thin")
    else:
        add("Estimated margin", 0, 20, f"Base margin {margin}% is unprofitable")

    # 4. Deadline runway (15)
    d = deadlines.days_until(opp.get("bid_deadline_utc"))
    if d is None:
        add("Deadline runway", 7, 15, "Deadline not on file; neutral")
    elif d < 0:
        add("Deadline runway", 0, 15, "Deadline has passed")
    elif d >= 14:
        add("Deadline runway", 15, 15, f"{d:.0f} days to prepare")
    elif d >= 7:
        add("Deadline runway", 10, 15, f"{d:.0f} days; tight but workable")
    elif d >= 3:
        add("Deadline runway", 5, 15, f"{d:.0f} days; very tight")
    else:
        add("Deadline runway", 1, 15, f"{d:.1f} days; almost no time")

    # 5. Access advantage (10): small procurement, set-aside the entity holds, DC CBE
    checks = (evaluation or {}).get("checks", [])
    text = " ".join(c.get("requirement", "") for c in checks).lower() + " " + (opp.get("set_aside") or "").lower()
    sbr = "small business reserve" in text or " sbr" in text
    cbe = "certified business enterprise" in text or " cbe" in text
    if value is not None and value <= SMALL_PROCUREMENT_MAX and (opp.get("jurisdiction") or "Maryland") == "Maryland":
        add("Access advantage", 10, 10, "Under the Maryland small-procurement ceiling; simplified process, fewer competitors")
    elif sbr or cbe:
        held = any(c.get("category") == "eligibility" and c.get("result") == "MET" and ("sbr" in c.get("requirement", "").lower() or "small business reserve" in c.get("requirement", "").lower() or "cbe" in c.get("requirement", "").lower()) for c in checks)
        add("Access advantage", 10 if held else 3, 10, "Set-aside procurement and the entity holds the certification" if held else "Set-aside procurement but certification not verified")
    else:
        add("Access advantage", 6, 10, "Open competition")

    # 6. Risk and bonding (10)
    bond_req = any(c.get("category") == "bond" and c.get("result") in ("MET", "NOT_MET", "UNKNOWN") for c in checks)
    bond_ok = any(c.get("category") == "bond" and c.get("result") == "MET" for c in checks)
    risk_hits = sum(1 for c in checks if c.get("category") == "risk")
    if not bond_req:
        pts, why = 10, "No bond required"
    elif bond_ok:
        pts, why = 8, "Bond required and bonding capacity verified"
    else:
        pts, why = 2, "Bond required and no verified bonding line"
    pts = max(0, pts - 2 * risk_hits)
    if risk_hits:
        why += f"; {risk_hits} risk clause(s) such as liquidated damages or prevailing wage"
    add("Risk and bonding", pts, 10, why)

    # award basis: a young entity competes better on price than on past-performance scoring
    ab = (opp.get("award_basis") or "").lower()
    exp_gap = any(c.get("category") == "experience" and c.get("result") in ("NOT_MET", "UNKNOWN") for c in checks)
    if ab == "best value" and exp_gap:
        add("Award basis", -4, 0, "Best-value award with unverified experience: technical scoring will favour incumbents")
    elif ab == "lowest price":
        add("Award basis", 0, 0, "Lowest-price award: price competitiveness decides")
    total = round(sum(p["points"] for p in parts), 1)
    mc = (evaluation or {}).get("match_class")
    if mc == POOR:
        total = round(min(total, 35.0), 1)
        parts.append({"component": "Cap", "points": 0, "max": 0, "why": "Poor Match caps the score at 35"})
    return total, parts
