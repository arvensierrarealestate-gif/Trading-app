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
    assert classify_industry("hospital environmental services linen") == "Healthcare & Hospital Support"


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
