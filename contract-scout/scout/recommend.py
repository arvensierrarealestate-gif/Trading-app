"""Recommendation card: everything the owner needs to decide, on one screen and in the digest."""
from __future__ import annotations

from typing import Optional

from . import db, deadlines, checklist, pipeline, scoring, alerts
from .models import STRONG, CONDITIONAL, POOR, PURSUE, INVESTIGATE, REJECT


def best_entity(rows: list[dict], active_name: Optional[str]) -> Optional[dict]:
    """Pick the entity with the best qualification result; ties go to the active entity."""
    if not rows:
        return None
    order = {STRONG: 0, CONDITIONAL: 1, POOR: 2}
    def key(r):
        return (order.get(r["match_class"], 3), r["not_met"], -r["met"], r["unknown"], 0 if r["entity"] == active_name else 1)
    return sorted(rows, key=key)[0]


def build_card(conn, opp_id: int, profile: dict, dashboard_url: str) -> dict:
    opp = db.get_opportunity(conn, opp_id)
    ev = db.latest_evaluation(conn, opp_id)
    est = db.latest_cost_estimate(conn, opp_id)
    rows = pipeline.compare_entities(conn, opp_id)
    active_name = (profile.get("entity", {}).get("legal_name", {}) or {}).get("value")
    best = best_entity(rows, active_name)
    checks = ev["checks"] if ev else []
    met = [c for c in checks if c["mandatory"] and c["result"] == "MET"]
    gaps = [c for c in checks if c["mandatory"] and c["result"] in ("NOT_MET", "UNKNOWN")]
    partner = [c for c in gaps if c.get("partner_path")]
    cscore, parts = scoring.score(opp, ev, est["results"] if est else None, alerts.can_do_industries(profile), profile)
    items = checklist.build_items(opp, db.list_requirements(conn, opp_id), ev)
    actions = [i["text"] for i in items if i["stage"] == "before_bid"][:6]
    rec = opp.get("recommendation") or INVESTIGATE
    why = [f"{c['category']}: {c['explanation']}" for c in met][:5]
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
        "financial": {k: est["results"].get(k) for k in ("revenue", "total_cost_base", "gross_profit_base", "gross_margin_pct", "working_capital_needed")} if est else None,
        "immediate_actions": actions,
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
    lines = [f"{card['title']}", f"  Agency: {card['agency'] or 'n/a'} | {card['jurisdiction'] or ''} | {card['industry']}",
             f"  Deadline: {card['deadline']} | Value: {('$%s' % format(card['value'], ',.0f')) if card['value'] else 'not published'} ({card['value_status']})",
             f"  Recommended entity: {card['recommended_entity']} ({card['entity_match']}) | Qualification: {card['qualification']} | Commercial score: {card['commercial_score']}/100",
             f"  Recommendation: {card['recommendation']}"]
    if card["why_it_matches"]:
        lines.append("  Why it fits: " + "; ".join(card["why_it_matches"][:3]))
    if card["missing"]:
        lines.append("  Missing: " + "; ".join(card["missing"][:4]))
    if card["partner_path"]:
        lines.append("  Partner/subcontractor path: " + "; ".join(card["partner_path"][:3]))
    if card["financial"] and card["financial"].get("gross_margin_pct") is not None:
        f = card["financial"]
        lines.append(f"  Financial: revenue ${f['revenue']:,.0f}, cost ${f['total_cost_base']:,.0f}, margin {f['gross_margin_pct']}%, working capital ${f['working_capital_needed']:,.0f}")
    if card["immediate_actions"]:
        lines.append("  Do first: " + "; ".join(card["immediate_actions"][:4]))
    lines.append(f"  Open: {card['dashboard_link']}" + (f" | Source: {card['link']}" if card["link"] else ""))
    return "\n".join(lines)
