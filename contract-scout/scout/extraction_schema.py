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
            "staffing", "equipment", "meeting", "submission", "risk", "scope"]},
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
        "requirements": {"type": "array", "items": REQUIREMENT},
        "not_found": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Categories the document does not address at all",
        },
    },
    "required": ["solicitation_number", "title", "agency", "location", "contract_duration",
                 "bid_deadline_text", "estimated_value", "scope_summary", "requirements", "not_found"],
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
- Confidence is 0 to 1 and reflects how explicit the document is.
Return JSON only, matching the schema."""
