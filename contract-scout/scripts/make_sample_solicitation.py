"""Generate two FICTITIOUS sample solicitations (PDF + DOCX) for testing.

These are not real Maryland solicitations. They exist so the document reader,
the compliance engine and the dashboard can be exercised end to end.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
OUT = ROOT / "examples"

JANITORIAL_PAGES = [
    """SAMPLE - FICTITIOUS SOLICITATION FOR SOFTWARE TESTING ONLY
INVITATION FOR BIDS
Janitorial Services for the Sample County Administration Building
Solicitation No. IFB-2026-JAN-0417
Issued by: Sample County Department of General Services
Project Location: 100 Sample Plaza, Rockville, Montgomery County, Maryland

Bids are due no later than December 4, 2026 at 2:00 PM local time. Late bids will not be considered.
A mandatory pre-bid conference and site visit will be held on November 18, 2026 at 10:00 AM at the building lobby.
The estimated contract value is $420,000 for the base period. The contract term is a one-year base period with two one-year renewal options.""",
    """SECTION 2 - SCOPE OF WORK
The Contractor shall provide all labor, supervision, equipment, and supplies necessary to perform nightly janitorial services
for approximately 85,000 square feet of office space, five nights per week. Services include restroom sanitation, trash removal,
vacuuming, hard floor care including monthly burnishing, and quarterly carpet extraction. The Contractor shall furnish all equipment
and cleaning products, which must be Green Seal certified where available.

SECTION 3 - MINIMUM QUALIFICATIONS
3.1 Bidders must have a minimum of three (3) years of experience providing commercial janitorial services to facilities of similar size.
3.2 Bidders shall provide three (3) references for similar contracts performed within the last five years.
3.3 Bidders must be registered on eMaryland Marketplace Advantage (eMMA) and in good standing with the Maryland State Department of Assessments and Taxation (SDAT).
3.4 This procurement is designated as a Small Business Reserve (SBR) procurement. Only SBR-certified bidders are eligible for award.
3.5 All employees assigned to the building shall pass a criminal background check prior to starting work.""",
    """SECTION 4 - INSURANCE REQUIREMENTS
4.1 Commercial General Liability insurance with limits of not less than $1,000,000 per occurrence and $2,000,000 aggregate is required.
4.2 Automobile Liability insurance of not less than $1,000,000 combined single limit is required for all owned, hired and non-owned vehicles.
4.3 Workers' Compensation insurance as required by Maryland law.
4.4 A Certificate of Insurance naming Sample County as additional insured must be submitted within ten days of award.

SECTION 5 - BONDS AND SUBMISSION
5.1 No bid bond is required for this solicitation.
5.2 A performance bond of 100% of the annual contract value is required within ten days of award.
5.3 Bidders shall submit the Bid/Proposal Affidavit, a completed W-9, and the price form.
5.4 The Living Wage requirements of the Maryland Living Wage Law apply to this contract.
5.5 Liquidated damages of $250 per day apply for each day services are not performed as scheduled.""",
]

ROOFING_PARAGRAPHS = [
    "SAMPLE - FICTITIOUS SOLICITATION FOR SOFTWARE TESTING ONLY",
    "INVITATION FOR BIDS - Roof Replacement at Sample Elementary School",
    "Solicitation Number: IFB 26-ROOF-088",
    "Issued by: Sample County Public Schools, Division of Facilities",
    "Project Location: 4500 Sample Road, Largo, Prince George's County, Maryland",
    "Bids will be received until November 20, 2026 at 11:00 AM, at which time they will be publicly opened.",
    "A pre-bid conference will be held on November 10, 2026 at 9:00 AM. Attendance is strongly encouraged but not mandatory.",
    "The anticipated budget for this project is $875,000. Work must be substantially complete within 120 calendar days of Notice to Proceed.",
    "SCOPE OF WORK: The work consists of removal of the existing modified bitumen roof system, replacement of damaged decking, and installation of a new 60-mil TPO membrane roof system, flashings, and roof drains on approximately 42,000 square feet.",
    "MINIMUM QUALIFICATIONS: Bidders must have a minimum of five (5) years of experience in commercial roofing and must have completed at least three (3) similar projects of comparable size within the last five years.",
    "Bidders must hold a current Maryland Home Improvement Commission (MHIC) license or a Maryland Construction license as applicable, and the roofing manufacturer's certification for the specified system.",
    "A Bid Bond of 5% of the total bid amount shall accompany each bid.",
    "The successful bidder shall furnish a Performance Bond and a Payment Bond, each in the amount of 100% of the contract price, within ten days of award.",
    "INSURANCE: Commercial General Liability of not less than $2,000,000 per occurrence and $4,000,000 aggregate; Automobile Liability of $1,000,000; Umbrella Liability of $5,000,000; and Workers' Compensation as required by law.",
    "A Minority Business Enterprise (MBE) participation goal of 29% has been established for this contract.",
    "Prevailing wage rates established by the Maryland Department of Labor apply to this project.",
    "Bidders shall submit the Bid/Proposal Affidavit, bid bond, references, and a list of proposed subcontractors with the bid.",
    "Liquidated damages of $1,000 per calendar day will be assessed for failure to achieve substantial completion.",
]


def make_pdf(path: Path) -> None:
    from fpdf import FPDF
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    for page in JANITORIAL_PAGES:
        pdf.add_page()
        pdf.set_font("Helvetica", size=10)
        pdf.multi_cell(0, 5, page.replace("’", "'"))
    pdf.output(str(path))


def make_docx(path: Path) -> None:
    import docx
    d = docx.Document()
    for p in ROOFING_PARAGRAPHS:
        d.add_paragraph(p)
    d.save(str(path))


def main() -> list[Path]:
    OUT.mkdir(exist_ok=True)
    pdf = OUT / "sample_janitorial_ifb.pdf"
    dx = OUT / "sample_roofing_ifb.docx"
    make_pdf(pdf)
    make_docx(dx)
    print(f"wrote {pdf}\nwrote {dx}")
    return [pdf, dx]


if __name__ == "__main__":
    main()
