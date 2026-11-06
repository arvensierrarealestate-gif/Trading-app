from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db, deadlines, export
from ..models import OPP_STATUSES, MATCH_CLASSES, RECOMMENDATIONS, INDUSTRIES, JURISDICTIONS
from .common import get_conn, BADGE, REC_BADGE, money, capability_banner


def render():
    st.title("Opportunity Dashboard")
    capability_banner()
    conn = get_conn()
    c = db.counts(conn)
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Opportunities", c["total"])
    m2.metric("Strong", c["Strong Match"])
    m3.metric("Conditional", c["Conditional Match"])
    m4.metric("Poor", c["Poor Match"])
    m5.metric("Unsent alerts", c["unsent_alerts"])

    with st.sidebar:
        st.subheader("Filters")
        f_jur = st.multiselect("Jurisdiction", list(JURISDICTIONS))
        f_ind = st.multiselect("Industry", list(INDUSTRIES) + ["Other / Unclassified"])
        f_match = st.multiselect("Qualification", list(MATCH_CLASSES) + ["Not evaluated"])
        f_rec = st.multiselect("Recommendation", list(RECOMMENDATIONS))
        f_status = st.multiselect("Bid status", list(OPP_STATUSES))
        f_days = st.slider("Deadline within (days)", 0, 120, 120)
        hide_samples = st.checkbox("Hide sample records", value=False)
        min_margin = st.number_input("Min. estimated margin %", value=-100.0, step=5.0)
        min_cscore = st.slider("Min. commercial score", 0, 100, 0)

    rows = []
    for o in db.list_opportunities(conn, exclude_samples=hide_samples):
        d = deadlines.days_until(o["bid_deadline_utc"])
        est = db.latest_cost_estimate(conn, o["id"])
        ev = db.latest_evaluation(conn, o["id"])
        margin = est["results"].get("gross_margin_pct") if est else None
        open_items = [ch for ch in (ev["checks"] if ev else []) if ch["mandatory"] and ch["result"] in ("UNKNOWN", "NOT_MET")]
        if f_jur and (o.get("jurisdiction") or "Maryland") not in f_jur:
            continue
        if f_ind and o["industry"] not in f_ind:
            continue
        if min_cscore and (o.get("commercial_score") or 0) < min_cscore:
            continue
        if f_match and not ((o["match_class"] in f_match) or (o["match_class"] is None and "Not evaluated" in f_match)):
            continue
        if f_rec and o["recommendation"] not in f_rec:
            continue
        if f_status and o["status"] not in f_status:
            continue
        if f_days < 120 and (d is None or d > f_days):
            continue
        if margin is not None and margin < min_margin:
            continue
        rows.append({
            "ID": o["id"],
            "Title": o["title"],
            "Number": o["solicitation_number"] or "—",
            "Agency": o["agency"] or "Not found",
            "Where": o.get("jurisdiction") or "Maryland",
            "Industry": o["industry"],
            "Location": o["location"] or "Not found",
            "Value": money(o["value_high"] or o["value_low"]) + ("" if o["value_status"] == "VERIFIED" else f" ({o['value_status']})"),
            "Deadline": deadlines.format_local(o["bid_deadline_utc"]),
            "Days left": round(d, 1) if d is not None else None,
            "Qualification": f"{BADGE.get(o['match_class'])} {o['match_class'] or 'Not evaluated'}",
            "Score": o["match_score"],
            "Commercial": o.get("commercial_score"),
            "Entity": o.get("recommended_entity") or "",
            "Open items": len(open_items),
            "Est. margin %": margin,
            "Recommendation": f"{REC_BADGE.get(o['recommendation'])} {o['recommendation'] or '—'}",
            "Status": o["status"],
            "Sample": bool(o["is_sample"]),
        })
    if not rows:
        st.info("No opportunities match these filters. Upload a solicitation on the **Upload** page or run `python scripts/seed_sample_data.py` for sample records.")
        return
    df = pd.DataFrame(rows)
    st.dataframe(df, width="stretch", hide_index=True)
    st.download_button("Export filtered table to CSV (Google Sheets-ready)", export.opportunities_csv(conn), "opportunities.csv", "text/csv")

    st.subheader("Open an opportunity")
    pick = st.selectbox("Select", options=[r["ID"] for r in rows], format_func=lambda i: f"#{i} · {next(r['Title'] for r in rows if r['ID'] == i)}")
    if st.button("Open detail page", type="primary"):
        st.session_state.selected_opp = pick
        st.switch_page(st.session_state.pages["detail"])
