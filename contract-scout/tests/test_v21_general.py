from scout import db, intake, pipeline, accessibility, opportunity, alerts, recommend, profile as prof
from scout.models import NO_BUSINESS
from scripts.make_sample_solicitation import JANITORIAL_PAGES, ROOFING_PARAGRAPHS


def _ingest(conn, name, pages):
    return intake.ingest_document(conn, name, "\n\f".join(pages).encode(), prefer_claude=False)["opportunity_id"]


def test_general_analysis_without_profile(conn, monkeypatch, tmp_path):
    monkeypatch.setattr(prof.config, "ACTIVE_PROFILE_FILE", tmp_path / "active.txt")
    assert prof.load_profile() == (None, "none")
    oid = _ingest(conn, "jan.txt", JANITORIAL_PAGES)
    res = pipeline.evaluate_opportunity(conn, oid, None, use_active_profile=True)
    assert res["match_class"] is None and res["general"]["potential"] in ("High", "Moderate", "Low", "Requires investigation")
    opp = db.get_opportunity(conn, oid)
    assert opp["match_class"] is None and opp["opportunity_potential"] and 0 <= opp["potential_score"] <= 100
    assert opp["recommendation"] in ("Worth bidding", "Investigate Further", "Low priority")
    card = recommend.build_card(conn, oid, None, "http://x")
    assert card["business_mode"] is False and len(card["barrier_answers"]) == 10 and card["business_types"]
    txt = recommend.card_text(card)
    assert txt.startswith("1. ") and "11. Opportunity score" in txt and "Business match" not in txt


def test_accessibility_answers_have_evidence(conn):
    oid = _ingest(conn, "roof.txt", [" ".join(ROOFING_PARAGRAPHS)])
    opp = db.get_opportunity(conn, oid)
    a = accessibility.analyze(opp, db.list_requirements(conn, oid))
    keys = {x["key"]: x for x in a["answers"]}
    assert keys["min_history"]["barrier"] == "high" and "5" in keys["min_history"]["answer"]
    assert keys["open_to_new"]["barrier"] == "high"
    assert keys["insurance_bonds"]["barrier"] == "high"
    assert keys["licensing"]["barrier"] in ("medium", "high")
    assert keys["restricted"]["barrier"] == "low" and "goal" in keys["restricted"]["answer"].lower()
    assert all(x["evidence"] for x in a["answers"])
    assert a["entry_barrier"] in ("medium", "high") and "roofing" in " ".join(a["business_types"]).lower()


def test_opportunity_model_marks_insufficient_info(conn):
    oid = db.insert_opportunity(conn, "EMPTY|X", solicitation_number="EMPTY", title="Mystery contract", agency="X", industry="Other / Unclassified")
    opp = db.get_opportunity(conn, oid)
    res = opportunity.score(opp, [], None, None)
    assert res["potential"] == "Requires investigation" and res["score"] < 60 and res["missing"]


def test_janitorial_is_more_accessible_than_roofing(conn):
    j = _ingest(conn, "jan.txt", JANITORIAL_PAGES)
    r = _ingest(conn, "roof.txt", [" ".join(ROOFING_PARAGRAPHS)])
    for oid in (j, r):
        pipeline.analyze_general(conn, oid)
    oj, orf = db.get_opportunity(conn, j), db.get_opportunity(conn, r)
    assert oj["potential_score"] > orf["potential_score"]
    assert oj["subcontracting_allowed"] in ("yes", "not stated", "limited") and oj["open_to_new_businesses"] in ("yes", "unclear", "no")


def test_business_mode_still_assigns_match(conn, profile):
    oid = _ingest(conn, "jan.txt", JANITORIAL_PAGES)
    res = pipeline.evaluate_opportunity(conn, oid, profile, use_active_profile=False)
    opp = db.get_opportunity(conn, oid)
    assert opp["match_class"] in ("Strong Match", "Conditional Match", "Poor Match") and opp["opportunity_potential"]
    card = recommend.build_card(conn, oid, profile, "http://x")
    assert card["business_mode"] is True and "Business match" in recommend.card_text(card)


def test_digest_has_detailed_reports_in_general_mode(conn, tmp_path, monkeypatch):
    from scout import config
    monkeypatch.setattr(config, "OUTBOX_DIR", tmp_path / "o")
    from datetime import datetime, timedelta, timezone
    oid = _ingest(conn, "jan.txt", JANITORIAL_PAGES)
    db.update_opportunity(conn, oid, bid_deadline_utc=(datetime.now(timezone.utc) + timedelta(days=20)).isoformat())
    pipeline.evaluate_opportunity(conn, oid, None, use_active_profile=False)
    body = alerts.build_digest(conn, profile=None)
    assert "OPPORTUNITIES YOU CAN DO" in body
    if db.get_opportunity(conn, oid)["opportunity_potential"] in ("High", "Moderate"):
        assert "DETAILED REPORTS" in body and "11. Opportunity score" in body


def test_subcontracting_and_preference_categories(janitorial_text):
    from scout import analyzer
    res = analyzer.heuristic_extract(janitorial_text + "\nThe Contractor may subcontract portions of the work with prior written approval. Joint ventures are permitted. Experience with LEED-certified buildings is preferred.", "j")
    cats = {r["category"] for r in res["requirements"]}
    assert "subcontracting" in cats and "preference" in cats
    assert res["subcontracting_allowed"] == "yes" and res["joint_venture_allowed"] == "yes"
    assert all(not r["mandatory"] for r in res["requirements"] if r["category"] == "preference")
