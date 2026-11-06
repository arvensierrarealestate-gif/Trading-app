from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db, sources, config, inbox, alerts, maintenance
from .common import get_conn


def render():
    st.title("Opportunity Sources & Scans")
    st.write("Only permitted access methods run automatically: manual upload, RSS/Atom feeds a site publishes, and notification emails you receive. "
             "Portal pages are never scraped until you confirm the terms allow it and set `allowed_fetch` to true in `source_registry.json`.")
    conn = get_conn()
    reg = sources.load_registry()
    rows = []
    for s in reg:
        state, reason = sources.source_readiness(s)
        rows.append({"Source": s["name"], "Jurisdiction": s["jurisdiction"], "Type": s["type"], "Access method": s["access_method"],
                     "Readiness": state, "Why": reason, "URL": s.get("url", ""), "URL verified": s.get("url_verified", False), "Notes": s.get("notes", "")})
    st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    st.caption("URL verified = false means the address came from general knowledge; open it in a browser once and flip the flag in source_registry.json.")

    st.subheader("Inbox intake (notification emails)")
    stats = db.inbox_stats(conn)
    c1, c2, c3 = st.columns(3)
    c1.metric("Emails processed", stats["processed_emails"])
    c2.metric("Last processed", (stats["last_processed"] or "never")[:16])
    ls = stats["last_scan"]
    c3.metric("Last inbox scan", f"{ls['status']} {ls['started_at'][:16]}" if ls else "never")
    if config.imap_available():
        st.success(f"IMAP configured for {config.IMAP_USER} on {config.IMAP_HOST}; sender filters: {config.IMAP_SENDER_FILTER}")
        if st.button("Read inbox and process new notices now", type="primary"):
            with st.spinner("Reading inbox..."):
                r = inbox.run_inbox_intake(conn)
                conn.commit()
            st.write(r)
    else:
        st.info("IMAP not configured. Set IMAP_HOST, IMAP_USER, IMAP_PASSWORD (and optionally IMAP_SENDER_FILTER) in .env. "
                "Until then you can forward notification emails to yourself, save them as .eml files, and drop them below.")
    eml = st.file_uploader("Process saved notification emails (.eml)", type=["eml"], accept_multiple_files=True)
    if eml and st.button("Process these emails"):
        notices = [inbox.parse_message(f.getvalue(), uid=f.name) for f in eml]
        r = inbox.run_inbox_intake(conn, notices=notices)
        conn.commit()
        st.write(r)
        if r.get("new"):
            alerts.generate_alerts(conn)
            conn.commit()
    st.caption("The scheduled scan (schedule_scan.bat on Windows, cron elsewhere) runs this same intake every weekday morning and emails the digest.")

    st.subheader("Run a scan now")
    ready = [s for s in reg if sources.source_readiness(s)[0] == "ready"]
    if not ready:
        st.info("No automated source is ready. eMMA email intake needs IMAP_* credentials in .env; everything else is manual upload for now.")
    pick = st.multiselect("Sources", [s["id"] for s in ready], default=[s["id"] for s in ready])
    if st.button("Scan selected", disabled=not pick):
        for s in reg:
            if s["id"] in pick:
                r = sources.scan_source(conn, s)
                conn.commit()
                st.write(f"**{s['id']}** → {r['status']} {r.get('reason', '')} · new leads: {r.get('new', 0)}")

    with st.expander("Scheduled scan log (data/scan.log)"):
        st.code(maintenance.scan_log_tail(), language="text")
    st.subheader("Scan history")
    hist = db.list_scans(conn)
    if hist:
        st.dataframe(pd.DataFrame(hist), width="stretch", hide_index=True)
    else:
        st.caption("No scans yet.")
