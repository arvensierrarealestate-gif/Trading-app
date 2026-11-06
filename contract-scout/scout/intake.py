"""Opportunity intake: create or update records, detect duplicates and amendments.

`ingest_document` is the one entry point used by the upload page, the sample
seeder and (later) automated sources.
"""
from __future__ import annotations

import difflib
import json
from typing import Any, Optional

from . import db, documents, analyzer, deadlines
from .models import normalize_key, classify_industry, classify_jurisdiction, VERIFIED, MISSING, utcnow_iso

TRACKED_FIELDS = ("title", "agency", "bid_deadline_utc", "value_low", "value_high", "contract_duration", "location")


def find_duplicate(conn, solicitation_number: Optional[str], agency: Optional[str], title: Optional[str]) -> tuple[Optional[dict], str]:
    """Return (existing_row, reason). Exact key match first, then fuzzy title match within the same agency."""
    key = normalize_key(solicitation_number, agency)
    if solicitation_number:
        row = db.get_opportunity_by_key(conn, key)
        if row:
            return row, "same solicitation number and agency"
        # same number, agency spelled differently
        for cand in db.list_opportunities(conn):
            if cand["normalized_key"].split("|")[0] == key.split("|")[0] and key.split("|")[0] != "NONUM":
                return cand, "same solicitation number"
    if title:
        for cand in db.list_opportunities(conn):
            ratio = difflib.SequenceMatcher(None, (cand["title"] or "").lower(), title.lower()).ratio()
            same_agency = (cand["agency"] or "").lower() == (agency or "").lower()
            if ratio >= 0.92 and (same_agency or not agency or not cand["agency"]):
                return cand, f"title similarity {ratio:.0%}"
    return None, ""


def ingest_document(conn, filename: str, data: bytes, *, source_id: str = "manual_upload", source_url: str = "",
                    doc_type: str = "solicitation", prefer_claude: bool = True, overrides: Optional[dict[str, Any]] = None,
                    is_sample: bool = False, actor: str = "user") -> dict:
    """Extract, de-duplicate, store, and return a report dict."""
    overrides = overrides or {}
    doc = documents.extract(filename, data)
    doc = documents.store(doc, data)
    extraction = analyzer.extract(doc.text, filename, prefer_claude=prefer_claude)

    sol = overrides.get("solicitation_number") or extraction["solicitation_number"]["value"]
    title = overrides.get("title") or extraction["title"]["value"] or filename
    agency = overrides.get("agency") or extraction["agency"]["value"]
    location = overrides.get("location") or extraction["location"]["value"]
    duration = overrides.get("contract_duration") or extraction["contract_duration"]["value"]
    deadline_text = overrides.get("bid_deadline_text") or extraction["bid_deadline_text"]["value"]
    dl = deadlines.parse_deadline(deadline_text) if deadline_text else None
    dl_utc, dl_local, dl_tz = deadlines.to_storage(dl)
    ev = extraction.get("estimated_value") or {}
    value_low = overrides.get("value_low", ev.get("low"))
    value_high = overrides.get("value_high", ev.get("high"))
    value_status = VERIFIED if value_low is not None and not overrides.get("value_low") else ("ASSUMED" if value_low is not None else MISSING)
    value_note = ev.get("text", "")
    if ev.get("page_ref"):
        value_note += f" ({ev['page_ref']})"
    industry = overrides.get("industry") or classify_industry(" ".join([title or "", extraction.get("scope_summary", ""), doc.text[:5000]]), ai_hint=extraction.get("industry"))

    existing, reason = find_duplicate(conn, sol, agency, title)
    changes: list[dict] = []
    if existing:
        opp_id = int(existing["id"])
        new_vals = {"title": title, "agency": agency or existing["agency"], "bid_deadline_utc": dl_utc or existing["bid_deadline_utc"],
                    "value_low": value_low if value_low is not None else existing["value_low"],
                    "value_high": value_high if value_high is not None else existing["value_high"],
                    "contract_duration": duration or existing["contract_duration"], "location": location or existing["location"]}
        for f in TRACKED_FIELDS:
            old, new = existing.get(f), new_vals.get(f)
            if new is not None and str(old) != str(new):
                changes.append({"field": f, "old": old, "new": new})
        db.update_opportunity(conn, opp_id, last_seen=utcnow_iso(), bid_deadline_local=dl_local or existing["bid_deadline_local"],
                              set_aside=extraction.get("set_aside") or existing.get("set_aside"), award_basis=extraction.get("award_basis") or existing.get("award_basis"),
                              services_requested=json.dumps(extraction.get("services_requested") or json.loads(existing.get("services_requested") or "[]")),
                              subcontracting_allowed=extraction.get("subcontracting_allowed") or existing.get("subcontracting_allowed"),
                              joint_venture_allowed=extraction.get("joint_venture_allowed") or existing.get("joint_venture_allowed"),
                              open_to_new_businesses=extraction.get("open_to_new_businesses") or existing.get("open_to_new_businesses"),
                              deadline_tz=dl_tz or existing["deadline_tz"], deadline_status=VERIFIED if (dl_utc or existing["bid_deadline_utc"]) else MISSING,
                              value_status=value_status if value_low is not None else existing["value_status"], value_note=value_note or existing["value_note"], **new_vals)
        if doc_type == "solicitation" and changes:
            doc_type = "amendment"
        created = False
    else:
        key = normalize_key(sol, agency)
        if db.get_opportunity_by_key(conn, key):
            key = f"{key}|{doc.sha256[:8]}"
        opp_id = db.insert_opportunity(
            conn, key, solicitation_number=sol, title=title, agency=agency,
            jurisdiction=overrides.get("jurisdiction") or classify_jurisdiction(agency or "", location or "", source_id, source_url, doc.text[:3000]),
            industry=industry, location=location, source_id=source_id, source_url=source_url,
            summary=extraction.get("scope_summary", ""), contract_duration=duration, value_low=value_low, value_high=value_high,
            value_status=value_status, value_note=value_note, bid_deadline_utc=dl_utc, bid_deadline_local=dl_local, deadline_tz=dl_tz,
            deadline_status=VERIFIED if dl_utc else MISSING, is_sample=1 if is_sample else 0,
            set_aside=extraction.get("set_aside"), award_basis=extraction.get("award_basis"),
            services_requested=json.dumps(extraction.get("services_requested") or []), subcontracting_allowed=extraction.get("subcontracting_allowed"),
            joint_venture_allowed=extraction.get("joint_venture_allowed"), open_to_new_businesses=extraction.get("open_to_new_businesses"),
        )
        created = True
    doc_id = db.add_document(conn, opp_id, filename, doc.sha256, doc_type=doc_type, page_count=doc.page_count, char_count=doc.char_count,
                             stored_path=doc.stored_path, text_path=doc.text_path, source_url=source_url, extraction_method=f"{doc.method} + {extraction.get('_engine', 'unknown')}")
    for c in changes:
        db.add_change_event(conn, opp_id, c["field"], c["old"], c["new"], document_id=doc_id)
    n_req = db.replace_requirements(conn, opp_id, doc_id, extraction.get("requirements", []))
    db.log(conn, "ingest_document", "opportunity", opp_id, {"filename": filename, "created": created, "duplicate_of": existing["id"] if existing else None,
                                                             "reason": reason, "requirements": n_req, "engine": extraction.get("_engine"), "changes": changes}, actor=actor)
    return {
        "opportunity_id": opp_id, "document_id": doc_id, "created": created, "duplicate_reason": reason, "changes": changes,
        "requirements_extracted": n_req, "engine": extraction.get("_engine"), "extraction": extraction, "doc": doc,
        "deadline_parsed": dl is not None, "deadline_text": deadline_text, "missing_core": analyzer.missing_core_categories(extraction),
    }
