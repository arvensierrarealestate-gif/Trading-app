from datetime import datetime, timedelta, timezone

from scout import db, intake, pipeline, alerts, config
from scripts.make_sample_solicitation import JANITORIAL_PAGES


def _txt(pages):
    return "\n\f".join(pages).encode()


def test_ingest_creates_then_detects_duplicate(conn, profile):
    data = _txt(JANITORIAL_PAGES)
    r1 = intake.ingest_document(conn, "jan.txt", data, prefer_claude=False)
    assert r1["created"] and r1["requirements_extracted"] > 10 and r1["deadline_parsed"]
    r2 = intake.ingest_document(conn, "jan_copy.txt", data, prefer_claude=False)
    assert not r2["created"] and r2["opportunity_id"] == r1["opportunity_id"]
    assert "same solicitation number" in r2["duplicate_reason"]
    assert len(db.list_opportunities(conn)) == 1
    assert len(db.list_documents(conn, r1["opportunity_id"])) == 1  # identical bytes stored once


def test_amendment_changes_deadline_and_logs_change(conn, profile):
    r1 = intake.ingest_document(conn, "jan.txt", _txt(JANITORIAL_PAGES), prefer_claude=False)
    amended = [p.replace("December 4, 2026 at 2:00 PM", "December 11, 2026 at 2:00 PM") for p in JANITORIAL_PAGES]
    r2 = intake.ingest_document(conn, "jan_amend1.txt", _txt(amended), prefer_claude=False)
    assert not r2["created"]
    assert any(c["field"] == "bid_deadline_utc" for c in r2["changes"])
    docs = db.list_documents(conn, r1["opportunity_id"])
    assert len(docs) == 2 and docs[-1]["doc_type"] == "amendment"
    opp = db.get_opportunity(conn, r1["opportunity_id"])
    assert "2026-12-11" in opp["bid_deadline_local"]
    assert db.list_change_events(conn, r1["opportunity_id"], unacknowledged_only=True)


def test_fuzzy_title_duplicate(conn):
    key = "ABC|X"
    db.insert_opportunity(conn, key, solicitation_number="ABC", title="Janitorial Services for the Sample County Administration Building", agency="Sample County")
    row, reason = intake.find_duplicate(conn, None, "Sample County", "Janitorial Services for the Sample County Administration Building.")
    assert row and "similarity" in reason


def test_evaluate_and_estimate_pipeline(conn, profile):
    r = intake.ingest_document(conn, "jan.txt", _txt(JANITORIAL_PAGES), prefer_claude=False)
    res = pipeline.evaluate_opportunity(conn, r["opportunity_id"], profile)
    assert res["match_class"] == "Conditional Match"
    opp = db.get_opportunity(conn, r["opportunity_id"])
    assert opp["match_class"] == "Conditional Match" and opp["recommendation"] == "Investigate Further"
    ev = db.latest_evaluation(conn, opp["id"])
    assert ev and ev["checks"]
    a = pipeline.save_estimate(conn, opp["id"], __import__("scout.finance", fromlist=["x"]).default_assumptions(420000, "VERIFIED"))
    assert a["recommendation"] in ("Investigate Further", "Reject")
    actions = {row["action"] for row in db.list_audit(conn)}
    assert {"ingest_document", "evaluate", "save_estimate"} <= actions


def test_alerts_generation_idempotent_and_digest(conn, profile, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "OUTBOX_DIR", tmp_path / "outbox")
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "u")
    monkeypatch.setattr(config, "TEXT_DIR", tmp_path / "t")
    monkeypatch.setattr(config, "EXPORT_DIR", tmp_path / "e")
    soon = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    oid = db.insert_opportunity(conn, "K1|A", solicitation_number="K1", title="Soon job", agency="A", industry="Cleaning & Janitorial", bid_deadline_utc=soon)
    db.update_opportunity(conn, oid, match_class="Strong Match", recommendation="Pursue")
    created = alerts.generate_alerts(conn)
    kinds = {c["kind"] for c in created}
    assert {"deadline_3d", "strong_match", "new"} <= kinds
    assert alerts.generate_alerts(conn) == []  # idempotent
    body = alerts.build_digest(conn)
    assert "STRONG MATCHES" in body and "DEADLINES APPROACHING" in body and "never submits bids" in body
    out = alerts.send_digest(conn, force_dry_run=True)
    assert out["channel"].startswith("dry_run") and out["alerts"] == 3
    assert not db.list_alerts(conn, unsent_only=True)
    assert list((tmp_path / "outbox").glob("digest_*.txt"))


def test_reissued_document_does_not_double_count_requirements(conn, profile):
    r1 = intake.ingest_document(conn, "jan.txt", _txt(JANITORIAL_PAGES), prefer_claude=False)
    n1 = len(db.list_requirements(conn, r1["opportunity_id"]))
    amended = [p.replace("December 4, 2026 at 2:00 PM", "December 11, 2026 at 2:00 PM") for p in JANITORIAL_PAGES]
    intake.ingest_document(conn, "jan_amend1.txt", _txt(amended), prefer_claude=False)
    assert len(db.list_requirements(conn, r1["opportunity_id"])) == n1
