"""Recommendation card: everything the owner needs to decide, on one screen and in the digest."""
from __future__ import annotations

from typing import Optional

import json
from . import db, deadlines, checklist, pipeline, alerts
from .models import STRONG, CONDITIONAL, POOR, PURSUE, INVESTIGATE, REJECT


def best_entity(rows: list[dict], active_name: Optional[str]) -> Optional[dict]:
    """Pick the entity with the best qualification result; ties go to the active entity."""
    if not rows:
        return None
    order = {STRONG: 0, CONDITIONAL: 1, POOR: 2}
    def key(r):
        return (order.get(r["match_class"], 3), r["not_met"], -r["met"], r["unknown"], 0 if r["entity"] == active_name else 1)
    return sorted(rows, key=key)[0]


def build_card(conn, opp_id: int, profile: Optional[dict], dashboard_url: str) -> dict:
    opp = db.get_opportunity(conn, opp_id)
    business_mode = profile is not None and bool(opp.get("match_class"))
    ev = db.latest_evaluation(conn, opp_id) if business_mode else None
    est = db.latest_cost_estimate(conn, opp_id)
    reqs = db.list_requirements(conn, opp_id)
    rows = pipeline.compare_entities(conn, opp_id) if business_mode else []
    active_name = (profile.get("entity", {}).get("legal_name", {}) or {}).get("value") if profile else None
    best = best_entity(rows, active_name)
    checks = ev["checks"] if ev else []
    met = [c for c in checks if c["mandatory"] and c["result"] == "MET"]
    gaps = [c for c in checks if c["mandatory"] and c["result"] in ("NOT_MET", "UNKNOWN")]
    partner = [c for c in gaps if c.get("partner_path")]
    try:
        reasons = json.loads(opp.get("potential_reasons") or "{}")
        access = json.loads(opp.get("barriers_json") or "{}")
    except json.JSONDecodeError:
        reasons, access = {}, {}
    cscore, parts = opp.get("potential_score"), reasons.get("parts", [])
    items = checklist.build_items(opp, reqs, ev)
    actions = [i["text"] for i in items if i["stage"] == "before_bid"][:6]
    rec = opp.get("recommendation") or INVESTIGATE
    why = [f"{c['category']}: {c['explanation']}" for c in met][:5]
    promising = [p["why"] for p in parts if p["max"] and p["points"] >= 0.7 * p["max"]][:4]
    barriers = [a["question"].rstrip("?") + ": " + a["answer"] for a in access.get("answers", []) if a.get("barrier") == "high"][:5]
    mandatory_quals = [r["text"][:110] for r in reqs if r.get("mandatory") and r.get("category") in ("eligibility", "license", "experience", "restriction")][:6]
    exp_lic = [r["text"][:110] for r in reqs if r.get("category") in ("experience", "license")][:4]
    ins_bond = [r["text"][:110] for r in reqs if r.get("category") in ("insurance", "bond")][:4]
    try:
        services = json.loads(opp.get("services_requested") or "[]")
    except json.JSONDecodeError:
        services = []
    return {
        "opportunity_id": opp_id, "title": opp["title"], "agency": opp.get("agency"), "jurisdiction": opp.get("jurisdiction"),
        "industry": opp.get("industry"), "value": opp.get("value_high") or opp.get("value_low"), "value_status": opp.get("value_status"),
        "deadline": deadlines.format_local(opp.get("bid_deadline_utc")), "days_left": deadlines.days_until(opp.get("bid_deadline_utc")),
        "link": opp.get("source_url") or "", "dashboard_link": f"{dashboard_url}/detail?opp={opp_id}",
        "recommended_entity": best["entity"] if best else active_name, "entity_match": best["match_class"] if best else (ev["match_class"] if ev else None),
        "all_entities": rows, "qualification": ev["match_class"] if ev else None, "qualification_score": ev["score"] if ev else None,
        "commercial_score": cscore, "commercial_parts": parts, "recommendation": rec,
        "why_it_matches": why, "missing": [f"{c['category']}: {c['requirement'][:100]}" for c in gaps][:8],
        "partner_path": [f"{c['category']}: {c.get('remedy') or c['requirement'][:80]}" for c in partner][:5],
        "financial": {k: est["results"].get(k) for k in ("revenue", "total_cost_base", "gross_profit_base", "gross_margin_pct", "working_capital_needed", "reliable", "reliability_note", "scenarios")} if est else None,
        "immediate_actions": actions,
        "business_mode": business_mode,
        "potential": opp.get("opportunity_potential"), "entry_barrier": access.get("entry_barrier"), "barrier_answers": access.get("answers", []),
        "business_types": access.get("business_types", []), "subcontract_feasible": access.get("subcontract_feasible"),
        "services": services, "mandatory_quals": mandatory_quals, "experience_licensing": exp_lic, "insurance_bonding": ins_bond,
        "promising": promising, "barriers": barriers, "set_aside": opp.get("set_aside"), "award_basis": opp.get("award_basis"),
        "location": opp.get("location"), "missing_info": reasons.get("missing", []),
    }


def refresh_scores(conn, profile: dict) -> int:
    """Store commercial score, reasons and recommended entity on every opportunity."""
    can_do = alerts.can_do_industries(profile)
    active_name = (profile.get("entity", {}).get("legal_name", {}) or {}).get("value")
    n = 0
    for opp in db.list_opportunities(conn):
        ev = db.latest_evaluation(conn, opp["id"])
        est = db.latest_cost_estimate(conn, opp["id"])
        sc, parts = scoring.score(opp, ev, est["results"] if est else None, can_do, profile)
        best = best_entity(pipeline.compare_entities(conn, opp["id"]), active_name)
        import json
        db.update_opportunity(conn, opp["id"], commercial_score=sc, commercial_reasons=json.dumps(parts), recommended_entity=best["entity"] if best else active_name)
        n += 1
    return n


def card_text(card: dict) -> str:
    """The 15-field opportunity report used in emails."""
    val = ('$%s (%s)' % (format(card['value'], ',.0f'), 'published' if card['value_status'] == 'VERIFIED' else 'estimate')) if card['value'] else 'not published'
    L = [f"1. {card['title']} | {card['agency'] or 'agency not stated'}",
         f"2. Jurisdiction: {card['jurisdiction'] or 'Maryland'} | Location: {card.get('location') or 'not stated'}",
         f"3. Industry: {card['industry']}",
         f"4. Contract value: {val}",
         f"5. Submission deadline: {card['deadline']}",
         f"6. Services required: {'; '.join(card.get('services') or [])[:300] or 'see scope'}",
         f"7. Mandatory qualifications: {'; '.join(card.get('mandatory_quals') or [])[:300] or 'none found in documents'}",
         f"8. Experience and licensing: {'; '.join(card.get('experience_licensing') or [])[:300] or 'not stated'}",
         f"9. Insurance and bonding: {'; '.join(card.get('insurance_bonding') or [])[:300] or 'not stated'}",
         f"10. Operational and financial: entry barrier {card.get('entry_barrier') or 'unknown'}; subcontracting {'feasible' if card.get('subcontract_feasible') else 'restricted/unknown'}"
         + (f"; modeled margin {card['financial']['gross_margin_pct']}% ({card['financial'].get('reliability_note')})" if card.get('financial') and card['financial'].get('gross_margin_pct') is not None else "; no cost model yet"),
         f"11. Opportunity score: {card['commercial_score']}/100 ({card.get('potential')}) - " + "; ".join(f"{p['component']} {p['points']}/{p['max']}" for p in card.get('commercial_parts') or [] if p.get('max')),
         f"12. Why it looks promising: {'; '.join(card.get('promising') or []) or 'see score breakdown'}",
         f"13. Barriers to bidding: {'; '.join(card.get('barriers') or []) or 'none rated high'}" + (f"; information gaps: {', '.join(card['missing_info'])}" if card.get('missing_info') else ""),
         f"14. Recommended next action: {card['recommendation']}" + (f" - {card['immediate_actions'][0]}" if card.get('immediate_actions') else ""),
         f"15. Official solicitation: {card['link'] or 'link not captured'} | Dashboard: {card['dashboard_link']}"]
    if card.get("business_mode"):
        L.append(f"   Business match ({card['recommended_entity']}): {card['qualification']}" + (f"; missing: {'; '.join(card['missing'][:4])}" if card.get('missing') else ""))
    return "\n".join(L)
