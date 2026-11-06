from __future__ import annotations

import json

import pandas as pd
import streamlit as st

from .. import db, deadlines
from .common import get_conn, money


def render():
    st.title("Subcontracting Opportunities")
    st.write("Contracts where the documents allow subcontracting or joint ventures, or where the main barriers are ones a qualified partner could cover. "
             "Even as a subcontractor you still need your own insurance, licenses and good standing.")
    conn = get_conn()
    rows = []
    for o in db.list_opportunities(conn):
        try:
            access = json.loads(o.get("barriers_json") or "{}")
        except json.JSONDecodeError:
            access = {}
        sub = (o.get("subcontracting_allowed") or "not stated")
        jv = (o.get("joint_venture_allowed") or "not stated")
        feasible = access.get("subcontract_feasible")
        if sub == "no" and jv == "no":
            continue
        high = [a["question"].rstrip("?") for a in access.get("answers", []) if a.get("barrier") == "high"]
        rows.append({"ID": o["id"], "Title": o["title"][:60], "Where": o.get("jurisdiction"), "Industry": o["industry"], "Value": money(o["value_high"] or o["value_low"]),
                     "Deadline": deadlines.format_local(o["bid_deadline_utc"]), "Subcontracting": sub, "Joint venture": jv,
                     "Partner could cover": "; ".join(high) or "nothing rated high", "Potential": o.get("opportunity_potential"), "Feasible via partner": feasible})
    if rows:
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    else:
        st.info("No subcontracting-friendly contracts yet.")
    st.subheader("Partner leads on file")
    parts = db.list_partners(conn)
    if parts:
        st.dataframe(pd.DataFrame([{"Name": p["name"], "Role": p["role"], "Industry": p["industry"], "Contact": p["contact"], "Opportunity #": p["opportunity_id"], "Notes": p["notes"]} for p in parts]), width="stretch", hide_index=True)
    else:
        st.caption("None yet. Add partners on the Partners page or from a contract's Partners tab.")
