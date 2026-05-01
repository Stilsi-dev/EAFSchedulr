"""Utility functions for text processing and time formatting.

Provides helper functions for normalizing text, parsing times, and formatting
dates in various formats (iCalendar, display-friendly, etc.).
"""

import re
from datetime import date, datetime, time, timedelta, timezone

# Timezone for Manila (UTC+8)
APP_TZ: timezone = timezone(timedelta(hours=8), name="PHT")
ICS_TIMEZONE_ID: str = "Asia/Manila"


def normalize_text(value: str) -> str:
    """Normalize whitespace by removing extra spaces and trimming.
    
    Args:
        value: Text to normalize
        
    Returns:
        Normalized text with single spaces and no leading/trailing whitespace
    """
    return re.sub(r"\s+", " ", value).strip()


def standardize_location(value: str) -> str:
    """Standardize location names to consistent format.
    
    Converts to title case and handles special cases like "online".
    Returns "TBA" for empty locations.
    
    Args:
        value: Raw location text
        
    Returns:
        Standardized location name
    """
    cleaned = normalize_text(value)
    if not cleaned:
        return "TBA"
    if cleaned.lower() == "online":
        return "Online"
    return cleaned


def parse_clock(value: str) -> time:
    """Parse 12-hour time format string to time object.
    
    Args:
        value: Time string (e.g., "7:30 AM")
        
    Returns:
        Time object
        
    Raises:
        ValueError: If time format is invalid
    """
    return datetime.strptime(normalize_text(value).upper(), "%I:%M %p").time()


def time_to_minutes(value: time) -> int:
    """Convert time to minutes since midnight.
    
    Args:
        value: Time object
        
    Returns:
        Minutes since midnight
    """
    return value.hour * 60 + value.minute


def minutes_to_time_label(minutes: int) -> str:
    """Convert minutes since midnight to readable 12-hour time label.
    
    Args:
        minutes: Minutes since midnight
        
    Returns:
        Formatted time string (e.g., "7:30 AM")
    """
    hour = (minutes // 60) % 24
    minute = minutes % 60
    suffix = "AM" if hour < 12 else "PM"
    display_hour = hour % 12 or 12
    return f"{display_hour}:{minute:02d} {suffix}"


def round_down_to_slot(minutes: int, slot_minutes: int) -> int:
    """Round down to nearest time slot.
    
    Args:
        minutes: Minutes to round
        slot_minutes: Slot size in minutes
        
    Returns:
        Rounded minutes
    """
    return minutes - (minutes % slot_minutes)


def round_up_to_slot(minutes: int, slot_minutes: int) -> int:
    """Round up to nearest time slot.
    
    Args:
        minutes: Minutes to round
        slot_minutes: Slot size in minutes
        
    Returns:
        Rounded minutes
    """
    return minutes if minutes % slot_minutes == 0 else minutes + (slot_minutes - (minutes % slot_minutes))


def next_weekday_on_or_after(start_date: date, weekday: int) -> date:
    """Find the next occurrence of a weekday on or after a given date.
    
    Args:
        start_date: Starting date
        weekday: Target weekday (0=Monday, 6=Sunday)
        
    Returns:
        First date with target weekday on or after start_date
    """
    delta_days = (weekday - start_date.weekday()) % 7
    return start_date + timedelta(days=delta_days)


def escape_ical_text(value: str) -> str:
    """Escape special characters for iCalendar (RFC 5545) format.
    
    Args:
        value: Text to escape
        
    Returns:
        Escaped text safe for iCalendar format
    """
    return (
        value.replace("\\", "\\\\")
        .replace(";", r"\;")
        .replace(",", r"\,")
        .replace("\n", r"\n")
    )


def format_ical_local_datetime(value: datetime) -> str:
    """Format datetime object for iCalendar local time format.
    
    Args:
        value: DateTime to format
        
    Returns:
        Formatted string (YYYYMMDDTHHMMSS)
    """
    return value.strftime("%Y%m%dT%H%M%S")


def format_display_datetime(value: datetime) -> str:
    """Format datetime object for user-friendly display.
    
    Args:
        value: DateTime to format
        
    Returns:
        Formatted string (e.g., "May 1, 2026 2:30 PM PHT")
    """
    return f"{value:%b} {value.day}, {value:%Y %I:%M %p %Z}"
