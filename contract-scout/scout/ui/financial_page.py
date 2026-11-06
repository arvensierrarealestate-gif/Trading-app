from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db, deadlines
from .common import get_conn, money


def render():
    st.title("Financial Evaluation")
    st.write("Published values versus modeled estimates. A profitability figure is shown only when both revenue and cost inputs exist; "
             "otherwise the contract is marked not assessable rather than guessed.")
    conn = get_conn()
    rows = []
    for o in db.list_opportunities(conn):
        est = db.latest_cost_estimate(conn, o["id"])
        r = est["results"] if est else {}
        sc = r.get("scenarios", {})
        rows.append({"ID": o["id"], "Title": o["title"][:60], "Published value": money(o["value_high"] or o["value_low"]) if o["value_status"] == "VERIFIED" else "not published",
                     "Modeled revenue": money(r.get("revenue")) if r else "—", "Base cost": money(r.get("total_cost_base")) if r else "—",
                     "Conservative margin %": sc.get("conservative", {}).get("margin_pct") if sc else None, "Base margin %": r.get("gross_margin_pct") if r else None,
                     "Optimistic margin %": sc.get("optimistic", {}).get("margin_pct") if sc else None,
                     "Working capital": money(r.get("working_capital_needed")) if r else "—", "Reliable": r.get("reliable") if r else False,
                     "Note": r.get("reliability_note") if r else "No estimate yet (open the contract, Cost & margin tab)", "Deadline": deadlines.format_local(o["bid_deadline_utc"])})
    if rows:
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    else:
        st.info("No opportunities yet.")
    st.caption("Open a contract and use the Cost & margin tab to enter or adjust assumptions. Labor rates start from the local wage floor.")
