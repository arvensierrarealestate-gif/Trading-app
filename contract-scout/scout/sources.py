"""Opportunity Source Registry and Scanner.

The registry (source_registry.json) lists every procurement source with the
access method we are allowed to use. Only these methods are implemented:
* manual_upload      - always available.
* rss                - standard syndication feeds a site publishes for this purpose.
* email_notification - read notification emails from an inbox you own (IMAP).
Anything marked `public_page` is NOT fetched until you have confirmed the
site's terms permit automated access and flipped `allowed_fetch` to true.
"""
from __future__ import annotations

import email
import imaplib
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Optional
from urllib.request import Request, urlopen

from . import config, db
from .models import utcnow_iso

USER_AGENT = "MarylandContractScout/0.1 (private research tool; contact owner)"


def load_registry(path: Optional[Path] = None) -> list[dict]:
    p = Path(path or config.SOURCE_REGISTRY_PATH)
    with open(p, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("sources", [])


def save_registry(sources: list[dict], path: Optional[Path] = None) -> None:
    p = Path(path or config.SOURCE_REGISTRY_PATH)
    with open(p, "w", encoding="utf-8") as f:
        json.dump({"updated_at": utcnow_iso(), "sources": sources}, f, indent=2)


def source_readiness(src: dict) -> tuple[str, str]:
    """Return (state, reason): 'ready', 'awaiting_credentials', 'manual', 'blocked'."""
    method = src.get("access_method")
    if method == "manual_upload":
        return "manual", "Download documents from the portal and upload them on the Upload page."
    if method == "rss":
        return ("ready", "Feed URL configured.") if src.get("feed_url") else ("blocked", "No feed_url set.")
    if method == "email_notification":
        return ("ready", "IMAP configured.") if config.imap_available() else ("awaiting_credentials", "Set IMAP_HOST / IMAP_USER / IMAP_PASSWORD in .env.")
    if method == "public_page":
        if src.get("allowed_fetch") is True:
            return "ready", "Owner confirmed terms permit automated access."
        return "blocked", "Automated fetch disabled until terms of use are confirmed. Use manual upload."
    if method == "api":
        return ("ready", "API configured.") if src.get("api_url") else ("blocked", "No API endpoint documented.")
    return "blocked", f"Unknown access method '{method}'."


def fetch_rss(feed_url: str, timeout: int = 30) -> list[dict]:
    """Parse an RSS/Atom feed into [{title, link, published, summary}]."""
    req = Request(feed_url, headers={"User-Agent": USER_AGENT})
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
    return parse_feed(raw)


def parse_feed(raw: bytes) -> list[dict]:
    root = ET.fromstring(raw)
    items: list[dict] = []
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    for it in root.iter("item"):
        items.append({
            "title": (it.findtext("title") or "").strip(),
            "link": (it.findtext("link") or "").strip(),
            "published": (it.findtext("pubDate") or "").strip(),
            "summary": re.sub(r"<[^>]+>", " ", it.findtext("description") or "").strip(),
        })
    for it in root.findall(".//atom:entry", ns):
        link_el = it.find("atom:link", ns)
        items.append({
            "title": (it.findtext("atom:title", default="", namespaces=ns) or "").strip(),
            "link": (link_el.get("href") if link_el is not None else "") or "",
            "published": (it.findtext("atom:updated", default="", namespaces=ns) or "").strip(),
            "summary": re.sub(r"<[^>]+>", " ", it.findtext("atom:summary", default="", namespaces=ns) or "").strip(),
        })
    return items


def fetch_notification_emails(limit: int = 50) -> list[dict]:
    """Read recent notification emails via IMAP. Returns [{subject, from, date, body, links}]."""
    if not config.imap_available():
        raise RuntimeError("IMAP credentials are not configured.")
    out: list[dict] = []
    with imaplib.IMAP4_SSL(config.IMAP_HOST) as M:
        M.login(config.IMAP_USER, config.IMAP_PASSWORD)
        M.select(config.IMAP_FOLDER, readonly=True)
        typ, data = M.search(None, f'(FROM "{config.IMAP_SENDER_FILTER}")')
        ids = data[0].split()[-limit:] if typ == "OK" and data and data[0] else []
        for mid in reversed(ids):
            typ, msg_data = M.fetch(mid, "(RFC822)")
            if typ != "OK":
                continue
            msg = email.message_from_bytes(msg_data[0][1])
            body = ""
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body += part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", errors="replace")
            out.append(parse_notification(msg.get("Subject", ""), msg.get("From", ""), msg.get("Date", ""), body))
    return out


def parse_notification(subject: str, sender: str, date: str, body: str) -> dict:
    links = re.findall(r"https?://[^\s<>\"]+", body or "")
    sol = re.search(r"\b([A-Z]{2,6}[-\s]?\d{2,}[A-Z0-9\-/]*)\b", (subject or "") + " " + (body or ""))
    return {"subject": subject, "from": sender, "date": date, "body": body, "links": links,
            "solicitation_number": sol.group(1) if sol else None}


def scan_source(conn, src: dict) -> dict:
    """Run one source. Creates lightweight 'lead' records only; documents still need upload/extraction."""
    scan_id = db.start_scan(conn, src["id"])
    state, reason = source_readiness(src)
    if state != "ready":
        db.finish_scan(conn, scan_id, "skipped", notes=reason)
        return {"source": src["id"], "status": "skipped", "reason": reason, "items": []}
    try:
        if src["access_method"] == "rss":
            items = fetch_rss(src["feed_url"])
        elif src["access_method"] == "email_notification":
            items = [{"title": e["subject"], "link": e["links"][0] if e["links"] else "", "summary": e["body"][:500], "published": e["date"],
                      "solicitation_number": e["solicitation_number"]} for e in fetch_notification_emails()]
        else:
            items = []
    except Exception as exc:  # network / parse errors are reported, never hidden
        db.finish_scan(conn, scan_id, "error", notes=str(exc))
        return {"source": src["id"], "status": "error", "reason": str(exc), "items": []}
    new = 0
    for it in items:
        from .models import normalize_key, classify_industry
        key = normalize_key(it.get("solicitation_number") or it.get("link") or it.get("title"), src.get("name"))
        if db.get_opportunity_by_key(conn, key):
            db.update_opportunity(conn, db.get_opportunity_by_key(conn, key)["id"], last_seen=utcnow_iso())
            continue
        db.insert_opportunity(conn, key, solicitation_number=it.get("solicitation_number"), title=it.get("title") or "(untitled lead)",
                              agency=src.get("name"), jurisdiction=src.get("jurisdiction"), industry=classify_industry(it.get("title", "") + " " + it.get("summary", "")),
                              source_id=src["id"], source_url=it.get("link", ""), summary=it.get("summary", ""), notes="Lead from automated source; upload documents to evaluate.")
        new += 1
    db.finish_scan(conn, scan_id, "ok", found=len(items), new=new)
    db.log(conn, "scan_source", "source", src["id"], {"found": len(items), "new": new})
    return {"source": src["id"], "status": "ok", "items": items, "new": new}
