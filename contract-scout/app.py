"""Maryland Government Contract Scout - Streamlit entry point.

Run:  streamlit run app.py
"""
from __future__ import annotations

import streamlit as st

from scout import config
from scout.ui import dashboard, upload, detail, profile_page, sources_page, partners_page, alerts_page, audit_page

st.set_page_config(page_title="Maryland Contract Scout", page_icon="📋", layout="wide")
config.ensure_dirs()

pages = {
    "dashboard": st.Page(dashboard.render, title="Dashboard", icon="📊", default=True),
    "upload": st.Page(upload.render, title="Upload solicitation", icon="📄", url_path="upload"),
    "detail": st.Page(detail.render, title="Opportunity detail", icon="🔎", url_path="detail"),
    "profile": st.Page(profile_page.render, title="Company profile", icon="🏢", url_path="profile"),
    "sources": st.Page(sources_page.render, title="Sources & scans", icon="🛰️", url_path="sources"),
    "partners": st.Page(partners_page.render, title="Partners", icon="🤝", url_path="partners"),
    "alerts": st.Page(alerts_page.render, title="Alerts", icon="⏰", url_path="alerts"),
    "audit": st.Page(audit_page.render, title="Audit log", icon="🧾", url_path="audit"),
}
st.session_state.pages = pages
nav = st.navigation(list(pages.values()))
with st.sidebar:
    st.markdown("**Maryland Contract Scout** · private · never submits bids")
nav.run()
