"""Housekeeping run after each scan: CSV snapshot, calendar file, database backup with retention."""
from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import config, db, export, calendar_export

BACKUPS_TO_KEEP = 14


def snapshot(conn, dashboard_url: str) -> dict:
    config.ensure_dirs()
    out = {}
    csv_path = config.EXPORT_DIR / "opportunities_latest.csv"
    csv_path.write_text(export.opportunities_csv(conn), encoding="utf-8")
    out["csv"] = str(csv_path)
    ics_path = config.EXPORT_DIR / "deadlines.ics"
    ics_path.write_text(calendar_export.build_ics(conn, dashboard_url), encoding="utf-8")
    out["ics"] = str(ics_path)
    out["backup"] = backup_database()
    return out


def backup_database() -> str:
    bdir = config.DATA_DIR / "backups"
    bdir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    dest = bdir / f"scout_{stamp}.db"
    if Path(config.DB_PATH).exists():
        shutil.copy2(config.DB_PATH, dest)
    olds = sorted(bdir.glob("scout_*.db"))
    for old in olds[:-BACKUPS_TO_KEEP]:
        old.unlink(missing_ok=True)
    return str(dest)


def scan_log_tail(lines: int = 60) -> str:
    p = config.DATA_DIR / "scan.log"
    if not p.exists():
        return "(no scan.log yet; run a scan or the scheduled task)"
    text = p.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(text[-lines:])
