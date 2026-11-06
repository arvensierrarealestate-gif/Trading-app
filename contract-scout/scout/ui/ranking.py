from __future__ import annotations

import json

import pandas as pd
import streamlit as st

from .. import db, deadlines, pipeline
from .common import get_conn, money


POT_BADGE = {"High": "🟢", "Moderate": "🟡", "Low": "🔴", "Requires investigation": "⚪", None: "⚪"}


def render():
    st.title("Opportunity Ranking")
    st.write("Company-independent 100-point model: industry relevance and accessibility 25 · profitability 20 · entry barriers 20 · "
             "operational feasibility 15 · financial exposure 10 · competition and deadline readiness 10. Missing information lowers the score "
             "and forces **Requires investigation**; it never adds points.")
    conn = get_conn()
    if st.button("Re-run general analysis on all opportunities"):
        n = pipeline.evaluate_all(conn, None, use_active_profile=True)
        conn.commit()
        st.success(f"Re-analyzed {n} opportunities.")
        st.rerun()
    rows = []
    for o in db.list_opportunities(conn):
        try:
            parts = (json.loads(o.get("potential_reasons") or "{}")).get("parts", [])
            access = json.loads(o.get("barriers_json") or "{}")
        except json.JSONDecodeError:
            parts, access = [], {}
        rows.append({"ID": o["id"], "Potential": f"{POT_BADGE.get(o.get('opportunity_potential'))} {o.get('opportunity_potential') or 'not analyzed'}",
                     "Score": o.get("potential_score"), "Title": o["title"], "Agency": o["agency"], "Where": o.get("jurisdiction"), "Industry": o["industry"],
                     "Value": money(o["value_high"] or o["value_low"]), "Deadline": deadlines.format_local(o["bid_deadline_utc"]),
                     "Entry barrier": access.get("entry_barrier", ""), "Subcontract-able": access.get("subcontract_feasible", ""),
                     "Business match": o.get("match_class") or "(no business selected)", "Recommendation": o.get("recommendation"),
                     "Breakdown": " | ".join(f"{p['component'].split(' ')[0]} {p['points']}/{p['max']}" for p in parts if p.get("max"))})
    if not rows:
        st.info("Nothing to rank yet.")
        return
    df = pd.DataFrame(rows).sort_values("Score", ascending=False, na_position="last")
    st.dataframe(df, width="stretch", hide_index=True)
    st.subheader("Why each score")
    for o in sorted(db.list_opportunities(conn), key=lambda x: -(x.get("potential_score") or 0))[:15]:
        try:
            reasons = json.loads(o.get("potential_reasons") or "{}")
        except json.JSONDecodeError:
            reasons = {}
        with st.expander(f"{POT_BADGE.get(o.get('opportunity_potential'))} {o.get('potential_score')}/100 · {o['title']}"):
            for p in reasons.get("parts", []):
                st.write(f"- **{p['component']}** {p['points']}/{p['max']}: {p['why']}")
            if reasons.get("missing"):
                st.warning("Information gaps: " + ", ".join(reasons["missing"]))
