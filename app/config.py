"""Application configuration and constants."""

# Timezone Configuration
ICS_TIMEZONE_ID = "Asia/Manila"

# PDF Configuration
DEFAULT_WEEKS = 14
MAX_PDF_SIZE_MB = 10
MAX_PDF_SIZE_BYTES = MAX_PDF_SIZE_MB * 1024 * 1024

# Hard request cap enforced by Werkzeug before the view runs. Deliberately a
# little above MAX_PDF_SIZE_BYTES: a file just over the limit should get the
# specific "File is too large" message, not an opaque 413.
MAX_UPLOAD_SIZE_BYTES = MAX_PDF_SIZE_BYTES + 2 * 1024 * 1024

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
