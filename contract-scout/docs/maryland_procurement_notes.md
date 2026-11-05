# Maryland procurement notes for the bot (research pass 2026-11-05)

Working notes behind the source registry, the eligibility rules and the bid checklist. Everything here came from web search of official Maryland pages and solicitation documents; the eMMA and procurement.maryland.gov sites themselves could not be opened from the build environment, so confirm details once in a browser before relying on them for a bid.

## eMMA (eMaryland Marketplace Advantage)
- Official state portal for solicitations and contracts. Registration is free and is a two-step process (Part I vendor registration, then vendor onboarding by the Vendor Admin).
- Training guides describe a **Public Solicitations** search that works without an account. Downloading attachments and submitting bids require login.
- **Notifications:** registered vendors choose UNSPSC commodity codes in the company profile. When a buyer publishes or amends a solicitation they run "Notify Commodity Vendors", which emails the Vendor Admin and primary contacts of every vendor with a matching code. One state page describes notices for procurements of $15,000 and over. If no codes are selected, no notices arrive.
- **No published terms on automated access were found.** The bot therefore never fetches eMMA pages; it reads the notification emails you receive (IMAP) and you upload the documents.
- Help desk: emma.helpdesk@maryland.gov.

### UNSPSC segments to select for the six industries (verify the exact codes in eMMA's picker)
| Industry | UNSPSC segments / families to start with |
|---|---|
| Construction & Property Services | 72 Building and facility construction and maintenance services (72100000 building maintenance and repair; 72150000 specialized trade construction such as roofing, HVAC, plumbing, electrical, painting, flooring); 70 Farming/landscaping (70110000 landscaping and grounds); 95 Land, buildings and structures |
| Cleaning & Janitorial | 76 Industrial cleaning services (76110000 cleaning and janitorial); 47 Cleaning equipment and supplies |
| Sanitation & Waste | 76120000 refuse disposal and treatment; 76130000 toxic and hazardous waste cleanup; 72102100 pest control |
| Food & Catering | 90100000 restaurants and catering; 50 Food, beverage and tobacco products; 85 Healthcare services for dietary programs where listed |
| Healthcare & Hospital Support | 85 Healthcare services; 42 Medical equipment, accessories and supplies; 76111500 cleaning of healthcare facilities (environmental services) |
| Hospitality & Lodging | 90110000 hotels, lodging and meeting facilities; 91 Personal and domestic services (laundry 91111500) |

## Small procurements
- 2023 law (HB 543, Chapter 161) raised the small-procurement ceiling in State Finance and Procurement §13-109 from $50,000 to $100,000; COMAR 21.05.07 is titled "Small Procurement Regulations ($100,000 or Less)". Some agency pages still quote older figures.
- Small procurements use simplified methods (quotes, often fewer forms, sometimes no bond). They are the realistic entry point for a young entity. The engine does not yet classify by threshold; that is a Stage 3 item.

## Small Business Reserve (SBR)
- Prime-contracting program: when a solicitation is designated SBR, only SBR-certified firms may be awarded.
- Certification is a free **self-certification inside the eMMA company profile** (General Information > Company Profile > Company Info, tick the SBR disclaimer). Renew annually.
- Criteria in COMAR 21.11.01.06 and SF&P §14-501: for-profit, not a broker, independently owned and operated, not a subsidiary, not dominant in its field, and under size limits on employees / gross sales that vary by industry. Pull the current text of 21.11.01.06 before certifying.

## Standard state solicitation forms and when they are due
From attachment indexes and submission checklists in state RFPs/IFBs. The solicitation's own table of attachments controls.
| Form | Usually due |
|---|---|
| Bid/Proposal Affidavit | With the bid or technical proposal |
| Contract Affidavit | At award (often within 5 working days of notice of recommended award); some RFPs ask for it with the proposal |
| MBE Utilization and Fair Solicitation Affidavit (Attachment D-1A) | With the bid when an MBE goal applies |
| MBE Waiver Request (D-1C), Outreach Efforts (D-2), Subcontractor Project Participation (D-3) | About 10 working days after recommended award |
| MBE Prime/Sub Payment Reports (D-4, D-5) | Monthly during the contract |
| Living Wage Requirements Affidavit of Agreement | With the technical proposal or in the contract file; applies to many service contracts |
| Mercury Affidavit | Only when the solicitation says it applies (products containing mercury) |
| Price Proposal / Bid Form | With the financial proposal, sealed separately when required |
| Certificate of Insurance naming the agency | Usually within 10 days of award, sometimes with the bid |
| Bid bond / security | With the bid, when required |
| Performance and payment bonds | Within ~10 days of award, when required |
| References, financial statements, subcontractor list | As stated in the solicitation |

## Local government portals found
| Jurisdiction | Where to look | Mechanism |
|---|---|---|
| Baltimore City | procurement.baltimorecity.gov (Supplier Self-Service Portal) and eMMA | Portal registration; many City bids on eMMA |
| Baltimore County | procurement.opengov.com/portal/baltimorecountymd | Free OpenGov registration, email notices, amendments on the portal |
| Montgomery County | montgomerycountymd.gov/PRO/solicitations; responses via BidNet | Free BidNet 'Limited' registration; County Vendor Registration System for award/payment; GovDelivery bulletins |
| Prince George's County | Central Services / CAP website, SPEED (SAP Ariba Discovery) and eMMA; Thursday newspaper ads | Register on SPEED and eMMA |
| Howard County | howardcountymd.gov/current-solicitations | PlanetBids, free |
| Carroll County | Public Purchase | Free registration |
| Charles County | OpenGov portal and eMMA | Free registration |
| St. Mary's County | County eProcurement portal | Formal solicitations over $50,000 |
| Anne Arundel County | Not confirmed | Verify in a browser |
| Baltimore City Public Schools | eMMA | Commodity-code notices |
| MCPS | montgomeryschoolsmd.org supplier portal | Must pick notification categories |
| PGCPS | pgcps.org purchasing | MBE program |

## Sources consulted
- procurement.maryland.gov vendor registration guide, Vendor User Guide 1.1, QRG 3a (browse business requests), QRG 8c (notify vendors and publish), QRG 7 (SBR certification)
- mdprocurement.freshdesk.com buyer and vendor FAQs
- gomdsmallbiz.maryland.gov SBR program pages and 2024/2025 T.I.P.S. webinar decks
- mgaleg.maryland.gov HB 543 (2023) fiscal note and chapter text; regulations.justia.com COMAR 21.05.07 and 21.11.01.06
- montgomerycountymd.gov/PRO FAQ and CVRS announcement; baltimorecountymd.gov purchasing pages; princegeorgescountymd.gov procurement FAQs; howardcountymd.gov current solicitations; carrollcountymd.gov; charlescountymd.gov; stmaryscountymd.gov
- State RFP attachment indexes (DoIT, DHS, DBM contract library) for the forms table
