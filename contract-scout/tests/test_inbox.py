from email.message import EmailMessage
from pathlib import Path

from scout import inbox, db, alerts
from scripts.make_sample_solicitation import JANITORIAL_PAGES

ROOT = Path(__file__).resolve().parent.parent


def _email(subject, body, sender="noreply@emma.maryland.gov", attach=None, msgid="<a1@emma>"):
    m = EmailMessage()
    m["Subject"] = subject
    m["From"] = sender
    m["To"] = "scout@example.com"
    m["Date"] = "Thu, 05 Nov 2026 09:00:00 -0500"
    m["Message-ID"] = msgid
    m.set_content(body)
    if attach:
        name, data, maintype, subtype = attach
        m.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return m.as_bytes()


def test_parse_message_fields_links_and_attachment(sample_pdf_bytes):
    raw = _email("New Solicitation BPM045678 - Janitorial Services", "A new solicitation has been published.\nDue Date: 12/04/2026 2:00 PM\nView: https://emma.maryland.gov/page.aspx/en/bpm/process_manage_extranet/12345 \n",
                 attach=("solicitation.pdf", sample_pdf_bytes, "application", "pdf"))
    n = inbox.parse_message(raw, uid="7")
    assert n.subject.startswith("New Solicitation") and n.sender_domain == "emma.maryland.gov"
    assert n.links == ["https://emma.maryland.gov/page.aspx/en/bpm/process_manage_extranet/12345"]
    assert n.attachments and n.attachments[0][0] == "solicitation.pdf"
    f = inbox.extract_fields(n)
    assert f["solicitation_number"] == "BPM045678" and "12/04/2026" in f["bid_deadline_text"]
    assert f["industry"] == "Cleaning & Janitorial"
    assert inbox.source_for(n) == "emma_email"


def test_source_mapping_from_links():
    raw = _email("Bid Notification", "See https://procurement.opengov.com/portal/baltimorecountymd/projects/999", sender="no-reply@mail.opengov.com", msgid="<b2@og>")
    assert inbox.source_for(inbox.parse_message(raw)) == "baltimore_county"
    raw = _email("Hello", "nothing", sender="someone@example.org", msgid="<c3@x>")
    assert inbox.source_for(inbox.parse_message(raw)) == "email_notification"


def test_download_gating_rejects_unknown_hosts_and_non_files():
    assert inbox.download_public_file("https://evil.example.com/file.pdf") is None
    assert inbox.download_public_file("https://emma.maryland.gov/page.aspx/en/rfp/request_browse_public") is None


def test_attachment_notice_creates_and_evaluates_opportunity(conn, profile, sample_pdf_bytes):
    raw = _email("New Solicitation IFB-2026-JAN-0417 Janitorial", "Due Date: December 4, 2026 2:00 PM", attach=("ifb.pdf", sample_pdf_bytes, "application", "pdf"), msgid="<d4@emma>")
    r = inbox.run_inbox_intake(conn, notices=[inbox.parse_message(raw, uid="1")], profile=profile, prefer_claude=False, fetch_links=False)
    assert r["status"] == "ok" and r["new"] == 1 and r["processed"] == 1
    opp = db.list_opportunities(conn)[0]
    assert opp["source_id"] == "emma_email" and opp["match_class"] in ("Conditional Match", "Poor Match", "Strong Match")
    assert db.list_documents(conn, opp["id"])[0]["doc_type"] == "solicitation"
    assert db.email_processed(conn, "<d4@emma>")
    # second run with the same message is a no-op
    r2 = inbox.run_inbox_intake(conn, notices=[inbox.parse_message(raw, uid="1")], profile=profile, prefer_claude=False, fetch_links=False)
    assert r2["processed"] == 0 and r2["skipped"] == 1 and len(db.list_opportunities(conn)) == 1


def test_text_only_notice_becomes_lead_with_deadline(conn, profile):
    body = "Prince George's County has posted RFP 26-ROOF-088 Roof Replacement at Sample Elementary School.\nClosing Date: 11/20/2026 11:00 AM\nhttps://www.princegeorgescountymd.gov/x"
    raw = _email("Solicitation Notice: RFP 26-ROOF-088 Roof Replacement", body, sender="procurement@princegeorgescountymd.gov", msgid="<e5@pg>")
    r = inbox.run_inbox_intake(conn, notices=[inbox.parse_message(raw, uid="2")], profile=profile, prefer_claude=False, fetch_links=False)
    assert r["new"] == 1
    opp = db.list_opportunities(conn)[0]
    assert opp["source_id"] == "prince_georges_county" and opp["industry"] == "Construction & Property Services"
    assert opp["bid_deadline_local"] and "2026-11-20" in opp["bid_deadline_local"]
    assert db.list_documents(conn, opp["id"])[0]["doc_type"] == "notice"
    assert opp["match_class"] is not None
    body_digest = alerts.build_digest(conn, dashboard_url="http://localhost:8501", profile=profile)
    assert "Maryland Contract Scout digest" in body_digest


def test_run_without_imap_reports_error(conn, monkeypatch):
    from scout import config
    monkeypatch.setattr(config, "IMAP_HOST", "")
    r = inbox.run_inbox_intake(conn)
    assert r["status"] == "error" and "IMAP" in r["reason"]
    assert db.list_scans(conn)[0]["status"] == "error"
