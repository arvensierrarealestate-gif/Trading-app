"""Deadline calendar (.ics) so bid deadlines and mandatory meetings land in Google/Outlook calendars."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db, deadlines


def _fmt(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _esc(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def build_ics(conn, dashboard_url: str = "http://localhost:8501") -> str:
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Maryland Contract Scout//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Contract Scout deadlines"]
    now = _fmt(datetime.now(timezone.utc))
    for o in db.list_opportunities(conn):
        if o["status"] in ("Rejected", "Lost", "Cancelled", "Awarded"):
            continue
        dt = deadlines.from_storage(o["bid_deadline_utc"])
        if dt is not None:
            lines += ["BEGIN:VEVENT", f"UID:scout-deadline-{o['id']}@contract-scout", f"DTSTAMP:{now}",
                      f"DTSTART:{_fmt(dt - timedelta(hours=1))}", f"DTEND:{_fmt(dt)}",
                      f"SUMMARY:{_esc('BID DUE: ' + (o['title'] or ''))}",
                      f"DESCRIPTION:{_esc((o['solicitation_number'] or '') + ' | ' + (o['agency'] or '') + ' | ' + (o['match_class'] or 'not evaluated') + ' | ' + dashboard_url + '/detail?opp=' + str(o['id']))}",
                      "BEGIN:VALARM", "TRIGGER:-P3D", "ACTION:DISPLAY", "DESCRIPTION:Bid due in 3 days", "END:VALARM",
                      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Bid due tomorrow", "END:VALARM",
                      "END:VEVENT"]
        for r in db.list_requirements(conn, o["id"]):
            if r["category"] != "meeting":
                continue
            mdt = deadlines.parse_deadline(r["text"])
            if mdt is None:
                continue
            lines += ["BEGIN:VEVENT", f"UID:scout-meeting-{o['id']}-{r['id']}@contract-scout", f"DTSTAMP:{now}",
                      f"DTSTART:{_fmt(mdt)}", f"DTEND:{_fmt(mdt + timedelta(hours=1))}",
                      f"SUMMARY:{_esc(('MANDATORY ' if r['mandatory'] else '') + 'Pre-bid meeting: ' + (o['title'] or ''))}",
                      f"DESCRIPTION:{_esc(r['text'][:300] + ' | ' + dashboard_url + '/detail?opp=' + str(o['id']))}",
                      "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", "DESCRIPTION:Pre-bid meeting tomorrow", "END:VALARM",
                      "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"
