import pytest
from scout import documents


def test_pdf_extraction_has_pages_and_markers(sample_pdf_bytes):
    doc = documents.extract("sample.pdf", sample_pdf_bytes)
    assert doc.page_count == 3
    assert "[[PAGE 1]]" in doc.text and "[[PAGE 3]]" in doc.text
    assert "IFB-2026-JAN-0417" in doc.text
    assert len(doc.sha256) == 64


def test_docx_extraction(sample_docx_bytes):
    doc = documents.extract("roof.docx", sample_docx_bytes)
    assert doc.page_count >= 1
    assert "MHIC" in doc.text


def test_same_bytes_same_hash(sample_pdf_bytes):
    a = documents.extract("a.pdf", sample_pdf_bytes)
    b = documents.extract("b.pdf", sample_pdf_bytes)
    assert a.sha256 == b.sha256


def test_unsupported_type_rejected():
    with pytest.raises(ValueError):
        documents.extract("x.xlsx", b"123")


def test_find_page():
    text = "[[PAGE 1]]\nhello\n[[PAGE 2]]\nneedle here"
    assert documents.find_page(text, "needle") == 2
    assert documents.find_page(text, "absent") is None
