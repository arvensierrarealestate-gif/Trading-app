"""Paths, environment and runtime settings.

Secrets are read from environment variables (optionally loaded from a .env file
that is never committed). Nothing sensitive is stored in source code.
"""
from __future__ import annotations

import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv, dotenv_values

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
# A value in the project's .env always wins over an empty or stale variable inherited from the shell.
for _k, _v in (dotenv_values(ROOT / ".env") or {}).items():
    if _v is not None and str(_v).strip():
        os.environ[_k] = str(_v).strip()


def env_file_has_key(name: str = "ANTHROPIC_API_KEY") -> str:
    """Diagnostic only: 'present', 'empty', 'absent' or 'no file'. Never returns the value."""
    p = ROOT / ".env"
    if not p.exists():
        return "no file"
    try:
        vals = dotenv_values(p) or {}
    except Exception as exc:  # pragma: no cover
        return f"unreadable ({exc})"
    if name not in vals:
        return "absent"
    return "present" if (vals.get(name) or "").strip() else "empty"

DATA_DIR = Path(os.getenv("SCOUT_DATA_DIR", ROOT / "data"))
UPLOAD_DIR = DATA_DIR / "uploads"
TEXT_DIR = DATA_DIR / "text"
OUTBOX_DIR = DATA_DIR / "outbox"
EXPORT_DIR = DATA_DIR / "exports"
DB_PATH = Path(os.getenv("SCOUT_DB_PATH", DATA_DIR / "scout.db"))
PROFILE_PATH = Path(os.getenv("SCOUT_PROFILE_PATH", DATA_DIR / "company_profile.json"))
SAMPLE_PROFILE_PATH = ROOT / "examples" / "company_profile.sample.json"
PROFILES_DIR = Path(os.getenv("SCOUT_PROFILES_DIR", ROOT / "profiles"))
USER_PROFILES_DIR = DATA_DIR / "profiles"
ACTIVE_PROFILE_FILE = DATA_DIR / "active_profile.txt"
TEMPLATE_PROFILE_PATH = ROOT / "company_profile_template.json"
SOURCE_REGISTRY_PATH = ROOT / "source_registry.json"

LOCAL_TZ_NAME = os.getenv("SCOUT_TIMEZONE", "America/New_York")
LOCAL_TZ = ZoneInfo(LOCAL_TZ_NAME)

CLAUDE_MODEL = os.getenv("SCOUT_CLAUDE_MODEL", "claude-opus-5-5")
MAX_DOC_CHARS_FOR_CLAUDE = int(os.getenv("SCOUT_MAX_DOC_CHARS", "400000"))

# Email (SMTP) settings for alerts. All optional; alerts fall back to a dry run.
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
ALERT_FROM = os.getenv("ALERT_FROM", SMTP_USER)
ALERT_TO = [a.strip() for a in os.getenv("ALERT_TO", "").split(",") if a.strip()]

# IMAP settings for reading eMMA notification emails. Optional.
IMAP_HOST = os.getenv("IMAP_HOST", "")
IMAP_USER = os.getenv("IMAP_USER", "")
IMAP_PASSWORD = os.getenv("IMAP_PASSWORD", "")
IMAP_FOLDER = os.getenv("IMAP_FOLDER", "INBOX")
IMAP_SENDER_FILTER = os.getenv("IMAP_SENDER_FILTER", "emma,opengov,bidnet,planetbids,ariba")
IMAP_SINCE_DAYS = int(os.getenv("IMAP_SINCE_DAYS", "14"))
DASHBOARD_URL = os.getenv("SCOUT_DASHBOARD_URL", "http://localhost:8501")


def anthropic_available() -> bool:
    """True only when a plausible key or token is present, not just any non-empty text."""
    key = (os.getenv("ANTHROPIC_API_KEY") or "").strip()
    return key.startswith("sk-ant-") or bool((os.getenv("ANTHROPIC_AUTH_TOKEN") or "").strip())


def smtp_available() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and ALERT_TO)


def imap_available() -> bool:
    return bool(IMAP_HOST and IMAP_USER and IMAP_PASSWORD)


def ensure_dirs() -> None:
    for d in (DATA_DIR, UPLOAD_DIR, TEXT_DIR, OUTBOX_DIR, EXPORT_DIR):
        d.mkdir(parents=True, exist_ok=True)
