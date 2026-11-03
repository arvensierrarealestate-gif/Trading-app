"""Solicitation Document Reader.

Two engines:
* `claude_extract`  - structured extraction with the Anthropic API (needs ANTHROPIC_API_KEY).
* `heuristic_extract` - offline regex pass used for tests and when no key is set.
  It is deliberately conservative and labels everything as low-confidence.

Both return the same dictionary shape (see extraction_schema.SOLICITATION_SCHEMA).
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

from . import config
from .extraction_schema import SOLICITATION_SCHEMA, SYSTEM_PROMPT
from .models import REQ_CATEGORIES, CORE_MANDATORY_CATEGORIES

_PAGE_RE = re.compile(r"\[\[PAGE (\d+)\]\]")


def split_pages(full_text: str) -> list[tuple[int, str]]:
    parts = _PAGE_RE.split(full_text)
    if len(parts) < 3:
        return [(1, full_text)]
    out = []
    for i in range(1, len(parts), 2):
        out.append((int(parts[i]), parts[i + 1]))
    return out


def _sentences(page_text: str) -> list[str]:
    text = re.sub(r"\s+", " ", page_text)
    return [s.strip() for s in re.split(r"(?<=[.;:])\s+(?=[A-Z(\d])", text) if len(s.strip()) > 15]


_MONEY = r"\$\s?([\d,]+(?:\.\d+)?)\s*(million|m\b|k\b)?"


def _money_to_number(amount: str, unit: Optional[str]) -> Optional[float]:
    try:
        n = float(amount.replace(",", ""))
    except ValueError:
        return None
    if unit:
        u = unit.lower()
        if u.startswith("m"):
            n *= 1_000_000
        elif u.startswith("k"):
            n *= 1_000
    return n


_WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}

# (category, regex, mandatory, value_group_handler)
_RULES: list[tuple[str, re.Pattern, bool]] = [
    ("insurance", re.compile(r"(commercial general liability|general liability|cgl)[^.]{0,120}?" + _MONEY, re.I), True),
    ("insurance", re.compile(r"(automobile liability|auto liability|business auto)[^.]{0,120}?" + _MONEY, re.I), True),
    ("insurance", re.compile(r"(umbrella|excess liability)[^.]{0,120}?" + _MONEY, re.I), True),
    ("insurance", re.compile(r"(workers['’]?\s*compensation)", re.I), True),
    ("insurance", re.compile(r"(professional liability|errors and omissions|pollution liability)[^.]{0,120}?" + _MONEY, re.I), True),
    ("bond", re.compile(r"(bid bond|bid security|bid guaranty)[^.]{0,80}?(\d{1,3})\s?%", re.I), True),
    ("bond", re.compile(r"(performance bond)[^.]{0,80}?(\d{1,3})\s?%", re.I), True),
    ("bond", re.compile(r"(payment bond)[^.]{0,80}?(\d{1,3})\s?%", re.I), True),
    ("bond", re.compile(r"\b(no (bid|performance|payment) bond[s]? (is|are|will be) required)", re.I), False),
    ("experience", re.compile(r"(minimum of|at least|not less than)\s+(\w+)\s*(?:\((\d+)\))?\s*years", re.I), True),
    ("experience", re.compile(r"(\d+)\s*\+?\s*years['’]? (of )?(documented |demonstrated |relevant )?experience", re.I), True),
    ("experience", re.compile(r"(three|\d+)\s*\(?\d*\)?\s*(similar|comparable) (projects|contracts|references)", re.I), True),
    ("license", re.compile(r"\b(MHIC|Maryland Home Improvement Commission)\b", re.I), True),
    ("license", re.compile(r"\b(master (electrician|plumber)|HVACR?|HVAC license|electrical license|plumbing license)\b", re.I), True),
    ("license", re.compile(r"\b(food service (facility )?license|health department permit|food (handler|manager) certification|ServSafe)\b", re.I), True),
    ("license", re.compile(r"\b(business license|contractor['’]?s? license|trade license)\b", re.I), True),
    ("eligibility", re.compile(r"\b(eMMA|eMaryland Marketplace Advantage|eMaryland Marketplace)\b", re.I), True),
    ("eligibility", re.compile(r"\b(Small Business Reserve|SBR)\b", re.I), True),
    ("eligibility", re.compile(r"(MBE|minority business enterprise)[^.]{0,80}?(\d{1,3})\s?%", re.I), True),
    ("eligibility", re.compile(r"(good standing)[^.]{0,80}?(SDAT|Department of Assessments and Taxation|State of Maryland)", re.I), True),
    ("eligibility", re.compile(r"\b(SAM\.gov|System for Award Management|UEI)\b", re.I), True),
    ("eligibility", re.compile(r"\b(local preference|located within|principal office in)\b", re.I), False),
    ("meeting", re.compile(r"\b(mandatory|required) (pre-?bid|pre-?proposal) (conference|meeting|site visit)\b", re.I), True),
    ("meeting", re.compile(r"\b(pre-?bid|pre-?proposal) (conference|meeting|site visit)\b", re.I), False),
    ("submission", re.compile(r"\b(bid/proposal affidavit|proposal affidavit|bid affidavit|affidavit)\b", re.I), True),
    ("submission", re.compile(r"\b(W-9|references|certificate of insurance|COI)\b", re.I), True),
    ("financial", re.compile(r"\b(financial statements?|audited statements?|balance sheet|line of credit|bank reference)\b", re.I), True),
    ("staffing", re.compile(r"\b(background check|fingerprint|CJIS|drug[- ]free|key personnel|project manager shall|site supervisor)\b", re.I), True),
    ("equipment", re.compile(r"\b(contractor shall (furnish|provide) all (equipment|vehicles|tools))\b", re.I), True),
    ("risk", re.compile(r"\b(liquidated damages|prevailing wage|living wage|Davis-Bacon|termination for convenience|retainage)\b", re.I), True),
]

_SOL_NUM_RE = re.compile(
    r"(?:Solicitation|Bid|IFB|RFP|RFQ|Project|Contract|Reference)\s*(?:No\.?|Number|#|ID)?\s*[:#]?\s*([A-Z]{1,6}[-/ ]?\d{2,}[A-Z0-9\-/\.]*|\d{2,}[-/][A-Z0-9\-/\.]{2,})", re.I)
_DEADLINE_HINT_RE = re.compile(r"(due|closing|deadline|must be received|received until|will be received|accepted until|no later than|will be opened|submission date)", re.I)
_VALUE_RE = re.compile(r"(estimated (?:contract )?(?:value|budget|cost|amount)|not[- ]to[- ]exceed|anticipated (?:value|budget))[^.]{0,80}?" + _MONEY, re.I)
_DURATION_RE = re.compile(r"((?:one|two|three|four|five|\d+)[- ]year(?:s)?(?: base)?(?: (?:term|period|contract))(?:[^.]{0,60}?(?:option|renewal)[^.]{0,40})?|(?:substantially )?complete(?:d)? within (?:\d+) (?:calendar |working )?days[^.]{0,40})", re.I)
_ISSUED_BY_RE = re.compile(r"(?:Issued by|Issuing (?:agency|office)|Procurement officer for)\s*[:\-]\s*([^\n]{4,120})", re.I)
_AGENCY_RE = re.compile(r"((?:Maryland |State of Maryland |Baltimore |Montgomery |Prince George['’]s |Anne Arundel |Howard |Harford |Frederick )?(?:Department|Dept\.|County|City|Board of Education|Public Schools|University|Hospital|Authority|Commission|Administration|Office) of [A-Z][A-Za-z&' ]{3,60})")
_LOCATION_RE = re.compile(r"\b(Baltimore City|Baltimore County|Montgomery County|Prince George['’]s County|Anne Arundel County|Howard County|Harford County|Frederick County|Carroll County|Charles County|Calvert County|St\. Mary['’]s County|Washington County|Cecil County|Wicomico County|Annapolis|Baltimore, M(?:D|aryland)|Rockville|Silver Spring|Largo|Towson|Columbia, M(?:D|aryland)|Upper Marlboro|Hyattsville)\b")


def _field(value: Optional[str], page: Optional[int], conf: float) -> dict:
    return {"value": value, "page_ref": f"p. {page}" if page else "", "confidence": conf}


def heuristic_extract(full_text: str, filename: str = "") -> dict:
    """Offline, conservative extraction. Confidence is capped at 0.6."""
    pages = split_pages(full_text)
    reqs: list[dict] = []
    seen: set[tuple[str, str]] = set()
    sol_num = title = agency = location = duration = deadline_text = None
    sol_page = agency_page = loc_page = dur_page = dl_page = None
    value_low = value_high = None
    value_text, value_page = "", None

    for pno, ptext in pages:
        if sol_num is None:
            m = _SOL_NUM_RE.search(ptext)
            if m:
                sol_num, sol_page = m.group(1).strip().rstrip("."), pno
        if agency is None:
            m = _ISSUED_BY_RE.search(ptext) or _AGENCY_RE.search(ptext)
            if m:
                agency, agency_page = re.split(r"\s+(?:apply|applies|shall|will|must)\b", m.group(1).strip())[0].strip(" .,"), pno
        if location is None:
            m = _LOCATION_RE.search(ptext)
            if m:
                location, loc_page = m.group(1), pno
        if duration is None:
            m = _DURATION_RE.search(ptext)
            if m:
                duration, dur_page = re.sub(r"\s+", " ", m.group(1)).strip(), pno
        if value_low is None:
            m = _VALUE_RE.search(ptext)
            if m:
                n = _money_to_number(m.group(2), m.group(3))
                if n:
                    value_low = value_high = n
                    value_text, value_page = m.group(0), pno
        for sent in _sentences(ptext):
            if deadline_text is None and _DEADLINE_HINT_RE.search(sent) and re.search(r"\d{4}|\d{1,2}/\d{1,2}/\d{2,4}", sent):
                deadline_text, dl_page = sent, pno
            for cat, rx, mandatory in _RULES:
                m = rx.search(sent)
                if not m:
                    continue
                key = (cat, rx.pattern, m.group(0)[:40].lower())
                if key in seen:
                    continue
                seen.add(key)
                value = None
                groups = [g for g in m.groups() if g]
                if cat == "insurance" and m.lastindex and m.lastindex >= 2:
                    n = _money_to_number(m.group(2), m.group(3) if m.lastindex >= 3 else None)
                    value = str(int(n)) if n else None
                elif cat == "bond" and m.lastindex and m.lastindex >= 2 and str(m.group(2)).isdigit():
                    value = f"{m.group(2)}%"
                elif cat == "experience":
                    nums = [g for g in groups if str(g).isdigit()]
                    words = [g for g in groups if str(g).lower() in _WORD_NUM]
                    n = nums[0] if nums else (str(_WORD_NUM[words[0].lower()]) if words else None)
                    if n is not None and re.search(r"similar|comparable", m.group(0), re.I):
                        value = f"{n} similar projects"
                    elif n is not None:
                        value = f"{n} years"
                elif cat == "eligibility" and "MBE" in m.group(0).upper() and m.lastindex and m.lastindex >= 2 and str(m.group(2)).isdigit():
                    value = f"{m.group(2)}%"
                is_mandatory = mandatory and (bool(re.search(r"\b(shall|must|required|mandatory|minimum|only .{0,40}eligible)\b", sent, re.I)) or cat in ("insurance", "bond", "eligibility", "license"))
                reqs.append({
                    "category": cat,
                    "text": sent if len(sent) < 300 else sent[:297] + "...",
                    "mandatory": bool(is_mandatory),
                    "value": value,
                    "page_ref": f"p. {pno}",
                    "quote": m.group(0)[:200],
                    "confidence": 0.55 if value else 0.45,
                    "document": filename,
                    "info_status": "VERIFIED",
                    "method": "heuristic",
                })
    # title: first non-empty line that looks like a heading
    first_page = pages[0][1] if pages else ""
    generic = ("invitation for bid", "request for proposal", "request for quotation", "request for qualification", "solicitation", "notice to bidders", "page", "sample", "fictitious")
    for line in first_page.splitlines():
        s = line.strip()
        low = s.lower()
        if 12 <= len(s) <= 140 and not low.startswith(generic):
            title = s
            break
        if low.startswith(generic[:4]) and " - " in s:
            title = s.split(" - ", 1)[1].strip()
            break
    found_cats = {r["category"] for r in reqs}
    not_found = [c for c in REQ_CATEGORIES if c not in found_cats and c != "scope"]
    scope_sents = []
    for pno, ptext in pages:
        for sent in _sentences(ptext):
            if re.search(r"\b(scope of work|contractor shall provide|services include|the work consists)\b", sent, re.I):
                scope_sents.append(sent)
    return {
        "solicitation_number": _field(sol_num, sol_page, 0.5 if sol_num else 0.0),
        "title": _field(title, 1 if title else None, 0.4 if title else 0.0),
        "agency": _field(agency, agency_page, 0.45 if agency else 0.0),
        "location": _field(location, loc_page, 0.45 if location else 0.0),
        "contract_duration": _field(duration, dur_page, 0.4 if duration else 0.0),
        "bid_deadline_text": _field(deadline_text, dl_page, 0.5 if deadline_text else 0.0),
        "estimated_value": {"low": value_low, "high": value_high, "text": value_text or "Not stated in document", "page_ref": f"p. {value_page}" if value_page else "", "confidence": 0.5 if value_low else 0.0},
        "scope_summary": " ".join(scope_sents[:4])[:1200] or "Scope not located by heuristic reader; review document.",
        "requirements": reqs,
        "not_found": not_found,
        "_engine": "heuristic",
    }


def claude_extract(full_text: str, filename: str = "", model: Optional[str] = None) -> dict:
    """Structured extraction with Claude. Raises RuntimeError with a readable reason on failure."""
    if not config.anthropic_available():
        raise RuntimeError("ANTHROPIC_API_KEY is not set; Claude extraction unavailable.")
    import anthropic

    model = model or config.CLAUDE_MODEL
    client = anthropic.Anthropic()
    chunks = _chunk_text(full_text, config.MAX_DOC_CHARS_FOR_CLAUDE)
    merged: Optional[dict] = None
    use_fallbacks = os.getenv("SCOUT_CLAUDE_FALLBACKS", "true").lower() in ("1", "true", "yes")
    for i, chunk in enumerate(chunks):
        user_msg = (
            f"Document: {filename or 'uploaded solicitation'} (part {i + 1} of {len(chunks)}).\n"
            "Extract the solicitation fields and every requirement. Cite pages using the [[PAGE n]] markers.\n\n"
            f"{chunk}"
        )
        kwargs: dict[str, Any] = dict(
            model=model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
            output_config={"format": {"type": "json_schema", "schema": SOLICITATION_SCHEMA}},
        )
        try:
            if use_fallbacks:
                # Server-side refusal fallback: if the model declines, the API re-runs on a
                # fallback model inside the same call. Untested in this environment.
                response = client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
            else:
                response = client.messages.create(**kwargs)
        except anthropic.AuthenticationError as exc:
            raise RuntimeError(f"Anthropic authentication failed: {exc}") from exc
        except anthropic.RateLimitError as exc:
            raise RuntimeError(f"Anthropic rate limit: {exc}") from exc
        except anthropic.APIStatusError as exc:
            raise RuntimeError(f"Anthropic API error {exc.status_code}: {exc.message}") from exc
        except anthropic.APIConnectionError as exc:
            raise RuntimeError(f"Could not reach the Anthropic API: {exc}") from exc
        if response.stop_reason == "refusal":
            detail = getattr(response, "stop_details", None)
            raise RuntimeError(f"Claude declined to process this document ({detail}).")
        text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), "")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"Claude returned non-JSON output: {exc}") from exc
        for r in data.get("requirements", []):
            r.setdefault("document", filename)
            r["document"] = filename
            r["info_status"] = "VERIFIED"
            r["method"] = "claude"
        merged = data if merged is None else _merge(merged, data)
    assert merged is not None
    merged["_engine"] = f"claude:{model}"
    merged["_usage"] = None
    return merged


def _chunk_text(text: str, max_chars: int) -> list[str]:
    if len(text) <= max_chars:
        return [text]
    pages = split_pages(text)
    chunks, cur = [], ""
    for pno, ptext in pages:
        piece = f"[[PAGE {pno}]]\n{ptext}\n"
        if cur and len(cur) + len(piece) > max_chars:
            chunks.append(cur)
            cur = ""
        cur += piece
    if cur:
        chunks.append(cur)
    return chunks


def _merge(a: dict, b: dict) -> dict:
    out = dict(a)
    for k in ("solicitation_number", "title", "agency", "location", "contract_duration", "bid_deadline_text"):
        if not (a.get(k) or {}).get("value") and (b.get(k) or {}).get("value"):
            out[k] = b[k]
    if (a.get("estimated_value") or {}).get("low") is None and (b.get("estimated_value") or {}).get("low") is not None:
        out["estimated_value"] = b["estimated_value"]
    out["requirements"] = list(a.get("requirements", [])) + list(b.get("requirements", []))
    out["not_found"] = sorted(set(a.get("not_found", [])) & set(b.get("not_found", [])))
    if len(b.get("scope_summary", "")) > len(a.get("scope_summary", "")):
        out["scope_summary"] = b["scope_summary"]
    return out


def extract(full_text: str, filename: str = "", prefer_claude: bool = True) -> dict:
    """Use Claude when available and requested; otherwise the heuristic reader."""
    if prefer_claude and config.anthropic_available():
        return claude_extract(full_text, filename)
    return heuristic_extract(full_text, filename)


def missing_core_categories(extraction: dict) -> list[str]:
    present = {r.get("category") for r in extraction.get("requirements", [])}
    return [c for c in CORE_MANDATORY_CATEGORIES if c not in present]
