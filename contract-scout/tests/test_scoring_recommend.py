from datetime import datetime, timedelta, timezone

from scout import db, scoring, recommend, intake, pipeline, inbox, alerts
from scout.models import classify_industry, classify_jurisdiction, OPP_STATUSES
from scout.profile import load_profile_by_id
from scripts.make_sample_solicitation import JANITORIAL_PAGES
from tests.test_inbox import _email


def test_pharmacy_industry_and_dc_jurisdiction():
    assert classify_industry("Pharmacy services and immunization clinics for seniors") == "Pharmacy & Immunization"
    assert classify_industry("vaccine administration at community sites") == "Pharmacy & Immunization"
    assert classify_jurisdiction("Department of General Services", "Washington, DC") == "Washington, DC"
    assert classify_jurisdiction("Sample County Department of General Services", "Rockville") == "Maryland"
    assert "Qualified" in OPP_STATUSES and "Cancelled" in OPP_STATUSES


def test_pharmacy_profile_valid_and_scores_pharmacy_job(conn):
    from scout import profile as prof
    p = load_profile_by_id("sierra_international_pharmaceutical_corp")
    assert not [x for x in prof.validate_profile(p) if x.startswith("ERROR")]
    assert p["entity"]["formation_date"]["value"] == "1992-10-28"
    assert len(prof.entity_experience(p, "Pharmacy & Immunization")) >= 1


def test_commercial_score_components_and_cap(profile):
    soon = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    opp = {"industry": "Cleaning & Janitorial", "value_high": 80000, "bid_deadline_utc": soon, "jurisdiction": "Maryland"}
    ev = {"match_class": "Conditional Match", "checks": [{"category": "bond", "result": "NOT_APPLICABLE", "requirement": "no bond", "mandatory": False}]}
    sc, parts = scoring.score(opp, ev, {"gross_margin_pct": 30}, ("Cleaning & Janitorial",), profile)
    assert sc == 100 and {p["component"] for p in parts} >= {"Industry fit", "Contract size", "Estimated margin", "Deadline runway", "Access advantage", "Risk and bonding"}
    sc2, _ = scoring.score(opp, {"match_class": "Poor Match", "checks": []}, {"gross_margin_pct": 30}, ("Cleaning & Janitorial",), profile)
    assert sc2 <= 35
    sc3, parts3 = scoring.score({"industry": "Other / Unclassified", "value_high": None, "bid_deadline_utc": None}, None, None, ("Cleaning & Janitorial",), profile)
    assert sc3 < 50 and all(p["why"] for p in parts3)


def test_evaluation_stores_score_and_entity_and_card(conn):
    profile = load_profile_by_id("sierra_real_estate_llc")
    r = intake.ingest_document(conn, "jan.txt", "\n\f".join(JANITORIAL_PAGES).encode(), prefer_claude=False)
    res = pipeline.evaluate_opportunity(conn, r["opportunity_id"], profile)
    opp = db.get_opportunity(conn, r["opportunity_id"])
    assert opp["commercial_score"] is not None and 0 <= opp["commercial_score"] <= 100
    assert opp["recommended_entity"] in {"Sierra Real Estate LLC", "Medwise Seniors LLC", "Sierra International Pharmaceutical Corporation", "New Maryland Entity (hypothetical)"}
    assert opp["jurisdiction"] == "Maryland"
    card = recommend.build_card(conn, opp["id"], profile, "http://localhost:8501")
    assert card["recommended_entity"] and card["commercial_parts"] and card["dashboard_link"].endswith(f"opp={opp['id']}")
    assert card["immediate_actions"] and card["recommendation"] in ("Pursue", "Investigate Further", "Reject")
    txt = recommend.card_text(card)
    assert "Recommended entity" in txt and "Commercial score" in txt


def test_cancellation_notice_marks_opportunity_and_alerts(conn, profile):
    raw = _email("New Solicitation IFB-2026-JAN-0417 Janitorial", "Due Date: December 4, 2026 2:00 PM\nhttps://emma.maryland.gov/x", msgid="<n1@emma>")
    inbox.run_inbox_intake(conn, notices=[inbox.parse_message(raw, uid="1")], profile=profile, prefer_claude=False, fetch_links=False)
    opp = db.list_opportunities(conn)[0]
    assert opp["status"] == "New"
    raw2 = _email("CANCELLED: Solicitation IFB-2026-JAN-0417", "This solicitation has been cancelled by the agency.", msgid="<n2@emma>")
    r = inbox.run_inbox_intake(conn, notices=[inbox.parse_message(raw2, uid="2")], profile=profile, prefer_claude=False, fetch_links=False)
    opp2 = db.get_opportunity(conn, opp["id"])
    assert opp2["status"] == "Cancelled" and len(db.list_opportunities(conn)) == 1
    assert any(a["kind"] == "cancelled" for a in db.list_alerts(conn))
    assert any(c["field"] == "status" and c["new_value"] == "Cancelled" for c in db.list_change_events(conn, opp["id"]))
    body = alerts.build_digest(conn, profile=profile)
    assert "CANCELLED - STOP WORK" in body
