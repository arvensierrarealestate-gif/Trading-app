"""Load the two fictitious sample solicitations, evaluate them, and create alerts.

Run:  python scripts/seed_sample_data.py
Uses the offline heuristic reader unless --claude is passed and ANTHROPIC_API_KEY is set.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scout import config, db, intake, pipeline, alerts, finance  # noqa: E402
from scout.profile import load_profile_or_sample as load_profile  # noqa: E402


def main(prefer_claude: bool = False) -> None:
    config.ensure_dirs()
    from scripts.make_sample_solicitation import main as make_docs
    paths = make_docs()
    profile, origin = load_profile()
    print(f"profile origin: {origin}")
    with db.session() as conn:
        for p in paths:
            report = intake.ingest_document(conn, p.name, p.read_bytes(), source_id="sample", prefer_claude=prefer_claude, is_sample=True, actor="seed")
            oid = report["opportunity_id"]
            res = pipeline.evaluate_opportunity(conn, oid, profile, actor="seed")
            print(f"[{p.name}] opp={oid} created={report['created']} reqs={report['requirements_extracted']} engine={report['engine']} "
                  f"-> {res['match_class']} score={res['score']} rec={res['recommendation']}")
            opp = db.get_opportunity(conn, oid)
            a = finance.default_assumptions(pipeline.contract_value_of(opp), opp["value_status"], bond_required=True)
            if "janitorial" in p.name:
                a["labor_hours"]["value"] = 5 * 52 * 4 * 2   # 2 cleaners x 4h x 5 nights
                a["materials"]["value"] = 18000
                a["equipment"]["value"] = 6000
                a["transportation"]["value"] = 4000
            else:
                a["labor_hours"]["value"] = 4200
                a["labor_rate"]["value"] = 42.0
                a["materials"]["value"] = 390000
                a["equipment"]["value"] = 45000
                a["subcontractors"]["value"] = 60000
            est = pipeline.save_estimate(conn, oid, a, label="seed assumptions (editable)", actor="seed")
            print(f"   margin={est['results'].get('gross_margin_pct')}% rec={est['recommendation']}")
        if not db.list_partners(conn):
            db.add_partner(conn, "Sample Roofing Prime Co (fictitious)", "prime contractor", "Construction & Property Services",
                           "", "", "Example partner record: a bonded roofer that could carry the roof job while we self-perform demolition and flashing.")
        created = alerts.generate_alerts(conn)
        out = alerts.send_digest(conn, force_dry_run=True)
        print(f"alerts created: {len(created)}; digest written via {out['channel']}")


if __name__ == "__main__":
    main(prefer_claude="--claude" in sys.argv)
