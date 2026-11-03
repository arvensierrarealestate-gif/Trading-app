from __future__ import annotations

import streamlit as st

from .. import config, db
from ..profile import load_profile, list_profiles, get_active_profile_id, set_active_profile_id

BADGE = {"Strong Match": "🟢", "Conditional Match": "🟡", "Poor Match": "🔴", None: "⚪", "": "⚪"}
REC_BADGE = {"Pursue": "✅", "Investigate Further": "🔎", "Reject": "⛔", None: "—", "": "—"}


def get_conn():
    """One SQLite connection per Streamlit session."""
    if "conn" not in st.session_state:
        config.ensure_dirs()
        st.session_state.conn = db.connect()
    return st.session_state.conn


def entity_picker():
    """Sidebar control: choose which legal entity evaluations run against."""
    profiles = [p for p in list_profiles() if p["id"] != "company_profile"]
    if not profiles:
        return
    ids = [p["id"] for p in profiles]
    current = get_active_profile_id()
    idx = ids.index(current) if current in ids else 0
    with st.sidebar:
        choice = st.selectbox("Bidding entity", ids, index=idx, format_func=lambda i: next(p["name"] for p in profiles if p["id"] == i), key="entity_picker")
    if choice != current:
        set_active_profile_id(choice)
        st.rerun()


def get_profile() -> tuple[dict, str]:
    profile, origin = load_profile()
    if origin in ("sample", "template"):
        st.warning(f"Using the **{origin}** company profile. Real evaluations need an entity profile in `profiles/` or `data/profiles/`.", icon="⚠️")
    elif origin.startswith("entity:"):
        st.caption(f"Evaluating as **{profile.get('entity', {}).get('legal_name', {}).get('value', origin)}** (profile version {profile.get('profile_version', '')}). Change the entity in the sidebar.")
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
