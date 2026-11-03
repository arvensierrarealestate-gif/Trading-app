"""CSV export of the opportunity table (Google Sheets import-ready)."""
from __future__ import annotations

import csv
import io
from typing import Optional

from . import db, deadlines

COLUMNS = ["id", "solicitation_number", "title", "agency", "jurisdiction", "industry", "location", "value_low", "value_high", "value_status",
           "bid_deadline_local", "deadline_status", "status", "match_class", "match_score", "recommendation", "source_url", "first_seen", "last_seen"]


def opportunities_csv(conn, **filters) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(COLUMNS + ["days_until_deadline", "open_mandatory_items"])
    for o in db.list_opportunities(conn, **filters):
        ev = db.latest_evaluation(conn, o["id"])
        open_items = sum(1 for c in (ev["checks"] if ev else []) if c["mandatory"] and c["result"] in ("UNKNOWN", "NOT_MET"))
        d = deadlines.days_until(o["bid_deadline_utc"])
        w.writerow([o.get(c) for c in COLUMNS] + [round(d, 1) if d is not None else "", open_items])
    return buf.getvalue()


def requirements_csv(conn, opportunity_id: int) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["category", "mandatory", "requirement", "value", "document", "page_ref", "quote", "confidence", "info_status", "method"])
    for r in db.list_requirements(conn, opportunity_id):
        w.writerow([r["category"], r["mandatory"], r["text"], r["value"], r["document"], r["page_ref"], r["quote"], r["confidence"], r["info_status"], r["method"]])
    return buf.getvalue()
