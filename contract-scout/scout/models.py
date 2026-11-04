"""Shared vocabulary: statuses, categories, industries and small helpers."""
from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional

# ---- Information status: how much we trust a fact -------------------------
VERIFIED = "VERIFIED"            # supported by a document or official record we hold
MISSING = "MISSING"              # required but not found / not provided
ASSUMED = "ASSUMED"              # an estimate or assumption, editable, not evidence
NOT_APPLICABLE = "NOT_APPLICABLE"
INFO_STATUSES = (VERIFIED, MISSING, ASSUMED, NOT_APPLICABLE)

# ---- Match classification --------------------------------------------------
STRONG = "Strong Match"
CONDITIONAL = "Conditional Match"
POOR = "Poor Match"
MATCH_CLASSES = (STRONG, CONDITIONAL, POOR)

# ---- Recommendation --------------------------------------------------------
PURSUE = "Pursue"
INVESTIGATE = "Investigate Further"
REJECT = "Reject"
RECOMMENDATIONS = (PURSUE, INVESTIGATE, REJECT)

# ---- Pipeline status of an opportunity ------------------------------------
OPP_STATUSES = ("New", "Under Review", "Preparing Bid", "Submitted", "Awarded", "Lost", "Rejected")

# ---- Result of a single compliance check ----------------------------------
MET = "MET"
NOT_MET = "NOT_MET"
UNKNOWN = "UNKNOWN"
CHECK_RESULTS = (MET, NOT_MET, UNKNOWN, NOT_APPLICABLE)

# ---- Requirement categories extracted from solicitations -----------------
REQ_CATEGORIES = (
    "eligibility",     # who may bid: registration, set-asides, entity type, location
    "experience",      # years in business, similar projects, references
    "license",         # MHIC, trade licenses, food permits, etc.
    "insurance",       # coverage types and limits
    "bond",            # bid / performance / payment bonds
    "financial",       # financial statements, capacity, credit
    "staffing",        # key personnel, headcount, background checks
    "equipment",       # vehicles, machinery, facilities
    "meeting",         # pre-bid meetings, site visits (mandatory or optional)
    "submission",      # required forms, affidavits, format, delivery method
    "risk",            # liquidated damages, prevailing wage, termination, restrictions
    "scope",           # scope of work items
)
# Categories where a solicitation almost always has a rule. If we find nothing,
# the engine records "not found in documents" and the match cannot be Strong.
CORE_MANDATORY_CATEGORIES = ("eligibility", "experience", "license", "insurance", "bond")

# ---- Industries and keyword map (used only to tag, never to decide) -------
INDUSTRIES = {
    "Construction & Property Services": [
        "construction", "renovation", "rehabilitation", "roof", "hvac", "plumbing",
        "electrical", "painting", "flooring", "demolition", "landscap", "tree",
        "property maintenance", "mowing", "snow removal", "carpentry", "masonry",
        "general contractor", "mhic", "building repair",
    ],
    "Cleaning & Janitorial": [
        "janitorial", "custodial", "cleaning", "sanitation", "floor care", "housekeeping",
        "disinfect", "window washing", "carpet cleaning", "waste removal",
    ],
    "Food & Catering": [
        "food service", "catering", "meal", "cafeteria", "food supply", "food distribution",
        "produce", "grocery", "nutrition", "kitchen", "dietary", "vending",
    ],
    "Healthcare & Hospital Support": [
        "hospital", "healthcare", "health care", "medical supplies", "environmental services",
        "patient transport", "sterile", "clinic", "nursing", "pharmac",
        "ppe", "durable medical", "medical waste", "biohazard",
    ],
    "Hospitality & Lodging": [
        "hospitality", "hotel", "lodging", "housekeeping", "laundry", "linen", "banquet",
        "conference services", "event services", "concierge", "front desk", "dormitory",
        "guest services", "shelter operations", "residential facility", "room attendant",
    ],
    "Sanitation & Waste": [
        "sanitation", "sanitary", "waste", "refuse", "trash", "recycling", "pest control",
        "extermination", "portable toilet", "restroom", "disinfection", "hygiene",
        "litter", "street sweeping", "grease trap", "septic", "hazardous materials",
    ],
}

# Industries the owner has said are "can do" by default; profile capabilities override this.
DEFAULT_CAN_DO_INDUSTRIES = ("Construction & Property Services", "Cleaning & Janitorial", "Food & Catering",
                             "Healthcare & Hospital Support", "Hospitality & Lodging", "Sanitation & Waste")


def classify_industry(text: str) -> str:
    """Tag an opportunity with the industry whose keywords appear most often."""
    t = (text or "").lower()
    best, best_hits = "Other / Unclassified", 0
    for name, words in INDUSTRIES.items():
        hits = sum(t.count(w) for w in words)
        if hits > best_hits:
            best, best_hits = name, hits
    return best


def normalize_key(solicitation_number: str | None, agency: str | None) -> str:
    """Stable key for duplicate detection: letters/digits only, upper case."""
    num = re.sub(r"[^A-Z0-9]", "", (solicitation_number or "").upper())
    ag = re.sub(r"[^A-Z0-9]", "", (agency or "").upper())[:40]
    return f"{num}|{ag}" if num else f"NONUM|{ag}"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


@dataclass
class Fact:
    """A single piece of profile information with provenance."""
    value: Any = None
    status: str = MISSING
    source: str = ""
    verified_on: str = ""
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Any) -> "Fact":
        if isinstance(d, Fact):
            return d
        if not isinstance(d, dict) or "status" not in d:
            # tolerate bare values but treat them as unverified
            return cls(value=d, status=ASSUMED, notes="bare value without provenance")
        return cls(
            value=d.get("value"),
            status=d.get("status", MISSING),
            source=d.get("source", ""),
            verified_on=d.get("verified_on", ""),
            notes=d.get("notes", ""),
        )


@dataclass
class Requirement:
    """One requirement extracted from a solicitation document."""
    category: str
    text: str
    mandatory: bool = True
    value: Optional[str] = None        # numeric/literal detail, e.g. "1000000" or "5 years"
    document: str = ""                 # filename
    page_ref: str = ""                 # "p. 12" or "Section 3.4"
    quote: str = ""                    # supporting excerpt
    confidence: float = 0.5            # 0..1, from extractor
    info_status: str = VERIFIED        # VERIFIED (stated in doc) or MISSING (not found)
    method: str = "manual"             # claude | heuristic | manual

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CheckOutcome:
    """Result of comparing one requirement with the company profile."""
    category: str
    requirement: str
    result: str                        # MET / NOT_MET / UNKNOWN / NOT_APPLICABLE
    mandatory: bool
    explanation: str
    profile_fact_status: str = MISSING
    page_ref: str = ""
    document: str = ""
    remedy: str = ""                   # what would need to happen to satisfy it
    partner_path: bool = False         # could a sub / JV realistically cover it

    def to_dict(self) -> dict:
        return asdict(self)
