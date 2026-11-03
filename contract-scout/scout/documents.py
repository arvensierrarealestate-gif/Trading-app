"""Document intake: PDF / DOCX / TXT text extraction with page markers.

Each page is wrapped in `[[PAGE n]]` markers so later steps can cite pages.
Files are stored under data/uploads by SHA-256 so duplicates are detected.
"""
from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import config


@dataclass
class ExtractedDoc:
    filename: str
    sha256: str
    pages: list[str]
    method: str
    stored_path: Optional[str] = None
    text_path: Optional[str] = None

    @property
    def text(self) -> str:
        return "\n".join(f"[[PAGE {i + 1}]]\n{p}" for i, p in enumerate(self.pages))

    @property
    def page_count(self) -> int:
        return len(self.pages)

    @property
    def char_count(self) -> int:
        return sum(len(p) for p in self.pages)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _extract_pdf(data: bytes) -> list[str]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    pages = []
    for p in reader.pages:
        try:
            pages.append((p.extract_text() or "").strip())
        except Exception as exc:  # pragma: no cover - defensive
            pages.append(f"[text extraction failed on this page: {exc}]")
    return pages


def _extract_docx(data: bytes) -> list[str]:
    import docx
    d = docx.Document(io.BytesIO(data))
    chunks: list[str] = []
    for para in d.paragraphs:
        if para.text.strip():
            chunks.append(para.text)
    for table in d.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                chunks.append(" | ".join(cells))
    text = "\n".join(chunks)
    # DOCX has no fixed pages; split on explicit page breaks or ~3500 chars.
    parts = re.split(r"\f", text)
    pages: list[str] = []
    for part in parts:
        while len(part) > 3500:
            cut = part.rfind("\n", 0, 3500)
            cut = cut if cut > 1000 else 3500
            pages.append(part[:cut].strip())
            part = part[cut:]
        if part.strip():
            pages.append(part.strip())
    return pages or [""]


def extract(filename: str, data: bytes) -> ExtractedDoc:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        pages, method = _extract_pdf(data), "pypdf"
    elif ext == ".docx":
        pages, method = _extract_docx(data), "python-docx"
    elif ext in (".txt", ".md"):
        pages, method = [data.decode("utf-8", errors="replace")], "plain-text"
    else:
        raise ValueError(f"Unsupported file type '{ext}'. Upload PDF, DOCX or TXT.")
    if sum(len(p.strip()) for p in pages) < 40:
        method += " (little or no text found; file may be a scanned image needing OCR)"
    return ExtractedDoc(filename=filename, sha256=sha256_bytes(data), pages=pages, method=method)


def store(doc: ExtractedDoc, data: bytes) -> ExtractedDoc:
    config.ensure_dirs()
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", doc.filename)
    stored = config.UPLOAD_DIR / f"{doc.sha256[:16]}_{safe}"
    if not stored.exists():
        stored.write_bytes(data)
    text_path = config.TEXT_DIR / f"{doc.sha256[:16]}.txt"
    text_path.write_text(doc.text, encoding="utf-8")
    doc.stored_path = str(stored)
    doc.text_path = str(text_path)
    return doc


def load_text(text_path: str) -> str:
    return Path(text_path).read_text(encoding="utf-8")


def find_page(full_text: str, needle: str) -> Optional[int]:
    """Return the 1-based page number where `needle` appears, if any."""
    if not needle:
        return None
    idx = full_text.find(needle)
    if idx < 0:
        return None
    return full_text.count("[[PAGE ", 0, idx) or 1
