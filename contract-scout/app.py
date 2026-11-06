"""Maryland Government Contract Scout - Streamlit entry point.

Run:  streamlit run app.py
"""
from __future__ import annotations

import streamlit as st

from scout import config
from scout.ui.common import entity_picker
from scout.ui import dashboard, upload, detail, profile_page, sources_page, partners_page, alerts_page, audit_page, ranking, requirements_page, financial_page, subcontracting_page, matching_page

st.set_page_config(page_title="Maryland Contract Scout", page_icon="📋", layout="wide")
config.ensure_dirs()

pages = {
    "dashboard": st.Page(dashboard.render, title="Opportunity Discovery", icon="📊", default=True),
    "detail": st.Page(detail.render, title="Contract Analysis", icon="🔎", url_path="detail"),
    "ranking": st.Page(ranking.render, title="Opportunity Ranking", icon="🏆", url_path="ranking"),
    "financial": st.Page(financial_page.render, title="Financial Evaluation", icon="💵", url_path="financial"),
    "requirements": st.Page(requirements_page.render, title="Qualification Requirements", icon="📋", url_path="requirements"),
    "subcontracting": st.Page(subcontracting_page.render, title="Subcontracting Opportunities", icon="🤝", url_path="subcontracting"),
    "matching": st.Page(matching_page.render, title="Optional Business Matching", icon="🏢", url_path="matching"),
    "alerts": st.Page(alerts_page.render, title="Notifications", icon="⏰", url_path="alerts"),
    "upload": st.Page(upload.render, title="Upload solicitation", icon="📄", url_path="upload"),
    "sources": st.Page(sources_page.render, title="Sources & scans", icon="🛰️", url_path="sources"),
    "profile": st.Page(profile_page.render, title="Business Profiles (Optional)", icon="🗂️", url_path="profile"),
    "partners": st.Page(partners_page.render, title="Partners", icon="👥", url_path="partners"),
    "audit": st.Page(audit_page.render, title="Audit log", icon="🧾", url_path="audit"),
}
st.session_state.pages = pages
nav = st.navigation({"Analyze": [pages[k] for k in ("dashboard", "detail", "ranking", "financial", "requirements", "subcontracting")],
                     "Match & notify": [pages[k] for k in ("matching", "alerts")],
                     "Data & setup": [pages[k] for k in ("upload", "sources", "profile", "partners", "audit")]})
with st.sidebar:
    st.markdown("**MD & DC Contract Scout v2.1** · private · never submits bids")
entity_picker()
nav.run()
