from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db
from .common import get_conn


def render():
    st.title("Subcontractor & Partner Tracker")
    st.write("Track primes, subs, suppliers and JV candidates. Partnering changes who holds the contract, not which rules apply to you: "
             "insurance at the prime's required limits, trade licenses, SDAT good standing and any certification the prime counts you toward still apply.")
    conn = get_conn()
    parts = db.list_partners(conn)
    if parts:
        df = pd.DataFrame([{"ID": p["id"], "Name": p["name"], "Role": p["role"], "Industry": p["industry"], "Contact": p["contact"],
                            "Opportunity #": p["opportunity_id"], "Notes": p["notes"], "Link": p["source_url"], "Added": p["created_at"][:10]} for p in parts])
        st.dataframe(df, use_container_width=True, hide_index=True)
        rm = st.selectbox("Remove a partner", [None] + [p["id"] for p in parts], format_func=lambda i: "—" if i is None else f"#{i}")
        if rm and st.button("Remove"):
            db.delete_partner(conn, rm)
            db.log(conn, "delete_partner", "partner", rm, actor="user")
            conn.commit()
            st.rerun()
    else:
        st.info("No partners yet.")
    with st.form("new_partner"):
        st.subheader("Add partner lead")
        n = st.text_input("Name")
        role = st.selectbox("Role", ["prime contractor", "subcontractor", "supplier", "joint venture", "mentor-protégé"])
        ind = st.text_input("Industry")
        contact = st.text_input("Contact")
        url = st.text_input("Source URL (award notice, directory, etc.)")
        note = st.text_area("Notes (how you found them, what they need from you)")
        if st.form_submit_button("Add") and n:
            db.add_partner(conn, n, role, ind, contact, url, note)
            db.log(conn, "add_partner", "partner", n, actor="user")
            conn.commit()
            st.rerun()
    st.subheader("Where partner leads come from (manual research for now)")
    st.markdown("- eMMA award notices and bid tabulations for the same commodity codes\n- Maryland MBE/SBR directories\n- Agency pre-bid attendance sheets\n- Prime contractors' subcontractor outreach pages\n\nAutomated collection of awards is a later-stage item on the checklist.")
