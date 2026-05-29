"""Calendar service for building ICS files and preview formats.

Provides functions for validating recollection dates, generating iCalendar
files in RFC 5545 format, and building preview data for UI display.
"""

from collections.abc import Iterable
from datetime import date, datetime, timezone
import uuid

from app.config import (
    DAY_LABELS,
    DAY_TO_WEEKDAY,
    ICS_TIMEZONE_ID,
    RECOLLECTION_TITLES,
    TIMETABLE_SLOT_HEIGHT,
    TIMETABLE_SLOT_MINUTES,
    TIMETABLE_START_MINUTES,
    TIMETABLE_END_MINUTES,
)
from app.models import Event
from app.utils import (
    escape_ical_text,
    format_ical_local_datetime,
    minutes_to_time_label,
    next_weekday_on_or_after,
    parse_clock,
    round_down_to_slot,
    round_up_to_slot,
    time_to_minutes,
)


def get_recollection_day_options(events: Iterable[Event]) -> dict[str, set[str]]:
    """Collect the weekday codes seen for each recollection course code."""
    day_options: dict[str, set[str]] = {}

    for event in events:
        if event.code not in RECOLLECTION_TITLES:
            continue

        day_options.setdefault(event.code, set()).add(event.day.strip().upper())

    return day_options


def validate_recollection_dates(
    events: Iterable[Event],
    recollection_dates: dict[str, date]
) -> None:
    """Validate that recollection dates match their scheduled weekdays.
    
    Ensures that selected recollection dates fall on the correct day of week
    (e.g., if LASARE1 is scheduled on Friday, selected date must be Friday).
    
    Args:
        events: Events to validate
        recollection_dates: Mapping of course code to selected date
        
    Raises:
        ValueError: If date doesn't match weekday or date is missing
    """
    for code, expected_days in get_recollection_day_options(events).items():
        recollection_date = recollection_dates.get(code)
        if recollection_date is None:
            raise ValueError(f"A specific recollection date is required for {RECOLLECTION_TITLES[code]}.")

        allowed_weekdays = {
            DAY_TO_WEEKDAY[day]
            for day in expected_days
            if day in DAY_TO_WEEKDAY
        }
        if allowed_weekdays and recollection_date.weekday() not in allowed_weekdays:
            allowed_labels = ", ".join(
                DAY_LABELS[day]
                for day in sorted(expected_days, key=lambda day: DAY_TO_WEEKDAY.get(day, 99))
                if day in DAY_LABELS
            )
            raise ValueError(
                f"{RECOLLECTION_TITLES[code]} is scheduled on {allowed_labels}. Please choose a {allowed_labels} date."
            )


def fold_ical_line(line: str, max_len: int = 75) -> list[str]:
    """Fold long iCalendar lines to RFC 5545 compliance (max 75 chars per line).
    
    iCalendar format requires lines longer than 75 bytes to be split
    with continuation lines starting with a space.
    
    Args:
        line: Line to fold
        max_len: Maximum line length (default: 75 per RFC 5545)
        
    Returns:
        List of folded lines
    """
    if len(line) <= max_len:
        return [line]

    folded_lines = [line[:max_len]]
    index = max_len
    while index < len(line):
        folded_lines.append(" " + line[index:index + (max_len - 1)])
        index += max_len - 1
    return folded_lines



def build_timetable_preview(
    events: Iterable[Event],
    recollection_dates: dict[str, date] | None = None
) -> dict[str, object]:
    """Build timetable preview with calculated positions for visual layout.
    
    Computes pixel positions, heights, and lane assignments for event
    boxes to handle overlapping events. Used for timetable grid display.
    
    Args:
        events: Events to render
        recollection_dates: Optional mapping of recollection dates
        
    Returns:
        Dictionary containing timetable metadata and positioned events
    """
    recollection_dates = recollection_dates or {}
    grouped: dict[str, list[dict[str, object]]] = {day: [] for day in DAY_TO_WEEKDAY}
    min_minutes = None
    max_minutes = None

    # Group events by day and calculate minutes
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

    # Calculate timetable bounds
    start_minutes = round_down_to_slot(
        min(min_minutes if min_minutes is not None else TIMETABLE_START_MINUTES, TIMETABLE_START_MINUTES),
        TIMETABLE_SLOT_MINUTES
    )
    end_minutes = round_up_to_slot(
        max(max_minutes if max_minutes is not None else TIMETABLE_END_MINUTES, TIMETABLE_START_MINUTES + TIMETABLE_SLOT_MINUTES),
        TIMETABLE_SLOT_MINUTES
    )
    if end_minutes <= start_minutes:
        end_minutes = start_minutes + TIMETABLE_SLOT_MINUTES

    span_minutes = end_minutes - start_minutes
    tick_minutes = list(range(start_minutes, end_minutes + 1, 60))

    def assign_overlap_layout(day_events: list[dict[str, object]]) -> None:
        """Assign lane indices and calculate CSS percentages for overlapping events."""
        if not day_events:
            return

        ordered = sorted(day_events, key=lambda item: (int(item["start_minutes"]), int(item["end_minutes"])))
        component: list[dict[str, object]] = []
        component_end = -1

        def flush_component(items: list[dict[str, object]]) -> None:
            """Process a group of overlapping events and assign lanes."""
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
        "current_day_key": next(
            (day for day, weekday in DAY_TO_WEEKDAY.items()
            if weekday == date.today().weekday()),
            None
        ),
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
    """Build RFC 5545 iCalendar file content.
    
    Generates an ICS file with recurring weekly events for regular courses
    and one-time events for recollections. Includes Manila timezone info.
    
    Args:
        events: Events to include
        term_start: First day of term (used for recurrence calculation)
        weeks: Number of weeks to generate recurring events for
        recollection_dates: Optional specific dates for recollection events
        
    Returns:
        Complete iCalendar file as string (RFC 5545 format)
        
    Raises:
        ValueError: If recollection dates are required but missing
    """
    now = datetime.now(timezone.utc)
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
            # One-time recollection event on specific date
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

        # Recurring weekly event
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
