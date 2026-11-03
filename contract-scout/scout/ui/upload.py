from __future__ import annotations

import streamlit as st

from .. import config, db, intake, pipeline, sources
from ..models import INDUSTRIES
from .common import get_conn, get_profile


def render():
    st.title("Upload a Solicitation")
    st.write("Upload the solicitation PDF/DOCX plus any amendments or attachments. The reader extracts requirements with page references, "
             "detects duplicates and amendments, then the compliance engine scores it against your profile.")
    conn = get_conn()
    profile, _ = get_profile()
    engine = "Claude structured extraction" if config.anthropic_available() else "offline heuristic reader (low confidence; set ANTHROPIC_API_KEY for Claude)"
    st.info(f"Document reader in use: **{engine}**.")

    with st.form("upload"):
        files = st.file_uploader("Solicitation documents (PDF, DOCX, TXT)", type=["pdf", "docx", "txt"], accept_multiple_files=True)
        c1, c2 = st.columns(2)
        src_ids = [s["id"] for s in sources.load_registry()]
        source_id = c1.selectbox("Source", ["manual_upload"] + src_ids)
        source_url = c2.text_input("Source URL (where you downloaded it)")
        doc_type = c1.selectbox("Document type", ["solicitation", "amendment", "attachment"])
        industry = c2.selectbox("Industry (override auto-tag)", ["auto"] + list(INDUSTRIES))
        st.caption("Optional overrides if the reader misses them:")
        o1, o2, o3 = st.columns(3)
        sol = o1.text_input("Solicitation number")
        agency = o2.text_input("Agency")
        deadline_text = o3.text_input("Bid deadline (e.g. 'December 4, 2026 2:00 PM')")
        prefer_claude = st.checkbox("Use Claude if available", value=True)
        go = st.form_submit_button("Read and evaluate", type="primary")

    if go:
        if not files:
            st.error("Choose at least one file.")
            return
        overrides = {k: v for k, v in {"solicitation_number": sol, "agency": agency, "bid_deadline_text": deadline_text}.items() if v}
        if industry != "auto":
            overrides["industry"] = industry
        for f in files:
            with st.spinner(f"Reading {f.name}..."):
                try:
                    rep = intake.ingest_document(conn, f.name, f.getvalue(), source_id=source_id, source_url=source_url, doc_type=doc_type,
                                                 prefer_claude=prefer_claude, overrides=overrides)
                    res = pipeline.evaluate_opportunity(conn, rep["opportunity_id"], profile, actor="user")
                    conn.commit()
                except Exception as exc:
                    conn.rollback()
                    st.error(f"{f.name}: {exc}")
                    continue
            verb = "Created" if rep["created"] else f"Updated existing record (duplicate: {rep['duplicate_reason']})"
            st.success(f"**{f.name}** → {verb} opportunity #{rep['opportunity_id']} · {rep['requirements_extracted']} requirements · engine: {rep['engine']}")
            if rep["changes"]:
                st.warning("Changes detected vs. earlier version: " + "; ".join(f"{c['field']}: {c['old']} → {c['new']}" for c in rep["changes"]))
            if not rep["deadline_parsed"]:
                st.warning("Bid deadline not parsed. Enter it in the override box and re-upload, or edit it on the detail page.")
            if rep["missing_core"]:
                st.warning("Not found in document: " + ", ".join(rep["missing_core"]) + ". These stay UNKNOWN and block a Strong Match until verified.")
            st.write(f"Classification: **{res['match_class']}** (score {res['score']}) · Recommendation: **{res['recommendation']}**")
            st.session_state.selected_opp = rep["opportunity_id"]
        st.page_link(st.session_state.pages["detail"], label="Open the detail page →")
