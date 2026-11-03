import copy

from scout import eligibility
from scout.models import STRONG, CONDITIONAL, POOR, MET, NOT_MET, UNKNOWN, VERIFIED


def req(cat, text, value=None, mandatory=True):
    return {"category": cat, "text": text, "value": value, "mandatory": mandatory, "page_ref": "p. 1", "document": "d.pdf", "quote": text}


FULL = [
    req("eligibility", "Bidders must be registered on eMMA"),
    req("experience", "minimum of three (3) years of experience in janitorial", "3 years"),
    req("license", "Bidders must hold an MHIC license"),
    req("insurance", "Commercial General Liability $1,000,000 per occurrence", "1000000"),
    req("bond", "No bid bond is required", mandatory=False),
]


def test_strong_when_all_mandatory_met_and_bonding_na(profile):
    p = copy.deepcopy(profile)
    res = eligibility.evaluate(FULL, p, industry="Cleaning & Janitorial", contract_value=100000)
    assert res["match_class"] == STRONG
    assert not res["blockers"] and not res["conditions"]


def test_unknown_mandatory_blocks_strong(profile):
    reqs = FULL + [req("insurance", "Automobile liability $1,000,000", "1000000")]
    res = eligibility.evaluate(reqs, profile, industry="Cleaning & Janitorial", contract_value=100000)
    assert res["match_class"] == CONDITIONAL
    assert any(c["result"] == UNKNOWN and "automobile" in c["explanation"] for c in res["conditions"])


def test_not_met_insurance_is_poor(profile):
    reqs = FULL + [req("insurance", "General liability $2,000,000 per occurrence", "2000000")]
    res = eligibility.evaluate(reqs, profile, industry="Cleaning & Janitorial", contract_value=100000)
    assert res["match_class"] == POOR
    assert res["blockers"][0]["result"] == NOT_MET and res["blockers"][0]["partner_path"] is True


def test_core_category_missing_is_unknown(profile):
    reqs = [r for r in FULL if r["category"] != "bond"]
    res = eligibility.evaluate(reqs, profile, industry="Cleaning & Janitorial")
    missing = [c for c in res["checks"] if c["requirement"].startswith("No bond requirement found")]
    assert missing and missing[0]["result"] == UNKNOWN and missing[0]["mandatory"]
    assert res["match_class"] == CONDITIONAL


def test_owner_experience_never_satisfies(profile):
    # healthcare: only owner experience exists in the sample profile
    r = req("experience", "minimum of two (2) years of hospital support experience", "2 years")
    out = eligibility.check_experience(r, profile, "Healthcare & Hospital Support")
    assert out.result == UNKNOWN and "supporting context only" in out.explanation


def test_experience_years_not_met(profile):
    r = req("experience", "minimum of ten (10) years", "10 years")
    out = eligibility.check_experience(r, profile, "Cleaning & Janitorial")
    assert out.result == NOT_MET and out.partner_path


def test_formation_date_unverified_gives_unknown(profile):
    p = copy.deepcopy(profile)
    p["entity"]["formation_date"]["status"] = "MISSING"
    out = eligibility.check_experience(req("experience", "5 years", "5 years"), p, None)
    assert out.result == UNKNOWN


def test_license_missing_and_expired(profile):
    out = eligibility.check_license(req("license", "Master Plumber license required"), profile)
    assert out.result == NOT_MET and "Master Plumber" in out.explanation
    p = copy.deepcopy(profile)
    p["licenses"][0]["expires"] = "2020-01-01"
    out = eligibility.check_license(req("license", "MHIC license required"), p)
    assert out.result == NOT_MET and "expired" in out.explanation


def test_sbr_and_mbe_rules(profile):
    sbr = eligibility.check_eligibility(req("eligibility", "Small Business Reserve procurement; only SBR-certified bidders eligible"), profile)
    assert sbr.result == UNKNOWN and sbr.profile_fact_status == "MISSING"
    mbe = eligibility.check_eligibility(req("eligibility", "MBE participation goal of 29%", "29%"), profile)
    assert mbe.result == UNKNOWN and mbe.partner_path and "29%" in mbe.explanation


def test_bond_with_and_without_capacity(profile):
    from scout.insurance import check_bond
    r = req("bond", "Performance bond of 100% of the contract price", "100%")
    assert check_bond(r, profile, 500000).result == UNKNOWN
    p = copy.deepcopy(profile)
    p["bonding"]["single_project_limit"] = {"value": 1000000, "status": VERIFIED, "source": "surety letter"}
    assert check_bond(r, p, 500000).result == MET
    assert check_bond(r, p, 2000000).result == NOT_MET
    assert check_bond(r, p, None).result == UNKNOWN


def test_every_check_is_traceable(profile):
    res = eligibility.evaluate(FULL, profile, industry="Cleaning & Janitorial", contract_value=100000)
    for c in res["checks"]:
        assert c["explanation"] and c["category"] and c["result"] in ("MET", "NOT_MET", "UNKNOWN", "NOT_APPLICABLE")


def test_foreign_entity_without_sdat_registration_is_flagged(profile):
    p = copy.deepcopy(profile)
    p["entity"]["state_of_formation"]["value"] = "Delaware"
    p["entity"]["sdat_department_id"]["status"] = "MISSING"
    res = eligibility.evaluate(FULL, p, industry="Cleaning & Janitorial", contract_value=100000)
    assert any("foreign LLC" in c["requirement"] for c in res["checks"])
    assert res["match_class"] == CONDITIONAL
