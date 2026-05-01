"""Application configuration and constants."""

import re

# Timezone Configuration
ICS_TIMEZONE_ID = "Asia/Manila"

# PDF Configuration
DEFAULT_WEEKS = 14
MAX_PDF_SIZE_MB = 10
MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024

# Recollection Titles
RECOLLECTION_TITLES = {
    "LASARE1": "LASARE1 - LASALLIAN RECOLLECTION 1",
    "LASARE2": "LASARE2 - LASALLIAN RECOLLECTION 2",
    "LASARE3": "LASARE3 - LASALLIAN RECOLLECTION 3",
}

# Day Mappings
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

# Timetable Configuration
TIMETABLE_START_MINUTES = 7 * 60
TIMETABLE_END_MINUTES = 20 * 60
TIMETABLE_SLOT_MINUTES = 30
TIMETABLE_SLOT_HEIGHT = 36

# Schedule Pattern
SCHEDULE_PATTERN = re.compile(
    r"(MON|TUE|WED|THU|FRI|SAT)\s*\|\s*([0-9]{1,2}:[0-9]{2}\s*[AP]M)\s*-\s*([0-9]{1,2}:[0-9]{2}\s*[AP]M)\s*\|\s*([^,]+)",
    re.IGNORECASE,
)
