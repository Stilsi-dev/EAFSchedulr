"""Application HTTP routes.

Handles user requests for PDF upload, calendar generation, and file download.
Manages CSRF tokens and coordinates between services.
"""

from datetime import date, datetime
from io import BytesIO
from typing import Any

from flask import Blueprint, current_app, flash, jsonify, redirect, request, send_file, url_for
from werkzeug.datastructures import FileStorage

from app.config import DEFAULT_WEEKS, RECOLLECTION_TITLES
from app.extensions import limiter
from app.token_store import create as create_token, consume as consume_token
from app.services.calendar import build_ics, build_timetable_preview, validate_recollection_dates
from app.services.parser import parse_eaf_pdf, validate_pdf_file
from app.utils import format_display_datetime, APP_TZ

# Blueprint for all routes
bp = Blueprint("main", __name__)


def log_parse_shape(endpoint: str, parsed) -> None:
    """Record the *shape* of a parse, never its content.

    Counts and course codes only - enough that a change to the Archers Hub EAF
    format shows up as a spike in unreadable rows, with nothing that identifies
    a student or discloses their schedule.
    """
    current_app.logger.info(
        "parse endpoint=%s events=%d courses=%d ambiguous=%d metadata_matched=%s",
        endpoint,
        len(parsed.events),
        len({event.code for event in parsed.events}),
        len(parsed.ambiguous_rows),
        parsed.suggested_filename != "eaf-calendar.ics",
    )
    if parsed.ambiguous_rows:
        current_app.logger.warning(
            "unreadable rows endpoint=%s count=%d codes=%s",
            endpoint,
            len(parsed.ambiguous_rows),
            sorted({row.code for row in parsed.ambiguous_rows}),
        )
    if not parsed.events:
        current_app.logger.warning(
            "no events parsed endpoint=%s ambiguous=%d", endpoint, len(parsed.ambiguous_rows)
        )


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
    return send_file(
        current_app.static_folder + "/index.html",
        mimetype="text/html"
    )


@bp.post("/inspect")
@limiter.limit("20 per minute")
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
        current_app.logger.warning("inspect rejected PDF: %s", exc)
        return jsonify({"error": str(exc)}), 400
    except Exception:
        current_app.logger.exception("inspect failed unexpectedly while reading PDF")
        return jsonify({"error": "An unexpected error occurred while reading the PDF. Please ensure you uploaded a valid EAF PDF."}), 400

    log_parse_shape("inspect", parsed)

    if not events:
        # Return the unreadable rows too: when nothing parses, they are the
        # only thing the student can send us to get the format fixed.
        return jsonify(
            {
                "error": "No scheduled events were found in the uploaded EAF. The file may not be a valid Enrollment Assessment Form.",
                "ambiguous_rows": [ar.__dict__ for ar in ambiguous_rows],
            }
        ), 400

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
            "generated_filename": parsed.suggested_filename,
            "event_count": len(events),
            "course_count": len({event.code for event in events}),
        }
    ), 200


@bp.post("/generate")
@limiter.limit("20 per minute")
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
        current_app.logger.warning("generate rejected PDF: %s", exc)
        if wants_json:
            return json_error(str(exc))
        flash(str(exc))
        return redirect(url_for("main.index"))
    except Exception:
        current_app.logger.exception("generate failed unexpectedly while reading PDF")
        if wants_json:
            return json_error("An unexpected error occurred. Please ensure you uploaded a valid EAF PDF.")
        flash("An unexpected error occurred. Please ensure you uploaded a valid EAF PDF.")
        return redirect(url_for("main.index"))

    log_parse_shape("generate", parsed)

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
    token = create_token(ics_content, parsed.suggested_filename)
    generated_at = format_display_datetime(datetime.now(tz=APP_TZ))

    if uploaded_file:
        try:
            uploaded_file.close()
        except Exception:  # noqa: BLE001
            pass

    download_url = url_for("main.download_ics", token=token)
    generated_filename = parsed.suggested_filename

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
    # The app fetches this endpoint rather than navigating to it, so a refusal
    # has to arrive in a form it can read. The redirect below would be followed
    # to the shell, whose 200 the client would take for success, and the flash
    # it carries has nothing to render it: `index` serves a static file, not a
    # template. Kept for plain navigation, which is the only caller that could
    # ever have benefited from it.
    wants_json = "application/json" in request.headers.get("Accept", "")

    result = consume_token(token)
    if result is None:
        if wants_json:
            return jsonify(
                {"error": "That download link expired. Create the schedule again."}
            ), 410
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
