from __future__ import annotations

import re
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

from flask import Flask, abort, flash, jsonify, redirect, render_template, request, send_file, url_for
from pypdf import PdfReader
from io import BytesIO

APP_TZ = timezone(timedelta(hours=8), name="PHT")
ICS_TIMEZONE_ID = "Asia/Manila"
DEFAULT_WEEKS = 14
RECOLLECTION_TITLES = {
    "LASARE1": "LASARE1 - LASALLIAN RECOLLECTION 1",
    "LASARE2": "LASARE2 - LASALLIAN RECOLLECTION 2",
    "LASARE3": "LASARE3 - LASALLIAN RECOLLECTION 3",
}

DAY_TO_WEEKDAY = {
    "MON": 0,
    "TUE": 1,
    "WED": 2,
    "THU": 3,
    "FRI": 4,
    "SAT": 5,
}

DAY_LABELS = {
    "MON": "Monday",
    "TUE": "Tuesday",
    "WED": "Wednesday",
    "THU": "Thursday",
    "FRI": "Friday",
    "SAT": "Saturday",
}

TIMETABLE_START_MINUTES = 7 * 60
TIMETABLE_END_MINUTES = 20 * 60
TIMETABLE_SLOT_MINUTES = 30
TIMETABLE_SLOT_HEIGHT = 36

SCHEDULE_PATTERN = re.compile(
    r"(MON|TUE|WED|THU|FRI|SAT)\s*\|\s*([0-9]{1,2}:[0-9]{2}\s*[AP]M)\s*-\s*([0-9]{1,2}:[0-9]{2}\s*[AP]M)\s*\|\s*([^,]+)",
    re.IGNORECASE,
)

app = Flask(__name__)
app.secret_key = "eaf-to-gcal-secret"

GENERATED_ICS: dict[str, str] = {}
GENERATED_FILENAMES: dict[str, str] = {}


@dataclass(frozen=True)
class Event:
    code: str
    title: str
    course_name: str
    location_label: str
    day: str
    start_time: str
    end_time: str
    location: str


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def standardize_location(value: str) -> str:
    cleaned = normalize_text(value)
    if not cleaned:
        return "TBA"
    if cleaned.lower() == "online":
        return "Online"
    return cleaned


def parse_eaf_pdf(uploaded_file) -> list[Event]:
    reader = PdfReader(uploaded_file)
    text = "\n".join(page.extract_text() or "" for page in reader.pages)
    text = text.replace("\r", "")

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


def build_schedule_filename(uploaded_file) -> str:
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


def parse_clock(value: str) -> time:
    return datetime.strptime(normalize_text(value).upper(), "%I:%M %p").time()


def time_to_minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def minutes_to_time_label(minutes: int) -> str:
    hour = (minutes // 60) % 24
    minute = minutes % 60
    suffix = "AM" if hour < 12 else "PM"
    display_hour = hour % 12 or 12
    return f"{display_hour}:{minute:02d} {suffix}"


def round_down_to_slot(minutes: int, slot_minutes: int) -> int:
    return minutes - (minutes % slot_minutes)


def round_up_to_slot(minutes: int, slot_minutes: int) -> int:
    return minutes if minutes % slot_minutes == 0 else minutes + (slot_minutes - (minutes % slot_minutes))


def next_weekday_on_or_after(start_date: date, weekday: int) -> date:
    delta_days = (weekday - start_date.weekday()) % 7
    return start_date + timedelta(days=delta_days)


def escape_ical_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace(";", r"\;")
        .replace(",", r"\,")
        .replace("\n", r"\n")
    )


def format_ical_local_datetime(value: datetime) -> str:
    return value.strftime("%Y%m%dT%H%M%S")


def format_display_datetime(value: datetime) -> str:
    return f"{value:%b} {value.day}, {value:%Y %I:%M %p %Z}"


def validate_recollection_dates(events: Iterable[Event], recollection_dates: dict[str, date]) -> None:
    for event in events:
        if event.code not in RECOLLECTION_TITLES:
            continue

        recollection_date = recollection_dates.get(event.code)
        if recollection_date is None:
            raise ValueError(f"A specific recollection date is required for {RECOLLECTION_TITLES[event.code]}.")

        if recollection_date.weekday() != DAY_TO_WEEKDAY[event.day]:
            raise ValueError(
                f"{RECOLLECTION_TITLES[event.code]} is scheduled on {DAY_LABELS[event.day]}. Please choose a {DAY_LABELS[event.day]} date."
            )


def fold_ical_line(line: str, max_len: int = 75) -> list[str]:
    if len(line) <= max_len:
        return [line]

    folded_lines = [line[:max_len]]
    index = max_len
    while index < len(line):
        folded_lines.append(" " + line[index:index + (max_len - 1)])
        index += max_len - 1
    return folded_lines


def build_calendar_preview(events: Iterable[Event], recollection_dates: dict[str, date] | None = None) -> list[dict[str, object]]:
    recollection_dates = recollection_dates or {}
    grouped: dict[str, list[dict[str, object]]] = {day: [] for day in DAY_TO_WEEKDAY}

    for event in events:
        grouped[event.day].append(
            {
                "code": event.code,
                "title": event.title,
                "course_name": event.course_name,
                "start_time": event.start_time,
                "end_time": event.end_time,
                "location": event.location,
                "is_recollection": event.code in RECOLLECTION_TITLES,
                "selected_date": recollection_dates.get(event.code).isoformat() if recollection_dates.get(event.code) else None,
            }
        )

    for day_events in grouped.values():
        day_events.sort(key=lambda item: parse_clock(str(item["start_time"])))

    return [
        {
            "key": day,
            "label": DAY_LABELS[day],
            "events": grouped[day],
        }
        for day in DAY_TO_WEEKDAY
    ]


def build_timetable_preview(events: Iterable[Event], recollection_dates: dict[str, date] | None = None) -> dict[str, object]:
    recollection_dates = recollection_dates or {}
    grouped: dict[str, list[dict[str, object]]] = {day: [] for day in DAY_TO_WEEKDAY}
    min_minutes = None
    max_minutes = None

    for event in events:
        start_minutes = time_to_minutes(parse_clock(event.start_time))
        end_minutes = time_to_minutes(parse_clock(event.end_time))
        min_minutes = start_minutes if min_minutes is None else min(min_minutes, start_minutes)
        max_minutes = end_minutes if max_minutes is None else max(max_minutes, end_minutes)
        grouped[event.day].append(
            {
                "code": event.code,
                "title": event.title,
                "course_name": event.course_name,
                "start_time": event.start_time,
                "end_time": event.end_time,
                "location": event.location,
                "is_recollection": event.code in RECOLLECTION_TITLES,
                "selected_date": recollection_dates.get(event.code).isoformat() if recollection_dates.get(event.code) else None,
                "start_minutes": start_minutes,
                "end_minutes": end_minutes,
            }
        )

    start_minutes = round_down_to_slot(min(min_minutes if min_minutes is not None else TIMETABLE_START_MINUTES, TIMETABLE_START_MINUTES), TIMETABLE_SLOT_MINUTES)
    end_minutes = round_up_to_slot(max(max_minutes if max_minutes is not None else TIMETABLE_END_MINUTES, TIMETABLE_START_MINUTES + TIMETABLE_SLOT_MINUTES), TIMETABLE_SLOT_MINUTES)
    if end_minutes <= start_minutes:
        end_minutes = start_minutes + TIMETABLE_SLOT_MINUTES

    span_minutes = end_minutes - start_minutes
    tick_minutes = list(range(start_minutes, end_minutes + 1, 60))

    def assign_overlap_layout(day_events: list[dict[str, object]]) -> None:
        if not day_events:
            return

        ordered = sorted(day_events, key=lambda item: (int(item["start_minutes"]), int(item["end_minutes"])))
        component: list[dict[str, object]] = []
        component_end = -1

        def flush_component(items: list[dict[str, object]]) -> None:
            if not items:
                return

            lanes_end: list[int] = []
            for item in items:
                start_value = int(item["start_minutes"])
                end_value = int(item["end_minutes"])
                lane_index = None
                for index, lane_end in enumerate(lanes_end):
                    if lane_end <= start_value:
                        lane_index = index
                        lanes_end[index] = end_value
                        break
                if lane_index is None:
                    lane_index = len(lanes_end)
                    lanes_end.append(end_value)
                item["lane_index"] = lane_index
            lane_count = max(1, len(lanes_end))
            for item in items:
                item["lane_count"] = lane_count
                item["top_pct"] = ((int(item["start_minutes"]) - start_minutes) / span_minutes) * 100
                item["height_pct"] = max(((int(item["end_minutes"]) - int(item["start_minutes"])) / span_minutes) * 100, 2.5)
                item["left_pct"] = (int(item["lane_index"]) / lane_count) * 100
                item["width_pct"] = 100 / lane_count

        for item in ordered:
            start_value = int(item["start_minutes"])
            end_value = int(item["end_minutes"])
            if not component:
                component = [item]
                component_end = end_value
                continue

            if start_value < component_end:
                component.append(item)
                component_end = max(component_end, end_value)
            else:
                flush_component(component)
                component = [item]
                component_end = end_value

        flush_component(component)

    for day_events in grouped.values():
        assign_overlap_layout(day_events)

    return {
        "start_minutes": start_minutes,
        "end_minutes": end_minutes,
        "span_minutes": span_minutes,
        "slot_height": TIMETABLE_SLOT_HEIGHT,
        "height_px": int((span_minutes / TIMETABLE_SLOT_MINUTES) * TIMETABLE_SLOT_HEIGHT),
        "day_count": len(DAY_TO_WEEKDAY),
        "current_day_key": [day for day, weekday in DAY_TO_WEEKDAY.items() if weekday == date.today().weekday()][0] if date.today().weekday() in DAY_TO_WEEKDAY.values() else None,
        "ticks": [
            {
                "top_pct": ((minute - start_minutes) / span_minutes) * 100,
                "label": minutes_to_time_label(minute),
            }
            for minute in tick_minutes
        ],
        "days": [
            {
                "key": day,
                "label": DAY_LABELS[day],
                "events": grouped[day],
            }
            for day in DAY_TO_WEEKDAY
        ],
    }


def build_ics(
    events: Iterable[Event],
    term_start: date,
    weeks: int,
    recollection_dates: dict[str, date] | None = None,
) -> str:
    now = datetime.utcnow()
    recollection_dates = recollection_dates or {}
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "BEGIN:VTIMEZONE",
        f"TZID:{ICS_TIMEZONE_ID}",
        "BEGIN:STANDARD",
        "DTSTART:19700101T000000",
        "TZOFFSETFROM:+0800",
        "TZOFFSETTO:+0800",
        "TZNAME:PHT",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]

    for event in events:
        if event.code in RECOLLECTION_TITLES:
            recollection_date = recollection_dates.get(event.code)
            if recollection_date is None:
                raise ValueError(f"A specific recollection date is required for {RECOLLECTION_TITLES[event.code]}.")

            start_clock = parse_clock(event.start_time)
            end_clock = parse_clock(event.end_time)
            start_dt = datetime.combine(recollection_date, start_clock)
            end_dt = datetime.combine(recollection_date, end_clock)
            uid = uuid.uuid4()
            lines.extend(
                [
                    "BEGIN:VEVENT",
                    f"UID:{uid}",
                    f"DTSTAMP:{now.strftime('%Y%m%dT%H%M%SZ')}",
                    f"DTSTART;TZID={ICS_TIMEZONE_ID}:{format_ical_local_datetime(start_dt)}",
                    f"DTEND;TZID={ICS_TIMEZONE_ID}:{format_ical_local_datetime(end_dt)}",
                    f"SUMMARY:{escape_ical_text(event.title)}",
                    f"LOCATION:{escape_ical_text(event.location)}",
                    "END:VEVENT",
                ]
            )
            continue

        weekday = DAY_TO_WEEKDAY[event.day]
        RRULE_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
        byday = RRULE_DAYS[weekday]
        first_date = next_weekday_on_or_after(term_start, weekday)
        start_clock = parse_clock(event.start_time)
        end_clock = parse_clock(event.end_time)
        start_dt = datetime.combine(first_date, start_clock)
        end_dt = datetime.combine(first_date, end_clock)
        uid = uuid.uuid4()
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTAMP:{now.strftime('%Y%m%dT%H%M%SZ')}",
                f"DTSTART;TZID={ICS_TIMEZONE_ID}:{format_ical_local_datetime(start_dt)}",
                f"DTEND;TZID={ICS_TIMEZONE_ID}:{format_ical_local_datetime(end_dt)}",
                f"RRULE:FREQ=WEEKLY;WKST=SU;COUNT={weeks};BYDAY={byday}",
                f"SUMMARY:{escape_ical_text(event.title)}",
                f"LOCATION:{escape_ical_text(event.location)}",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    folded_lines: list[str] = []
    for line in lines:
        folded_lines.extend(fold_ical_line(line))
    return "\r\n".join(folded_lines) + "\r\n"


@app.get("/")
def index():
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
    )


@app.post("/inspect")
def inspect():
    uploaded_file = request.files.get("eaf_pdf")
    if uploaded_file is None or uploaded_file.filename == "":
        return jsonify({"error": "Upload an EAF PDF first."}), 400

    if not uploaded_file.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Please upload a PDF file."}), 400

    try:
        events = parse_eaf_pdf(uploaded_file)
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Could not read the PDF: {exc}"}), 400

    return jsonify(
        {
            "has_recollection": any(event.code in RECOLLECTION_TITLES for event in events),
            "recollection_codes": sorted({event.code for event in events if event.code in RECOLLECTION_TITLES}),
            "recollection_days": {event.code: event.day for event in events if event.code in RECOLLECTION_TITLES},
            "event_count": len(events),
        }
    )


@app.post("/generate")
def generate():
    uploaded_file = request.files.get("eaf_pdf")
    if uploaded_file is None or uploaded_file.filename == "":
        flash("Upload an EAF PDF before generating a calendar.")
        return redirect(url_for("index"))

    if not uploaded_file.filename.lower().endswith(".pdf"):
        flash("Please upload a PDF file.")
        return redirect(url_for("index"))

    try:
        events = parse_eaf_pdf(uploaded_file)
    except Exception as exc:  # noqa: BLE001
        flash(f"Could not read the PDF: {exc}")
        return redirect(url_for("index"))

    if not events:
        flash("No scheduled events were found in the uploaded EAF.")
        return redirect(url_for("index"))

    term_start_raw = request.form.get("term_start") or date.today().isoformat()
    weeks_raw = request.form.get("weeks") or str(DEFAULT_WEEKS)

    try:
        term_start = date.fromisoformat(term_start_raw)
    except ValueError:
        flash("Enter a valid term start date in YYYY-MM-DD format.")
        return redirect(url_for("index"))

    try:
        weeks = max(1, min(52, int(weeks_raw)))
    except ValueError:
        flash("Weeks must be a whole number.")
        return redirect(url_for("index"))

    recollection_codes = sorted({event.code for event in events if event.code in RECOLLECTION_TITLES})
    recollection_dates: dict[str, date] = {}
    has_recollection = bool(recollection_codes)

    if has_recollection:
        for code in recollection_codes:
            recollection_date_raw = request.form.get(f"recollection_date_{code}") or ""
            if not recollection_date_raw:
                flash(f"Please choose the specific date for {RECOLLECTION_TITLES[code]}.")
                return redirect(url_for("index"))

            try:
                recollection_dates[code] = date.fromisoformat(recollection_date_raw)
            except ValueError:
                flash(f"Enter a valid date for {RECOLLECTION_TITLES[code]} in YYYY-MM-DD format.")
                return redirect(url_for("index"))

    try:
        validate_recollection_dates(events, recollection_dates)
        ics_content = build_ics(events, term_start, weeks, recollection_dates=recollection_dates)
    except ValueError as exc:
        flash(str(exc))
        return redirect(url_for("index"))
    token = uuid.uuid4().hex
    GENERATED_ICS[token] = ics_content
    GENERATED_FILENAMES[token] = build_schedule_filename(uploaded_file)
    generated_at = format_display_datetime(datetime.now(tz=APP_TZ))

    download_url = url_for("download_ics", token=token)
    return render_template(
        "index.html",
        events=[event.__dict__ for event in events],
        download_url=download_url,
        generated_at=generated_at,
        term_start=term_start.isoformat(),
        weeks=weeks,
        recollection_dates={code: recollection_dates.get(code, date.today()).isoformat() for code in RECOLLECTION_TITLES},
        has_recollection=has_recollection,
        visible_recollection_codes=recollection_codes,
        timetable=build_timetable_preview(events, recollection_dates),
    )


@app.get("/download/<token>")
def download_ics(token: str):
    ics_content = GENERATED_ICS.get(token)
    if ics_content is None:
        abort(404)

    download_name = GENERATED_FILENAMES.get(token, "eaf-calendar.ics")
    buffer = BytesIO(ics_content.encode("utf-8"))
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="text/calendar",
        as_attachment=True,
        download_name=download_name,
    )


if __name__ == "__main__":
    app.run(debug=True)
