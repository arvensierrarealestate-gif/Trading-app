import json

from scout import sources, config


HTML = """<html><body>
<a href="/bids/123">IFB 26-ROOF-088 Roof Replacement at Sample Elementary School</a>
<a href="https://portal.example/solicitations/456">Request for Proposals: Janitorial Services FY27</a>
<a href="/about">About us</a>
<a href="/bids/789">Bid</a>
<a href="/bids/123">IFB 26-ROOF-088 Roof Replacement at Sample Elementary School</a>
</body></html>"""


def test_parse_listing_html_filters_and_dedupes():
    items = sources.parse_listing_html(HTML, "https://portal.example/list")
    links = [i["link"] for i in items]
    assert "https://portal.example/bids/123" in links and "https://portal.example/solicitations/456" in links
    assert all("about" not in l for l in links) and len(links) == 2


def test_overrides_merge_and_persist(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    before = {s["id"]: s for s in sources.load_registry()}["emma_public_listing"]
    assert before["allowed_fetch"] is False and sources.source_readiness(before)[0] == "blocked"
    sources.save_source_override("emma_public_listing", listing_url="https://emma.maryland.gov/page.aspx/en/rfp/request_browse_public", allowed_fetch=True)
    after = {s["id"]: s for s in sources.load_registry()}["emma_public_listing"]
    assert after["allowed_fetch"] is True and after["listing_url"].startswith("https://emma")
    assert sources.source_readiness(after)[0] == "ready"
    assert json.loads((tmp_path / "source_overrides.json").read_text())["emma_public_listing"]["allowed_fetch"] is True


def test_robots_failure_means_not_allowed():
    assert sources.robots_allows("https://no-such-host.invalid/page") is False
