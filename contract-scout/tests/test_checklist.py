from scout import db, checklist, intake, pipeline
from scripts.make_sample_solicitation import JANITORIAL_PAGES, ROOFING_PARAGRAPHS


def _ingest(conn, profile, name, pages):
    r = intake.ingest_document(conn, name, "\n\f".join(pages).encode(), prefer_claude=False)
    pipeline.evaluate_opportunity(conn, r["opportunity_id"], profile)
    return r["opportunity_id"]


def test_janitorial_checklist_has_core_items(conn, profile):
    oid = _ingest(conn, profile, "jan.txt", JANITORIAL_PAGES)
    opp = db.get_opportunity(conn, oid)
    items = checklist.build_items(opp, db.list_requirements(conn, oid), db.latest_evaluation(conn, oid))
    texts = " | ".join(i["text"] for i in items).lower()
    assert "bid/proposal affidavit" in texts
    assert "attend mandatory pre-bid" in texts
    assert "living wage" in texts
    assert "performance and payment bonds" in texts
    assert "bid bond" not in texts.replace("performance and payment bonds", "")  # janitorial says no bid bond
    assert "sbr self-certification" in texts
    assert any(i["text"].startswith("Resolve:") and i["stage"] == "before_bid" for i in items)
    assert all(i["stage"] in checklist.STAGES and i["source"] for i in items)
    stages = [i["stage"] for i in items]
    assert stages == sorted(stages, key=lambda s: checklist.STAGES.index(s))


def test_roofing_checklist_has_mbe_and_bid_bond(conn, profile):
    oid = _ingest(conn, profile, "roof.txt", [" ".join(ROOFING_PARAGRAPHS)])
    opp = db.get_opportunity(conn, oid)
    items = checklist.build_items(opp, db.list_requirements(conn, oid), db.latest_evaluation(conn, oid))
    texts = " | ".join(i["text"] for i in items).lower()
    assert "attachment d-1a" in texts and "d-2" in texts
    assert "bid bond" in texts
    assert any("license" in i["text"].lower() for i in items)


def test_sync_keeps_done_state(conn, profile):
    oid = _ingest(conn, profile, "jan.txt", JANITORIAL_PAGES)
    opp = db.get_opportunity(conn, oid)
    items = checklist.build_items(opp, db.list_requirements(conn, oid), db.latest_evaluation(conn, oid))
    n1 = checklist.sync(conn, oid, items)
    rows = db.list_checklist(conn, oid)
    db.set_checklist_done(conn, rows[0]["id"], True)
    n2 = checklist.sync(conn, oid, items)
    assert n1 == n2 == len(items)
    assert db.list_checklist(conn, oid)[0]["done"] is True
    md = checklist.as_markdown(opp, db.list_checklist(conn, oid))
    assert md.startswith("# Bid package checklist") and "[x]" in md and "[ ]" in md
