"""Eligibility and Compliance Engine.

Compares extracted requirements with the company profile and classifies the
opportunity. Rules that matter:
* Only VERIFIED profile facts satisfy a requirement.
* Owner or affiliate experience never satisfies a mandatory experience rule.
* Any mandatory requirement that is UNKNOWN blocks Strong Match.
* Core categories with nothing found in the documents are recorded as UNKNOWN.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Optional

from .insurance import check_insurance, check_bond, parse_amount
from .models import (CheckOutcome, MET, NOT_MET, UNKNOWN, NOT_APPLICABLE, VERIFIED, MISSING,
                     STRONG, CONDITIONAL, POOR, CORE_MANDATORY_CATEGORIES)
from .profile import fact, entity_experience, supporting_experience

LICENSE_KEYWORDS = {
    "MHIC": ["mhic", "home improvement"],
    "Master Electrician": ["electrician", "electrical license"],
    "Master Plumber": ["plumber", "plumbing license"],
    "HVACR": ["hvac"],
    "Food Service License": ["food service", "health department", "servsafe", "food handler", "food manager"],
    "Business License": ["business license"],
    "Contractor License": ["contractor's license", "contractors license", "trade license"],
}


def _years_in_business(profile: dict, as_of: Optional[date] = None) -> Optional[float]:
    f = fact(profile, "entity.formation_date")
    if f.status != VERIFIED or not f.value:
        return None
    try:
        y, m, d = (int(x) for x in str(f.value)[:10].split("-"))
    except ValueError:
        return None
    as_of = as_of or date.today()
    return (as_of - date(y, m, d)).days / 365.25


def _required_years(value: Optional[str], text: str) -> Optional[float]:
    for src in (value or "", text):
        m = re.search(r"(\d+(?:\.\d+)?)\s*years?", src, re.I)
        if m:
            return float(m.group(1))
    return None


def check_eligibility(req: dict, profile: dict) -> CheckOutcome:
    t = (req.get("text", "") + " " + (req.get("quote") or "")).lower()
    base = dict(category="eligibility", requirement=req["text"], mandatory=bool(req.get("mandatory", True)),
                page_ref=req.get("page_ref", ""), document=req.get("document", ""))
    if "emma" in t or "emaryland" in t:
        f = fact(profile, "registrations.emma_vendor")
        if f.status == VERIFIED and f.value:
            return CheckOutcome(result=MET, explanation="eMMA vendor registration verified.", profile_fact_status=VERIFIED, **base)
        return CheckOutcome(result=UNKNOWN if f.status == MISSING else NOT_MET, explanation="eMMA vendor registration not verified in profile.",
                            profile_fact_status=f.status, remedy="Register the entity on eMMA (free) and record the vendor number.", **base)
    if "small business reserve" in t or re.search(r"\bsbr\b", t):
        f = fact(profile, "registrations.sbr_certified")
        if f.status == VERIFIED and f.value:
            return CheckOutcome(result=MET, explanation="SBR certification verified.", profile_fact_status=VERIFIED, **base)
        return CheckOutcome(result=UNKNOWN if f.status == MISSING else NOT_MET,
                            explanation="Solicitation is a Small Business Reserve procurement; SBR status not verified.",
                            profile_fact_status=f.status, remedy="Self-certify for SBR on eMMA if the entity meets size standards.", **base)
    if "mbe" in t or "minority business" in t:
        f = fact(profile, "registrations.mbe_certified")
        pct = re.search(r"(\d{1,3})\s?%", t)
        note = f" MBE participation goal {pct.group(1)}%." if pct else ""
        if f.status == VERIFIED and f.value:
            return CheckOutcome(result=MET, explanation=f"MBE certification verified.{note}", profile_fact_status=VERIFIED, **base)
        # MBE goals are usually met via subcontracting, so this is a condition, not a disqualifier
        return CheckOutcome(result=UNKNOWN, explanation=f"MBE goal applies.{note} Entity MBE status not verified; goal can often be met with certified subcontractors.",
                            profile_fact_status=f.status, remedy="Plan MBE subcontracting or apply for MDOT MBE certification.", partner_path=True, **base)
    if "good standing" in t or "sdat" in t or "assessments and taxation" in t:
        f = fact(profile, "entity.good_standing")
        if f.status == VERIFIED and f.value:
            return CheckOutcome(result=MET, explanation="SDAT good standing verified.", profile_fact_status=VERIFIED, **base)
        return CheckOutcome(result=UNKNOWN if f.status == MISSING else NOT_MET, explanation="Good standing with Maryland SDAT not verified.",
                            profile_fact_status=f.status, remedy="Pull a Certificate of Status from Maryland Business Express.", **base)
    if "sam.gov" in t or "uei" in t or "system for award management" in t:
        f = fact(profile, "registrations.sam_uei")
        if f.status == VERIFIED and f.value:
            return CheckOutcome(result=MET, explanation="SAM.gov registration verified.", profile_fact_status=VERIFIED, **base)
        return CheckOutcome(result=UNKNOWN if f.status == MISSING else NOT_MET, explanation="SAM.gov / UEI registration not verified.",
                            profile_fact_status=f.status, remedy="Register at SAM.gov (free).", **base)
    if "local preference" in t or "located within" in t or "principal office" in t:
        return CheckOutcome(result=UNKNOWN, explanation="Location-based preference or restriction stated; confirm whether the entity's address qualifies.",
                            profile_fact_status=fact(profile, "entity.principal_address").status, **base)
    return CheckOutcome(result=UNKNOWN, explanation="Eligibility rule found but not recognised; review manually.", **base)


def check_experience(req: dict, profile: dict, industry: Optional[str]) -> CheckOutcome:
    base = dict(category="experience", requirement=req["text"], mandatory=bool(req.get("mandatory", True)),
                page_ref=req.get("page_ref", ""), document=req.get("document", ""))
    years_req = _required_years(req.get("value"), req.get("text", ""))
    own = entity_experience(profile, industry)
    own_verified = [e for e in own if (e.get("status") == VERIFIED)]
    support = supporting_experience(profile, industry)
    if years_req is not None:
        yib = _years_in_business(profile)
        if yib is None:
            return CheckOutcome(result=UNKNOWN, explanation=f"Requires {years_req:g} years; entity formation date not verified.",
                                profile_fact_status=MISSING, remedy="Record verified formation date from SDAT filing.", partner_path=True, **base)
        if yib >= years_req and own_verified:
            return CheckOutcome(result=MET, explanation=f"Requires {years_req:g} years; entity has {yib:.1f} years and {len(own_verified)} verified project(s) in this industry.",
                                profile_fact_status=VERIFIED, **base)
        if yib >= years_req and not own_verified:
            return CheckOutcome(result=UNKNOWN, explanation=f"Entity age {yib:.1f} years meets {years_req:g}, but no verified projects performed by the entity in this industry. "
                                f"{len(support)} owner/affiliate project(s) are supporting context only.",
                                profile_fact_status=MISSING, remedy="Document entity-performed projects or team with an experienced partner.", partner_path=True, **base)
        return CheckOutcome(result=NOT_MET, explanation=f"Requires {years_req:g} years; entity has {yib:.1f} years. Owner/affiliate history does not transfer.",
                            profile_fact_status=VERIFIED, remedy="Pursue as subcontractor or joint venture with a qualified prime.", partner_path=True, **base)
    # project-count style requirement
    m = re.search(r"(\d+)\s*\(?\d*\)?\s*(similar|comparable)", (req.get("value") or "") + " " + req.get("text", ""), re.I)
    count_req = int(m.group(1)) if m else None
    if count_req is not None:
        if len(own_verified) >= count_req:
            return CheckOutcome(result=MET, explanation=f"Requires {count_req} similar projects; {len(own_verified)} verified entity projects on file.", profile_fact_status=VERIFIED, **base)
        return CheckOutcome(result=NOT_MET if own_verified or support else UNKNOWN,
                            explanation=f"Requires {count_req} similar projects; {len(own_verified)} verified entity projects on file ({len(support)} owner/affiliate, not counted).",
                            profile_fact_status=MISSING, remedy="Add verified references or partner with an experienced firm.", partner_path=True, **base)
    return CheckOutcome(result=UNKNOWN, explanation="Experience rule stated without a measurable threshold; review manually.",
                        profile_fact_status=VERIFIED if own_verified else MISSING, **base)


def check_license(req: dict, profile: dict) -> CheckOutcome:
    t = (req.get("text", "") + " " + (req.get("quote") or "")).lower()
    base = dict(category="license", requirement=req["text"], mandatory=bool(req.get("mandatory", True)),
                page_ref=req.get("page_ref", ""), document=req.get("document", ""))
    wanted = None
    for name, kws in LICENSE_KEYWORDS.items():
        if any(k in t for k in kws):
            wanted = name
            break
    if wanted is None:
        return CheckOutcome(result=UNKNOWN, explanation="License requirement not recognised; review manually.", **base)
    for lic in profile.get("licenses", []):
        if str(lic.get("type", "")).lower() == wanted.lower():
            st = lic.get("status", MISSING)
            exp = lic.get("expires", "")
            if st == VERIFIED:
                if exp and exp < date.today().isoformat():
                    return CheckOutcome(result=NOT_MET, explanation=f"{wanted} on file but expired {exp}.", profile_fact_status=VERIFIED, remedy="Renew license.", **base)
                return CheckOutcome(result=MET, explanation=f"{wanted} verified{(' (expires ' + exp + ')') if exp else ''}.", profile_fact_status=VERIFIED, **base)
            return CheckOutcome(result=UNKNOWN, explanation=f"{wanted} listed in profile but status is {st}.", profile_fact_status=st, remedy="Upload license and mark VERIFIED.", **base)
    return CheckOutcome(result=NOT_MET, explanation=f"{wanted} required; no such license in profile.", profile_fact_status=MISSING,
                        remedy=f"Obtain {wanted} or subcontract that trade to a licensed firm.", partner_path=True, **base)


def check_generic(req: dict, profile: dict) -> CheckOutcome:
    cat = req.get("category", "scope")
    base = dict(category=cat, requirement=req["text"], mandatory=bool(req.get("mandatory", True)),
                page_ref=req.get("page_ref", ""), document=req.get("document", ""))
    if cat == "financial":
        f = fact(profile, "financial.statements_available")
        if f.status == VERIFIED and f.value:
            return CheckOutcome(result=MET, explanation="Financial statements available (verified).", profile_fact_status=VERIFIED, **base)
        return CheckOutcome(result=UNKNOWN, explanation="Financial documentation requested; availability not verified.", profile_fact_status=f.status,
                            remedy="Prepare CPA-reviewed statements or bank reference letter.", **base)
    if cat == "staffing":
        f = fact(profile, "resources.employees_w2")
        return CheckOutcome(result=UNKNOWN, explanation=f"Staffing rule stated; profile headcount status is {f.status}. Confirm capacity.",
                            profile_fact_status=f.status, remedy="Confirm staffing plan, background-check process, key personnel.", partner_path=True, **base)
    if cat == "equipment":
        return CheckOutcome(result=UNKNOWN, explanation="Equipment rule stated; confirm owned/rented equipment.", profile_fact_status=fact(profile, "resources.equipment").status, partner_path=True, **base)
    if cat == "meeting":
        mand = bool(req.get("mandatory", True))
        return CheckOutcome(result=UNKNOWN if mand else NOT_APPLICABLE,
                            explanation="Mandatory pre-bid meeting or site visit; attendance must be scheduled." if mand else "Optional pre-bid meeting.",
                            profile_fact_status=NOT_APPLICABLE, remedy="Put the meeting on the calendar; missing it disqualifies the bid." if mand else "", **base)
    if cat == "submission":
        return CheckOutcome(result=UNKNOWN, explanation="Required submission item; include in bid checklist.", profile_fact_status=NOT_APPLICABLE, **base)
    if cat == "risk":
        return CheckOutcome(result=NOT_APPLICABLE, explanation="Contract risk term; price it into the estimate.", profile_fact_status=NOT_APPLICABLE, **base)
    return CheckOutcome(result=NOT_APPLICABLE, explanation="Scope item.", profile_fact_status=NOT_APPLICABLE, **base)


def evaluate(requirements: list[dict], profile: dict, industry: Optional[str] = None, contract_value: Optional[float] = None) -> dict:
    """Run every check and classify. Returns {match_class, score, checks, summary, blockers, conditions}."""
    checks: list[CheckOutcome] = []
    for r in requirements:
        cat = r.get("category", "scope")
        if cat == "insurance":
            checks.append(check_insurance(r, profile))
        elif cat == "bond":
            checks.append(check_bond(r, profile, contract_value))
        elif cat == "eligibility":
            checks.append(check_eligibility(r, profile))
        elif cat == "experience":
            checks.append(check_experience(r, profile, industry))
        elif cat == "license":
            checks.append(check_license(r, profile))
        else:
            checks.append(check_generic(r, profile))
    present = {r.get("category") for r in requirements}
    for cat in CORE_MANDATORY_CATEGORIES:
        if cat not in present:
            checks.append(CheckOutcome(category=cat, requirement=f"No {cat} requirement found in the documents.", result=UNKNOWN, mandatory=True,
                                       explanation="Not stated in uploaded documents. Verify with the procurement officer or check for missing attachments/amendments.",
                                       profile_fact_status=MISSING, remedy="Request clarification or locate the full solicitation package."))
    # entity can bid at all?
    name = fact(profile, "entity.legal_name")
    gs = fact(profile, "entity.good_standing")
    if name.status != VERIFIED or (gs.status == VERIFIED and gs.value is False):
        checks.insert(0, CheckOutcome(category="eligibility", requirement="Contracting entity exists and is in good standing", result=UNKNOWN if gs.status != VERIFIED else NOT_MET,
                                      mandatory=True, explanation="Legal entity identity or good standing is not verified in the profile.",
                                      profile_fact_status=MISSING, remedy="Record SDAT entity details and good-standing status."))
    mandatory = [c for c in checks if c.mandatory and c.result != NOT_APPLICABLE]
    blockers = [c for c in mandatory if c.result == NOT_MET]
    unknowns = [c for c in mandatory if c.result == UNKNOWN]
    met = [c for c in mandatory if c.result == MET]
    if blockers:
        match_class = POOR
    elif unknowns:
        match_class = CONDITIONAL
    elif met:
        match_class = STRONG
    else:
        match_class = CONDITIONAL
    total = len(mandatory) or 1
    score = round(100.0 * (len(met) + 0.4 * len(unknowns)) / total, 1) if not blockers else round(100.0 * len(met) / total * 0.5, 1)
    partner_feasible = bool(blockers or unknowns) and all(c.partner_path for c in blockers) if blockers else any(c.partner_path for c in unknowns)
    summary_bits = [f"{len(met)} mandatory requirement(s) met", f"{len(unknowns)} unknown/unverified", f"{len(blockers)} not met"]
    if partner_feasible and (blockers or unknowns):
        summary_bits.append("a subcontract or JV arrangement could address the gaps")
    return {
        "match_class": match_class,
        "score": score,
        "checks": [c.to_dict() for c in checks],
        "blockers": [c.to_dict() for c in blockers],
        "conditions": [c.to_dict() for c in unknowns],
        "met": [c.to_dict() for c in met],
        "partner_feasible": partner_feasible,
        "summary": "; ".join(summary_bits) + ".",
        "legally_eligible": not any(b.category == "eligibility" for b in blockers),
    }
