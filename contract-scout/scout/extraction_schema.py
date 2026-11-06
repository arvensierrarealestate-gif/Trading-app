"""JSON schema that the document reader must return (Claude or heuristic)."""

FIELD = {
    "type": "object",
    "properties": {
        "value": {"type": ["string", "null"]},
        "page_ref": {"type": "string"},
        "confidence": {"type": "number"},
    },
    "required": ["value", "page_ref", "confidence"],
    "additionalProperties": False,
}

REQUIREMENT = {
    "type": "object",
    "properties": {
        "category": {"type": "string", "enum": [
            "eligibility", "experience", "license", "insurance", "bond", "financial",
            "staffing", "equipment", "meeting", "submission", "risk", "subcontracting", "preference", "restriction", "scope"]},
        "text": {"type": "string", "description": "Plain-English statement of the requirement"},
        "mandatory": {"type": "boolean"},
        "value": {"type": ["string", "null"], "description": "Numeric or literal detail, e.g. '1000000', '5 years', '5%'"},
        "page_ref": {"type": "string", "description": "e.g. 'p. 12' or 'Section 3.2, p. 7'"},
        "quote": {"type": "string", "description": "Short verbatim excerpt supporting the requirement"},
        "confidence": {"type": "number"},
    },
    "required": ["category", "text", "mandatory", "value", "page_ref", "quote", "confidence"],
    "additionalProperties": False,
}

SOLICITATION_SCHEMA = {
    "type": "object",
    "properties": {
        "solicitation_number": FIELD,
        "title": FIELD,
        "agency": FIELD,
        "location": FIELD,
        "contract_duration": FIELD,
        "bid_deadline_text": FIELD,
        "estimated_value": {
            "type": "object",
            "properties": {
                "low": {"type": ["number", "null"]},
                "high": {"type": ["number", "null"]},
                "text": {"type": "string"},
                "page_ref": {"type": "string"},
                "confidence": {"type": "number"},
            },
            "required": ["low", "high", "text", "page_ref", "confidence"],
            "additionalProperties": False,
        },
        "scope_summary": {"type": "string"},
        "industry": {"type": "string", "description": "Best industry label for the work, e.g. 'Cleaning & Janitorial', 'Construction & Property Services', 'Food & Catering', 'Pharmacy & Immunization', 'Hospitality & Lodging', 'Sanitation & Waste', 'Healthcare & Hospital Support', or a short new label if none fits"},
        "services_requested": {"type": "array", "items": {"type": "string"}, "description": "Concrete services or products requested, 3-10 short items"},
        "subcontracting_allowed": {"type": "string", "enum": ["yes", "no", "limited", "not stated"]},
        "joint_venture_allowed": {"type": "string", "enum": ["yes", "no", "not stated"]},
        "open_to_new_businesses": {"type": "string", "enum": ["yes", "no", "unclear"], "description": "'no' only if the document requires a minimum operating history or mandatory past performance that a new business cannot meet"},
        "set_aside": {"type": "string", "description": "Set-aside or preference program stated, e.g. 'Small Business Reserve', 'MBE goal 29%', 'CBE set-aside', 'VSBE goal', or 'none stated'"},
        "award_basis": {"type": "string", "enum": ["lowest price", "best value", "not stated"], "description": "How award is decided"},
        "requirements": {"type": "array", "items": REQUIREMENT},
        "not_found": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Categories the document does not address at all",
        },
    },
    "required": ["solicitation_number", "title", "agency", "location", "contract_duration",
                 "bid_deadline_text", "estimated_value", "scope_summary", "industry", "services_requested", "subcontracting_allowed",
                 "joint_venture_allowed", "open_to_new_businesses", "set_aside", "award_basis", "requirements", "not_found"],
    "additionalProperties": False,
}

SYSTEM_PROMPT = """You are a procurement analyst reading a government solicitation for a small Maryland contractor.
Extract only what the document actually states. Never infer, estimate, or fill in values that are not written.
Rules:
- Every requirement must cite the page marker [[PAGE n]] where you found it as 'p. n' (add section numbers when present).
- Include a short verbatim quote for each requirement.
- Mark a requirement mandatory=true only when the document uses shall/must/required/mandatory language or the requirement is a condition of award.
- For insurance and bonds, put the numeric limit or percentage in 'value' (digits only for dollars, e.g. '1000000'; '5%' for percentages).
- For experience, put the stated number of years or projects in 'value'.
- If a category (eligibility, experience, license, insurance, bond, financial, staffing, equipment, meeting, submission, risk) is not addressed anywhere, list it in not_found. Do not invent a requirement for it.
- If the estimated contract value is not stated, set low and high to null and say so in text.
- State the set-aside or preference program exactly as written (SBR, MBE goal and percentage, CBE, VSBE, local preference) or 'none stated'.
- award_basis is 'lowest price' for IFB/low-bid awards, 'best value' for RFPs with technical scoring, else 'not stated'.
- Use category 'subcontracting' for any clause on subcontracting, joint ventures, teaming or self-performance percentages; 'preference' for desirable-but-not-required qualifications and evaluation preferences (mark mandatory=false); 'restriction' for clauses limiting who may bid (certified-only, local-only, incumbent-only).
- Separate mandatory requirements (shall/must) from preferred ones (should/preferred/desirable/points awarded).
- Confidence is 0 to 1 and reflects how explicit the document is.
Return JSON only, matching the schema."""
