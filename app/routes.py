"""Application HTTP routes.

Handles user requests for PDF upload, calendar generation, and file download.
Manages CSRF tokens and coordinates between services.
"""

import uuid
from datetime import date, datetime
from io import BytesIO
from typing import Any

from flask import Blueprint, flash, jsonify, redirect, request, send_file, session, url_for
from werkzeug.datastructures import FileStorage

from app.config import DEFAULT_WEEKS, RECOLLECTION_TITLES
from app.services.calendar import build_ics, build_timetable_preview, validate_recollection_dates
from app.services.parser import build_schedule_filename, parse_eaf_pdf, validate_pdf_file
from app.utils import format_display_datetime, APP_TZ

# Blueprint for all routes
bp = Blueprint("main", __name__)

# Storage for generated ICS files (simple in-memory cache)
# Maps temporary token -> ICS content
GENERATED_ICS: dict[str, str] = {}
# Maps temporary token -> downloaded filename
GENERATED_FILENAMES: dict[str, str] = {}


def generate_csrf_token() -> str:
    """Generate and store a CSRF token in the user's session.
    
    Creates a new token if one doesn't exist, or returns the existing token.
    
    Returns:
        CSRF token string (UUID hex)
    """
    if "csrf_token" not in session:
        session["csrf_token"] = uuid.uuid4().hex
    return session["csrf_token"]


def validate_csrf_token(token: str) -> bool:
    """Validate a CSRF token against the session token.
    
    Args:
        token: Token to validate (from form submission)
        
    Returns:
        True if token matches session token, False otherwise
    """
    return token == session.get("csrf_token")


def format_recollection_summary(recollection_dates: dict[str, date]) -> list[str]:
    """Return human-readable recollection lines for the result summary."""
    return [
        f"{code} - {recollection_date:%A, %B} {recollection_date.day}, {recollection_date:%Y}"
        for code, recollection_date in sorted(recollection_dates.items())
    ]


@bp.get("/")
def index():
    """Serve the main React app HTML.
    
    Returns:
        The index.html file from the public directory
    """
    from flask import current_app
    return send_file(
        current_app.static_folder + "/index.html",
        mimetype="text/html"
    )


@bp.post("/inspect")
def inspect() -> Any:
    """Inspect uploaded PDF and return course and recollection info.
    
    Called via AJAX after PDF upload. Validates and parses the PDF
    to extract course count and recollection codes.
    
    Returns:
        JSON response with course/recollection info or error message
    """
    uploaded_file: FileStorage | None = request.files.get("eaf_pdf")
    
    is_valid, error_msg = validate_pdf_file(uploaded_file)
    if not is_valid:
        return jsonify({"error": error_msg}), 400

    # At this point `uploaded_file` is guaranteed non-None by validation above;
    # tell the type checker this so functions that require FileStorage accept it.
    assert uploaded_file is not None

    try:
        parsed = parse_eaf_pdf(uploaded_file)
        events = parsed.events
        ambiguous_rows = parsed.ambiguous_rows
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": f"An unexpected error occurred while reading the PDF: {str(exc)}"}), 400

    if not events:
        return jsonify({"error": "No scheduled events were found in the uploaded EAF. The file may not be a valid Enrollment Assessment Form."}), 400

    # Build recollection mappings: codes -> list of unique days
    recollection_map: dict[str, list[str]] = {}
    for ev in events:
        if ev.code in RECOLLECTION_TITLES:
            recollection_map.setdefault(ev.code, [])
            if ev.day not in recollection_map[ev.code]:
                recollection_map[ev.code].append(ev.day)

    # Serialize events and mark recollection flags for the frontend
    serialized_events = []
    for ev in events:
        d = ev.__dict__.copy()
        d["is_recollection"] = ev.code in RECOLLECTION_TITLES
        serialized_events.append(d)

    return jsonify(
        {
            "has_recollection": any(ev["is_recollection"] for ev in serialized_events),
            "recollection_codes": sorted(list(recollection_map.keys())),
            "recollection_days": recollection_map,
            "events": serialized_events,
            "ambiguous_rows": [ar.__dict__ for ar in ambiguous_rows],
            "generated_filename": build_schedule_filename(uploaded_file),
            "event_count": len(events),
            "course_count": len({event.code for event in events}),
        }
    ), 200


@bp.post("/generate")
def generate() -> Any:
    """Generate calendar file from uploaded EAF PDF.
    
    Validates CSRF token, parses PDF, validates inputs, builds ICS file,
    and renders result page with download option.
    
    Returns:
        Rendered template with results or redirect on error
    """
    wants_json = "application/json" in request.headers.get("Accept", "")

    def json_error(message: str, status_code: int = 400) -> tuple[dict[str, str], int]:
        return jsonify({"error": message}), status_code

    # Validate CSRF token for the legacy server-rendered form. The React UI
    # posts with an Accept: application/json header and receives JSON instead.
    csrf_token = request.form.get("csrf_token", "")
    if not wants_json and not validate_csrf_token(csrf_token):
        flash("Invalid request. Please try again.")
        return redirect(url_for("main.index"))
    
    uploaded_file: FileStorage | None = request.files.get("eaf_pdf")
    
    # Validate file
    is_valid, error_msg = validate_pdf_file(uploaded_file)
    if not is_valid:
        if wants_json:
            return json_error(error_msg)
        flash(error_msg)
        return redirect(url_for("main.index"))

    # Ensure static type checkers know uploaded_file is present after validation
    assert uploaded_file is not None

    # Parse PDF
    try:
        parsed = parse_eaf_pdf(uploaded_file)
        events = parsed.events
        ambiguous_rows = parsed.ambiguous_rows
    except ValueError as exc:
        if wants_json:
            return json_error(str(exc))
        flash(str(exc))
        return redirect(url_for("main.index"))
    except Exception as exc:
        if wants_json:
            return json_error(f"An unexpected error occurred: {str(exc)}")
        flash(f"An unexpected error occurred: {str(exc)}")
        return redirect(url_for("main.index"))

    if not events:
        if wants_json:
            return json_error("No scheduled events were found in the uploaded EAF. The file may not be a valid Enrollment Assessment Form.")
        flash("No scheduled events were found in the uploaded EAF. The file may not be a valid Enrollment Assessment Form.")
        return redirect(url_for("main.index"))

    # Parse and validate term dates
    term_start_raw = request.form.get("term_start") or date.today().isoformat()
    weeks_raw = request.form.get("weeks") or str(DEFAULT_WEEKS)

    try:
        term_start = date.fromisoformat(term_start_raw)
    except ValueError:
        if wants_json:
            return json_error("Enter a valid term start date in YYYY-MM-DD format.")
        flash("Enter a valid term start date in YYYY-MM-DD format.")
        return redirect(url_for("main.index"))

    try:
        weeks = max(1, min(52, int(weeks_raw)))
    except ValueError:
        if wants_json:
            return json_error("Weeks must be a whole number.")
        flash("Weeks must be a whole number.")
        return redirect(url_for("main.index"))

    # Handle recollection dates if needed
    recollection_codes = sorted({event.code for event in events if event.code in RECOLLECTION_TITLES})
    recollection_dates: dict[str, date] = {}
    has_recollection = bool(recollection_codes)

    if has_recollection:
        for code in recollection_codes:
            recollection_date_raw = request.form.get(f"recollection_date_{code}") or ""
            if not recollection_date_raw:
                if wants_json:
                    return json_error(f"Please choose the specific date for {RECOLLECTION_TITLES[code]}.")
                flash(f"Please choose the specific date for {RECOLLECTION_TITLES[code]}.")
                return redirect(url_for("main.index"))

            try:
                recollection_dates[code] = date.fromisoformat(recollection_date_raw)
            except ValueError:
                if wants_json:
                    return json_error(f"Enter a valid date for {RECOLLECTION_TITLES[code]} in YYYY-MM-DD format.")
                flash(f"Enter a valid date for {RECOLLECTION_TITLES[code]} in YYYY-MM-DD format.")
                return redirect(url_for("main.index"))

    # Build calendar
    try:
        validate_recollection_dates(events, recollection_dates)
        ics_content = build_ics(events, term_start, weeks, recollection_dates=recollection_dates)
    except ValueError as exc:
        if wants_json:
            return json_error(str(exc))
        flash(str(exc))
        return redirect(url_for("main.index"))
  
    # Store generated calendar for download
    token = uuid.uuid4().hex
    GENERATED_ICS[token] = ics_content
    GENERATED_FILENAMES[token] = build_schedule_filename(uploaded_file)
    generated_at = format_display_datetime(datetime.now(tz=APP_TZ))

    if uploaded_file:
        try:
            uploaded_file.close()
        except Exception:  # noqa: BLE001
            pass

    download_url = url_for("main.download_ics", token=token)
    generated_filename = GENERATED_FILENAMES[token]

    # Always return JSON for the React app to handle the UI
    return jsonify(
        {
            "download_url": download_url,
            "generated_filename": generated_filename,
            "generated_at": generated_at,
            "events": [event.__dict__ for event in events],
            "term_start": term_start.isoformat(),
            "weeks": weeks,
            "recollection_dates": {code: recollection_dates.get(code, date.today()).isoformat() for code in RECOLLECTION_TITLES},
            "has_recollection": has_recollection,
            "visible_recollection_codes": recollection_codes,
            "recollection_summary": format_recollection_summary(recollection_dates),
            "timetable": build_timetable_preview(events, recollection_dates),
            "course_count": len({event.code for event in events}),
            "event_count": len(events),
        }
    ), 200


@bp.get("/download/<token>")
def download_ics(token: str):
    """Download generated ICS calendar file.
    
    Retrieves the previously generated ICS file by token, serves it
    as an attachment, then deletes it from storage.
    
    Args:
        token: Temporary token identifying the calendar file
        
    Returns:
        File download response or redirect if token invalid/expired
    """
    ics_content = GENERATED_ICS.get(token)
    if ics_content is None:
        flash("Download link expired. Please generate a new calendar.")
        return redirect(url_for("main.index"))

    download_name = GENERATED_FILENAMES.get(token, "eaf-calendar.ics")
    buffer = BytesIO(ics_content.encode("utf-8"))
    buffer.seek(0)
    
    def cleanup() -> None:
        """Remove token and ICS content from storage."""
        GENERATED_ICS.pop(token, None)
        GENERATED_FILENAMES.pop(token, None)
    
    try:
        response = send_file(
            buffer,
            mimetype="text/calendar",
            as_attachment=True,
            download_name=download_name,
        )
    finally:
        cleanup()
    
    return response
