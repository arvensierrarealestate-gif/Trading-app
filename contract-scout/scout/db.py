"""SQLite persistence layer. One file database, created on first use."""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Optional

from . import config
from .models import utcnow_iso

SCHEMA = """
CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    normalized_key TEXT UNIQUE NOT NULL,
    solicitation_number TEXT,
    title TEXT NOT NULL,
    agency TEXT,
    jurisdiction TEXT,
    industry TEXT,
    location TEXT,
    source_id TEXT,
    source_url TEXT,
    summary TEXT,
    contract_duration TEXT,
    value_low REAL,
    value_high REAL,
    value_status TEXT DEFAULT 'MISSING',
    value_note TEXT,
    bid_deadline_utc TEXT,
    bid_deadline_local TEXT,
    deadline_tz TEXT,
    deadline_status TEXT DEFAULT 'MISSING',
    status TEXT DEFAULT 'New',
    match_class TEXT,
    match_score REAL,
    recommendation TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    notes TEXT,
    is_sample INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    doc_type TEXT DEFAULT 'solicitation',
    sha256 TEXT NOT NULL,
    page_count INTEGER,
    char_count INTEGER,
    stored_path TEXT,
    text_path TEXT,
    source_url TEXT,
    retrieved_at TEXT NOT NULL,
    extraction_method TEXT,
    UNIQUE(opportunity_id, sha256)
);
CREATE TABLE IF NOT EXISTS requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    text TEXT NOT NULL,
    mandatory INTEGER DEFAULT 1,
    value TEXT,
    document TEXT,
    page_ref TEXT,
    quote TEXT,
    confidence REAL,
    info_status TEXT,
    method TEXT
);
CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    profile_version TEXT,
    match_class TEXT,
    score REAL,
    checks_json TEXT,
    summary TEXT
);
CREATE TABLE IF NOT EXISTS cost_estimates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    label TEXT,
    assumptions_json TEXT,
    results_json TEXT,
    recommendation TEXT
);
CREATE TABLE IF NOT EXISTS partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT,
    industry TEXT,
    contact TEXT,
    source_url TEXT,
    notes TEXT,
    opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    detected_at TEXT NOT NULL,
    document_id INTEGER,
    acknowledged INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    channel TEXT,
    dedupe_key TEXT UNIQUE
);
CREATE TABLE IF NOT EXISTS scan_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT,
    items_found INTEGER DEFAULT 0,
    items_new INTEGER DEFAULT 0,
    items_updated INTEGER DEFAULT 0,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    stage TEXT NOT NULL,
    source TEXT,
    note TEXT,
    done INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT
);
CREATE TABLE IF NOT EXISTS processed_emails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT UNIQUE NOT NULL,
    uid TEXT,
    opportunity_id INTEGER,
    subject TEXT,
    processed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    actor TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_deadline ON opportunities(bid_deadline_utc);
CREATE INDEX IF NOT EXISTS idx_req_opp ON requirements(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
"""


def connect(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = Path(db_path or config.DB_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), detect_types=0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    _migrate(conn)
    return conn


def _migrate(conn) -> None:
    cols = {r[1] for r in conn.execute("PRAGMA table_info(opportunities)").fetchall()}
    for name, ddl in (("commercial_score", "REAL"), ("commercial_reasons", "TEXT"), ("recommended_entity", "TEXT")):
        if name not in cols:
            conn.execute(f"ALTER TABLE opportunities ADD COLUMN {name} {ddl}")


@contextmanager
def session(db_path: Optional[Path] = None):
    conn = connect(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _rows(cur) -> list[dict]:
    return [dict(r) for r in cur.fetchall()]


def _row(cur) -> Optional[dict]:
    r = cur.fetchone()
    return dict(r) if r else None


# ---- audit -------------------------------------------------------------------
def log(conn, action: str, entity: str = "", entity_id: Any = "", details: Any = None, actor: str = "system") -> None:
    conn.execute(
        "INSERT INTO audit_log (ts, actor, action, entity, entity_id, details_json) VALUES (?,?,?,?,?,?)",
        (utcnow_iso(), actor, action, entity, str(entity_id), json.dumps(details, default=str) if details is not None else None),
    )


def list_audit(conn, limit: int = 200) -> list[dict]:
    return _rows(conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)))


# ---- opportunities -----------------------------------------------------------
OPP_FIELDS = (
    "solicitation_number", "title", "agency", "jurisdiction", "industry", "location", "source_id",
    "source_url", "summary", "contract_duration", "value_low", "value_high", "value_status",
    "value_note", "bid_deadline_utc", "bid_deadline_local", "deadline_tz", "deadline_status", "notes", "is_sample",
)


def get_opportunity(conn, opp_id: int) -> Optional[dict]:
    return _row(conn.execute("SELECT * FROM opportunities WHERE id=?", (opp_id,)))


def get_opportunity_by_key(conn, key: str) -> Optional[dict]:
    return _row(conn.execute("SELECT * FROM opportunities WHERE normalized_key=?", (key,)))


def insert_opportunity(conn, normalized_key: str, **fields) -> int:
    now = utcnow_iso()
    cols = ["normalized_key", "first_seen", "last_seen", "updated_at"]
    vals: list[Any] = [normalized_key, now, now, now]
    for k, v in fields.items():
        if k in OPP_FIELDS or k in ("status", "match_class", "match_score", "recommendation"):
            cols.append(k)
            vals.append(v)
    q = f"INSERT INTO opportunities ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})"
    cur = conn.execute(q, vals)
    return int(cur.lastrowid)


def update_opportunity(conn, opp_id: int, **fields) -> None:
    allowed = set(OPP_FIELDS) | {"status", "match_class", "match_score", "recommendation", "last_seen", "commercial_score", "commercial_reasons", "recommended_entity"}
    sets, vals = [], []
    for k, v in fields.items():
        if k in allowed:
            sets.append(f"{k}=?")
            vals.append(v)
    sets.append("updated_at=?")
    vals.append(utcnow_iso())
    vals.append(opp_id)
    conn.execute(f"UPDATE opportunities SET {', '.join(sets)} WHERE id=?", vals)


def list_opportunities(conn, **filters) -> list[dict]:
    where, vals = [], []
    for k in ("industry", "status", "match_class", "recommendation", "jurisdiction"):
        v = filters.get(k)
        if v:
            where.append(f"{k}=?")
            vals.append(v)
    if filters.get("deadline_before"):
        where.append("bid_deadline_utc IS NOT NULL AND bid_deadline_utc<=?")
        vals.append(filters["deadline_before"])
    if filters.get("deadline_after"):
        where.append("(bid_deadline_utc IS NULL OR bid_deadline_utc>=?)")
        vals.append(filters["deadline_after"])
    if filters.get("exclude_samples"):
        where.append("is_sample=0")
    sql = "SELECT * FROM opportunities"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY CASE WHEN bid_deadline_utc IS NULL THEN 1 ELSE 0 END, bid_deadline_utc ASC, id DESC"
    return _rows(conn.execute(sql, vals))


def delete_opportunity(conn, opp_id: int) -> None:
    conn.execute("DELETE FROM opportunities WHERE id=?", (opp_id,))


# ---- documents ---------------------------------------------------------------
def add_document(conn, opportunity_id: int, filename: str, sha256: str, **fields) -> int:
    existing = _row(conn.execute(
        "SELECT id FROM documents WHERE opportunity_id=? AND sha256=?", (opportunity_id, sha256)))
    if existing:
        return int(existing["id"])
    cols = ["opportunity_id", "filename", "sha256", "retrieved_at"]
    vals: list[Any] = [opportunity_id, filename, sha256, fields.pop("retrieved_at", utcnow_iso())]
    for k in ("doc_type", "page_count", "char_count", "stored_path", "text_path", "source_url", "extraction_method"):
        if k in fields:
            cols.append(k)
            vals.append(fields[k])
    cur = conn.execute(
        f"INSERT INTO documents ({','.join(cols)}) VALUES ({','.join('?' for _ in cols)})", vals)
    return int(cur.lastrowid)


def list_documents(conn, opportunity_id: int) -> list[dict]:
    return _rows(conn.execute("SELECT * FROM documents WHERE opportunity_id=? ORDER BY id", (opportunity_id,)))


# ---- requirements ------------------------------------------------------------
def replace_requirements(conn, opportunity_id: int, document_id: Optional[int], reqs: Iterable[dict], keep_other_documents: bool = True) -> int:
    if keep_other_documents and document_id is not None:
        conn.execute("DELETE FROM requirements WHERE opportunity_id=? AND document_id=?", (opportunity_id, document_id))
    else:
        conn.execute("DELETE FROM requirements WHERE opportunity_id=?", (opportunity_id,))
    n = 0
    for r in reqs:
        conn.execute(
            """INSERT INTO requirements (opportunity_id, document_id, category, text, mandatory, value, document,
               page_ref, quote, confidence, info_status, method) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (opportunity_id, document_id, r.get("category", "scope"), r.get("text", ""), 1 if r.get("mandatory", True) else 0,
             r.get("value"), r.get("document", ""), r.get("page_ref", ""), r.get("quote", ""),
             float(r.get("confidence", 0.5) or 0.5), r.get("info_status", "VERIFIED"), r.get("method", "manual")),
        )
        n += 1
    return n


def list_requirements(conn, opportunity_id: int) -> list[dict]:
    """Requirements for an opportunity. When an amendment re-states a clause already on file,
    the newest copy wins so re-issued documents do not double-count open items."""
    rows = _rows(conn.execute("SELECT * FROM requirements WHERE opportunity_id=? ORDER BY id DESC", (opportunity_id,)))
    kept: dict[tuple[str, str], dict] = {}
    for r in rows:
        r["mandatory"] = bool(r["mandatory"])
        key = (r["category"], (r["text"] or "")[:120].lower())
        prev = kept.get(key)
        if prev is None or (r["mandatory"] and not prev["mandatory"]):
            kept[key] = r
    out = list(kept.values())
    out.sort(key=lambda r: (r["category"], r["id"]))
    return out


# ---- evaluations & costs -----------------------------------------------------
def add_evaluation(conn, opportunity_id: int, profile_version: str, match_class: str, score: float, checks: list[dict], summary: str) -> int:
    cur = conn.execute(
        "INSERT INTO evaluations (opportunity_id, created_at, profile_version, match_class, score, checks_json, summary) VALUES (?,?,?,?,?,?,?)",
        (opportunity_id, utcnow_iso(), profile_version, match_class, score, json.dumps(checks), summary),
    )
    return int(cur.lastrowid)


def latest_evaluation(conn, opportunity_id: int) -> Optional[dict]:
    row = _row(conn.execute("SELECT * FROM evaluations WHERE opportunity_id=? ORDER BY id DESC LIMIT 1", (opportunity_id,)))
    if row:
        row["checks"] = json.loads(row.pop("checks_json") or "[]")
    return row


def add_cost_estimate(conn, opportunity_id: int, label: str, assumptions: dict, results: dict, recommendation: str) -> int:
    cur = conn.execute(
        "INSERT INTO cost_estimates (opportunity_id, created_at, label, assumptions_json, results_json, recommendation) VALUES (?,?,?,?,?,?)",
        (opportunity_id, utcnow_iso(), label, json.dumps(assumptions), json.dumps(results), recommendation),
    )
    return int(cur.lastrowid)


def latest_cost_estimate(conn, opportunity_id: int) -> Optional[dict]:
    row = _row(conn.execute("SELECT * FROM cost_estimates WHERE opportunity_id=? ORDER BY id DESC LIMIT 1", (opportunity_id,)))
    if row:
        row["assumptions"] = json.loads(row.pop("assumptions_json") or "{}")
        row["results"] = json.loads(row.pop("results_json") or "{}")
    return row


# ---- partners ----------------------------------------------------------------
def add_partner(conn, name: str, role: str, industry: str = "", contact: str = "", source_url: str = "", notes: str = "", opportunity_id: Optional[int] = None) -> int:
    cur = conn.execute(
        "INSERT INTO partners (name, role, industry, contact, source_url, notes, opportunity_id, created_at) VALUES (?,?,?,?,?,?,?,?)",
        (name, role, industry, contact, source_url, notes, opportunity_id, utcnow_iso()),
    )
    return int(cur.lastrowid)


def list_partners(conn, opportunity_id: Optional[int] = None) -> list[dict]:
    if opportunity_id is None:
        return _rows(conn.execute("SELECT * FROM partners ORDER BY id DESC"))
    return _rows(conn.execute("SELECT * FROM partners WHERE opportunity_id=? OR opportunity_id IS NULL ORDER BY id DESC", (opportunity_id,)))


def delete_partner(conn, partner_id: int) -> None:
    conn.execute("DELETE FROM partners WHERE id=?", (partner_id,))


# ---- change events & alerts ---------------------------------------------------
def add_change_event(conn, opportunity_id: int, field: str, old: Any, new: Any, document_id: Optional[int] = None) -> int:
    cur = conn.execute(
        "INSERT INTO change_events (opportunity_id, field, old_value, new_value, detected_at, document_id) VALUES (?,?,?,?,?,?)",
        (opportunity_id, field, None if old is None else str(old), None if new is None else str(new), utcnow_iso(), document_id),
    )
    return int(cur.lastrowid)


def list_change_events(conn, opportunity_id: Optional[int] = None, unacknowledged_only: bool = False, limit: int = 200) -> list[dict]:
    where, vals = [], []
    if opportunity_id is not None:
        where.append("opportunity_id=?")
        vals.append(opportunity_id)
    if unacknowledged_only:
        where.append("acknowledged=0")
    sql = "SELECT * FROM change_events"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY id DESC LIMIT ?"
    vals.append(limit)
    return _rows(conn.execute(sql, vals))


def acknowledge_changes(conn, opportunity_id: int) -> None:
    conn.execute("UPDATE change_events SET acknowledged=1 WHERE opportunity_id=?", (opportunity_id,))


def add_alert(conn, kind: str, message: str, opportunity_id: Optional[int], dedupe_key: str) -> Optional[int]:
    try:
        cur = conn.execute(
            "INSERT INTO alerts (opportunity_id, kind, message, created_at, dedupe_key) VALUES (?,?,?,?,?)",
            (opportunity_id, kind, message, utcnow_iso(), dedupe_key),
        )
        return int(cur.lastrowid)
    except sqlite3.IntegrityError:
        return None


def list_alerts(conn, unsent_only: bool = False, limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM alerts"
    if unsent_only:
        sql += " WHERE sent_at IS NULL"
    sql += " ORDER BY id DESC LIMIT ?"
    return _rows(conn.execute(sql, (limit,)))


def mark_alerts_sent(conn, alert_ids: Iterable[int], channel: str) -> None:
    now = utcnow_iso()
    for aid in alert_ids:
        conn.execute("UPDATE alerts SET sent_at=?, channel=? WHERE id=?", (now, channel, aid))


# ---- scan runs ---------------------------------------------------------------
def start_scan(conn, source_id: str) -> int:
    cur = conn.execute("INSERT INTO scan_runs (source_id, started_at, status) VALUES (?,?,?)", (source_id, utcnow_iso(), "running"))
    return int(cur.lastrowid)


def finish_scan(conn, scan_id: int, status: str, found: int = 0, new: int = 0, updated: int = 0, notes: str = "") -> None:
    conn.execute(
        "UPDATE scan_runs SET finished_at=?, status=?, items_found=?, items_new=?, items_updated=?, notes=? WHERE id=?",
        (utcnow_iso(), status, found, new, updated, notes, scan_id),
    )


def list_scans(conn, limit: int = 50) -> list[dict]:
    return _rows(conn.execute("SELECT * FROM scan_runs ORDER BY id DESC LIMIT ?", (limit,)))


# ---- dashboard summary --------------------------------------------------------
def counts(conn) -> dict:
    out = {}
    out["total"] = conn.execute("SELECT COUNT(*) FROM opportunities").fetchone()[0]
    for mc in ("Strong Match", "Conditional Match", "Poor Match"):
        out[mc] = conn.execute("SELECT COUNT(*) FROM opportunities WHERE match_class=?", (mc,)).fetchone()[0]
    out["unclassified"] = conn.execute("SELECT COUNT(*) FROM opportunities WHERE match_class IS NULL").fetchone()[0]
    out["unsent_alerts"] = conn.execute("SELECT COUNT(*) FROM alerts WHERE sent_at IS NULL").fetchone()[0]
    out["unacknowledged_changes"] = conn.execute("SELECT COUNT(*) FROM change_events WHERE acknowledged=0").fetchone()[0]
    return out


# ---- bid checklist -------------------------------------------------------------
def add_checklist_item(conn, opportunity_id: int, text: str, stage: str, source: str = "", note: str = "") -> int:
    cur = conn.execute("INSERT INTO checklist_items (opportunity_id, text, stage, source, note, created_at) VALUES (?,?,?,?,?,?)",
                       (opportunity_id, text, stage, source, note, utcnow_iso()))
    return int(cur.lastrowid)


def list_checklist(conn, opportunity_id: int) -> list[dict]:
    rows = _rows(conn.execute("SELECT * FROM checklist_items WHERE opportunity_id=? ORDER BY id", (opportunity_id,)))
    for r in rows:
        r["done"] = bool(r["done"])
    return rows


def set_checklist_done(conn, item_id: int, done: bool) -> None:
    conn.execute("UPDATE checklist_items SET done=?, updated_at=? WHERE id=?", (1 if done else 0, utcnow_iso(), item_id))


def clear_checklist(conn, opportunity_id: int) -> None:
    conn.execute("DELETE FROM checklist_items WHERE opportunity_id=?", (opportunity_id,))


# ---- inbox intake ---------------------------------------------------------------
def email_processed(conn, message_id: str) -> bool:
    return conn.execute("SELECT 1 FROM processed_emails WHERE message_id=?", (message_id,)).fetchone() is not None


def mark_email_processed(conn, message_id: str, uid: str, opportunity_id: Optional[int], subject: str) -> None:
    conn.execute("INSERT OR IGNORE INTO processed_emails (message_id, uid, opportunity_id, subject, processed_at) VALUES (?,?,?,?,?)",
                 (message_id, uid, opportunity_id, subject, utcnow_iso()))


def inbox_stats(conn) -> dict:
    n = conn.execute("SELECT COUNT(*) FROM processed_emails").fetchone()[0]
    last = conn.execute("SELECT MAX(processed_at) FROM processed_emails").fetchone()[0]
    last_scan = _row(conn.execute("SELECT * FROM scan_runs WHERE source_id='inbox' ORDER BY id DESC LIMIT 1"))
    return {"processed_emails": n, "last_processed": last, "last_scan": last_scan}
