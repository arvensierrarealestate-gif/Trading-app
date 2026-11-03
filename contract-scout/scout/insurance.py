"""Insurance and bonding analysis.

Compares limits stated in a solicitation with VERIFIED limits in the profile.
Nothing here guesses a limit; a missing figure on either side yields UNKNOWN.
"""
from __future__ import annotations

import re
from typing import Optional

from .models import CheckOutcome, MET, NOT_MET, UNKNOWN, NOT_APPLICABLE, VERIFIED, MISSING
from .profile import fact

# map keywords in a requirement to profile coverage keys
COVERAGE_KEYS = [
    ("general liability", "insurance.general_liability"),
    ("cgl", "insurance.general_liability"),
    ("auto", "insurance.automobile_liability"),
    ("vehicle", "insurance.automobile_liability"),
    ("umbrella", "insurance.umbrella"),
    ("excess", "insurance.umbrella"),
    ("workers", "insurance.workers_compensation"),
    ("professional", "insurance.professional_liability"),
    ("errors and omissions", "insurance.professional_liability"),
    ("pollution", "insurance.pollution_liability"),
    ("cyber", "insurance.cyber_liability"),
]


def parse_amount(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    m = re.search(r"([\d,]+(?:\.\d+)?)\s*(million|m\b|k\b)?", str(value), re.I)
    if not m:
        return None
    n = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "").lower()
    if unit.startswith("m"):
        n *= 1_000_000
    elif unit.startswith("k"):
        n *= 1_000
    return n


def parse_percent(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    m = re.search(r"(\d{1,3}(?:\.\d+)?)\s*%", str(value))
    return float(m.group(1)) if m else None


def coverage_key_for(text: str) -> Optional[str]:
    t = text.lower()
    for kw, key in COVERAGE_KEYS:
        if kw in t:
            return key
    return None


def check_insurance(req: dict, profile: dict) -> CheckOutcome:
    key = coverage_key_for(req.get("text", "") + " " + (req.get("quote") or ""))
    required = parse_amount(req.get("value"))
    base = dict(category="insurance", requirement=req["text"], mandatory=bool(req.get("mandatory", True)),
                page_ref=req.get("page_ref", ""), document=req.get("document", ""))
    if key is None:
        return CheckOutcome(result=UNKNOWN, explanation="Could not map this coverage to a profile field; review manually.",
                            remedy="Confirm coverage type with insurance agent.", **base)
    f_occ = fact(profile, f"{key}.per_occurrence")
    f_carried = fact(profile, f"{key}.carried")
    if f_carried.status != VERIFIED and f_occ.status != VERIFIED:
        return CheckOutcome(result=UNKNOWN, explanation=f"Profile has no verified record for {key.split('.')[-1].replace('_', ' ')}.",
                            profile_fact_status=MISSING, remedy="Obtain a certificate of insurance and record the limit in the profile.",
                            partner_path=True, **base)
    if required is None:
        # requirement exists but no numeric limit stated
        if f_carried.status == VERIFIED and f_carried.value:
            return CheckOutcome(result=MET, explanation="Coverage is carried (verified); solicitation states no limit. Confirm limit with the agency.",
                                profile_fact_status=VERIFIED, **base)
        return CheckOutcome(result=UNKNOWN, explanation="Solicitation names the coverage without a limit; verify required limit.",
                            profile_fact_status=f_carried.status, **base)
    have = parse_amount(f_occ.value) if f_occ.status == VERIFIED else None
    if have is None:
        return CheckOutcome(result=UNKNOWN, explanation=f"Required ${required:,.0f}; profile limit is not verified.",
                            profile_fact_status=f_occ.status, remedy="Record verified per-occurrence limit from the policy declarations.", **base)
    if have >= required:
        return CheckOutcome(result=MET, explanation=f"Required ${required:,.0f} per occurrence; profile shows ${have:,.0f} (verified).",
                            profile_fact_status=VERIFIED, **base)
    return CheckOutcome(result=NOT_MET, explanation=f"Required ${required:,.0f} per occurrence; profile shows ${have:,.0f}.",
                        profile_fact_status=VERIFIED,
                        remedy=f"Ask agent to quote an increase to ${required:,.0f} (or an umbrella) before bidding.", partner_path=True, **base)


def check_bond(req: dict, profile: dict, contract_value: Optional[float]) -> CheckOutcome:
    text = (req.get("text") or "") + " " + (req.get("quote") or "")
    t = text.lower()
    base = dict(category="bond", requirement=req["text"], mandatory=bool(req.get("mandatory", True)),
                page_ref=req.get("page_ref", ""), document=req.get("document", ""))
    if re.search(r"no (bid|performance|payment) bond", t):
        return CheckOutcome(result=NOT_APPLICABLE, explanation="Solicitation states no bond is required.", profile_fact_status=NOT_APPLICABLE, **base)
    pct = parse_percent(req.get("value"))
    f_single = fact(profile, "bonding.single_project_limit")
    f_surety = fact(profile, "bonding.surety")
    if f_single.status != VERIFIED:
        return CheckOutcome(result=UNKNOWN, explanation="Bond required; profile has no verified surety bonding line.",
                            profile_fact_status=f_single.status,
                            remedy="Obtain a surety letter stating single-project and aggregate bonding capacity.", partner_path=True, **base)
    capacity = parse_amount(f_single.value)
    if pct is None or contract_value is None:
        return CheckOutcome(result=UNKNOWN, explanation=f"Bonding line verified (${capacity:,.0f}) but bond size cannot be computed: "
                            f"{'percentage not stated' if pct is None else 'contract value unknown'}.",
                            profile_fact_status=VERIFIED, remedy="Confirm bond percentage and estimated contract value.", **base)
    needed = contract_value * pct / 100.0
    if "bid bond" in t or "bid security" in t:
        needed = contract_value * pct / 100.0
    if capacity is not None and capacity >= (contract_value if "performance" in t or "payment" in t else needed):
        return CheckOutcome(result=MET, explanation=f"Bond of {pct:.0f}% on ~${contract_value:,.0f} = ${needed:,.0f}; verified bonding line ${capacity:,.0f}.",
                            profile_fact_status=VERIFIED, **base)
    return CheckOutcome(result=NOT_MET, explanation=f"Bond of {pct:.0f}% on ~${contract_value:,.0f} = ${needed:,.0f}; bonding line ${capacity or 0:,.0f} is insufficient.",
                        profile_fact_status=VERIFIED, remedy="Ask surety to raise the line, or pursue as a subcontractor under a bonded prime.",
                        partner_path=True, **base)


def bond_cost_estimate(contract_value: Optional[float], rate_pct: float = 2.0) -> Optional[float]:
    """Premium estimate for a performance+payment bond. Rate is an editable assumption."""
    if contract_value is None:
        return None
    return round(contract_value * rate_pct / 100.0, 2)
