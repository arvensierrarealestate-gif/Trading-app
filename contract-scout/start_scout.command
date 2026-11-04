#!/bin/bash
# One-click launcher for Maryland Contract Scout (macOS). Double-click in Finder.
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || python3 -m venv .venv
source .venv/bin/activate
python -c "import streamlit, pypdf, docx, anthropic" 2>/dev/null || pip install --quiet -r requirements.txt
[ -f data/scout.db ] || python scripts/seed_sample_data.py
(sleep 4; open "http://localhost:8501") &
python -m streamlit run app.py --server.headless true --browser.gatherUsageStats false
