# Testing Guide (v2.1)

Work through these in order. Each step says what you should see.

## A. Start and sanity
1. Double-click `start_scout.bat`. Browser opens Opportunity Discovery with two SAMPLE contracts.
2. Sidebar shows *Business Profile (Optional)* set to *General Contract Analysis — No Business Selected*.
3. Open **System Check & Tests** (bottom of the sidebar). Core section shows Database, Program folder, and whether the Claude key, SMTP and IMAP are configured.

## B. Claude reader
1. On System Check, click **Test Claude reader on the sample PDF**. Expect engine `claude:claude-opus-5-5`, 15-25 requirements, set-aside *Small Business Reserve*, award basis *lowest price*.
2. If it fails with an authentication error, the key in `.env` is wrong; create a new one in the Claude Console.

## C. General analysis on a real solicitation
1. Download one current solicitation PDF from eMMA (public search) or DC DGS OpenGov.
2. **Upload solicitation** → drop the file → Read and evaluate. Expect a new opportunity, requirements with page references, and an opportunity potential with score.
3. Open **Contract Analysis** → tab **General analysis**: ten questions, each with evidence. Note anything wrong and send a screenshot; that is how the reader gets tuned.
4. **Opportunity Ranking** shows the contract with its score breakdown.

## D. Financial model
1. Contract Analysis → **Cost & margin**. The labor rate is pre-filled from the local wage floor. Enter hours, materials, subs; click Recalculate. Expect conservative/base/optimistic margins and a reliability note.
2. **Financial Evaluation** page lists every contract with those figures.

## E. Optional business matching
1. Sidebar → select *Sierra Real Estate LLC*. Contract Analysis now shows Business match and the **Business qualification checks** tab with reasons.
2. **Optional Business Matching** page compares all profiles on one contract.
3. Switch back to *No Business Selected*; the general analysis is unchanged.

## F. Sources and automation
1. **System Check → Public-listing sources**: for eMMA public listing or DC DGS, read the site's terms, paste the listing page URL, tick the confirmation, Save, then **Dry-run fetch now**. Expect "robots.txt allowed" and a list of solicitation links, or a clear reason why not.
2. **Inbox**: put IMAP details in `.env`, restart, then **Test IMAP login**. Expect a count of recent notices with their detected source.
3. **Email**: put SMTP details in `.env`, restart, then **Send a test email**.
4. Double-click `schedule_scan.bat` once. System Check section 6 shows the task; `data\scan.log` fills in each weekday morning.
5. Or click **Run one full scan now** and read the log output on screen.

## G. Notifications
1. **Notifications** → Build digest. Expect *OPPORTUNITIES YOU CAN DO* first, then up to five 15-field reports, then deadlines, amendments, cancellations.
2. Download the `.ics` calendar and import it into Google Calendar to see bid-due reminders.

## What to send me after testing
- Screenshots of Contract Analysis for two real solicitations (top card and General analysis tab).
- The dry-run fetch result for any listing source you switched on.
- Any red error box, with the page it appeared on.
