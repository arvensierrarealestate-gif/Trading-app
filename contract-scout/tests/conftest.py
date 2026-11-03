import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
# isolate all test data from the real data/ folder before scout.config is imported
_TMP = tempfile.mkdtemp(prefix="scout-tests-")
os.environ["SCOUT_DATA_DIR"] = _TMP
os.environ["SCOUT_DB_PATH"] = str(Path(_TMP) / "test.db")
os.environ["SCOUT_PROFILE_PATH"] = str(Path(_TMP) / "no_profile.json")
os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("ANTHROPIC_AUTH_TOKEN", None)
for k in ("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "ALERT_TO", "IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD"):
    os.environ.pop(k, None)

import json  # noqa: E402
import pytest  # noqa: E402

from scout import db as _db, config  # noqa: E402
from scripts.make_sample_solicitation import JANITORIAL_PAGES, ROOFING_PARAGRAPHS  # noqa: E402


@pytest.fixture
def conn(tmp_path):
    c = _db.connect(tmp_path / "t.db")
    yield c
    c.close()


@pytest.fixture
def profile():
    with open(ROOT / "examples" / "company_profile.sample.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def janitorial_text():
    return "\n".join(f"[[PAGE {i + 1}]]\n{p}" for i, p in enumerate(JANITORIAL_PAGES))


@pytest.fixture
def roofing_text():
    return "[[PAGE 1]]\n" + "\n".join(ROOFING_PARAGRAPHS)


@pytest.fixture
def sample_pdf_bytes():
    p = ROOT / "examples" / "sample_janitorial_ifb.pdf"
    if not p.exists():
        from scripts.make_sample_solicitation import main
        main()
    return p.read_bytes()


@pytest.fixture
def sample_docx_bytes():
    p = ROOT / "examples" / "sample_roofing_ifb.docx"
    if not p.exists():
        from scripts.make_sample_solicitation import main
        main()
    return p.read_bytes()
