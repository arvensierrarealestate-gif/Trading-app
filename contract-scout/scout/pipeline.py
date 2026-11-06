"""Orchestration helpers shared by the UI, scripts and tests."""
from __future__ import annotations

from typing import Optional

from . import db, eligibility, finance
from .models import VERIFIED
from .profile import load_profile, list_profiles, load_profile_by_id


def contract_value_of(opp: dict) -> Optional[float]:
    for k in ("value_high", "value_low"):
        if opp.get(k) is not None:
            return float(opp[k])
    return None


def evaluate_opportunity(conn, opp_id: int, profile: Optional[dict] = None, actor: str = "system") -> dict:
    """Run the compliance engine for one opportunity and persist the result."""
    if profile is None:
        profile, _ = load_profile()
    opp = db.get_opportunity(conn, opp_id)
    if not opp:
        raise ValueError(f"opportunity {opp_id} not found")
    reqs = db.list_requirements(conn, opp_id)
    result = eligibility.evaluate(reqs, profile, industry=opp.get("industry"), contract_value=contract_value_of(opp))
    version = str(profile.get("profile_version", "unversioned"))
    db.add_evaluation(conn, opp_id, version, result["match_class"], result["score"], result["checks"], result["summary"])
    rec = _recommendation_for(conn, opp, result)
    db.update_opportunity(conn, opp_id, match_class=result["match_class"], match_score=result["score"], recommendation=rec)
    try:
        from . import scoring, alerts, recommend
        import json as _json
        opp2 = db.get_opportunity(conn, opp_id)
        est = db.latest_cost_estimate(conn, opp_id)
        sc, parts = scoring.score(opp2, {"checks": result["checks"], "match_class": result["match_class"]}, est["results"] if est else None, alerts.can_do_industries(profile), profile)
        best = recommend.best_entity(compare_entities(conn, opp_id), (profile.get("entity", {}).get("legal_name", {}) or {}).get("value"))
        db.update_opportunity(conn, opp_id, commercial_score=sc, commercial_reasons=_json.dumps(parts), recommended_entity=best["entity"] if best else None)
        result["commercial_score"], result["recommended_entity"] = sc, best["entity"] if best else None
    except Exception as exc:  # scoring must never break evaluation
        db.log(conn, "scoring_error", "opportunity", opp_id, {"error": str(exc)})
    db.log(conn, "evaluate", "opportunity", opp_id, {"match_class": result["match_class"], "score": result["score"], "recommendation": rec}, actor=actor)
    result["recommendation"] = rec
    return result


def _recommendation_for(conn, opp: dict, eval_result: dict) -> str:
    est = db.latest_cost_estimate(conn, opp["id"])
    if est:
        rec, _ = finance.recommend(eval_result["match_class"], est["results"], est["assumptions"], eval_result.get("legally_eligible", True))
        return rec
    assumptions = finance.default_assumptions(contract_value_of(opp), opp.get("value_status") or "MISSING")
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
    rec, reasons = finance.recommend(ev["match_class"] if ev else None, results, assumptions, legally)
    db.add_cost_estimate(conn, opp_id, label, assumptions, results, rec)
    db.update_opportunity(conn, opp_id, recommendation=rec)
    db.log(conn, "save_estimate", "opportunity", opp_id, {"recommendation": rec, "margin": results.get("gross_margin_pct")}, actor=actor)
    return {"results": results, "recommendation": rec, "reasons": reasons}


def evaluate_all(conn, profile: Optional[dict] = None) -> int:
    if profile is None:
        profile, _ = load_profile()
    n = 0
    for opp in db.list_opportunities(conn):
        evaluate_opportunity(conn, opp["id"], profile)
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
