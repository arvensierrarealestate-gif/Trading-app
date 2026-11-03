"""Scheduled scan entry point: scan every ready source, refresh alerts, send/dry-run the digest.

Schedule it with cron (Linux/macOS) or Task Scheduler (Windows), e.g. weekdays at 7:30 AM:
  30 7 * * 1-5  cd /path/to/contract-scout && python scripts/run_scan.py >> data/scan.log 2>&1
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scout import config, db, sources, alerts, pipeline  # noqa: E402


def main() -> int:
    config.ensure_dirs()
    with db.session() as conn:
        for src in sources.load_registry():
            r = sources.scan_source(conn, src)
            print(f"{src['id']:>24}: {r['status']} {r.get('reason', '')} new={r.get('new', 0)}")
        pipeline.evaluate_all(conn)
        created = alerts.generate_alerts(conn)
        out = alerts.send_digest(conn, dashboard_url=config.__dict__.get("DASHBOARD_URL", "http://localhost:8501"))
        print(f"alerts created={len(created)} sent via {out['channel']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
