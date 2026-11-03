from scout import analyzer


def _by_cat(res, cat):
    return [r for r in res["requirements"] if r["category"] == cat]


def test_janitorial_header_fields(janitorial_text):
    res = analyzer.heuristic_extract(janitorial_text, "jan.pdf")
    assert res["solicitation_number"]["value"] == "IFB-2026-JAN-0417"
    assert res["title"]["value"].startswith("Janitorial Services")
    assert "General Services" in res["agency"]["value"]
    assert "December 4, 2026" in res["bid_deadline_text"]["value"]
    assert res["estimated_value"]["low"] == 420000
    assert res["estimated_value"]["page_ref"] == "p. 1"
    assert "renewal" in res["contract_duration"]["value"]
    assert res["_engine"] == "heuristic"


def test_janitorial_requirements(janitorial_text):
    res = analyzer.heuristic_extract(janitorial_text, "jan.pdf")
    ins = _by_cat(res, "insurance")
    assert any(r["value"] == "1000000" and "general liability" in r["text"].lower() for r in ins)
    assert all(r["page_ref"] == "p. 3" for r in ins)
    bonds = _by_cat(res, "bond")
    assert any(r["value"] == "100%" and r["mandatory"] for r in bonds)
    assert any("no bid bond" in r["text"].lower() and not r["mandatory"] for r in bonds)
    elig = _by_cat(res, "eligibility")
    assert any("emma" in r["text"].lower() for r in elig)
    assert any("small business reserve" in r["text"].lower() and r["mandatory"] for r in elig)
    exp = _by_cat(res, "experience")
    assert any(r["value"] == "3 years" for r in exp)
    assert any(r["mandatory"] for r in _by_cat(res, "meeting"))
    assert "insurance" not in res["not_found"]
    assert "license" in res["not_found"]
    for r in res["requirements"]:
        assert r["document"] == "jan.pdf" and r["quote"] and 0 < r["confidence"] <= 0.6 and r["method"] == "heuristic"


def test_roofing_requirements(roofing_text):
    res = analyzer.heuristic_extract(roofing_text, "roof.docx")
    assert res["solicitation_number"]["value"] == "IFB 26-ROOF-088"
    assert res["agency"]["value"].startswith("Sample County Public Schools")
    assert "November 20, 2026" in res["bid_deadline_text"]["value"]
    assert res["estimated_value"]["low"] == 875000
    vals = {r["value"] for r in _by_cat(res, "bond")}
    assert "5%" in vals and "100%" in vals
    assert any(r["value"] == "5 years" for r in _by_cat(res, "experience"))
    assert any(r["value"] == "3 similar projects" for r in _by_cat(res, "experience"))
    assert any("mhic" in r["text"].lower() for r in _by_cat(res, "license"))
    ins_vals = {r["value"] for r in _by_cat(res, "insurance")}
    assert {"2000000", "1000000", "5000000"} <= ins_vals
    assert any(r["value"] == "29%" for r in _by_cat(res, "eligibility"))
    assert "120 calendar days" in res["contract_duration"]["value"]


def test_empty_document_reports_nothing_found():
    res = analyzer.heuristic_extract("[[PAGE 1]]\nNothing useful here.", "x.txt")
    assert res["solicitation_number"]["value"] is None
    assert res["estimated_value"]["low"] is None
    assert res["requirements"] == []
    assert set(analyzer.missing_core_categories(res)) == {"eligibility", "experience", "license", "insurance", "bond"}


def test_claude_unavailable_without_key(janitorial_text):
    import pytest
    with pytest.raises(RuntimeError):
        analyzer.claude_extract(janitorial_text)
    # extract() must fall back cleanly
    assert analyzer.extract(janitorial_text, prefer_claude=True)["_engine"] == "heuristic"


def test_chunking_keeps_page_markers():
    text = "".join(f"[[PAGE {i}]]\n{'x' * 100}\n" for i in range(1, 11))
    chunks = analyzer._chunk_text(text, 350)
    assert len(chunks) > 1 and all(c.startswith("[[PAGE") for c in chunks)
