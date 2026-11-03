from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import config, db, alerts, deadlines
from .common import get_conn


def render():
    st.title("Deadline & Change Alerts")
    conn = get_conn()
    st.write("Email: " + ("**SMTP configured** → digests will send to " + ", ".join(config.ALERT_TO) if config.smtp_available()
                          else "**not configured** → digests are written to `data/outbox/` as a dry run. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, ALERT_TO in .env."))
    st.subheader("Deadline board")
    rows = []
    for o in db.list_opportunities(conn):
        rows.append({"Opportunity": o["title"], "Deadline (local)": deadlines.format_local(o["bid_deadline_utc"]), "Urgency": deadlines.urgency_bucket(o["bid_deadline_utc"]),
                     "Status": o["status"], "Qualification": o["match_class"] or "Not evaluated"})
    if rows:
        st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
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
        st.dataframe(pd.DataFrame([{"When": a["created_at"][:16], "Kind": a["kind"], "Message": a["message"], "Sent": a["sent_at"] or "", "Channel": a["channel"] or ""} for a in al]), use_container_width=True, hide_index=True)
    st.subheader("Unacknowledged changes")
    ch = db.list_change_events(conn, unacknowledged_only=True)
    if ch:
        st.dataframe(pd.DataFrame(ch), use_container_width=True, hide_index=True)
    else:
        st.caption("None.")
