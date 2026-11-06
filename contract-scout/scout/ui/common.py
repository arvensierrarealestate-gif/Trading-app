from __future__ import annotations

import os

import streamlit as st

from .. import config, db
from ..profile import load_profile, list_profiles, get_active_profile_id, set_active_profile_id
from ..models import NO_BUSINESS, NO_BUSINESS_LABEL

BADGE = {"Strong Match": "🟢", "Conditional Match": "🟡", "Poor Match": "🔴", None: "⚪", "": "⚪"}
REC_BADGE = {"Pursue": "✅", "Investigate Further": "🔎", "Reject": "⛔", None: "—", "": "—"}


def get_conn():
    """One SQLite connection per Streamlit session."""
    if "conn" not in st.session_state:
        config.ensure_dirs()
        st.session_state.conn = db.connect()
    return st.session_state.conn


def entity_picker():
    """Sidebar control: Business Profile (Optional). Default is general analysis with no business selected."""
    profiles = [p for p in list_profiles() if p["id"] != "company_profile"]
    ids = [NO_BUSINESS] + [p["id"] for p in profiles]
    names = {NO_BUSINESS: NO_BUSINESS_LABEL, **{p["id"]: p["name"] for p in profiles}}
    current = get_active_profile_id() or NO_BUSINESS
    idx = ids.index(current) if current in ids else 0
    with st.sidebar:
        choice = st.selectbox("Business Profile (Optional)", ids, index=idx, format_func=lambda i: names.get(i, i), key="entity_picker",
                              help="Leave on general analysis to evaluate contracts on their own terms. Pick a business to add eligibility matching.")
    if choice != current:
        set_active_profile_id(choice)
        st.rerun()


def get_profile() -> tuple:
    profile, origin = load_profile()
    if profile is None:
        st.caption("Mode: **General Contract Analysis** (no business selected). Pick a Business Profile in the sidebar to add eligibility matching.")
    elif origin == "sample":
        st.warning("Using the **sample** company profile (fictitious).", icon="⚠️")
    else:
        st.caption(f"Business mode: **{profile.get('entity', {}).get('legal_name', {}).get('value', origin)}** (profile version {profile.get('profile_version', '')}). Switch back to general analysis in the sidebar.")
    return profile, origin


def money(v) -> str:
    if v is None or v == "":
        return "Not found"
    try:
        return f"${float(v):,.0f}"
    except (TypeError, ValueError):
        return str(v)


def capability_banner():
    rows = [
        ("Claude document reader", "working" if config.anthropic_available() else "awaiting ANTHROPIC_API_KEY (offline heuristic reader in use)"),
        ("Email alerts (SMTP)", "working" if config.smtp_available() else "dry run to data/outbox (set SMTP_* and ALERT_TO)"),
        ("eMMA email intake (IMAP)", "configured" if config.imap_available() else "awaiting IMAP_* credentials"),
    ]
    with st.expander("System status: what is live, simulated, or awaiting credentials", expanded=False):
        for name, state in rows:
            icon = "🟢" if state.startswith(("working", "configured")) else "🟠"
            st.write(f"{icon} **{name}**: {state}")
        st.caption("Manual upload, SQLite storage, compliance engine, cost estimator, CSV export and the audit log run fully offline.")
        st.markdown("**Setup diagnostics** (safe to screenshot; the key is never shown)")
        env_path = config.ROOT / ".env"
        key = os.getenv("ANTHROPIC_API_KEY", "")
        masked = (key[:7] + "..." + f" ({len(key)} characters)") if key else "not set"
        st.code(f"Program folder : {config.ROOT}\n.env file      : {'found' if env_path.exists() else 'NOT FOUND'} at {env_path}\nKey line in file: {config.env_file_has_key()}\nAPI key seen   : {masked}\nData folder    : {config.DATA_DIR}", language="text")
