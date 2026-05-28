"""Application HTTP routes.

Handles user requests for PDF upload, calendar generation, and file download.
Manages CSRF tokens and coordinates between services.
"""

import uuid
from datetime import date, datetime
from io import BytesIO
from typing import Any

from flask import Blueprint, current_app, flash, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.datastructures import FileStorage

from app.extensions import limiter
from app.config import APP_TZ, DEFAULT_WEEKS, RECOLLECTION_TITLES
from app.services.calendar import build_ics, build_timetable_preview, validate_recollection_dates
from app.services.parser import build_schedule_filename, parse_eaf_pdf, validate_pdf_file
from app.utils import format_display_datetime

# Blueprint for all routes
bp = Blueprint("main", __name__)


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


@bp.get("/")
def index() -> str:
    """Render the main page with upload form.
    
    Returns:
        Rendered HTML template
    """
    csrf_token = generate_csrf_token()
    return render_template(
        "index.html",
        events=None,
        download_url=None,
        generated_at=None,
        term_start=date.today().isoformat(),
        weeks=DEFAULT_WEEKS,
        recollection_dates={},
        has_recollection=False,
        visible_recollection_codes=[],
        timetable={},
        csrf_token=csrf_token,
        course_count=0,
    )


@bp.post("/inspect")
@limiter.limit("20 per minute")
def inspect() -> tuple[dict[str, Any], int]:
    """Inspect uploaded PDF and return course and recollection info.
    
    Called via AJAX after PDF upload. Validates and parses the PDF
    to extract course count and recollection codes.
    
    Returns:
        JSON response with course/recollection info or error message
    """
    uploaded_file: FileStorage | None = request.files.get("eaf_pdf")
    content: bytes | None = uploaded_file.read() if uploaded_file else None
    filename: str = (uploaded_file.filename or "") if uploaded_file else ""

    is_valid, error_msg = validate_pdf_file(content, filename)
    if not is_valid:
        return jsonify({"error": error_msg}), 400

    try:
        events, _ = parse_eaf_pdf(content, filename)  # type: ignore[arg-type]
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        return jsonify({"error": "An unexpected error occurred while reading the PDF. Please try a different file."}), 400

    if not events:
        return jsonify({"error": "No scheduled events were found in the uploaded EAF. The file may not be a valid Enrollment Assessment Form."}), 400

    return jsonify(
        {
            "has_recollection": any(event.code in RECOLLECTION_TITLES for event in events),
            "recollection_codes": sorted({event.code for event in events if event.code in RECOLLECTION_TITLES}),
            "recollection_days": {event.code: event.day for event in events if event.code in RECOLLECTION_TITLES},
            "event_count": len(events),
            "course_count": len({event.code for event in events}),
        }
    ), 200


@bp.post("/generate")
@limiter.limit("10 per minute")
def generate() -> tuple[str, int] | str:
    """Generate calendar file from uploaded EAF PDF.
    
    Validates CSRF token, parses PDF, validates inputs, builds ICS file,
    and renders result page with download option.
    
    Returns:
        Rendered template with results or redirect on error
    """
    # Validate CSRF token
    csrf_token = request.form.get("csrf_token", "")
    if not validate_csrf_token(csrf_token):
        flash("Invalid request. Please try again.")
        return redirect(url_for("main.index"))
    
    uploaded_file: FileStorage | None = request.files.get("eaf_pdf")
    content: bytes | None = uploaded_file.read() if uploaded_file else None
    filename: str = (uploaded_file.filename or "") if uploaded_file else ""

    # Validate file
    is_valid, error_msg = validate_pdf_file(content, filename)
    if not is_valid:
        flash(error_msg)
        return redirect(url_for("main.index"))

    # Parse PDF
    try:
        events, metadata = parse_eaf_pdf(content, filename)  # type: ignore[arg-type]
    except ValueError as exc:
        flash(str(exc))
        return redirect(url_for("main.index"))
    except Exception:
        flash("An unexpected error occurred. Please try a different file.")
        return redirect(url_for("main.index"))

    if not events:
        flash("No scheduled events were found in the uploaded EAF. The file may not be a valid Enrollment Assessment Form.")
        return redirect(url_for("main.index"))

    # Parse and validate term dates
    term_start_raw = request.form.get("term_start") or date.today().isoformat()
    weeks_raw = request.form.get("weeks") or str(DEFAULT_WEEKS)

    try:
        term_start = date.fromisoformat(term_start_raw)
    except ValueError:
        flash("Enter a valid term start date in YYYY-MM-DD format.")
        return redirect(url_for("main.index"))

    try:
        weeks = max(1, min(52, int(weeks_raw)))
    except ValueError:
        flash("Weeks must be a whole number.")
        return redirect(url_for("main.index"))

    # Handle recollection dates if needed
    recollection_codes = sorted({event.code for event in events if event.code in RECOLLECTION_TITLES})
    recollection_dates: dict[str, date] = {}
    has_recollection = bool(recollection_codes)
    recollection_count = len(recollection_codes)

    if has_recollection:
        for code in recollection_codes:
            recollection_date_raw = request.form.get(f"recollection_date_{code}") or ""
            if not recollection_date_raw:
                flash(f"Please choose the specific date for {RECOLLECTION_TITLES[code]}.")
                return redirect(url_for("main.index"))

            try:
                recollection_dates[code] = date.fromisoformat(recollection_date_raw)
            except ValueError:
                flash(f"Enter a valid date for {RECOLLECTION_TITLES[code]} in YYYY-MM-DD format.")
                return redirect(url_for("main.index"))

    # Build calendar
    try:
        validate_recollection_dates(events, recollection_dates)
        ics_content = build_ics(events, term_start, weeks, recollection_dates=recollection_dates)
    except ValueError as exc:
        flash(str(exc))
        return redirect(url_for("main.index"))
    
    # Store generated calendar for download
    token = uuid.uuid4().hex
    schedule_filename = build_schedule_filename(metadata)
    current_app.calendar_store.put(token, ics_content, schedule_filename)  # type: ignore[attr-defined]
    generated_at = format_display_datetime(datetime.now(tz=APP_TZ))

    download_url = url_for("main.download_ics", token=token)
    csrf_token = generate_csrf_token()
    return render_template(
        "index.html",
        events=[event.__dict__ for event in events],
        download_url=download_url,
        generated_at=generated_at,
        generated_filename=schedule_filename,
        term_start=term_start.isoformat(),
        weeks=weeks,
        recollection_dates={code: recollection_dates.get(code, date.today()).isoformat() for code in RECOLLECTION_TITLES},
        has_recollection=has_recollection,
        visible_recollection_codes=recollection_codes,
        timetable=build_timetable_preview(events, recollection_dates),
        csrf_token=csrf_token,
        course_count=len({event.code for event in events}),
        event_count=len(events),
        recollection_count=recollection_count,
    )


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
    result = current_app.calendar_store.pop(token)  # type: ignore[attr-defined]
    if result is None:
        flash("Download link expired. Please generate a new calendar.")
        return redirect(url_for("main.index"))

    ics_content, download_name = result
    buffer = BytesIO(ics_content.encode("utf-8"))
    buffer.seek(0)

    return send_file(
        buffer,
        mimetype="text/calendar",
        as_attachment=True,
        download_name=download_name,
    )
