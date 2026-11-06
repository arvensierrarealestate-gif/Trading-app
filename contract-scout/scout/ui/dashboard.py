from __future__ import annotations

import json

import pandas as pd
import streamlit as st

from .. import db, deadlines, export
from ..models import OPP_STATUSES, MATCH_CLASSES, RECOMMENDATIONS, INDUSTRIES, JURISDICTIONS
from .common import get_conn, BADGE, REC_BADGE, money, capability_banner


def render():
    st.title("Opportunity Discovery")
    capability_banner()
    conn = get_conn()
    c = db.counts(conn)
    m1, m2, m3, m4, m5, m6 = st.columns(6)
    m1.metric("Opportunities", c["total"])
    m2.metric("High potential", c.get("High", 0))
    m3.metric("Moderate", c.get("Moderate", 0))
    m4.metric("Low", c.get("Low", 0))
    m5.metric("Needs investigation", c.get("Requires investigation", 0))
    m6.metric("Unsent alerts", c["unsent_alerts"])

    with st.sidebar:
        st.subheader("Filters")
        f_jur = st.multiselect("Jurisdiction", list(JURISDICTIONS))
        f_ind = st.multiselect("Industry", list(INDUSTRIES) + ["Other / Unclassified"])
        f_pot = st.multiselect("Opportunity rating", ["High", "Moderate", "Low", "Requires investigation"])
        f_match = st.multiselect("Business match (only with a business selected)", list(MATCH_CLASSES) + ["Not evaluated"])
        f_rec = st.multiselect("Recommendation", list(RECOMMENDATIONS))
        f_status = st.multiselect("Bid status", list(OPP_STATUSES))
        f_days = st.slider("Deadline within (days)", 0, 120, 120)
        v_lo, v_hi = st.slider("Contract value ($k)", 0, 5000, (0, 5000), step=25)
        max_years = st.slider("Max. years of experience required", 0, 10, 10)
        f_lic = st.multiselect("Licensing difficulty", ["low", "medium", "high", "unknown"])
        f_cap = st.multiselect("Capital requirement", ["low", "medium", "high", "unknown"])
        f_sub = st.checkbox("Subcontracting possible only", value=False)
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
        try:
            access = json.loads(o.get("barriers_json") or "{}")
        except json.JSONDecodeError:
            access = {}
        ans = {a["key"]: a for a in access.get("answers", [])}
        if f_jur and (o.get("jurisdiction") or "Maryland") not in f_jur:
            continue
        if f_pot and (o.get("opportunity_potential") or "") not in f_pot:
            continue
        val = o["value_high"] or o["value_low"]
        if val is not None and not (v_lo * 1000 <= val <= v_hi * 1000) and not (v_hi == 5000 and val > 5_000_000):
            continue
        if max_years < 10:
            import re as _re
            m = _re.search(r"(\d+(?:\.\d+)?)\s*years", (ans.get("min_history", {}).get("answer") or ""))
            if m and float(m.group(1)) > max_years:
                continue
        if f_lic and (ans.get("licensing", {}).get("barrier") or "unknown") not in f_lic:
            continue
        if f_cap and (ans.get("upfront_capital", {}).get("barrier") or "unknown") not in f_cap:
            continue
        if f_sub and not access.get("subcontract_feasible"):
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
            "Potential": o.get("opportunity_potential") or "not analyzed",
            "Score": o.get("potential_score"),
            "Entry barrier": access.get("entry_barrier", ""),
            "Business match": f"{BADGE.get(o['match_class'])} {o['match_class']}" if o.get("match_class") else "—",
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
