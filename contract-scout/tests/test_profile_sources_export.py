import copy
import json

import pytest

from scout import profile as prof, sources, export, db
from scout.models import normalize_key, classify_industry


def test_profile_validation_rejects_sensitive_keys(profile):
    p = copy.deepcopy(profile)
    p["entity"]["ein"] = {"value": "12-3456789", "status": "VERIFIED", "source": "x"}
    probs = prof.validate_profile(p)
    assert any("sensitive key" in x for x in probs)
    with pytest.raises(ValueError):
        prof.save_profile(p)


def test_profile_validation_bad_status(profile):
    p = copy.deepcopy(profile)
    p["entity"]["legal_name"]["status"] = "MAYBE"
    assert any("invalid status" in x for x in prof.validate_profile(p))


def test_template_is_valid_and_all_missing():
    with open(prof.config.TEMPLATE_PROFILE_PATH, encoding="utf-8") as f:
        t = json.load(f)
    assert not [x for x in prof.validate_profile(t) if x.startswith("ERROR")]
    assert prof.completeness(t)["VERIFIED"] == 0


def test_fact_lookup_and_experience_split(profile):
    assert prof.fact(profile, "insurance.general_liability.per_occurrence").value == 1000000
    assert prof.fact(profile, "nothing.here").status == "MISSING"
    assert len(prof.entity_experience(profile, "Cleaning & Janitorial")) == 1
    assert len(prof.supporting_experience(profile, "Healthcare & Hospital Support")) == 1
    assert prof.entity_experience(profile, "Healthcare & Hospital Support") == []
    assert "registrations.sbr_certified" in prof.missing_facts(profile)


def test_normalize_and_classify():
    assert normalize_key("IFB-2026-JAN-0417", "Sample County") == normalize_key("ifb 2026 jan 0417", "sample county")
    assert classify_industry("roof replacement and hvac") == "Construction & Property Services"
    assert classify_industry("nightly janitorial custodial cleaning") == "Cleaning & Janitorial"
    assert classify_industry("school cafeteria meal service") == "Food & Catering"
    assert classify_industry("hospital environmental services linen") == "Cleaning & Janitorial"
    assert classify_industry("patient transport and medical supplies for the hospital") == "Healthcare & Hospital Support"
    assert classify_industry("widget calibration", ai_hint="Metrology services") == "Other: Metrology services"


def test_source_registry_readiness():
    reg = sources.load_registry()
    ids = {s["id"] for s in reg}
    assert "emma" in ids and "emma_email" in ids
    states = {s["id"]: sources.source_readiness(s)[0] for s in reg}
    assert states["emma"] == "manual"
    assert states["emma_email"] == "awaiting_credentials"
    assert states["example_rss"] == "blocked"
    for s in reg:
        assert s["access_method"] != "public_page" or s.get("allowed_fetch") is False


def test_parse_feed_rss_and_atom():
    rss = b"""<rss><channel><item><title>Bid 1</title><link>http://x/1</link><pubDate>Mon</pubDate><description>&lt;p&gt;janitorial&lt;/p&gt;</description></item></channel></rss>"""
    items = sources.parse_feed(rss)
    assert items[0]["title"] == "Bid 1" and items[0]["summary"] == "janitorial"
    atom = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link href="http://x/a"/><updated>2026</updated><summary>roof</summary></entry></feed>"""
    assert sources.parse_feed(atom)[0]["link"] == "http://x/a"


def test_parse_notification_extracts_links_and_number():
    n = sources.parse_notification("New solicitation BPM-045678 posted", "noreply@emma", "today", "See https://emma.maryland.gov/page/x for details")
    assert n["links"] == ["https://emma.maryland.gov/page/x"]
    assert n["solicitation_number"] == "BPM-045678"


def test_scan_skips_unready_sources(conn):
    r = sources.scan_source(conn, {"id": "emma_email", "name": "x", "access_method": "email_notification"})
    assert r["status"] == "skipped"
    assert db.list_scans(conn)[0]["status"] == "skipped"


def test_csv_export(conn):
    oid = db.insert_opportunity(conn, "Z|A", solicitation_number="Z", title="T", agency="A", industry="Food & Catering")
    csv = export.opportunities_csv(conn)
    assert "solicitation_number" in csv.splitlines()[0] and ",Z," in csv
    db.replace_requirements(conn, oid, None, [{"category": "insurance", "text": "GL", "page_ref": "p. 2"}])
    assert "p. 2" in export.requirements_csv(conn, oid)


def test_shipped_entity_profiles_are_valid_and_free_of_secrets():
    import re
    from pathlib import Path
    files = sorted((prof.config.PROFILES_DIR).glob("*.json"))
    assert len(files) >= 3
    for f in files:
        data = json.load(open(f, encoding="utf-8"))
        errs = [x for x in prof.validate_profile(data) if x.startswith("ERROR")]
        assert not errs, (f.name, errs)
        raw = f.read_text(encoding="utf-8")
        assert not re.search(r"\b\d{2}-\d{7}\b", raw), f"{f.name} looks like it contains an EIN"
        assert not re.search(r"\b\d{3}-\d{2}-\d{4}\b", raw), f"{f.name} looks like it contains an SSN"


def test_list_profiles_and_active_switch(tmp_path, monkeypatch):
    monkeypatch.setattr(prof.config, "ACTIVE_PROFILE_FILE", tmp_path / "active.txt")
    monkeypatch.setattr(prof.config, "USER_PROFILES_DIR", tmp_path / "profiles")
    ids = [p["id"] for p in prof.list_profiles()]
    assert "sierra_real_estate_llc" in ids and "medwise_seniors_llc" in ids and "new_maryland_entity" in ids
    prof.set_active_profile_id("medwise_seniors_llc")
    p, origin = prof.load_profile()
    assert origin == "entity:medwise_seniors_llc" and p["entity"]["state_of_formation"]["value"] == "Delaware"
    # user copy overrides shipped file with the same id
    (tmp_path / "profiles").mkdir()
    override = dict(p, profile_version="user-override")
    json.dump(override, open(tmp_path / "profiles" / "medwise_seniors_llc.json", "w"))
    p2, origin2 = prof.load_profile()
    assert p2["profile_version"] == "user-override" and origin2 == "entity:medwise_seniors_llc"


def test_mhic_license_is_not_credited_to_sierra():
    from scout import eligibility
    p = prof.load_profile_by_id("sierra_real_estate_llc")
    out = eligibility.check_license({"category": "license", "text": "Bidders must hold a current MHIC license", "mandatory": True, "page_ref": "p. 1", "document": "d"}, p)
    assert out.result == "UNKNOWN" and out.profile_fact_status == "MISSING"


def test_compare_entities(conn):
    from scout import pipeline
    oid = db.insert_opportunity(conn, "CMP|A", solicitation_number="CMP", title="Janitorial", agency="A", industry="Cleaning & Janitorial", value_low=100000, value_high=100000)
    db.replace_requirements(conn, oid, None, [
        {"category": "insurance", "text": "General liability $1,000,000 per occurrence", "value": "1000000", "mandatory": True},
        {"category": "eligibility", "text": "Must be registered on eMMA", "mandatory": True},
    ])
    rows = pipeline.compare_entities(conn, oid)
    names = {r["entity"] for r in rows}
    assert "Sierra Real Estate LLC" in names and "Medwise Seniors LLC" in names
    sre = next(r for r in rows if r["entity"] == "Sierra Real Estate LLC")
    assert sre["met"] >= 1 and sre["match_class"] == "Conditional Match"


def test_new_industries_classify():
    assert classify_industry("hotel housekeeping and laundry services for the conference center") == "Hospitality & Lodging"
    assert classify_industry("refuse collection, recycling and pest control for county parks") == "Sanitation & Waste"
