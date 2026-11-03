"""Deadline parsing and time-zone handling.

Maryland agencies publish deadlines in Eastern time. We store both the UTC
instant and the local wall-clock string so nothing is ambiguous around
daylight-saving changes.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from . import config

_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
_PATTERNS = [
    # November 21, 2026 at 2:00 PM  /  November 21, 2026, 2:00 p.m.
    rf"(?P<month>{_MONTHS})\s+(?P<day>\d{{1,2}}),?\s+(?P<year>\d{{4}})(?:,?\s*(?:at|by|@)?\s*(?P<hour>\d{{1,2}})(?::(?P<minute>\d{{2}}))?\s*(?P<ampm>a\.?m\.?|p\.?m\.?|noon)?)?",
    # 11/21/2026 2:00 PM  /  11/21/26
    r"(?P<month>\d{1,2})/(?P<day>\d{1,2})/(?P<year>\d{2,4})(?:,?\s*(?:at|by|@)?\s*(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>a\.?m\.?|p\.?m\.?|noon)?)?",
    # 2026-11-21 14:00
    r"(?P<year>\d{4})-(?P<month>\d{2})-(?P<day>\d{2})(?:[T ](?P<hour>\d{1,2}):(?P<minute>\d{2}))?",
]
_MONTH_INDEX = {m: i + 1 for i, m in enumerate(_MONTHS.split("|"))}


def parse_deadline(text: str, tz: Optional[ZoneInfo] = None) -> Optional[datetime]:
    """Parse a human-written deadline into an aware datetime in the local zone.

    Returns None when nothing parseable is present. Times without a clock
    default to 23:59 local so they are never treated as already passed.
    """
    if not text:
        return None
    tz = tz or config.LOCAL_TZ
    t = text.strip().lower()
    for pat in _PATTERNS:
        m = re.search(pat, t, flags=re.IGNORECASE)
        if not m:
            continue
        g = m.groupdict()
        try:
            month = _MONTH_INDEX.get(g["month"], None) if not str(g["month"]).isdigit() else int(g["month"])
            day = int(g["day"])
            year = int(g["year"])
            if year < 100:
                year += 2000
            hour = int(g["hour"]) if g.get("hour") else 23
            minute = int(g["minute"]) if g.get("minute") else (59 if not g.get("hour") else 0)
            ampm = (g.get("ampm") or "").replace(".", "")
            if ampm == "noon":
                hour, minute = 12, 0
            elif ampm.startswith("p") and hour < 12:
                hour += 12
            elif ampm.startswith("a") and hour == 12:
                hour = 0
            return datetime(year, month, day, hour, minute, tzinfo=tz)
        except (TypeError, ValueError):
            continue
    return None


def to_storage(dt: Optional[datetime]) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Return (utc_iso, local_iso, tz_name) for storage."""
    if dt is None:
        return None, None, None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=config.LOCAL_TZ)
    local = dt.astimezone(config.LOCAL_TZ)
    return dt.astimezone(timezone.utc).isoformat(), local.isoformat(), config.LOCAL_TZ_NAME


def from_storage(utc_iso: Optional[str]) -> Optional[datetime]:
    if not utc_iso:
        return None
    return datetime.fromisoformat(utc_iso).astimezone(config.LOCAL_TZ)


def days_until(utc_iso: Optional[str], now: Optional[datetime] = None) -> Optional[float]:
    dt = from_storage(utc_iso)
    if dt is None:
        return None
    now = now or datetime.now(timezone.utc)
    return (dt - now.astimezone(timezone.utc)).total_seconds() / 86400.0


def format_local(utc_iso: Optional[str]) -> str:
    dt = from_storage(utc_iso)
    if dt is None:
        return "Not found"
    return dt.strftime("%a %b %d, %Y %I:%M %p %Z")


def urgency_bucket(utc_iso: Optional[str], now: Optional[datetime] = None) -> str:
    d = days_until(utc_iso, now)
    if d is None:
        return "No deadline on file"
    if d < 0:
        return "Passed"
    if d <= 3:
        return "Due in 3 days or less"
    if d <= 7:
        return "Due within 7 days"
    if d <= 14:
        return "Due within 14 days"
    return "More than 14 days"
