from __future__ import annotations

import pandas as pd
import streamlit as st

from .. import db
from .common import get_conn


def render():
    st.title("Audit Log")
    st.write("Every ingest, evaluation, estimate, edit, scan and digest is recorded with a UTC timestamp. Nothing here is deletable from the UI.")
    conn = get_conn()
    rows = db.list_audit(conn, limit=500)
    if rows:
        st.dataframe(pd.DataFrame([{"Time (UTC)": r["ts"], "Actor": r["actor"], "Action": r["action"], "Entity": r["entity"], "ID": r["entity_id"], "Details": r["details_json"]} for r in rows]),
                     use_container_width=True, hide_index=True)
    else:
        st.info("No activity yet.")
