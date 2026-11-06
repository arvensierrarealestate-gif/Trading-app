from __future__ import annotations

import json

import pandas as pd
import streamlit as st

from .. import db
from ..models import REQ_CATEGORIES
from .common import get_conn


def render():
    st.title("Qualification Requirements")
    st.write("Every requirement the reader extracted, across all contracts, with its page reference. Mandatory and preferred are kept separate. "
             "Use this to see what licenses, insurance, experience and certifications the market is asking for.")
    conn = get_conn()
    opps = {o["id"]: o for o in db.list_opportunities(conn)}
    cats = st.multiselect("Category", list(REQ_CATEGORIES), default=["eligibility", "experience", "license", "insurance", "bond", "financial", "staffing", "restriction"])
    only_mand = st.checkbox("Mandatory only", value=False)
    rows = []
    for oid, o in opps.items():
        for r in db.list_requirements(conn, oid):
            if cats and r["category"] not in cats:
                continue
            if only_mand and not r["mandatory"]:
                continue
            rows.append({"Contract": o["title"][:60], "Where": o.get("jurisdiction"), "Category": r["category"], "Mandatory": r["mandatory"],
                         "Requirement": r["text"], "Value": r["value"], "Page": r["page_ref"], "Document": r["document"], "Confidence": r["confidence"], "By": r["method"]})
    if rows:
        st.dataframe(pd.DataFrame(rows), width="stretch", hide_index=True)
    else:
        st.info("No requirements match.")
    st.subheader("Entry-barrier answers per contract")
    for oid, o in opps.items():
        try:
            access = json.loads(o.get("barriers_json") or "{}")
        except json.JSONDecodeError:
            access = {}
        if not access:
            continue
        with st.expander(f"{o['title']} · entry barrier: {access.get('entry_barrier')} · {access.get('mandatory_count')} mandatory / {access.get('preferred_count')} preferred"):
            for a in access.get("answers", []):
                icon = {"low": "🟢", "medium": "🟡", "high": "🔴", "unknown": "⚪"}.get(a["barrier"], "⚪")
                st.write(f"{icon} **{a['question']}** {a['answer']}  \n:gray[evidence: {a['evidence']}{(' · ' + a['note']) if a.get('note') else ''}]")
            st.caption("Business types that could perform this work: " + ", ".join(access.get("business_types", [])))
