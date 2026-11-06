# Maryland & DC Government Contract Scout Bot

A private web application that reads Maryland and Washington, DC government solicitations, compares every stated requirement with your company's **verified** qualifications, estimates whether the job can be profitable, and ranks opportunities on a dashboard.

It never submits bids, never scrapes portals that forbid it, and never stores EINs, passwords or API keys.

## What works today (version 0.1, stage one of the MVP)

| Module | State | Notes |
|---|---|---|
| 1. Company profile & verified qualifications | Working | JSON profile; every fact is VERIFIED / MISSING / ASSUMED / NOT_APPLICABLE with a source. Sensitive keys are rejected. |
| 2. Source registry & scanner | Working (needs credentials) | Registry of 19 Maryland sources with their mechanisms. Inbox intake pipeline: parses notices, ingests attachments, downloads linked files from allowed portal hosts only, creates leads, evaluates, de-duplicates by message ID. Tested with simulated emails; live IMAP needs your inbox credentials. Portal pages are never scraped. |
| 3. Solicitation document reader | Working (two engines) | PDF/DOCX/TXT extraction with page markers. **Claude** structured extraction when `ANTHROPIC_API_KEY` is set (not yet exercised in this environment). **Offline heuristic** reader otherwise, labelled low confidence. |
| Commercial attractiveness score | Working | Separate 0-100 score (industry fit, size, margin, deadline runway, access advantage, risk/bonding) with a per-component explanation; Poor Match caps it at 35. |
| Recommendation card | Working | Recommended bidding entity across all profiles, why it fits, missing items, partner path, financials, immediate actions, deadline and links; also in the digest. |
| 4. Eligibility & compliance engine | Working | Classifies Strong / Conditional / Poor with a traceable check per requirement. Unknown mandatory items block Strong Match. Owner/affiliate experience never counts. |
| 5. Insurance & bonding analysis | Working | Compares stated limits and bond percentages with verified profile limits; computes bond size from contract value. |
| 6. Cost, margin & working capital estimator | Working | Editable assumptions, low/base/high band, working-capital need, Pursue / Investigate / Reject logic. Never invents a contract value. |
| 7. Subcontractor & partner tracker | Working (manual) | Record primes/subs/suppliers; detail page lists which gaps a partner could cover and which rules still apply to you. Automated award mining not built. |
| 8. Opportunity dashboard | Working | Filters by industry, qualification, recommendation, status, deadline window, margin. CSV export. |
| 9. Deadline & change alerts | Working (dry run) | The digest leads with **Opportunities you can do**: live deadline, industry in the entity's can-do list, Strong or Conditional Match, not rejected. Then 3/7/14-day deadline alerts, new/strong-match alerts, amendment detection. Email sends when SMTP is configured; otherwise digest files land in `data/outbox/`. |
| Wage floors | Working | Labor-rate assumptions seed from the Maryland Living Wage tier, county minimum wages, or the DC Living Wage for the place of performance, with sources; prevailing-wage construction is flagged. |
| Calendar, snapshots, backups | Working | Every scan writes `data/exports/opportunities_latest.csv`, `data/exports/deadlines.ics` (bid-due and pre-bid meeting reminders for Google/Outlook) and a database backup (14 kept). |
| Bid-package checklist | Working | Per-opportunity checklist built from standard Maryland forms, the submission items the reader found (page refs), and open qualification gaps; ticks saved; Markdown export. |
| 10. Audit log & test suite | Working | Every action logged. `pytest` suite covers extraction, engine, finance, dedupe, deadlines, alerts. |

Everything runs locally with SQLite. No account is required to try it with the fictitious sample solicitations.

## Quick start (10 minutes)

**Easiest way on Windows:** double-click `start_scout.bat` in the `contract-scout` folder. It creates the Python environment, installs packages on first run, loads the sample data, starts the app and opens your browser. Keep the window open while you use the app. On a Mac, double-click `start_scout.command`.

**Manual way:**

You need Python 3.11 or newer. Open a terminal in this folder.

```bash
python -m venv .venv
```

```bash
source .venv/bin/activate        # Windows: .venv\Scripts\activate
```

```bash
pip install -r requirements.txt
```

```bash
python scripts/seed_sample_data.py
```

```bash
streamlit run app.py
```

Your browser opens at <http://localhost:8501>. If it does not, paste that address into a browser.

The seed script creates two **fictitious** sample solicitations (a janitorial IFB and a school roof replacement) so every page has data. Delete them from the detail page, or hide them with the "Hide sample records" filter, once you upload real documents.

## Entity profiles (which company is bidding)

Three profiles ship in `profiles/`, built from the owner's documents on 2026-11-03:

| File | Entity | What the documents show |
|---|---|---|
| `sierra_real_estate_llc.json` | Sierra Real Estate LLC (Maryland, formed 2023-09-08, SDAT W24358616) | General liability $1M on a 2025 certificate (renewal not found), 0 employees, 2025 revenue in the 50k to 100k range, no eMMA/SAM/SBR, no bonding. The MHIC license on file belongs to a hired contractor, not this entity. |
| `medwise_seniors_llc.json` | Medwise Seniors LLC (Delaware, formed 2026-08-25) | No Maryland registration, insurance, licenses or history. |
| `sierra_international_pharmaceutical_corp.json` | Sierra International Pharmaceutical Corporation (Maryland corp., 1992; Columbia Heights Pharmacy, DC) | 34 years of pharmacy operation, DC pharmacy license (current copy not on file), immunization CPA, Erie liability program 2026-27, Medicare/PBM credentialing; no eMMA, DC eSourcing or CBE registration yet. |
| `new_maryland_entity.json` | Hypothetical new Maryland LLC | Everything MISSING, to show what a fresh entity would need. |

Pick the bidding entity in the sidebar. The **Compare entities** tab on each opportunity scores the same solicitation against all three. To edit a profile without touching the shipped file, save it from the profile page; the copy lands in `data/profiles/` and overrides the shipped one.

## Using it with real Maryland solicitations

1. Review the active entity profile on the **Company profile** page. Mark a fact VERIFIED only when you hold the document. Fields that are MISSING (eMMA registration, good standing certificate, current insurance certificate, bonding) are exactly what keeps real opportunities at Conditional.
2. Browse eMMA (<https://emma.maryland.gov>) or a county portal, download the solicitation PDF and attachments, and drop them on the **Upload** page. Amendments go to the same page; the app matches them to the existing record and logs what changed.
3. Open the **Opportunity detail** page: review requirements with page references, the qualification checks with reasons, and enter cost assumptions.
4. Set the bid status as you work (New → Under Review → Preparing Bid → Submitted → Awarded/Lost/Rejected).
5. Use **Alerts** to preview or send the digest. Use **Dashboard → Export CSV** to pull the table into Google Sheets.

## Accounts, keys and registrations you need (and which features they unlock)

| Item | Why | Cost |
|---|---|---|
| Anthropic API key (`ANTHROPIC_API_KEY`) | Full document reading with page-referenced requirements. Without it the heuristic reader is used. | Pay per use; a 40-page solicitation costs roughly a few cents to tens of cents on Claude Opus 5.5. |
| eMMA vendor registration | Required to bid on state work; enables commodity-code email notifications the scanner can read. | Free |
| An inbox for eMMA notifications (`IMAP_*`) | Lets the scanner turn notification emails into leads automatically. Use an app password, never your main password. | Free |
| SMTP credentials (`SMTP_*`, `ALERT_TO`) | Sends the digest by email. Gmail app password or a transactional provider both work. | Free tiers exist |
| Maryland SDAT good standing, SBR self-certification, SAM.gov UEI | Not software requirements, but the engine will keep marking opportunities Conditional until these are VERIFIED in the profile. | Free |

Put secrets in `.env` (see `.env.example`). The file is git-ignored.

## Automated intake and scheduled scans

The intake pipeline turns notification emails into scored opportunities:

1. Register the bidding entity on eMMA (and on Baltimore County OpenGov, BidNet, SPEED) and point their notices at one inbox you own.
2. Put that inbox's IMAP details in `.env` (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`; Gmail needs an app password). `IMAP_SENDER_FILTER` lists the senders to read.
3. Run one scan by hand to confirm:

```bash
python scripts/run_scan.py
```

Each scan reads new notices (read-only, each message handled once), ingests attached PDF/DOCX files, downloads directly linked files only from the portal hosts listed in `scout/inbox.py` or `SCOUT_ALLOWED_FILE_HOSTS`, creates a lead from the email text when there is no file, evaluates everything against the active entity, refreshes alerts, and sends the digest (or writes it to `data/outbox/` without SMTP). Digest lines link straight to the opportunity in the dashboard.

**Schedule it on Windows:** double-click `schedule_scan.bat` once. It creates a task that runs `run_scan.bat` weekdays at 7:30 AM and logs to `data\scan.log`. The computer must be on. Remove with `schtasks /delete /tn "Maryland Contract Scout scan" /f`.

**Mac/Linux cron:** `30 7 * * 1-5 cd /path/to/contract-scout && .venv/bin/python scripts/run_scan.py >> data/scan.log 2>&1`

**No inbox yet?** Forward a notification email to yourself, save it as a `.eml` file, and drop it on the Sources & scans page. The same pipeline runs on it.

## Rules the code enforces

* Every requirement stores document, page/section reference, quote, confidence, extraction method and retrieval date.
* VERIFIED / MISSING / ASSUMED / NOT_APPLICABLE are the only information statuses.
* A mandatory requirement that is UNKNOWN or NOT_MET prevents Strong Match; NOT_MET makes it Poor Match.
* Experience counts only when `performed_by` is `contracting_entity`.
* Contract value is MISSING unless published or you enter an estimate (then ASSUMED). No value means no "Pursue".
* Deadlines are stored in UTC and shown in Eastern time with the zone name.
* Duplicate detection by solicitation number + agency, with a fuzzy title fallback; changes create amendment events.
* No automated fetching of portal pages unless `allowed_fetch` is true in `source_registry.json`.
* The profile validator rejects EIN, tax-ID, password and account-number keys.

## Running the tests

```bash
pytest -q
```

## Project layout

```
app.py                         Streamlit entry point
scout/                         library
  config.py  models.py  db.py  profile.py  deadlines.py  documents.py
  extraction_schema.py  analyzer.py  eligibility.py  insurance.py  finance.py
  intake.py  alerts.py  sources.py  export.py  pipeline.py
  ui/                          one module per page
scripts/                       seed_sample_data.py, make_sample_solicitation.py, run_scan.py
tests/                         pytest suite
examples/                      sample profile and fictitious solicitations
company_profile_template.json  blank profile to copy
source_registry.json           procurement sources and permitted access methods
IMPLEMENTATION_CHECKLIST.md    staged plan with status
docs/maryland_procurement_notes.md  research notes: eMMA, SBR, thresholds, forms, local portals
```
