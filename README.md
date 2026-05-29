# EAF Schedulr

[![Demo](https://img.shields.io/badge/demo-animo.li%2Feafschedulr-blue?style=flat-square)](https://animo.li/eafschedulr) [![Python](https://img.shields.io/badge/python-3.12-blue?style=flat-square)](https://www.python.org/) [![Issues](https://img.shields.io/github/issues/Stilsi-dev/EAFSchedulr?style=flat-square)](https://github.com/Stilsi-dev/EAFSchedulr/issues)

Convert your Enrollment Assessment Form (EAF) PDF into a Google Calendar-compatible `.ics` file in seconds.

## Live Demo

🌐 https://animo.li/eafschedulr

## What It Does

**EAF Schedulr** is a web application that reads your De La Salle University Archers Hub EAF PDF, extracts your class schedule, and generates a calendar file you can import directly into Google Calendar. It now ships with a React + TypeScript frontend and a Flask backend that communicate through JSON endpoints.

## Why I Built This

A friend from COB asked me to build a new EAF-to-calendar converter after the latest Archers Hub EAF format stopped working with existing tools.

Manually recreating class schedules in Google Calendar was tedious, especially when schedule changes required updating recurring events one by one. LASARE recollections were also inconvenient to configure because they should appear as one-time events instead of repeating weekly like regular classes.

This project automates the entire process directly from the official EAF PDF, generating a ready-to-import `.ics` file with recurring schedules, locations, and properly configured recollection events.

### Features

- 📄 **Automatic Schedule Extraction** — Reads the latest Archers Hub EAF PDF format and extracts all scheduled classes, seminars, and workshops
- 📅 **Google Calendar Import** — Download a `.ics` file compatible with Google Calendar and other calendar applications
- 🏫 **Location Tracking** — Preserves room numbers and building locations for each class
- 🔄 **Recurring Events** — Classes are set up as recurring weekly events for the entire term
- 📍 **Timezone Support** — All times are adjusted for Philippine Time (PHT/Asia/Manila)
- ✅ **Recollection Management** — Supports LASARE (Lasallian Recollection) 1, 2, and 3 with weekday validation
- 🎯 **Smart Weekday Validation** — Ensures recollection dates match the scheduled weekday
- 💾 **Automatic Metadata** — Extracts student ID, term, and academic year from your EAF for proper file naming
- ⚡ **Modern Frontend** — React, TypeScript, Vite, and Tailwind-powered UI built for the current workflow

## Quick Start

### Installation

1. Clone this repository.
2. Create a Python virtual environment:
   ```bash
   python -m venv .venv
   ```
3. Activate the virtual environment:
   - **Windows PowerShell:** `.\.venv\Scripts\Activate.ps1`
   - **Windows CMD:** `.\.venv\Scripts\activate.bat`
   - **macOS/Linux:** `source .venv/bin/activate`
4. Install the Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
5. Install the frontend dependencies if you want to run the React app in development:
   ```bash
   cd frontend
   npm install
   ```

### Running the App

1. Activate your Python virtual environment.
2. Start the Flask backend:
   ```bash
   python run.py
   ```
3. In a second terminal, start the Vite frontend if you want the source UI instead of the built files in `public/`:
   ```bash
   cd frontend
   npm run dev
   ```
4. Open your browser and go to `http://127.0.0.1:5000` for the Flask-served app, or use the Vite dev server while it proxies API calls back to Flask.

## How to Use

### Step 1: Upload
- Drop your EAF PDF into the upload box or click to select it
- The app immediately inspects the PDF and extracts the schedule details

### Step 2: Review
- Set your **Term Start Date** (the first day of classes)
- Set the **Number of Weeks** for the term (default: 14 weeks)
- If your EAF includes LASARE (Lasallian Recollection) 1, 2, or 3, select the exact date for each recollection
  - **Important:** The recollection date must fall on the same weekday as scheduled in your EAF
- The app validates your choices and shows helpful guidance when something does not line up

### Step 3: Export
- Click **Generate Calendar** to create your `.ics` file
- Download the file, which is automatically named with your student ID, term, and academic year
- Open Google Calendar, go to Settings → Import & Export → Import Calendar
- Upload the `.ics` file and your schedule appears in your calendar

## What Gets Imported

Your calendar will include:

- **All Course Sections** — Every class, seminar, or workshop from your EAF
- **Class Times** — Exact meeting times in your local timezone
- **Room/Location** — Where each class meets, or `Online` when applicable
- **Course Codes & Sections** — Displayed in the event title for easy identification
- **Recurring Pattern** — Classes repeat weekly throughout the term
- **Recollections** — Any Lasallian recollections appear as single all-day events on their designated dates

## Project Structure

```text
EAFSchedulr/
├── app/                           # Flask application package
│   ├── __init__.py               # App factory and static-folder setup
│   ├── config.py                 # Configuration and constants
│   ├── models.py                 # Data models
│   ├── utils.py                  # Shared text and time utilities
│   ├── routes.py                 # HTTP route handlers and JSON responses
│   └── services/
│       ├── parser.py             # PDF parsing and validation
│       └── calendar.py           # Calendar generation and preview formatting
├── frontend/                      # React + Vite source for the UI
│   ├── src/                       # App source code and components
│   └── package.json               # Frontend dependencies and scripts
├── public/                        # Built frontend assets served by Flask
├── scripts/
│   └── sync_static.ps1            # Copies the Vite build into public/
├── run.py                         # Application entry point
├── README.md                      # This file
└── requirements.txt               # Python dependencies
```

### Architecture

The application follows a **modular, layered architecture**:

- **Routes Layer** (`routes.py`) — HTTP endpoints, CSRF protection, file upload handling, and JSON responses
- **Services Layer** — Business logic separated into focused modules:
  - `parser.py` — PDF validation and event extraction
  - `calendar.py` — ICS file generation and preview data
- **Utilities Layer** (`utils.py`) — Reusable text processing, time formatting, and iCalendar formatting
- **Configuration Layer** (`config.py`) — Constants, patterns, and settings
- **Models Layer** (`models.py`) — Data structures for parsed events and related metadata

This separation keeps the backend easy to test, maintain, and extend.

## Requirements

- Python 3.12 or higher
- Flask 3.1.1
- pypdf 6.0.0
- Node.js and npm for frontend development

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, TailwindCSS, Vite |
| Backend | Flask |
| PDF Parsing | pypdf |
| Calendar Generation | iCalendar (.ics) |
| Language | Python 3.12 |

## Technical Details

### How It Works

1. **PDF Parsing** — The app uses `pypdf` to extract text from your EAF
2. **Schedule Extraction** — Pattern matching identifies courses, meeting days, and time ranges
3. **Timezone Handling** — All times are stored in Philippine Time (UTC+8) for consistent exports
4. **ICS Generation** — Creates a standards-compliant calendar file with recurring weekly events
5. **Metadata Extraction** — Pulls your student ID, term number, and academic year from the PDF for file naming
6. **Frontend/API Split** — The React app calls `/inspect`, `/generate`, and `/download` on the Flask backend

### File Storage

- Generated calendar files are temporarily stored in memory during your session
- Downloads are served with proper HTTP headers for correct filename formatting
- Files are not persisted to disk; they are generated fresh each time

## Privacy

- Your EAF PDF is processed locally by the app and is not uploaded to external services.
- Generated calendar files are created in memory for the session and are not persisted to disk.
- The application does not collect analytics or personal data.
- Temporary data used for generation is discarded after the download completes.

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
- **SUMMARY** — The course code and section, for example `FINCPMA C02`
- **LOCATION** — The room/building number, for example `M317` or `Online`

This information shows in Google Calendar event details and is searchable.

### Filename Format

Downloaded files are automatically named:
```text
[StudentID]_T[TermNumber]_AY[AcademicYear]_Schedule.ics
```

Example: `12345678_T3_AY25-26_Schedule.ics`

## Troubleshooting

### "No scheduled events found"
- Make sure you're uploading an actual EAF PDF with class schedule data
- The PDF should be in the latest Archers Hub format

### Google Calendar shows 0 imported events
- Check that your PDF was read correctly and that the upload confirmation shows the filename
- Verify the term start date is correct
- Try importing again if the calendar UI needs a refresh

### Recollection validation fails
- Double-check the recollection date matches the weekday shown in your EAF
- For example, if LASARE is on Tuesday, you must select a Tuesday date

### Times appear wrong in Google Calendar
- Verify your Google Calendar timezone is set to Philippine Time (Asia/Manila)
- The app exports all times in PHT; Google Calendar should respect that setting

### Frontend is not loading changes
- If you are editing the React source, make sure the Flask backend is running on `http://127.0.0.1:5000`
- Run the Vite dev server from `frontend/` so the browser loads the current source instead of the built files in `public/`

## Support
If you encounter bugs or unsupported EAF formats:

- Open an issue on GitHub
- Include a screenshot or sample PDF format if possible
- Mention your browser and operating system

GitHub Issues:
https://github.com/Stilsi-dev/EAFSchedulr/issues

## Deployment

The frontend is built with Vite and served as static assets through Flask in production. Use the provided `scripts/sync_static.ps1` to copy a Vite build into `public/`, or copy the `dist` output manually. Run the Flask app behind a production WSGI server (for example, Gunicorn or Waitress) for a production deployment.

## License

License: MIT License — see the `LICENSE` file for details.

This project is created for De La Salle University students to manage their academic schedules.
