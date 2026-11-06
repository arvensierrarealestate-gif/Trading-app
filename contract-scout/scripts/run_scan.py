"""Scheduled scan: read notification emails, scan feed sources, re-evaluate, refresh alerts, send the digest.

Run by hand:        python scripts/run_scan.py
Windows schedule:   double-click schedule_scan.bat once (creates a daily 7:30 AM task)
Mac/Linux cron:     30 7 * * 1-5  cd /path/to/contract-scout && .venv/bin/python scripts/run_scan.py >> data/scan.log 2>&1
Without IMAP or SMTP credentials the inbox step is skipped and the digest is written to data/outbox/.
"""
from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scout import config, db, sources, alerts, pipeline, inbox, maintenance  # noqa: E402
from scout.profile import load_profile  # noqa: E402


def main() -> int:
    config.ensure_dirs()
    stamp = datetime.now(config.LOCAL_TZ).strftime("%Y-%m-%d %H:%M %Z")
    print(f"=== Maryland Contract Scout scan {stamp} ===")
    profile, origin = load_profile()
    print(f"business profile: {origin if profile else 'none (general contract analysis)'}")
    with db.session() as conn:
        if config.imap_available():
            r = inbox.run_inbox_intake(conn, profile=profile)
            print(f"inbox: {r.get('status')} found={r.get('found', 0)} new={r.get('new', 0)} processed={r.get('processed', 0)} skipped={r.get('skipped', 0)} "
                  + (f"reason={r.get('reason')}" if r.get("reason") else "") + (f" errors={len(r.get('errors', []))}" if r.get("errors") else ""))
            for e in r.get("errors", [])[:10]:
                print("   !", e)
        else:
            print("inbox: skipped (set IMAP_HOST / IMAP_USER / IMAP_PASSWORD in .env)")
        for src in sources.load_registry():
            if src.get("access_method") in ("rss", "api", "public_listing") and sources.source_readiness(src)[0] == "ready":
                r = sources.scan_source(conn, src)
                print(f"{src['id']:>24}: {r['status']} {r.get('reason', '')} new={r.get('new', 0)}")
        n = pipeline.evaluate_all(conn, profile, use_active_profile=False)
        created = alerts.generate_alerts(conn)
        out = alerts.send_digest(conn, dashboard_url=config.DASHBOARD_URL)
        print(f"evaluated {n} opportunities; alerts created={len(created)}; digest sent via {out['channel']}")
        snap = maintenance.snapshot(conn, config.DASHBOARD_URL)
        print(f"snapshot: csv={snap['csv']} ics={snap['ics']} backup={snap['backup']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
