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

## Stage 2 - Permitted automated intake
- [ ] You: register the bidding entity on eMMA and subscribe to commodity codes for the four industries
- [ ] You: create an inbox/app password for notifications; set IMAP_* in .env
- [~] IMAP notification reader (coded, untested against a live inbox)
- [~] RSS/Atom feed reader (coded, untested; no Maryland feed configured yet)
- [ ] Confirm each portal's terms of use; flip `allowed_fetch` only where permitted; implement per-source link lister where allowed
- [ ] Verify every URL in source_registry.json and set `url_verified: true`
- [ ] Attachment download from links in notification emails (only when the link is a direct public file)

## Stage 3 - Scheduling, alerts, finance depth
- [~] run_scan.py scheduled via cron / Task Scheduler
- [~] SMTP email digest (coded; needs SMTP_* credentials to test)
- [ ] Google Sheets sync (service account) as alternative to CSV export
- [ ] Prevailing/living wage lookup to pre-fill labor rate assumptions
- [ ] Bond premium and insurance quote tracking per opportunity
- [ ] Award/bid-tabulation capture for partner research
- [ ] Multi-entity profiles (choose bidding entity per opportunity)

## Stage 4 - Testing against real solicitations
- [ ] Upload 10 real eMMA solicitations across the four industries; compare extracted requirements against a manual read; log misses
- [ ] Tune Claude prompt and heuristics from the misses
- [ ] Document precision/recall of the reader in README

## Known limitations
- Heuristic reader catches common clauses only; it will miss unusual wording. Use Claude for real bids.
- Scanned (image-only) PDFs need OCR, which is not included yet.
- The sample profile and sample solicitations are fictitious and must not be used for a real bid decision.
