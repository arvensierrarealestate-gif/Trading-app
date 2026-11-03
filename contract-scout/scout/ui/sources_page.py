from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db, sources
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

    st.subheader("Scan history")
    hist = db.list_scans(conn)
    if hist:
        st.dataframe(pd.DataFrame(hist), width="stretch", hide_index=True)
    else:
        st.caption("No scans yet.")
