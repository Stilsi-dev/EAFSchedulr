"""Data models for calendar events extracted from EAF PDFs."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Event:
    """Immutable representation of a scheduled event extracted from EAF PDF.

    Attributes:
        code: Course code (e.g., "CS101")
        title: Event title for calendar (e.g., "CS101 SEC-A")
        course_name: Full course name (e.g., "Introduction to Computer Science")
        day: Day of week (MON, TUE, WED, THU, FRI, SAT)
        start_time: Start time in 12-hour format (e.g., "7:30 AM")
        end_time: End time in 12-hour format (e.g., "8:30 AM")
        location: Location string for calendar event
    """
    code: str
    title: str
    course_name: str
    day: str
    start_time: str
    end_time: str
    location: str
