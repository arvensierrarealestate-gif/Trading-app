from scout import wages, finance, calendar_export, db, maintenance, analyzer, intake, pipeline, config
from scripts.make_sample_solicitation import JANITORIAL_PAGES, ROOFING_PARAGRAPHS


def test_wage_floor_by_place():
    assert wages.wage_floor("Washington, DC", "Washington, DC")["rate"] == 18.40
    assert wages.wage_floor("Maryland", "Rockville, Montgomery County")["rate"] == 18.00
    assert wages.wage_floor("Maryland", "Largo, Prince George's County")["rate"] >= 17.54
    assert wages.wage_floor("Maryland", "Baltimore City")["rate"] == 17.54
    assert wages.wage_floor("Maryland", "Rockville")["rate"] == 18.00
    assert wages.wage_floor("Maryland", "Towson")["rate"] == 17.54
    assert wages.wage_floor("Maryland", "Salisbury, Wicomico County")["rate"] == 15.00
    c = wages.wage_floor("Maryland", "Baltimore City", contract_type="construction")
    assert "prevailing" in c["note"].lower()


def test_default_assumptions_seed_labor_rate_from_floor():
    a = finance.default_assumptions(100000, "VERIFIED", opp={"jurisdiction": "Washington, DC", "location": "Washington, DC", "industry": "Cleaning & Janitorial"})
    assert a["labor_rate"]["value"] == round(18.40 * 1.15, 2) and "DC Living Wage" in a["labor_rate"]["note"]
    b = finance.default_assumptions(100000, "VERIFIED", opp={"jurisdiction": "Maryland", "location": "Salisbury", "industry": "Cleaning & Janitorial"})
    assert b["labor_rate"]["value"] == round(15.0 * 1.15, 2) and "Tier 2" in b["labor_rate"]["note"]


def test_set_aside_and_award_basis_extraction(janitorial_text, roofing_text):
    j = analyzer.heuristic_extract(janitorial_text, "j")
    assert j["set_aside"] == "Small Business Reserve" and j["award_basis"] == "lowest price"
    r = analyzer.heuristic_extract(roofing_text, "r")
    assert r["set_aside"] == "MBE goal 29%"


def test_set_aside_stored_and_scored(conn, profile):
    r = intake.ingest_document(conn, "roof.txt", " ".join(ROOFING_PARAGRAPHS).encode(), prefer_claude=False)
    pipeline.evaluate_opportunity(conn, r["opportunity_id"], profile)
    opp = db.get_opportunity(conn, r["opportunity_id"])
    assert opp["set_aside"] == "MBE goal 29%" and opp["award_basis"] == "lowest price"


def test_ics_and_snapshot(conn, profile, tmp_path, monkeypatch):
    for attr in ("DATA_DIR", "UPLOAD_DIR", "TEXT_DIR", "OUTBOX_DIR", "EXPORT_DIR"):
        monkeypatch.setattr(config, attr, tmp_path / attr.lower())
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "x.db")
    (tmp_path / "x.db").write_bytes(b"fake")
    r = intake.ingest_document(conn, "jan.txt", "\n\f".join(JANITORIAL_PAGES).encode(), prefer_claude=False)
    pipeline.evaluate_opportunity(conn, r["opportunity_id"], profile)
    ics = calendar_export.build_ics(conn)
    assert ics.startswith("BEGIN:VCALENDAR") and "BID DUE:" in ics and "Pre-bid meeting" in ics and "VALARM" in ics
    snap = maintenance.snapshot(conn, "http://localhost:8501")
    assert (tmp_path / "export_dir" / "deadlines.ics").exists() and (tmp_path / "export_dir" / "opportunities_latest.csv").exists()
    assert snap["backup"].endswith(".db") and (tmp_path / "data_dir" / "backups").exists()
