from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import config, db, alerts, deadlines, calendar_export
from .common import get_conn


def render():
    st.title("Deadline & Change Alerts")
    conn = get_conn()
    st.write("Email: " + ("**SMTP configured** → digests will send to " + ", ".join(config.ALERT_TO) if config.smtp_available()
                          else "**not configured** → digests are written to `data/outbox/` as a dry run. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, ALERT_TO in .env."))
    st.subheader("Opportunities you can do")
    doable = alerts.doable_opportunities(conn)
    if doable:
        st.dataframe(pd.DataFrame([{"Opportunity": x["opportunity"]["title"], "Industry": x["opportunity"]["industry"], "Why": x["why"],
                                    "Deadline": deadlines.format_local(x["opportunity"]["bid_deadline_utc"]), "Days left": round(x["days_left"], 1) if x["days_left"] is not None else None,
                                    "Resolve first": "; ".join(x["gaps"])} for x in doable]), width="stretch", hide_index=True)
    else:
        st.caption("None yet: nothing on file is both in a can-do industry and at least a Conditional Match with a live deadline.")
    st.caption("Can-do industries come from the active entity's profile (capabilities.industries): " + ", ".join(alerts.can_do_industries()))
    st.download_button("Download deadlines calendar (.ics for Google/Outlook)", calendar_export.build_ics(conn, config.DASHBOARD_URL), "contract_scout_deadlines.ics", "text/calendar")
    st.caption("Import the .ics file into Google Calendar (Settings > Import) to get bid-due and pre-bid meeting reminders. The scheduled scan refreshes data/exports/deadlines.ics daily.")
    st.subheader("Deadline board")
    rows = []
    for o in db.list_opportunities(conn):
        rows.append({"Opportunity": o["title"], "Deadline (local)": deadlines.format_local(o["bid_deadline_utc"]), "Urgency": deadlines.urgency_bucket(o["bid_deadline_utc"]),
                     "Status": o["status"], "Qualification": o["match_class"] or "Not evaluated"})
    if rows:
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    c1, c2 = st.columns(2)
    if c1.button("Generate alerts now"):
        created = alerts.generate_alerts(conn)
        conn.commit()
        st.success(f"{len(created)} new alert(s).")
    if c2.button("Build digest and send (or dry run)"):
        out = alerts.send_digest(conn, force_dry_run=not config.smtp_available())
        conn.commit()
        st.success(f"Digest handled via {out['channel']} covering {out['alerts']} alert(s).")
        st.code(out["body"])
    st.subheader("Preview of the next digest")
    st.code(alerts.build_digest(conn))
    st.subheader("Alert log")
    al = db.list_alerts(conn)
    if al:
        st.dataframe(pd.DataFrame([{"When": a["created_at"][:16], "Kind": a["kind"], "Message": a["message"], "Sent": a["sent_at"] or "", "Channel": a["channel"] or ""} for a in al]), width="stretch", hide_index=True)
    st.subheader("Unacknowledged changes")
    ch = db.list_change_events(conn, unacknowledged_only=True)
    if ch:
        st.dataframe(pd.DataFrame(ch), width="stretch", hide_index=True)
    else:
        st.caption("None.")
