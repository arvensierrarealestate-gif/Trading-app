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


def list_profiles() -> list[dict]:
    """All entity profiles available: data/profiles/*.json (yours) first, then profiles/*.json shipped with the app.

    Returns [{id, name, path, origin}] sorted so user files win over shipped ones with the same id."""
    found: dict[str, dict] = {}
    for d, origin in ((config.PROFILES_DIR, "repo"), (config.USER_PROFILES_DIR, "user")):
        if not Path(d).exists():
            continue
        for p in sorted(Path(d).glob("*.json")):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            name = (data.get("entity", {}).get("legal_name", {}) or {}).get("value") or p.stem
            found[p.stem] = {"id": p.stem, "name": name, "path": str(p), "origin": origin, "version": data.get("profile_version", "")}
    if Path(config.PROFILE_PATH).exists():
        found["company_profile"] = {"id": "company_profile", "name": "data/company_profile.json", "path": str(config.PROFILE_PATH), "origin": "user", "version": ""}
    return sorted(found.values(), key=lambda x: (x["origin"] != "user", x["name"]))


def get_active_profile_id() -> Optional[str]:
    try:
        return Path(config.ACTIVE_PROFILE_FILE).read_text(encoding="utf-8").strip() or None
    except OSError:
        return None


def set_active_profile_id(profile_id: str) -> None:
    Path(config.ACTIVE_PROFILE_FILE).parent.mkdir(parents=True, exist_ok=True)
    Path(config.ACTIVE_PROFILE_FILE).write_text(profile_id, encoding="utf-8")


def load_profile_by_id(profile_id: str) -> dict:
    for p in list_profiles():
        if p["id"] == profile_id:
            with open(p["path"], "r", encoding="utf-8") as f:
                return json.load(f)
    raise FileNotFoundError(f"No profile with id '{profile_id}'")


def load_profile(path: Optional[Path] = None) -> tuple[Optional[dict], str]:
    """Return (profile, origin). origin is 'none' (general analysis, the default), 'user', 'entity:<id>', 'sample' or 'template'.

    Order: explicit path; the active selection in data/active_profile.txt ('none' = no business); when nothing was ever
    selected the app runs in general mode and returns (None, 'none')."""
    if path and Path(path).exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f), "user"
    active = get_active_profile_id()
    profiles = list_profiles()
    if not active or active == "none":
        return None, "none"
    if active:
        for p in profiles:
            if p["id"] == active:
                with open(p["path"], "r", encoding="utf-8") as f:
                    return json.load(f), f"entity:{p['id']}"
    if active == "company_profile" and Path(config.PROFILE_PATH).exists():
        with open(config.PROFILE_PATH, "r", encoding="utf-8") as f:
            return json.load(f), "user"
    if active == "sample" and Path(config.SAMPLE_PROFILE_PATH).exists():
        with open(config.SAMPLE_PROFILE_PATH, "r", encoding="utf-8") as f:
            return json.load(f), "sample"
    return None, "none"


def load_profile_or_sample() -> tuple[dict, str]:
    """For scripts/tests that need some profile: the active one, else the shipped sample."""
    p, origin = load_profile()
    if p is not None:
        return p, origin
    with open(config.SAMPLE_PROFILE_PATH, "r", encoding="utf-8") as f:
        return json.load(f), "sample"


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
