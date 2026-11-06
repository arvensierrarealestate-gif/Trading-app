from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db, pipeline
from ..profile import list_profiles
from .common import get_conn, get_profile, BADGE


def render():
    st.title("Optional Business Matching")
    st.write("Compare any contract against the business profiles on file. Strong, Conditional and Poor Match are assigned only here, from verified company facts. "
             "General analysis on the other pages never depends on a business.")
    conn = get_conn()
    profile, origin = get_profile()
    profiles = [p for p in list_profiles() if p["id"] != "company_profile"]
    if not profiles:
        st.info("No business profiles yet. Add one on the Business Profiles page.")
        return
    opps = db.list_opportunities(conn)
    if not opps:
        st.info("No contracts yet.")
        return
    oid = st.selectbox("Contract", [o["id"] for o in opps], format_func=lambda i: f"#{i} · {next(o['title'] for o in opps if o['id'] == i)}")
    rows = pipeline.compare_entities(conn, oid)
    if rows:
        st.dataframe(pd.DataFrame([{"Business": r["entity"], "Match": f"{BADGE.get(r['match_class'])} {r['match_class']}", "Score": r["score"], "Met": r["met"], "Unknown": r["unknown"],
                                    "Not met": r["not_met"], "Legally eligible": r["legally_eligible"], "Partner path": r["partner_feasible"], "Top gap": r["top_gap"]} for r in rows]),
                     width="stretch", hide_index=True)
    st.caption("Unknown is homework, not a pass: a business with no verified facts can never do better than Conditional.")
    if profile is not None and st.button(f"Run full matching for the selected business on this contract"):
        res = pipeline.evaluate_opportunity(conn, oid, profile, actor="user")
        conn.commit()
        st.success(f"{res['match_class']} · {res['summary']}")
    elif profile is None:
        st.info("Select a business in the sidebar to run and save a full match with reasons on the Contract Analysis page.")
