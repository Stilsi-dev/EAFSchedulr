"""PDF parsing service for extracting events from EAF files.

Handles PDF validation, text extraction, and event parsing from
De La Salle University Enrollment Assessment Forms.
"""

from dataclasses import dataclass
import re

from pypdf import PdfReader
from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

from app.config import MAX_PDF_SIZE_BYTES, MAX_PDF_SIZE_MB
from app.models import Event
from app.utils import normalize_text, standardize_location


@dataclass(frozen=True)
class AmbiguousRow:
    """A parsed row that could not be mapped confidently to a course meeting."""

    code: str
    row_number: int
    text: str
    reason: str


@dataclass(frozen=True)
class ParsedEAF:
    """Result of parsing an EAF PDF."""

    events: list[Event]
    ambiguous_rows: list[AmbiguousRow]
    suggested_filename: str


# The course type is a field to step over, not a list to keep up with. It was
# an alternation of the four types we happened to have seen, so the first EAF
# using a fifth failed the whole row and handed a real class back to the
# student to enter by hand. "Research / Capstone" had already been bolted on
# that way; "Practicum / Internship" was the next one.
#
# Nothing downstream reads the type, so the pattern's only job is to cross the
# field without eating the course name in front of it. Course names come out of
# the PDF upper case and types come out title case, so a title-case run is the
# boundary - which still leaves a row with no type at all failing, as it should.
COURSE_TYPE = r"[A-Z][a-z]+(?:\s*/\s*[A-Z][a-z]+|\s+[A-Z][a-z]+)*"

COURSE_ROW_PATTERN = re.compile(
    r"^\d+\s+([A-Z0-9]+)-(.+?)\s+"
    rf"({COURSE_TYPE})\s+"
    r"([A-Z0-9]+)\s+([\d.]+)\s+(.*)$"
)

# The location group excludes `|` deliberately. With `[^,]*` a new
# pipe-delimited column (e.g. a modality field) would be absorbed into the
# room silently; excluding it makes the row fail instead, so the user is
# told what could not be read rather than handed a wrong room.
SCHEDULE_SEGMENT_PATTERN = re.compile(
    r"^(MON|TUE|WED|THU|FRI|SAT)\s*\|\s*"
    r"([0-9]{1,2}:[0-9]{2}\s*[AP]M)\s*-\s*"
    r"([0-9]{1,2}:[0-9]{2}\s*[AP]M)"
    r"(?:\s*\|\s*([^,|]*))?\s*$",
    re.IGNORECASE,
)


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
    
    filename = secure_filename(uploaded_file.filename or "")
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

    # Verify PDF magic bytes to reject non-PDF files with a .pdf extension
    magic = uploaded_file.read(5)
    uploaded_file.seek(0)
    if magic != b"%PDF-":
        return False, "The uploaded file does not appear to be a valid PDF."

    return True, ""


def parse_eaf_pdf(uploaded_file: FileStorage) -> ParsedEAF:
    """Parse EAF PDF and extract scheduled events.
    
    Extracts course codes, course names, sections, and schedule information
    from the PDF text. Handles multiple schedule entries per course.
    
    Args:
        uploaded_file: Flask FileStorage object containing PDF
        
    Returns:
        ParsedEAF object with extracted events and ambiguous rows
        
    Raises:
        ValueError: If PDF cannot be read or contains no valid events
    """
    try:
        reader = PdfReader(uploaded_file.stream)
    except Exception as exc:
        raise ValueError("Could not read PDF file. It may be corrupted or not a valid PDF.") from exc
    
    if len(reader.pages) == 0:
        raise ValueError("The PDF file has no pages. Please upload a valid EAF PDF.")
    
    try:
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as exc:
        raise ValueError("Could not extract text from PDF. The file may be corrupted.") from exc
    
    return parse_eaf_text(text)


def parse_eaf_text(text: str) -> ParsedEAF:
    """Extract events from already-extracted EAF text.

    Split out from `parse_eaf_pdf` so the parsing rules can be exercised
    against plain-text fixtures, without committing PDFs (and the personal
    data inside them) to the repository.

    Args:
        text: Raw text extracted from an EAF PDF

    Returns:
        ParsedEAF object with extracted events and ambiguous rows
    """
    text = text.replace("\r", "")

    # Build suggested filename from student ID and session metadata
    filename_text = normalize_text(text.replace("\n", " "))
    student_id_match = re.search(r"STUDENT ID\s*:\s*(\d+)", filename_text)
    session_match = re.search(r"AY\s*(\d{4})-(\d{4}).*?Term\s*(\d+)", filename_text)
    if student_id_match and session_match:
        student_id = student_id_match.group(1)
        start_year = session_match.group(1)
        end_year = session_match.group(2)
        term_number = session_match.group(3)
        academic_year = f"AY{start_year[-2:]}-{end_year[-2:]}"
        suggested_filename = f"{student_id}_T{term_number}_{academic_year}_Schedule.ics"
    else:
        suggested_filename = "eaf-calendar.ics"

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
    ambiguous_rows: list[AmbiguousRow] = []

    for row_number, row in enumerate(rows, start=1):
        match = COURSE_ROW_PATTERN.fullmatch(row)
        if match is None:
            code_match = re.match(r"^\d+\s+([A-Z0-9]+)-", row)
            ambiguous_rows.append(
                AmbiguousRow(
                    code=code_match.group(1) if code_match else "UNKNOWN",
                    row_number=row_number,
                    text=row,
                    reason="The row did not match the expected course format.",
                )
            )
            continue

        code = normalize_text(match.group(1))
        course_name = normalize_text(match.group(2))
        section = normalize_text(match.group(4))
        schedule_text = normalize_text(match.group(6))
        title = f"{code} {section}"

        schedule_segments = [segment.strip() for segment in schedule_text.split(",") if segment.strip()]
        parsed_events: list[Event] = []
        invalid_segment = None

        for schedule_segment in schedule_segments:
            schedule_match = SCHEDULE_SEGMENT_PATTERN.fullmatch(schedule_segment)
            if schedule_match is None:
                invalid_segment = schedule_segment
                break

            day = schedule_match.group(1).upper()
            start_time = normalize_text(schedule_match.group(2).upper())
            end_time = normalize_text(schedule_match.group(3).upper())
            location = standardize_location(schedule_match.group(4) or "")
            parsed_events.append(
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

        if invalid_segment is not None or not parsed_events:
            ambiguous_rows.append(
                AmbiguousRow(
                    code=code,
                    row_number=row_number,
                    text=row,
                    reason=(
                        "Could not confidently parse the schedule fragment: "
                        f"{invalid_segment}"
                        if invalid_segment is not None
                        else "The row did not include any recognizable meeting times."
                    ),
                )
            )
            continue

        events.extend(parsed_events)

    return ParsedEAF(events=events, ambiguous_rows=ambiguous_rows, suggested_filename=suggested_filename)
