# Implementation Checklist

Legend: [x] done and tested · [~] coded, awaiting credentials or real-world test · [ ] not started

## Stage 1 - Local MVP (this release)
- [x] Project skeleton, requirements, .env.example, .gitignore
- [x] SQLite schema: opportunities, documents, requirements, evaluations, cost estimates, partners, change events, alerts, scan runs, audit log
- [x] Company profile template + sample profile + validator (status vocabulary, sensitive-key rejection)
- [x] PDF / DOCX / TXT extraction with page markers and SHA-256 de-duplication
- [x] Offline heuristic requirement extractor (low confidence, labelled)
- [~] Claude structured extraction (coded against the Anthropic SDK; needs ANTHROPIC_API_KEY to exercise)
- [x] Deadline parsing with Eastern time zone, UTC storage, urgency buckets
- [x] Eligibility & compliance engine with traceable checks and Strong/Conditional/Poor rules
- [x] Insurance limit and bond comparison
- [x] Cost / margin / working-capital estimator with editable assumptions and Pursue/Investigate/Reject
- [x] Duplicate detection (number+agency, fuzzy title) and amendment change events
- [x] Streamlit dashboard with filters, CSV export, detail page, profile editor, sources, partners, alerts, audit log
- [x] Alerts: deadline windows, new, strong match, amendment; digest dry-run to data/outbox
- [x] Seed script with two fictitious solicitations
- [x] pytest suite
- [x] Six industry tags (added Hospitality & Lodging, Sanitation & Waste) and a "can do" digest section driven by the entity profile
- [x] Multi-entity profiles (profiles/ + data/profiles override), sidebar entity picker, Compare entities tab
- [x] Real profiles for Sierra Real Estate LLC and Medwise Seniors LLC built from SDAT, formation, COI, P&L and license documents

## v2.1 - Company-independent intelligence (2026-11-06)
- [x] Inspected and backed up (launcher backs up data/scout.db before each start; migrations add columns)
- [x] Company-specific dependencies removed from the primary pipeline; general analysis always runs
- [x] Business profiles optional (selector default: General Contract Analysis — No Business Selected)
- [x] Industry keyword maps expanded for the five groups; AI industry hint; subcontracting / preference / restriction categories
- [x] Extraction: services requested, subcontracting and JV flags, open-to-new-businesses, set-aside, award basis
- [x] Ten entry-barrier questions with evidence; business types; mandatory vs preferred
- [x] 100-point opportunity model with High / Moderate / Low / Requires investigation and explanations
- [x] Financial scenarios (conservative, base, optimistic) with reliability flag
- [x] Dashboard restructured into the eight sections with the requested filters
- [x] 15-field email report cards for top High/Moderate contracts
- [x] DC transparency portal; opt-in public-listing watcher (robots.txt honored; untested live)
- [x] System Check & Tests page: one-click Claude reader test, IMAP login test, SMTP test email, public-listing dry run with in-app URL/terms settings, scheduled-task status, run-full-scan button; TESTING_GUIDE.md written
- [x] Public-listing watcher settings editable in the app and saved to data/source_overrides.json (listing parser unit-tested)
- [ ] Test against real Maryland and DC solicitations (needs documents from the live portals)

## Stage 1b - Objective review 2026-11-06
- [x] Washington, DC sources (OCP eSourcing, DGS OpenGov, DC Health, DCPS, DC Housing Authority, DC Water) with jurisdiction tagging
- [x] Pharmacy & Immunization industry and the pharmacy entity profile (Sierra International Pharmaceutical Corporation)
- [x] Commercial attractiveness score 0-100 with explanation, stored per opportunity, filterable
- [x] Recommendation card: recommended entity, why, missing, partner path, financials, actions, links; digest carries entity and score
- [x] Stages Qualified and Cancelled; cancellation/withdrawal detection from notices with stop-work alert
- [ ] You: DC OCP eSourcing registration and DC DGS OpenGov account for the pharmacy entity; CBE certification application
- [ ] You: upload current DC pharmacy license, immunization certifications, Erie COI for the pharmacy entity

- [x] Set-aside and award-basis extracted per solicitation and used in the commercial score
- [x] One-click stage changes from the recommendation card; scan log viewer on Sources page

## Stage 2 - Permitted automated intake
- [ ] You: pull a Certificate of Status for Sierra Real Estate LLC from Maryland Business Express and a current COI from Gray Insurance Group; record both in the profile
- [ ] You: confirm who is the authorized signer for Sierra Real Estate LLC (operating agreement lists Tiffany Mia Smith as 100% member)
- [ ] You: register the bidding entity on eMMA and subscribe to commodity codes for the four industries
- [ ] You: create an inbox/app password for notifications; set IMAP_* in .env
- [x] Inbox intake pipeline (parse, attachments, allowed-host downloads, leads, evaluate, de-dup) tested with simulated emails; [~] live IMAP read awaits credentials
- [~] RSS/Atom feed reader (coded, untested; no Maryland feed configured yet)
- [ ] Confirm each portal's terms of use; flip `allowed_fetch` only where permitted; implement per-source link lister where allowed
- [~] Source registry researched 2026-11-05: 19 sources, portals and mechanisms documented in docs/maryland_procurement_notes.md; state sites could not be opened from the build environment, so confirm once in a browser
- [x] Attachment download from links in notification emails, restricted to an allowlist of portal hosts and direct PDF/DOCX links

## Stage 3 - Scheduling, alerts, finance depth
- [x] Bid-package checklist per opportunity (standard forms + document items + profile gaps)
- [x] run_scan.py + run_scan.bat + schedule_scan.bat (Windows Task Scheduler, weekdays 7:30 AM); cron line documented
- [~] SMTP email digest (coded; needs SMTP_* credentials to test)
- [x] CSV snapshot, .ics deadline calendar and DB backups on every scan; [ ] Google Sheets live sync (service account) still optional
- [x] Living/minimum wage floors by place of performance seed the labor rate (MD tiers, Montgomery, PG, DC); prevailing-wage construction flagged (wage determinations still come from the solicitation)
- [ ] Bond premium and insurance quote tracking per opportunity
- [ ] Award/bid-tabulation capture for partner research

## Stage 4 - Testing against real solicitations
- [ ] Upload 10 real eMMA solicitations across the four industries; compare extracted requirements against a manual read; log misses
- [ ] Tune Claude prompt and heuristics from the misses
- [ ] Document precision/recall of the reader in README

## Known limitations
- Heuristic reader catches common clauses only; it will miss unusual wording. Use Claude for real bids.
- Scanned (image-only) PDFs need OCR, which is not included yet.
- The sample profile and sample solicitations are fictitious and must not be used for a real bid decision.
