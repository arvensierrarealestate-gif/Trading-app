"""Company-independent qualification analysis.

Answers, for any solicitation and without any business profile, the ten
entry-barrier questions and rates how hard the contract is to qualify for.
Every answer carries its evidence (requirement text and page) or says
"not stated". Nothing here invents a requirement.
"""
from __future__ import annotations

import re
from typing import Optional

from .insurance import parse_amount, parse_percent

LOW, MEDIUM, HIGH, UNKNOWN = "low", "medium", "high", "unknown"

QUESTIONS = (
    ("open_to_new", "Is it open to new businesses?"),
    ("min_history", "Is there a minimum operating history?"),
    ("past_performance", "Is documented past performance mandatory?"),
    ("licensing", "Does it require specialized professional licensing?"),
    ("insurance_bonds", "Are expensive insurance policies or bonds required?"),
    ("staffing_equipment", "Does it require significant staffing or equipment?"),
    ("upfront_capital", "Is there a substantial upfront financial commitment?"),
    ("subcontracting", "Can subcontractors perform any portion of the work?"),
    ("joint_venture", "Are joint ventures permitted?"),
    ("restricted", "Is the opportunity restricted to a specific type of certified business?"),
)

BUSINESS_TYPES = {
    "Construction & Property Services": ["licensed general contractor", "MHIC-licensed home improvement contractor", "specialty trade contractor (roofing, HVAC, electrical, plumbing)", "landscaping and grounds maintenance company", "property maintenance firm"],
    "Cleaning & Janitorial": ["commercial janitorial company", "facility services contractor", "cleaning supply distributor"],
    "Sanitation & Waste": ["waste hauler / recycling contractor", "pest control operator", "sanitation services company", "portable restroom provider"],
    "Food & Catering": ["licensed caterer", "food service management company", "food distributor", "institutional kitchen operator"],
    "Healthcare & Hospital Support": ["medical supply distributor", "healthcare staffing / support services firm", "environmental services contractor"],
    "Pharmacy & Immunization": ["licensed pharmacy", "immunization services provider (pharmacy or clinic)", "pharmaceutical wholesaler/distributor"],
    "Hospitality & Lodging": ["hospitality staffing company", "commercial laundry", "event management firm", "lodging operator"],
}


def _ev(r: dict) -> str:
    return f"{(r.get('document') or '')} {(r.get('page_ref') or '')}".strip() or "document"


def analyze(opp: dict, requirements: list[dict]) -> dict:
    reqs = requirements or []
    by = lambda cat: [r for r in reqs if r.get("category") == cat]
    text_all = " ".join((r.get("text") or "") + " " + (r.get("quote") or "") for r in reqs).lower()
    answers: list[dict] = []

    def ans(key, answer, level, evidence, note=""):
        answers.append({"key": key, "question": dict(QUESTIONS)[key], "answer": answer, "barrier": level, "evidence": evidence, "note": note})

    # minimum history / experience
    years = None
    yrs_ev = ""
    _words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
    for r in by("experience"):
        hay = (r.get("value") or "") + " " + (r.get("text") or "")
        m = re.search(r"(\d+(?:\.\d+)?)\)?\s*(?:\+\s*)?years?", hay, re.I)
        w = re.search(r"\b(one|two|three|four|five|six|seven|eight|nine|ten)\b\s*(?:\(\d+\))?\s*years?", hay, re.I)
        n = float(m.group(1)) if m else (float(_words[w.group(1).lower()]) if w else None)
        if n is not None and r.get("mandatory") and re.search(r"experience|business|operat|in the trade|performing", hay, re.I):
            years = max(years or 0, n)
            yrs_ev = _ev(r)
    projects = [r for r in by("experience") if re.search(r"similar|comparable|references?", (r.get("text") or "") + (r.get("value") or ""), re.I)]
    if years:
        ans("min_history", f"Yes: {years:g} years of experience required", HIGH if years >= 5 else MEDIUM, yrs_ev)
    elif by("experience"):
        ans("min_history", "Experience is mentioned without a clear number of years", MEDIUM, _ev(by("experience")[0]))
    else:
        ans("min_history", "Not stated", UNKNOWN, "not stated", "Confirm with the procurement officer")
    if projects and any(p.get("mandatory") for p in projects):
        ans("past_performance", "Yes: similar projects or references are mandatory", HIGH, _ev(projects[0]))
    elif projects:
        ans("past_performance", "References requested but not clearly mandatory", MEDIUM, _ev(projects[0]))
    else:
        ans("past_performance", "Not stated", UNKNOWN, "not stated")
    otn = (opp.get("open_to_new_businesses") or "").lower()
    if years and years >= 3:
        ans("open_to_new", f"No: a new business cannot show {years:g} years", HIGH, yrs_ev)
    elif otn == "yes" or (not years and not projects):
        ans("open_to_new", "Yes, nothing in the document excludes a new business", LOW, "no exclusion found")
    else:
        ans("open_to_new", "Unclear: experience is requested; a partner or subcontractor may bridge it", MEDIUM, yrs_ev or "experience clause")

    # licensing
    lic = by("license")
    pro = [r for r in lic if re.search(r"pharmac|physician|nurse|electric|plumb|hvac|engineer|architect|master", (r.get("text") or ""), re.I)]
    if pro:
        ans("licensing", "Yes: specialized professional licensing", HIGH, _ev(pro[0]))
    elif lic:
        ans("licensing", "Yes: a trade or business license is required", MEDIUM, _ev(lic[0]))
    else:
        ans("licensing", "No license requirement found", LOW, "none found")

    # insurance and bonds
    max_ins = 0.0
    ins_ev = ""
    for r in by("insurance"):
        a = parse_amount(r.get("value"))
        if a and a > max_ins:
            max_ins, ins_ev = a, _ev(r)
    bonds = [r for r in by("bond") if not re.search(r"\bno (bid|performance|payment) bond", (r.get("text") or ""), re.I)]
    perf = any(re.search(r"performance|payment", (r.get("text") or ""), re.I) for r in bonds)
    if perf or max_ins >= 2_000_000:
        ans("insurance_bonds", f"Yes: {'performance/payment bonds' if perf else ''}{' and ' if perf and max_ins >= 2_000_000 else ''}{('insurance up to $%s' % format(max_ins, ',.0f')) if max_ins >= 2_000_000 else ''}", HIGH, ins_ev or (_ev(bonds[0]) if bonds else ""))
    elif bonds or max_ins > 0:
        ans("insurance_bonds", f"Moderate: {'bid bond' if bonds else ''}{' and ' if bonds and max_ins else ''}{('insurance $%s' % format(max_ins, ',.0f')) if max_ins else ''}", MEDIUM, ins_ev or (_ev(bonds[0]) if bonds else ""))
    else:
        ans("insurance_bonds", "Not stated", UNKNOWN, "not stated", "Standard GL is usually expected even when unstated")

    # staffing / equipment
    staff = by("staffing") + by("equipment")
    value = opp.get("value_high") or opp.get("value_low")
    if staff and (value or 0) > 500_000:
        ans("staffing_equipment", "Yes: staffing/equipment rules on a large contract", HIGH, _ev(staff[0]))
    elif staff:
        ans("staffing_equipment", "Some staffing or equipment rules stated", MEDIUM, _ev(staff[0]))
    else:
        ans("staffing_equipment", "Not stated", UNKNOWN, "not stated")

    # upfront capital
    fin = by("financial")
    if perf and value and value > 250_000:
        ans("upfront_capital", f"Yes: bonding on a ${value:,.0f} contract plus mobilization before first payment", HIGH, ins_ev or "bond clause")
    elif value and value > 250_000 or fin:
        ans("upfront_capital", "Moderate: payroll and materials are carried 30-60 days before payment" + ("; financial statements requested" if fin else ""), MEDIUM, _ev(fin[0]) if fin else "contract value")
    elif value:
        ans("upfront_capital", "Low: small contract, limited float", LOW, "contract value")
    else:
        ans("upfront_capital", "Unknown: value not published", UNKNOWN, "not stated")

    # subcontracting / JV
    sub = (opp.get("subcontracting_allowed") or "not stated").lower()
    sub_rules = by("subcontracting")
    if sub == "no":
        ans("subcontracting", "No: subcontracting is prohibited", HIGH, _ev(sub_rules[0]) if sub_rules else "document")
    elif sub in ("yes", "limited"):
        ans("subcontracting", "Yes" + (" with self-performance limits" if sub == "limited" else ""), LOW, _ev(sub_rules[0]) if sub_rules else "document")
    else:
        ans("subcontracting", "Not stated; usually allowed with agency approval", UNKNOWN, "not stated")
    jv = (opp.get("joint_venture_allowed") or "not stated").lower()
    if jv == "yes":
        ans("joint_venture", "Yes", LOW, "document")
    elif jv == "no":
        ans("joint_venture", "No", HIGH, "document")
    else:
        ans("joint_venture", "Not stated", UNKNOWN, "not stated")

    # restriction / set-aside
    restr = by("restriction")
    sa = (opp.get("set_aside") or "").lower()
    if restr or "small business reserve" in sa or "cbe" in sa:
        ans("restricted", f"Yes: {opp.get('set_aside') or restr[0].get('text', '')[:80]}", HIGH, _ev(restr[0]) if restr else "set-aside designation",
            "Only businesses holding the certification may be awarded")
    elif "mbe" in sa or "vsbe" in sa:
        ans("restricted", f"Participation goal only ({opp.get('set_aside')}); any bidder may compete and meet it with certified subs", LOW, "set-aside designation")
    else:
        ans("restricted", "No restriction found", LOW, "none found")

    # overall entry barrier
    weights = {HIGH: 3, MEDIUM: 2, LOW: 0, UNKNOWN: 1}
    pts = sum(weights[a["barrier"]] for a in answers)
    unknowns = sum(1 for a in answers if a["barrier"] == UNKNOWN)
    if unknowns >= 5:
        overall = "requires investigation"
    elif pts <= 6:
        overall = "low"
    elif pts <= 13:
        overall = "medium"
    else:
        overall = "high"
    mandatory = [r for r in reqs if r.get("mandatory") and r.get("category") not in ("scope", "risk", "preference")]
    preferred = [r for r in reqs if r.get("category") == "preference" or (not r.get("mandatory") and r.get("category") in ("experience", "license", "staffing", "equipment"))]
    ind = opp.get("industry") or ""
    types = BUSINESS_TYPES.get(ind, ["any business able to meet the stated requirements"])
    sub_feasible = sub in ("yes", "limited", "not stated") and not any(a["key"] == "restricted" and a["barrier"] == HIGH for a in answers)
    return {
        "answers": answers,
        "entry_barrier": overall,
        "barrier_points": pts,
        "unknown_count": unknowns,
        "mandatory_count": len(mandatory),
        "preferred_count": len(preferred),
        "business_types": types,
        "subcontract_feasible": sub_feasible,
        "low_barrier": overall == "low",
    }
