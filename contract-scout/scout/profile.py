"""Company profile: load, validate and summarise verified qualifications.

Every field is a Fact {value, status, source, verified_on, notes}. The engine
only treats VERIFIED facts as satisfying a requirement.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from . import config
from .models import Fact, INFO_STATUSES, MISSING, VERIFIED

REQUIRED_SECTIONS = ("entity", "registrations", "licenses", "insurance", "bonding", "experience", "capabilities", "resources", "financial")
FORBIDDEN_KEYS = ("ein", "tax_id", "ssn", "password", "api_key", "account_number", "routing_number")


def load_profile(path: Optional[Path] = None) -> tuple[dict, str]:
    """Return (profile, origin). origin is 'user', 'sample' or 'template'."""
    candidates = [(path or config.PROFILE_PATH, "user"), (config.SAMPLE_PROFILE_PATH, "sample"), (config.TEMPLATE_PROFILE_PATH, "template")]
    for p, origin in candidates:
        if p and Path(p).exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f), origin
    raise FileNotFoundError("No company profile found. Copy company_profile_template.json to data/company_profile.json.")


def save_profile(profile: dict, path: Optional[Path] = None) -> Path:
    p = Path(path or config.PROFILE_PATH)
    p.parent.mkdir(parents=True, exist_ok=True)
    problems = validate_profile(profile)
    hard = [x for x in problems if x.startswith("ERROR")]
    if hard:
        raise ValueError("; ".join(hard))
    with open(p, "w", encoding="utf-8") as f:
        json.dump(profile, f, indent=2)
    return p


def _walk(obj: Any, path: str = ""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")
    else:
        yield path, obj


def validate_profile(profile: dict) -> list[str]:
    """Return a list of 'ERROR ...' and 'WARN ...' strings. Empty list = clean."""
    problems: list[str] = []
    for s in REQUIRED_SECTIONS:
        if s not in profile:
            problems.append(f"ERROR missing section '{s}'")
    def _keys(obj: Any, path: str = ""):
        if isinstance(obj, dict):
            for k, v in obj.items():
                here = f"{path}.{k}" if path else k
                if str(k).lower() in FORBIDDEN_KEYS:
                    problems.append(f"ERROR sensitive key '{here}' must not be stored in the profile")
                _keys(v, here)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                _keys(v, f"{path}[{i}]")
    _keys(profile)
    for path, val in _walk(profile):
        if path.endswith(".status") and val not in INFO_STATUSES:
            problems.append(f"ERROR '{path}' has invalid status '{val}' (use {', '.join(INFO_STATUSES)})")
    # facts should carry a source when VERIFIED
    def _check_facts(obj: Any, path: str = ""):
        if isinstance(obj, dict):
            if "status" in obj and "value" in obj:
                if obj.get("status") == VERIFIED and not obj.get("source"):
                    problems.append(f"WARN '{path}' is VERIFIED but has no source document")
            else:
                for k, v in obj.items():
                    _check_facts(v, f"{path}.{k}" if path else k)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                _check_facts(v, f"{path}[{i}]")
    _check_facts(profile)
    return problems


def fact(profile: dict, dotted: str) -> Fact:
    """Fetch a Fact by dotted path, e.g. 'insurance.general_liability.per_occurrence'."""
    cur: Any = profile
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return Fact(status=MISSING, notes=f"profile has no '{dotted}'")
    return Fact.from_dict(cur)


def verified_value(profile: dict, dotted: str) -> Any:
    f = fact(profile, dotted)
    return f.value if f.status == VERIFIED else None


def entity_experience(profile: dict, industry: Optional[str] = None) -> list[dict]:
    """Experience performed by the contracting entity itself (not owner/affiliate)."""
    out = []
    for e in profile.get("experience", []):
        if e.get("performed_by") != "contracting_entity":
            continue
        if industry and e.get("industry") and e.get("industry") != industry:
            continue
        out.append(e)
    return out


def supporting_experience(profile: dict, industry: Optional[str] = None) -> list[dict]:
    """Owner or affiliate experience. Useful context, never satisfies a mandatory rule."""
    out = []
    for e in profile.get("experience", []):
        if e.get("performed_by") == "contracting_entity":
            continue
        if industry and e.get("industry") and e.get("industry") != industry:
            continue
        out.append(e)
    return out


def completeness(profile: dict) -> dict:
    """Count facts by status for the profile page."""
    tally = {s: 0 for s in INFO_STATUSES}
    for path, val in _walk(profile):
        if path.endswith(".status") and val in tally:
            tally[val] += 1
    total = sum(tally.values()) or 1
    tally["verified_pct"] = round(100.0 * tally[VERIFIED] / total, 1)
    return tally


def missing_facts(profile: dict) -> list[str]:
    out = []
    def _rec(obj: Any, path: str = ""):
        if isinstance(obj, dict):
            if "status" in obj and "value" in obj:
                if obj["status"] == MISSING:
                    out.append(path)
            else:
                for k, v in obj.items():
                    _rec(v, f"{path}.{k}" if path else k)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                _rec(v, f"{path}[{i}]")
    _rec(profile)
    return out
