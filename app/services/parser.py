"""PDF parsing service for extracting events from EAF files.

Handles PDF validation, text extraction, and event parsing from
De La Salle University Enrollment Assessment Forms.
"""

import re
from io import BytesIO

from pypdf import PdfReader

from app.config import MAX_PDF_SIZE_BYTES, MAX_PDF_SIZE_MB, SCHEDULE_PATTERN
from app.models import EafMetadata, Event
from app.utils import normalize_text, standardize_location


def validate_pdf_file(content: bytes | None, filename: str) -> tuple[bool, str]:
    """Validate PDF content for size and format.

    Args:
        content: Raw PDF bytes, or None if no file was provided
        filename: Original filename from the upload

    Returns:
        Tuple of (is_valid, error_message)
    """
    if content is None or not filename:
        return False, "Please upload a file."

    if not filename.lower().endswith(".pdf"):
        return False, "Only PDF files are accepted. Please upload a valid PDF file."

    file_size = len(content)

    if file_size == 0:
        return False, "The uploaded file is empty. Please upload a valid PDF file."

    if file_size > MAX_PDF_SIZE_BYTES:
        return False, f"File is too large. Maximum size is {MAX_PDF_SIZE_MB}MB. Your file is {file_size / 1024 / 1024:.1f}MB."

    return True, ""


def parse_eaf_pdf(content: bytes, filename: str = "") -> tuple[list[Event], EafMetadata]:
    """Parse EAF PDF and extract scheduled events and metadata.

    Args:
        content: Raw PDF bytes
        filename: Original filename (unused, kept for call-site symmetry)

    Returns:
        Tuple of (events, metadata) where events is a list of Event objects
        and metadata contains student ID and term information

    Raises:
        ValueError: If PDF cannot be read or contains no valid events
    """
    try:
        reader = PdfReader(BytesIO(content))
    except Exception as exc:
        raise ValueError(f"Could not read PDF file. It may be corrupted or not a valid PDF. Error: {str(exc)}") from exc

    if len(reader.pages) == 0:
        raise ValueError("The PDF file has no pages. Please upload a valid EAF PDF.")

    try:
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        raise ValueError(f"Could not extract text from PDF. The file may be corrupted. Error: {str(exc)}") from exc

    text = text.replace("\r", "")
    flat_text = normalize_text(text.replace("\n", " "))

    # Extract metadata from a single pass over the text
    student_id_match = re.search(r"STUDENT ID\s*:\s*(\d+)", flat_text)
    session_match = re.search(r"AY\s*(\d{4})-(\d{4}).*?Term\s*(\d+)", flat_text)
    metadata = EafMetadata(
        student_id=student_id_match.group(1) if student_id_match else None,
        start_year=session_match.group(1) if session_match else None,
        end_year=session_match.group(2) if session_match else None,
        term_number=session_match.group(3) if session_match else None,
    )

    # Parse rows from PDF text
    rows: list[str] = []
    current_row: list[str] = []

    for raw_line in text.splitlines():
        line = normalize_text(raw_line)
        if not line:
            continue
        if line.startswith("Payments"):
            break
        if re.match(r"^\d+\s+[A-Z0-9]+-", line):
            if current_row:
                rows.append(" ".join(current_row))
            current_row = [line]
            continue
        if current_row:
            current_row.append(line)

    if current_row:
        rows.append(" ".join(current_row))

    # Extract events from rows
    events: list[Event] = []

    for row in rows:
        match = re.search(
            r"([A-Z0-9]+)-(.+?)\s+"
            r"(Lecture|Seminar / Workshop|Laboratory|Research / Capstone)\s+"
            r"([A-Z0-9]+)\s+([\d.]+)\s+(.*)",
            row,
        )
        if match is None:
            continue

        code = normalize_text(match.group(1))
        course_name = normalize_text(match.group(2))
        section = normalize_text(match.group(4))
        schedule_text = normalize_text(match.group(6))
        title = f"{code} {section}"

        for schedule_match in SCHEDULE_PATTERN.finditer(schedule_text):
            day = schedule_match.group(1).upper()
            start_time = normalize_text(schedule_match.group(2).upper())
            end_time = normalize_text(schedule_match.group(3).upper())
            location = standardize_location(schedule_match.group(4) or "")
            events.append(
                Event(
                    code=code,
                    title=title,
                    course_name=course_name,
                    day=day,
                    start_time=start_time,
                    end_time=end_time,
                    location=location,
                )
            )

    return events, metadata


def build_schedule_filename(metadata: EafMetadata) -> str:
    """Generate ICS filename from EAF metadata (student ID, term, AY).

    Args:
        metadata: Parsed EAF metadata from parse_eaf_pdf

    Returns:
        Generated filename for ICS file (e.g., "123456_T2_AY24-25_Schedule.ics")
    """
    if metadata.student_id and metadata.start_year and metadata.end_year and metadata.term_number:
        academic_year = f"AY{metadata.start_year[-2:]}-{metadata.end_year[-2:]}"
        return f"{metadata.student_id}_T{metadata.term_number}_{academic_year}_Schedule.ics"

    return "eaf-calendar.ics"
