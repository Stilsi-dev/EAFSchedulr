"""PDF parsing service for extracting events from EAF files.

Handles PDF validation, text extraction, and event parsing from
De La Salle University Enrollment Assessment Forms.
"""

import re
from typing import Iterable

from pypdf import PdfReader
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from app.config import MAX_PDF_SIZE_BYTES, MAX_PDF_SIZE_MB, SCHEDULE_PATTERN
from app.models import Event
from app.utils import normalize_text, standardize_location


def validate_pdf_file(uploaded_file: FileStorage | None) -> tuple[bool, str]:
    """Validate uploaded PDF file for size and format.
    
    Checks that:
    - File exists and has a filename
    - File has .pdf extension
    - File is not empty
    - File size is within MAX_PDF_SIZE_BYTES limit
    
    Args:
        uploaded_file: Flask FileStorage object from form upload
        
    Returns:
        Tuple of (is_valid, error_message)
        - If valid: (True, "")
        - If invalid: (False, error_description)
    """
    if not uploaded_file or uploaded_file.filename == "":
        return False, "Please upload a file."
    
    filename = secure_filename(uploaded_file.filename)
    if not filename.lower().endswith(".pdf"):
        return False, "Only PDF files are accepted. Please upload a valid PDF file."
    
    # Check file size
    uploaded_file.seek(0, 2)  # Seek to end
    file_size = uploaded_file.tell()
    uploaded_file.seek(0)  # Reset to start
    
    if file_size == 0:
        return False, "The uploaded file is empty. Please upload a valid PDF file."
    
    if file_size > MAX_PDF_SIZE_BYTES:
        return False, f"File is too large. Maximum size is {MAX_PDF_SIZE_MB}MB. Your file is {file_size / 1024 / 1024:.1f}MB."
    
    return True, ""


def parse_eaf_pdf(uploaded_file: FileStorage) -> list[Event]:
    """Parse EAF PDF and extract scheduled events.
    
    Extracts course codes, course names, sections, and schedule information
    from the PDF text. Handles multiple schedule entries per course.
    
    Args:
        uploaded_file: Flask FileStorage object containing PDF
        
    Returns:
        List of Event objects extracted from PDF
        
    Raises:
        ValueError: If PDF cannot be read or contains no valid events
    """
    try:
        reader = PdfReader(uploaded_file)
    except Exception as exc:
        raise ValueError(f"Could not read PDF file. It may be corrupted or not a valid PDF. Error: {str(exc)}") from exc
    
    if len(reader.pages) == 0:
        raise ValueError("The PDF file has no pages. Please upload a valid EAF PDF.")
    
    try:
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        raise ValueError(f"Could not extract text from PDF. The file may be corrupted. Error: {str(exc)}") from exc
    
    text = text.replace("\r", "")

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
        match = re.match(
            r"^\d+\s+([A-Z0-9]+)-(.+?)\s+(Lecture|Seminar / Workshop)\s+([A-Z0-9]+)\s+([\d.]+)\s+(.*)$",
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
            location = standardize_location(schedule_match.group(4))
            events.append(
                Event(
                    code=code,
                    title=title,
                    course_name=course_name,
                    location_label=location,
                    day=day,
                    start_time=start_time,
                    end_time=end_time,
                    location=location,
                )
            )

    return events


def build_schedule_filename(uploaded_file: FileStorage) -> str:
    """Generate ICS filename from PDF metadata (student ID, term, AY).
    
    Extracts student ID and academic year/term info from PDF to create
    a descriptive filename. Falls back to generic name if metadata not found.
    
    Args:
        uploaded_file: Flask FileStorage object containing PDF
        
    Returns:
        Generated filename for ICS file (e.g., "123456_T2_AY24-25_Schedule.ics")
    """
    try:
        uploaded_file.seek(0)
        reader = PdfReader(uploaded_file)
        text = normalize_text(" ".join(page.extract_text() or "" for page in reader.pages))
    finally:
        try:
            uploaded_file.seek(0)
        except Exception:  # noqa: BLE001
            pass

    student_id_match = re.search(r"STUDENT ID\s*:\s*(\d+)", text)
    session_match = re.search(r"AY\s*(\d{4})-(\d{4}).*?Term\s*(\d+)", text)

    if student_id_match and session_match:
        student_id = student_id_match.group(1)
        start_year = session_match.group(1)
        end_year = session_match.group(2)
        term_number = session_match.group(3)
        academic_year = f"AY{start_year[-2:]}-{end_year[-2:]}"
        return f"{student_id}_T{term_number}_{academic_year}_Schedule.ics"

    return "eaf-calendar.ics"
