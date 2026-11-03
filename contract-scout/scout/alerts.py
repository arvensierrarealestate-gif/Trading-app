"""Deadline and change alerts with an email digest.

If SMTP is not configured the digest is written to data/outbox/ as a dry run so
the content can be reviewed before any email goes out.
"""
from __future__ import annotations

import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

from . import config, db, deadlines
from .models import STRONG, utcnow_iso

DEADLINE_WINDOWS = (3, 7, 14)


def generate_alerts(conn, now: Optional[datetime] = None) -> list[dict]:
    """Create alert rows for new strong matches, approaching deadlines and amendments. Idempotent via dedupe_key."""
    now = now or datetime.now(timezone.utc)
    created: list[dict] = []
    for opp in db.list_opportunities(conn):
        oid = opp["id"]
        label = f"{opp['title']} ({opp['solicitation_number'] or 'no number'})"
        d = deadlines.days_until(opp["bid_deadline_utc"], now)
        if d is not None and 0 <= d:
            for w in DEADLINE_WINDOWS:
                if d <= w:
                    key = f"deadline:{oid}:{w}"
                    msg = f"Deadline in {d:.1f} days ({deadlines.format_local(opp['bid_deadline_utc'])}) for {label}."
                    aid = db.add_alert(conn, f"deadline_{w}d", msg, oid, key)
                    if aid:
                        created.append({"id": aid, "kind": f"deadline_{w}d", "message": msg})
                    break
        if opp["match_class"] == STRONG:
            aid = db.add_alert(conn, "strong_match", f"Strong Match: {label}. Recommendation: {opp['recommendation'] or 'not yet'}.", oid, f"strong:{oid}")
            if aid:
                created.append({"id": aid, "kind": "strong_match", "message": label})
        if opp["status"] == "New":
            aid = db.add_alert(conn, "new", f"New opportunity: {label} [{opp['industry']}].", oid, f"new:{oid}")
            if aid:
                created.append({"id": aid, "kind": "new", "message": label})
    for ch in db.list_change_events(conn, unacknowledged_only=True):
        opp = db.get_opportunity(conn, ch["opportunity_id"])
        if not opp:
            continue
        msg = f"Amendment/change on {opp['title']}: {ch['field']} changed from '{ch['old_value']}' to '{ch['new_value']}'."
        aid = db.add_alert(conn, "amendment", msg, opp["id"], f"change:{ch['id']}")
        if aid:
            created.append({"id": aid, "kind": "amendment", "message": msg})
    if created:
        db.log(conn, "generate_alerts", "alerts", "", {"created": len(created)})
    return created


def build_digest(conn, dashboard_url: str = "http://localhost:8501") -> str:
    """Plain-text digest of unsent alerts plus a snapshot of urgent items."""
    unsent = db.list_alerts(conn, unsent_only=True)
    opps = db.list_opportunities(conn)
    lines = [f"Maryland Contract Scout digest - {datetime.now(config.LOCAL_TZ).strftime('%a %b %d, %Y %I:%M %p %Z')}", ""]
    def section(title, items):
        if items:
            lines.append(title)
            lines.extend(f"  - {i}" for i in items)
            lines.append("")
    section("NEW OPPORTUNITIES", [a["message"] for a in unsent if a["kind"] == "new"])
    section("STRONG MATCHES", [a["message"] for a in unsent if a["kind"] == "strong_match"])
    section("DEADLINES APPROACHING", [a["message"] for a in unsent if a["kind"].startswith("deadline")])
    section("AMENDMENTS / CHANGES", [a["message"] for a in unsent if a["kind"] == "amendment"])
    needs = []
    for o in opps:
        ev = db.latest_evaluation(conn, o["id"])
        if ev:
            missing = [c["requirement"][:70] for c in ev["checks"] if c["result"] in ("UNKNOWN", "NOT_MET") and c["mandatory"]]
            if missing and o["status"] in ("New", "Under Review", "Preparing Bid"):
                needs.append(f"{o['title']}: {len(missing)} open item(s) e.g. {missing[0]}")
    section("MISSING QUALIFICATIONS TO RESOLVE", needs[:10])
    partners = db.list_partners(conn)
    section("SUBCONTRACTING / PARTNER LEADS", [f"{p['name']} ({p['role']}, {p['industry'] or 'n/a'})" for p in partners[:10]])
    if len(lines) <= 2:
        lines.append("Nothing new since the last digest.")
    lines += ["", f"Open the dashboard: {dashboard_url}", "This digest never submits bids or contacts agencies."]
    return "\n".join(lines)


def send_digest(conn, dashboard_url: str = "http://localhost:8501", force_dry_run: bool = False) -> dict:
    """Email the digest if SMTP is configured; otherwise write it to the outbox. Marks alerts as sent either way."""
    config.ensure_dirs()
    body = build_digest(conn, dashboard_url)
    unsent = db.list_alerts(conn, unsent_only=True)
    ts = utcnow_iso().replace(":", "")
    if config.smtp_available() and not force_dry_run:
        msg = EmailMessage()
        msg["Subject"] = f"Contract Scout digest: {len(unsent)} alert(s)"
        msg["From"] = config.ALERT_FROM
        msg["To"] = ", ".join(config.ALERT_TO)
        msg.set_content(body)
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=30) as s:
            s.starttls()
            s.login(config.SMTP_USER, config.SMTP_PASSWORD)
            s.send_message(msg)
        channel = "smtp"
    else:
        path = config.OUTBOX_DIR / f"digest_{ts}.txt"
        path.write_text(body, encoding="utf-8")
        channel = f"dry_run:{path}"
    db.mark_alerts_sent(conn, [a["id"] for a in unsent], channel)
    db.log(conn, "send_digest", "alerts", "", {"channel": channel, "alerts": len(unsent)})
    return {"channel": channel, "alerts": len(unsent), "body": body}
