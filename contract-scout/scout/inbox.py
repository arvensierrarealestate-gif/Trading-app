"""Automated intake from notification emails (eMMA, OpenGov, BidNet, PlanetBids, ...).

Flow per message:
  parse -> map sender/links to a source -> create or update the opportunity ->
  ingest attached PDF/DOCX files -> download linked files only from allowed hosts ->
  evaluate against the active entity profile.

Reads the inbox read-only over IMAP and remembers processed message IDs, so a
message is never handled twice. Nothing is ever sent from the inbox.
"""
from __future__ import annotations

import email
import imaplib
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.message import Message
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from . import config, db, intake, deadlines, pipeline, analyzer, documents
from .models import classify_industry, normalize_key, utcnow_iso, MISSING, VERIFIED

USER_AGENT = "MarylandContractScout/0.1 (private research tool)"
MAX_FILE_BYTES = 40 * 1024 * 1024
FILE_EXTS = (".pdf", ".docx", ".txt")

# sender / link domain -> source id in source_registry.json
SOURCE_HINTS = [
    ("emma.maryland.gov", "emma_email"), ("maryland.gov", "emma_email"),
    ("opengov.com", "baltimore_county"), ("baltimorecountymd.gov", "baltimore_county"),
    ("bidnetdirect.com", "bidnet_maryland"), ("bidnet.com", "bidnet_maryland"),
    ("montgomerycountymd.gov", "montgomery_county"), ("govdelivery.com", "montgomery_county"),
    ("planetbids.com", "howard_county"), ("howardcountymd.gov", "howard_county"),
    ("ariba.com", "prince_georges_county"), ("princegeorgescountymd.gov", "prince_georges_county"),
    ("baltimorecity.gov", "baltimore_city"), ("publicpurchase.com", "carroll_county"),
    ("montgomeryschoolsmd.org", "mcps"), ("pgcps.org", "pgcps"), ("baltimorecityschools.org", "baltimore_city_schools"),
    ("dgs.dc.gov", "dc_dgs_email"), ("ocp.dc.gov", "dc_ocp_email"), ("dc.gov", "dc_ocp_email"), ("esourcing", "dc_ocp_email"),
]
_CANCEL_RE = re.compile(r"\b(cancel+ed|cancel+ation|withdrawn|rescinded)\b", re.I)

# hosts the bot may download a directly linked file from (public attachments only)
DEFAULT_FILE_HOSTS = ("emma.maryland.gov", "procurement.opengov.com", "www.bidnetdirect.com", "pbsystem.planetbids.com",
                      "www.montgomerycountymd.gov", "montgomerycountymd.gov", "www.baltimorecountymd.gov", "www.howardcountymd.gov",
                      "www.princegeorgescountymd.gov", "procurement.baltimorecity.gov", "dgs.dc.gov", "ocp.dc.gov", "dchealth.dc.gov", "dcps.dc.gov")


def allowed_file_hosts() -> set[str]:
    extra = [h.strip().lower() for h in os.getenv("SCOUT_ALLOWED_FILE_HOSTS", "").split(",") if h.strip()]
    return set(DEFAULT_FILE_HOSTS) | set(extra)


@dataclass
class Notice:
    uid: str
    message_id: str
    subject: str
    sender: str
    date: str
    body: str
    links: list[str] = field(default_factory=list)
    attachments: list[tuple[str, bytes]] = field(default_factory=list)   # (filename, bytes)

    @property
    def sender_domain(self) -> str:
        m = re.search(r"@([A-Za-z0-9.-]+)", self.sender or "")
        return (m.group(1) if m else "").lower()


_SOL_NUM = re.compile(r"\b((?:BPM|IFB|RFP|RFQ|RFI|ITB|B|P|Q)[-\s]?\d{4,}[A-Z0-9\-]*|[A-Z]{2,6}-\d{2,}-[A-Z0-9\-]{2,}|\d{2,}-\d{3,}[A-Z0-9\-]*)\b")
_DUE = re.compile(r"(due date|closing date|close date|deadline|bids? due|proposals? due|responses? due|end date|submission deadline)[^\n:]{0,20}[:\-]?\s*([^\n]{6,60})", re.I)


def parse_message(raw: bytes, uid: str = "") -> Notice:
    msg: Message = email.message_from_bytes(raw)
    body_parts: list[str] = []
    attachments: list[tuple[str, bytes]] = []
    for part in msg.walk():
        ctype = part.get_content_type()
        fname = part.get_filename()
        if fname and fname.lower().endswith(FILE_EXTS):
            data = part.get_payload(decode=True) or b""
            if 0 < len(data) <= MAX_FILE_BYTES:
                attachments.append((fname, data))
            continue
        if ctype == "text/plain" and not fname:
            body_parts.append((part.get_payload(decode=True) or b"").decode(part.get_content_charset() or "utf-8", errors="replace"))
        elif ctype == "text/html" and not fname and not body_parts:
            html = (part.get_payload(decode=True) or b"").decode(part.get_content_charset() or "utf-8", errors="replace")
            body_parts.append(re.sub(r"<[^>]+>", " ", html))
    body = "\n".join(body_parts)
    links = []
    for u in re.findall(r"https?://[^\s<>\"')\]]+", body):
        u = u.rstrip(".,;")
        if u not in links:
            links.append(u)
    try:
        date = parsedate_to_datetime(msg.get("Date", "")).astimezone(timezone.utc).isoformat()
    except Exception:
        date = utcnow_iso()
    return Notice(uid=uid, message_id=(msg.get("Message-ID") or f"uid:{uid}").strip(), subject=(msg.get("Subject") or "").strip(),
                  sender=msg.get("From", ""), date=date, body=body, links=links, attachments=attachments)


def source_for(notice: Notice) -> str:
    hay = [notice.sender_domain] + [urlparse(u).netloc.lower() for u in notice.links]
    for dom, sid in SOURCE_HINTS:
        if any(h.endswith(dom) for h in hay):
            return sid
    return "email_notification"


def extract_fields(notice: Notice) -> dict:
    text = notice.subject + "\n" + notice.body
    m = _SOL_NUM.search(text)
    due = _DUE.search(notice.body)
    deadline_text = due.group(2).strip() if due else None
    title = re.sub(r"^(fwd?|re):\s*", "", notice.subject, flags=re.I).strip() or "(untitled notice)"
    return {"solicitation_number": m.group(1).strip() if m else None, "title": title[:200], "bid_deadline_text": deadline_text,
            "industry": classify_industry(text)}


def download_public_file(url: str, timeout: int = 60) -> Optional[tuple[str, bytes]]:
    """Fetch a directly linked PDF/DOCX from an allowed host. Returns (filename, bytes) or None."""
    p = urlparse(url)
    host = p.netloc.lower()
    if host not in allowed_file_hosts():
        return None
    if not p.path.lower().endswith(FILE_EXTS):
        return None
    req = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:
        data = resp.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        return None
    name = os.path.basename(p.path) or "download.pdf"
    return name, data


def _handle_cancellation(conn, notice: Notice, fields: dict, source_id: str) -> Optional[dict]:
    """If a notice says a tracked solicitation was cancelled/withdrawn, mark it and alert. Returns a report or None."""
    if not _CANCEL_RE.search(notice.subject + " " + notice.body[:600]):
        return None
    num = fields.get("solicitation_number")
    if not num:
        return None
    target = None
    for o in db.list_opportunities(conn):
        if o.get("solicitation_number") and normalize_key(o["solicitation_number"], "").split("|")[0] == normalize_key(num, "").split("|")[0]:
            target = o
            break
    if target is None:
        return None
    if target["status"] != "Cancelled":
        db.add_change_event(conn, target["id"], "status", target["status"], "Cancelled")
        db.update_opportunity(conn, target["id"], status="Cancelled", last_seen=utcnow_iso(), notes=((target.get("notes") or "") + f"\nCancelled per notice '{notice.subject}' ({notice.date[:10]}).").strip())
        db.add_alert(conn, "cancelled", f"CANCELLED: {target['title']} ({num}) per notice '{notice.subject}'. Stop work on this bid.", target["id"], f"cancel:{target['id']}:{notice.message_id}")
        db.log(conn, "cancelled_by_notice", "opportunity", target["id"], {"subject": notice.subject}, actor="scan")
    db.mark_email_processed(conn, notice.message_id, notice.uid, target["id"], notice.subject)
    return {"status": "cancelled", "source": source_id, "opportunity_id": target["id"], "documents": 0, "created": False, "errors": []}


def process_notice(conn, notice: Notice, profile: Optional[dict] = None, prefer_claude: bool = True, fetch_links: bool = True, actor: str = "scan") -> dict:
    """Turn one notification email into an opportunity (plus documents) and evaluate it."""
    if db.email_processed(conn, notice.message_id):
        return {"status": "already_processed", "message_id": notice.message_id}
    fields = extract_fields(notice)
    source_id = source_for(notice)
    cancelled = _handle_cancellation(conn, notice, fields, source_id)
    if cancelled:
        return cancelled
    report: dict = {"status": "ok", "source": source_id, "documents": 0, "created": False, "opportunity_id": None, "errors": []}
    ingested = False
    # 1. attached files
    for fname, data in notice.attachments:
        try:
            r = intake.ingest_document(conn, fname, data, source_id=source_id, source_url=notice.links[0] if notice.links else "", doc_type="solicitation",
                                       prefer_claude=prefer_claude, overrides={k: v for k, v in fields.items() if v}, actor=actor)
            report["opportunity_id"], report["documents"], ingested = r["opportunity_id"], report["documents"] + 1, True
            report["created"] = report["created"] or r["created"]
        except Exception as exc:
            report["errors"].append(f"{fname}: {exc}")
    # 2. directly linked files on allowed hosts
    if fetch_links:
        for url in notice.links:
            try:
                got = download_public_file(url)
            except Exception as exc:
                report["errors"].append(f"{url}: {exc}")
                continue
            if not got:
                continue
            try:
                r = intake.ingest_document(conn, got[0], got[1], source_id=source_id, source_url=url, doc_type="solicitation",
                                           prefer_claude=prefer_claude, overrides={k: v for k, v in fields.items() if v}, actor=actor)
                report["opportunity_id"], report["documents"], ingested = r["opportunity_id"], report["documents"] + 1, True
                report["created"] = report["created"] or r["created"]
            except Exception as exc:
                report["errors"].append(f"{url}: {exc}")
    # 3. no file: create a lead from the notice text itself
    if not ingested:
        key = normalize_key(fields["solicitation_number"] or notice.message_id, source_id)
        existing = db.get_opportunity_by_key(conn, key)
        dl = deadlines.parse_deadline(fields["bid_deadline_text"]) if fields["bid_deadline_text"] else None
        dl_utc, dl_local, dl_tz = deadlines.to_storage(dl)
        if existing:
            db.update_opportunity(conn, existing["id"], last_seen=utcnow_iso())
            report["opportunity_id"] = existing["id"]
        else:
            from .models import classify_jurisdiction
            oid = db.insert_opportunity(conn, key, solicitation_number=fields["solicitation_number"], title=fields["title"], agency=None,
                                        jurisdiction=classify_jurisdiction(notice.sender, notice.subject, notice.body[:800], source_id),
                                        industry=fields["industry"], source_id=source_id, source_url=notice.links[0] if notice.links else "",
                                        summary=notice.body[:1500], bid_deadline_utc=dl_utc, bid_deadline_local=dl_local, deadline_tz=dl_tz,
                                        deadline_status=VERIFIED if dl_utc else MISSING, notes="Lead from notification email; download the solicitation and upload it to evaluate fully.")
            report["opportunity_id"], report["created"] = oid, True
            # keep the notice text as a document so the reader can pull what it can
            doc = documents.store(documents.extract("notice.txt", notice.body.encode("utf-8")), notice.body.encode("utf-8"))
            doc_id = db.add_document(conn, oid, f"notice_{notice.uid or 'email'}.txt", doc.sha256, doc_type="notice", page_count=1, char_count=doc.char_count,
                                     stored_path=doc.stored_path, text_path=doc.text_path, source_url=notice.links[0] if notice.links else "", extraction_method="email body")
            ext = analyzer.heuristic_extract(doc.text, "notice")
            db.replace_requirements(conn, oid, doc_id, ext.get("requirements", []))
    if report["opportunity_id"]:
        try:
            pipeline.evaluate_opportunity(conn, report["opportunity_id"], profile, actor=actor, use_active_profile=profile is None)
        except Exception as exc:
            report["errors"].append(f"evaluate: {exc}")
    db.mark_email_processed(conn, notice.message_id, notice.uid, report["opportunity_id"], notice.subject)
    db.log(conn, "inbox_notice", "opportunity", report["opportunity_id"], {"subject": notice.subject, "source": source_id, "documents": report["documents"], "errors": report["errors"]}, actor=actor)
    return report


def fetch_notices(since_days: int = 14, limit: int = 100) -> list[Notice]:
    """Read recent messages over IMAP (read-only). Sender filters are comma-separated substrings."""
    if not config.imap_available():
        raise RuntimeError("IMAP credentials are not configured (IMAP_HOST / IMAP_USER / IMAP_PASSWORD).")
    filters = [f.strip() for f in (config.IMAP_SENDER_FILTER or "").split(",") if f.strip()]
    since = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%d-%b-%Y")
    out: list[Notice] = []
    with imaplib.IMAP4_SSL(config.IMAP_HOST) as M:
        M.login(config.IMAP_USER, config.IMAP_PASSWORD)
        M.select(config.IMAP_FOLDER, readonly=True)
        uids: list[bytes] = []
        for f in (filters or [""]):
            crit = f'(SINCE {since} FROM "{f}")' if f else f"(SINCE {since})"
            typ, data = M.uid("search", None, crit)
            if typ == "OK" and data and data[0]:
                uids += [u for u in data[0].split() if u not in uids]
        for uid in uids[-limit:]:
            typ, msg_data = M.uid("fetch", uid, "(RFC822)")
            if typ != "OK" or not msg_data or not msg_data[0]:
                continue
            out.append(parse_message(msg_data[0][1], uid=uid.decode()))
    return out


def run_inbox_intake(conn, notices: Optional[list[Notice]] = None, profile: Optional[dict] = None, prefer_claude: bool = True, fetch_links: bool = True) -> dict:
    """Process every new notice. Pass `notices` to bypass IMAP (tests, forwarded .eml files)."""
    scan_id = db.start_scan(conn, "inbox")
    try:
        notices = notices if notices is not None else fetch_notices()
    except Exception as exc:
        db.finish_scan(conn, scan_id, "error", notes=str(exc))
        return {"status": "error", "reason": str(exc), "processed": 0, "new": 0}
    processed = new = skipped = 0
    errors: list[str] = []
    for n in notices:
        r = process_notice(conn, n, profile=profile, prefer_claude=prefer_claude, fetch_links=fetch_links)
        if r["status"] == "already_processed":
            skipped += 1
            continue
        processed += 1
        new += 1 if r.get("created") else 0
        errors += r.get("errors", [])
    db.finish_scan(conn, scan_id, "ok", found=len(notices), new=new, updated=processed - new, notes=f"skipped {skipped}; errors {len(errors)}")
    return {"status": "ok", "found": len(notices), "processed": processed, "new": new, "skipped": skipped, "errors": errors}
