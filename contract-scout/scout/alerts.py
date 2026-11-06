"""Deadline and change alerts with an email digest.

If SMTP is not configured the digest is written to data/outbox/ as a dry run so
the content can be reviewed before any email goes out.
"""
from __future__ import annotations

import json
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Optional

from . import config, db, deadlines
from .models import STRONG, CONDITIONAL, REJECT, DEFAULT_CAN_DO_INDUSTRIES, utcnow_iso
from .profile import load_profile, fact

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
        msg = f"Amendment/change on {opp['title']}: {ch['field']} changed from '{ch['old_value']}' to '{ch['new_value']}'. -> {config.DASHBOARD_URL}/detail?opp={opp['id']}"
        aid = db.add_alert(conn, "amendment", msg, opp["id"], f"change:{ch['id']}")
        if aid:
            created.append({"id": aid, "kind": "amendment", "message": msg})
    if created:
        db.log(conn, "generate_alerts", "alerts", "", {"created": len(created)})
    return created


def can_do_industries(profile: Optional[dict] = None) -> tuple[str, ...]:
    """Industries in focus: the selected business's list, else the system's tracked industries."""
    if profile is None:
        try:
            profile, _ = load_profile()
        except FileNotFoundError:
            profile = None
    if profile is None:
        return DEFAULT_CAN_DO_INDUSTRIES
    f = fact(profile, "capabilities.industries")
    vals = tuple(f.value) if isinstance(f.value, list) and f.value else ()
    return vals or DEFAULT_CAN_DO_INDUSTRIES


def doable_opportunities(conn, profile: Optional[dict] = None, now: Optional[datetime] = None) -> list[dict]:
    """Opportunities worth your attention: in a can-do industry, deadline not passed, evaluated as
    Strong, or Conditional with a partner path, and not recommended for rejection."""
    inds = set(can_do_industries(profile))
    out = []
    for o in db.list_opportunities(conn):
        if o["industry"] not in inds:
            continue
        d = deadlines.days_until(o["bid_deadline_utc"], now)
        if d is not None and d < 0:
            continue
        if o["status"] in ("Rejected", "Lost", "Awarded", "Submitted", "Cancelled"):
            continue
        if o["recommendation"] == REJECT:
            continue
        pot = o.get("opportunity_potential")
        if o.get("match_class"):   # business mode
            ev = db.latest_evaluation(conn, o["id"])
            if not ev or ev["match_class"] not in (STRONG, CONDITIONAL):
                continue
            open_items = [c for c in ev["checks"] if c["mandatory"] and c["result"] in ("UNKNOWN", "NOT_MET")]
            why = "Strong Match" if ev["match_class"] == STRONG else f"Conditional Match, {len(open_items)} item(s) to resolve"
            gaps = [c["requirement"][:60] for c in open_items][:3]
        else:                      # general mode
            if pot not in ("High", "Moderate"):
                continue
            why = f"{pot} opportunity potential"
            try:
                access = json.loads(o.get("barriers_json") or "{}")
            except json.JSONDecodeError:
                access = {}
            gaps = [a["question"].rstrip("?") + ": " + a["answer"][:50] for a in access.get("answers", []) if a.get("barrier") in ("high", "unknown")][:3]
        out.append({"opportunity": o, "why": why, "gaps": gaps, "days_left": d, "commercial_score": o.get("potential_score") or o.get("commercial_score"),
                    "entity": o.get("recommended_entity"), "potential": pot})
    out.sort(key=lambda x: (0 if (x["why"] == "Strong Match" or x["potential"] == "High") else 1, -(x["commercial_score"] or 0), x["days_left"] if x["days_left"] is not None else 9999))
    return out


def build_digest(conn, dashboard_url: str = "http://localhost:8501", profile: Optional[dict] = None) -> str:
    """Plain-text digest: the doable list first, then alerts and housekeeping."""
    unsent = db.list_alerts(conn, unsent_only=True)
    opps = db.list_opportunities(conn)
    lines = [f"Maryland Contract Scout digest - {datetime.now(config.LOCAL_TZ).strftime('%a %b %d, %Y %I:%M %p %Z')}", ""]
    def section(title, items):
        if items:
            lines.append(title)
            lines.extend(f"  - {i}" for i in items)
            lines.append("")
    doable = doable_opportunities(conn, profile)
    section("OPPORTUNITIES YOU CAN DO (" + ", ".join(can_do_industries(profile)) + ")",
            [f"{x['opportunity']['title']} [{x['opportunity']['industry']}] due {deadlines.format_local(x['opportunity']['bid_deadline_utc'])} "
             f"- {x['why']}; score {x['commercial_score'] if x['commercial_score'] is not None else 'n/a'}/100; entity: {x['entity'] or 'n/a'}" + (f"; resolve: {'; '.join(x['gaps'])}" if x['gaps'] else "") + f"  -> {dashboard_url}/detail?opp={x['opportunity']['id']}" for x in doable])
    if not doable:
        lines += ["OPPORTUNITIES YOU CAN DO", "  - None yet. Everything on file is either outside the tracked industries, past deadline, low potential, or Poor Match.", ""]
    else:
        from . import recommend
        lines.append("DETAILED REPORTS (top " + str(min(5, len(doable))) + ")")
        for x in doable[:5]:
            try:
                lines.append(recommend.card_text(recommend.build_card(conn, x["opportunity"]["id"], profile, dashboard_url)))
            except Exception as exc:  # a broken card must not kill the digest
                lines.append(f"  (report unavailable for #{x['opportunity']['id']}: {exc})")
            lines.append("")
    section("NEW OPPORTUNITIES", [a["message"] for a in unsent if a["kind"] == "new"])
    section("STRONG MATCHES", [a["message"] for a in unsent if a["kind"] == "strong_match"])
    section("DEADLINES APPROACHING", [a["message"] for a in unsent if a["kind"].startswith("deadline")])
    section("CANCELLED - STOP WORK", [a["message"] for a in unsent if a["kind"] == "cancelled"])
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
