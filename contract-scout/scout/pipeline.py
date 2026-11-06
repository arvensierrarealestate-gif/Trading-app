"""Orchestration helpers shared by the UI, scripts and tests."""
from __future__ import annotations

from typing import Optional

import json

from . import db, eligibility, finance, accessibility, opportunity
from .models import VERIFIED, PURSUE, INVESTIGATE, REJECT, WORTH_BIDDING, LOW_PRIORITY
from .profile import load_profile, list_profiles, load_profile_by_id


def contract_value_of(opp: dict) -> Optional[float]:
    for k in ("value_high", "value_low"):
        if opp.get(k) is not None:
            return float(opp[k])
    return None


def analyze_general(conn, opp_id: int, focus_industries: tuple[str, ...] = (), actor: str = "system") -> dict:
    """Company-independent analysis: barrier questions, business types, 100-point opportunity model. Always runs."""
    opp = db.get_opportunity(conn, opp_id)
    if not opp:
        raise ValueError(f"opportunity {opp_id} not found")
    reqs = db.list_requirements(conn, opp_id)
    est = db.latest_cost_estimate(conn, opp_id)
    access = accessibility.analyze(opp, reqs)
    res = opportunity.score(opp, reqs, access, est["results"] if est else None, focus_industries)
    rec = {opportunity.HIGH: WORTH_BIDDING, opportunity.MODERATE: INVESTIGATE, opportunity.LOW: LOW_PRIORITY, opportunity.INVESTIGATE: INVESTIGATE}[res["potential"]]
    db.update_opportunity(conn, opp_id, opportunity_potential=res["potential"], potential_score=res["score"],
                          potential_reasons=json.dumps({"parts": res["parts"], "missing": res["missing"]}), barriers_json=json.dumps(access),
                          commercial_score=res["score"], commercial_reasons=json.dumps(res["parts"]))
    res["recommendation"] = rec
    return res


def evaluate_opportunity(conn, opp_id: int, profile: Optional[dict] = None, actor: str = "system", use_active_profile: bool = True) -> dict:
    """General analysis always; business-specific matching only when a profile is given or selected."""
    if profile is None and use_active_profile:
        profile, _ = load_profile()
    opp = db.get_opportunity(conn, opp_id)
    if not opp:
        raise ValueError(f"opportunity {opp_id} not found")
    general = analyze_general(conn, opp_id, actor=actor)
    if profile is None:
        db.update_opportunity(conn, opp_id, match_class=None, match_score=None, recommendation=general["recommendation"], recommended_entity=None)
        db.log(conn, "analyze_general", "opportunity", opp_id, {"potential": general["potential"], "score": general["score"]}, actor=actor)
        return {"match_class": None, "score": None, "checks": [], "blockers": [], "conditions": [], "met": [], "partner_feasible": general["access"]["subcontract_feasible"],
                "summary": f"General analysis: {general['potential']} opportunity potential, score {general['score']}/100, entry barrier {general['access']['entry_barrier']}.",
                "legally_eligible": True, "recommendation": general["recommendation"], "general": general}
    reqs = db.list_requirements(conn, opp_id)
    result = eligibility.evaluate(reqs, profile, industry=opp.get("industry"), contract_value=contract_value_of(opp))
    result["general"] = general
    version = str(profile.get("profile_version", "unversioned"))
    db.add_evaluation(conn, opp_id, version, result["match_class"], result["score"], result["checks"], result["summary"])
    rec = _recommendation_for(conn, opp, result)
    db.update_opportunity(conn, opp_id, match_class=result["match_class"], match_score=result["score"], recommendation=rec)
    try:
        from . import recommend
        best = recommend.best_entity(compare_entities(conn, opp_id), (profile.get("entity", {}).get("legal_name", {}) or {}).get("value"))
        db.update_opportunity(conn, opp_id, recommended_entity=best["entity"] if best else None)
        result["commercial_score"], result["recommended_entity"] = general["score"], best["entity"] if best else None
    except Exception as exc:  # entity comparison must never break evaluation
        db.log(conn, "compare_error", "opportunity", opp_id, {"error": str(exc)})
    db.log(conn, "evaluate", "opportunity", opp_id, {"match_class": result["match_class"], "score": result["score"], "recommendation": rec}, actor=actor)
    result["recommendation"] = rec
    return result


def _recommendation_for(conn, opp: dict, eval_result: dict) -> str:
    est = db.latest_cost_estimate(conn, opp["id"])
    if est:
        rec, _ = finance.recommend(eval_result["match_class"], est["results"], est["assumptions"], eval_result.get("legally_eligible", True))
        return rec
    assumptions = finance.default_assumptions(contract_value_of(opp), opp.get("value_status") or "MISSING", opp=opp)
    results = finance.estimate(assumptions)
    rec, _ = finance.recommend(eval_result["match_class"], results, assumptions, eval_result.get("legally_eligible", True))
    return rec


def save_estimate(conn, opp_id: int, assumptions: dict, label: str = "user estimate", actor: str = "user") -> dict:
    opp = db.get_opportunity(conn, opp_id)
    ev = db.latest_evaluation(conn, opp_id)
    results = finance.estimate(assumptions)
    legally = True
    if ev:
        legally = not any(c["category"] == "eligibility" and c["result"] == "NOT_MET" and c["mandatory"] for c in ev["checks"])
    business_mode = bool(opp.get("match_class"))
    if business_mode:
        rec, reasons = finance.recommend(ev["match_class"] if ev else None, results, assumptions, legally)
    else:
        rec, reasons = None, []
    db.add_cost_estimate(conn, opp_id, label, assumptions, results, rec or "")
    general = analyze_general(conn, opp_id, actor=actor)   # re-score with the new estimate
    if not business_mode:
        rec = general["recommendation"]
        reasons = [f"{general['potential']} opportunity potential, score {general['score']}/100", results.get("reliability_note", "")]
    db.update_opportunity(conn, opp_id, recommendation=rec)
    db.log(conn, "save_estimate", "opportunity", opp_id, {"recommendation": rec, "margin": results.get("gross_margin_pct")}, actor=actor)
    return {"results": results, "recommendation": rec, "reasons": reasons}


def evaluate_all(conn, profile: Optional[dict] = None, use_active_profile: bool = True) -> int:
    if profile is None and use_active_profile:
        profile, _ = load_profile()
    n = 0
    for opp in db.list_opportunities(conn):
        evaluate_opportunity(conn, opp["id"], profile, use_active_profile=False)
        n += 1
    return n


def compare_entities(conn, opp_id: int) -> list[dict]:
    """Evaluate one opportunity against every available entity profile without persisting anything."""
    opp = db.get_opportunity(conn, opp_id)
    reqs = db.list_requirements(conn, opp_id)
    out = []
    for p in list_profiles():
        if p["id"] == "company_profile":
            continue
        prof = load_profile_by_id(p["id"])
        res = eligibility.evaluate(reqs, prof, industry=opp.get("industry"), contract_value=contract_value_of(opp))
        out.append({"profile_id": p["id"], "entity": p["name"], "match_class": res["match_class"], "score": res["score"],
                    "met": len(res["met"]), "unknown": len(res["conditions"]), "not_met": len(res["blockers"]),
                    "legally_eligible": res["legally_eligible"], "partner_feasible": res["partner_feasible"],
                    "top_gap": (res["blockers"] or res["conditions"] or [{}])[0].get("requirement", "")[:90]})
    return out
