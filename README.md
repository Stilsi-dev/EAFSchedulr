# EAF Schedulr

Convert your Enrollment Assessment Form (EAF) PDF into a Google Calendar-compatible `.ics` file in seconds.

## What It Does

**EAF Schedulr** is a web application that reads your De La Salle University Archers Hub EAF PDF and automatically extracts your class schedule. It generates a calendar file that you can import directly into Google Calendar, showing all your courses with their times and locations.

### Features

- 📄 **Automatic Schedule Extraction** — Reads the latest Archers Hub EAF PDF format and extracts all scheduled classes, seminars, and workshops
- 📅 **Google Calendar Import** — Download a `.ics` file compatible with Google Calendar and other calendar applications
- 🏫 **Location Tracking** — Preserves room numbers and building locations for each class
- 🔄 **Recurring Events** — Classes are set up as recurring weekly events for the entire term
- 📍 **Timezone Support** — All times are adjusted for Philippine Time (PHT/Asia/Manila)
- ✅ **Recollection Management** — Supports LASARE (Lasallian Recollection) 1, 2, and 3 with weekday validation
- 🎯 **Smart Weekday Validation** — Ensures recollection dates match the scheduled weekday
- 💾 **Automatic Metadata** — Extracts student ID, term, and academic year from your EAF for proper file naming

## Quick Start

**Live demo:** https://eafschedulr.onrender.com


### Installation

1. Clone this repository.
2. Create a Python virtual environment:
   ```bash
   python -m venv .venv
   ```

3. Activate the virtual environment:
   - Windows PowerShell: .\.venv\Scripts\Activate.ps1
   - Windows CMD: .\.venv\Scripts\activate.bat
   - macOS/Linux: source .venv/bin/activate

4. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Running the App
**Run locally (development)** — Use these steps to run the app on your machine for testing or development.

1. Activate your virtual environment (see step 3 above).
2. Start the Flask development server:
   ```bash
   python run.py
   ```
3. Open your browser and go to: http://127.0.0.1:5000

On Windows PowerShell you can also use the helper script:
```powershell
.\start.ps1
```

## How to Use

### Step 1: Upload
- Drop your EAF PDF into the upload box or click to select it
- The app instantly extracts your schedule and displays the filename

### Step 2: Review
- Set your **Term Start Date** (the first day of classes)
- Set the **Number of Weeks** for the term (default: 14 weeks)
- If your EAF includes LASARE (Lasallian Recollection) 1, 2, or 3, select the exact date for each recollection
  - **Important:** The recollection date must fall on the same weekday as scheduled in your EAF
- The app validates your choices and shows helpful guidance

### Step 3: Export
- Click **Generate Calendar** to create your `.ics` file
- Download the file (automatically named with your student ID, term, and academic year)
- Open Google Calendar, go to Settings → Import & Export → Import Calendar
- Upload the `.ics` file and your schedule appears in your calendar

## What Gets Imported

Your calendar will include:

- **All Course Sections** — Every class, seminar, or workshop from your EAF
- **Class Times** — Exact meeting times in your local timezone
- **Room/Location** — Where each class meets (or "Online" if applicable)
- **Course Codes & Sections** — Displayed in the event title for easy identification
- **Recurring Pattern** — Classes repeat weekly throughout the term
- **Recollections** — Any Lasallian recollections appear as single all-day events on their designated dates

## Project Structure

```text
EAFtoGCAL_AH/
├── app/                           # Main application package
│   ├── __init__.py               # App factory and initialization
│   ├── config.py                 # Configuration and constants
│   ├── models.py                 # Data models (Event dataclass)
│   ├── utils.py                  # Utility functions for text and time processing
│   ├── routes.py                 # HTTP route handlers
│   └── services/
│       ├── parser.py             # PDF parsing and validation
│       └── calendar.py           # Calendar generation and preview formatting
├── static/
│   ├── app.js                    # Client-side JavaScript
│   └── styles.css                # Styling
├── templates/
│   └── index.html                # HTML template
├── run.py                        # Application entry point
├── start.ps1                     # Windows PowerShell launcher
├── README.md                     # This file
└── requirements.txt              # Python dependencies
```

### Architecture

The application follows a **modular, layered architecture**:

- **Routes Layer** (`routes.py`) — HTTP endpoints, CSRF protection, form handling
- **Services Layer** — Business logic separated into focused modules:
  - `parser.py` — PDF validation and event extraction
  - `calendar.py` — ICS file generation and preview data
- **Utilities Layer** (`utils.py`) — Reusable text processing, time formatting, and iCalendar formatting
- **Configuration Layer** (`config.py`) — Constants, patterns, and settings
- **Models Layer** (`models.py`) — Data structures (Event dataclass)

This separation enables easy testing, maintenance, and future feature additions.

## Requirements

- Python 3.12 or higher
- Flask 3.1.1
- pypdf 6.0.0 (for PDF text extraction)

## Technical Details

### How It Works

1. **PDF Parsing** — The app uses `pypdf` to extract text from your EAF
2. **Schedule Extraction** — Uses pattern matching to identify courses and their meeting times
3. **Timezone Handling** — All times are stored in Philippine Time (UTC+8) for accuracy in Google Calendar
4. **ICS Generation** — Creates a standards-compliant calendar file with recurring weekly events
5. **Metadata Extraction** — Pulls your student ID, term number, and academic year from the PDF for file naming

### File Storage

- Generated calendar files are temporarily stored in memory during your session
- Downloads are served with proper HTTP headers for correct filename formatting
- Files are not persisted to disk — they're generated fresh each time

### Privacy

- Your EAF PDF is processed locally by the app
- The file is not uploaded to any external service
- Calendar files are generated in memory and are not stored permanently

### Timezone

- The app uses a fixed UTC+8 offset for Philippine Standard Time (PHT)
- All class times are adjusted to this timezone before export
- Google Calendar automatically adjusts display times based on your device's timezone

## Features in Detail

### Recollection Date Validation

When your EAF includes LASARE events:
- The app identifies which day of the week each recollection is scheduled
- You must choose a date that falls on that same weekday
- The browser shows a real-time validation message if you pick the wrong day
- The server validates again before generating the calendar as a safety check

### Location Field

Each class includes:
- **SUMMARY** — The course code and section (e.g., "FINCPMA C02")
- **LOCATION** — The room/building number (e.g., "M317" or "Online")

This information shows in Google Calendar event details and is searchable.

### Filename Format

Downloaded files are automatically named:
```
[StudentID]_T[TermNumber]_AY[AcademicYear]_Schedule.ics
```

Example: `12345678_T3_AY25-26_Schedule.ics`

## Troubleshooting

### "No scheduled events found"
- Make sure you're uploading an actual EAF PDF with class schedule data
- The PDF should be in the latest Archers Hub format

### Google Calendar shows 0 imported events
- Check that your PDF was read correctly (the upload confirmation shows the filename)
- Verify term start date is in the past relative to May 2026 (current date)
- Try importing again — sometimes a refresh helps

### Recollection validation fails
- Double-check the recollection date matches the weekday shown in your EAF
- For example, if LASARE is on Tuesday, you must select a Tuesday date

### Times appear wrong in Google Calendar
- Verify your Google Calendar timezone is set to Philippine Time (Asia/Manila)
- The app exports all times in PHT; Google Calendar should respect that setting

## Support

For issues or feature requests, please check your EAF PDF format matches the latest Archers Hub version or contact your academic advisor.

## License

This project is created for De La Salle University students to manage their academic schedules.