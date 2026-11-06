from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path

import streamlit as st

from .. import config, db, sources, analyzer, documents, inbox
from .common import get_conn


def _ok(label, good, detail=""):
    st.write(("🟢 " if good else "🟠 ") + f"**{label}**" + (f": {detail}" if detail else ""))


def render():
    st.title("System Check & Tests")
    st.write("One-click tests for every part of the pipeline. Nothing here submits a bid or changes your data except where a button says it writes a test record.")
    conn = get_conn()

    st.subheader("1. Core")
    _ok("Database", True, f"{config.DB_PATH} · {db.counts(conn)['total']} opportunities")
    _ok("Program folder", True, str(config.ROOT))
    _ok("Claude API key", config.anthropic_available(), "present" if config.anthropic_available() else "missing: add ANTHROPIC_API_KEY to .env (offline reader in use)")
    _ok("Email sending (SMTP)", config.smtp_available(), "configured" if config.smtp_available() else "not configured: digests go to data/outbox")
    _ok("Inbox intake (IMAP)", config.imap_available(), f"{config.IMAP_USER} on {config.IMAP_HOST}" if config.imap_available() else "not configured")

    st.subheader("2. Claude document reader")
    st.caption("Reads the fictitious sample solicitation with Claude and shows what it extracted. Costs a few cents. No records are changed.")
    if st.button("Test Claude reader on the sample PDF", disabled=not config.anthropic_available()):
        sample = config.ROOT / "examples" / "sample_janitorial_ifb.pdf"
        with st.spinner("Calling Claude..."):
            try:
                doc = documents.extract(sample.name, sample.read_bytes())
                res = analyzer.claude_extract(doc.text, sample.name)
                st.success(f"Engine {res.get('_engine')} · {len(res.get('requirements', []))} requirements · set-aside: {res.get('set_aside')} · award basis: {res.get('award_basis')} · industry: {res.get('industry')}")
                st.json({k: res[k] for k in ("solicitation_number", "agency", "bid_deadline_text", "estimated_value", "services_requested", "subcontracting_allowed", "open_to_new_businesses") if k in res})
                st.dataframe([{"category": r["category"], "mandatory": r["mandatory"], "text": r["text"][:120], "page": r["page_ref"], "confidence": r["confidence"]} for r in res.get("requirements", [])], width="stretch", hide_index=True)
            except Exception as exc:
                st.error(f"Claude test failed: {exc}")

    st.subheader("3. Inbox connection")
    if st.button("Test IMAP login and count recent notices", disabled=not config.imap_available()):
        try:
            notices = inbox.fetch_notices(since_days=config.IMAP_SINCE_DAYS, limit=20)
            st.success(f"Logged in. {len(notices)} message(s) from the configured senders in the last {config.IMAP_SINCE_DAYS} days.")
            for n in notices[:10]:
                st.write(f"- {n.date[:10]} · {n.sender} · {n.subject[:90]} · attachments: {len(n.attachments)} · links: {len(n.links)} → source: {inbox.source_for(n)}")
            st.caption("Nothing was processed. Use Sources & scans → 'Read inbox and process new notices now' to ingest.")
        except Exception as exc:
            st.error(f"IMAP test failed: {exc}")

    st.subheader("4. Email delivery")
    if st.button("Send a test email to ALERT_TO", disabled=not config.smtp_available()):
        import smtplib
        from email.message import EmailMessage
        try:
            msg = EmailMessage()
            msg["Subject"] = "Contract Scout test email"
            msg["From"] = config.ALERT_FROM
            msg["To"] = ", ".join(config.ALERT_TO)
            msg.set_content("If you can read this, SMTP delivery works. Daily digests will arrive the same way.")
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=30) as s:
                s.starttls()
                s.login(config.SMTP_USER, config.SMTP_PASSWORD)
                s.send_message(msg)
            st.success(f"Sent to {', '.join(config.ALERT_TO)}")
        except Exception as exc:
            st.error(f"SMTP test failed: {exc}")

    st.subheader("5. Public-listing sources (dry run)")
    st.caption("For each watcher source that you have switched on, fetch the listing page once, honoring robots.txt, and show what would be picked up. No records are created.")
    for src in sources.load_registry():
        if src.get("access_method") != "public_listing":
            continue
        state, reason = sources.source_readiness(src)
        with st.expander(f"{src['name']} · {state}"):
            st.write(reason)
            url = st.text_input("Listing page URL", value=src.get("listing_url") or "", key=f"lu_{src['id']}")
            allowed = st.checkbox("I have read this site's terms of use and automated read-only viewing is not prohibited", value=bool(src.get("allowed_fetch")), key=f"af_{src['id']}")
            if st.button("Save", key=f"sv_{src['id']}"):
                sources.save_source_override(src["id"], listing_url=url.strip(), allowed_fetch=bool(allowed and url.strip()))
                st.success("Saved to data/source_overrides.json (survives app updates).")
                st.rerun()
            if url.strip() and allowed and st.button("Dry-run fetch now", key=f"dr_{src['id']}"):
                try:
                    items = sources.fetch_public_listing(url.strip())
                    st.success(f"robots.txt allowed; {len(items)} solicitation-looking link(s) found.")
                    for it in items[:25]:
                        st.write(f"- {it['title'][:100]} → {it['link']}")
                    if not items:
                        st.info("No matching links. The page may load its list with JavaScript; if so this source needs the notification route instead.")
                except Exception as exc:
                    st.error(f"Fetch failed: {exc}")

    st.subheader("6. Scheduled scan")
    if platform.system() == "Windows":
        try:
            out = subprocess.run(["schtasks", "/query", "/tn", "Maryland Contract Scout scan", "/fo", "LIST"], capture_output=True, text=True, timeout=20)
            if out.returncode == 0:
                st.code(out.stdout.strip()[:1200], language="text")
            else:
                st.info("No scheduled task found. Double-click schedule_scan.bat once to create it.")
        except Exception as exc:
            st.info(f"Could not query Task Scheduler: {exc}")
    else:
        st.info("Not on Windows: use the cron line from the README.")
    log = (config.DATA_DIR / "scan.log")
    if log.exists():
        st.code("\n".join(log.read_text(encoding="utf-8", errors="replace").splitlines()[-15:]), language="text")
    if st.button("Run one full scan now (inbox + feeds + analysis + alerts + digest)"):
        with st.spinner("Scanning..."):
            r = subprocess.run([sys.executable, str(config.ROOT / "scripts" / "run_scan.py")], capture_output=True, text=True, timeout=1800)
        st.code((r.stdout + r.stderr)[-3000:], language="text")
