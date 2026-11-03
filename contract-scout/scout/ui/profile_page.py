from __future__ import annotations

import json

import streamlit as st

from .. import config
from ..profile import load_profile, save_profile, validate_profile, completeness, missing_facts
from .common import get_conn


def render():
    st.title("Company Profile & Verified Qualifications")
    profile, origin = load_profile()
    st.write(f"Loaded from: **{origin}** ({config.PROFILE_PATH if origin == 'user' else ('examples/company_profile.sample.json' if origin == 'sample' else 'company_profile_template.json')})")
    if origin != "user":
        st.warning("This is not your company. Save your own profile below (it is written to data/company_profile.json, which is git-ignored).")
    comp = completeness(profile)
    c = st.columns(5)
    c[0].metric("Verified facts", comp["VERIFIED"])
    c[1].metric("Missing", comp["MISSING"])
    c[2].metric("Assumed", comp["ASSUMED"])
    c[3].metric("Not applicable", comp["NOT_APPLICABLE"])
    c[4].metric("Verified %", f"{comp['verified_pct']}%")
    problems = validate_profile(profile)
    for p in problems:
        (st.error if p.startswith("ERROR") else st.warning)(p)

    st.subheader("Entity")
    ent = profile.get("entity", {})
    for k, f in ent.items():
        if isinstance(f, dict) and "status" in f:
            st.write(f"- **{k.replace('_', ' ')}**: {f.get('value')} · `{f['status']}`" + (f" · source: {f['source']}" if f.get("source") else ""))

    st.subheader("Missing facts that block qualification")
    miss = missing_facts(profile)
    if miss:
        for m in miss:
            st.write(f"- {m}")
    else:
        st.success("No MISSING facts.")

    st.subheader("Experience on file")
    for e in profile.get("experience", []):
        who = "entity" if e.get("performed_by") == "contracting_entity" else f"{e.get('performed_by')} (context only, does not qualify)"
        st.write(f"- {e.get('description')} · {e.get('industry')} · {e.get('year')} · `{e.get('status')}` · performed by {who}")

    st.subheader("Edit profile JSON")
    st.caption("Edit and save. Validation blocks sensitive keys (EIN, passwords, account numbers) and bad status values.")
    txt = st.text_area("profile.json", value=json.dumps(profile, indent=2), height=500)
    col1, col2 = st.columns(2)
    if col1.button("Validate"):
        try:
            probs = validate_profile(json.loads(txt))
            st.write(probs or ["OK: no problems found."])
        except json.JSONDecodeError as exc:
            st.error(f"Invalid JSON: {exc}")
    if col2.button("Save as my profile", type="primary"):
        try:
            data = json.loads(txt)
            data.pop("_notice", None)
            path = save_profile(data)
            conn = get_conn()
            from .. import db
            db.log(conn, "save_profile", "profile", str(path), {"version": data.get("profile_version")}, actor="user")
            conn.commit()
            st.success(f"Saved to {path}. Re-run qualification on the detail pages to apply it.")
        except (json.JSONDecodeError, ValueError) as exc:
            st.error(str(exc))
