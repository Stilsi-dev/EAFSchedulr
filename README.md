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
- 🌙 **Dark Mode** — Persistent dark/light mode toggle with system preference stored in localStorage

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
   pnpm install
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
   pnpm dev
   ```
4. Open your browser at `http://127.0.0.1:5000` for the Flask-served app, or use the Vite dev server while it proxies API calls back to Flask.

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
- If any row of your EAF could not be read, the app lists those rows, asks you to confirm you
  will add them yourself, and lets you copy a report to send with a bug report. Nothing is
  dropped silently

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
- **Recollections** — Any Lasallian recollections appear as one-time events at their scheduled time on the date you choose (not repeating, and not all-day)

## Project Structure

```text
EAFSchedulr/
├── app/                           # Flask application package
│   ├── __init__.py               # App factory, security headers, and rate limiter setup
│   ├── config.py                 # Configuration and constants
│   ├── extensions.py             # Shared Flask extension instances (Flask-Limiter)
│   ├── models.py                 # Data models
│   ├── token_store.py            # In-memory token store for download links (10-min TTL)
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
├── tests/
│   ├── test_flow.py              # Integration tests for /inspect and /generate
│   ├── test_parser.py            # Parser tests: golden files + named rules
│   ├── make_fixtures.py          # Regenerates fixtures from local EAF PDFs
│   └── fixtures/                 # Anonymised EAF text + expected parse output
├── run.py                         # Application entry point
├── Procfile                       # Gunicorn command for deployment
├── README.md                      # This file
└── requirements.txt               # Python dependencies
```

### Architecture

The application follows a **modular, layered architecture**:

- **Routes Layer** (`routes.py`) — HTTP endpoints, rate limiting (20 requests/min per IP), file upload handling, and JSON responses
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
- Flask-Limiter 3.9.0
- gunicorn 26.0.0
- Node.js and pnpm for frontend development

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, TailwindCSS, Vite |
| Backend | Flask, Gunicorn |
| PDF Parsing | pypdf |
| Calendar Generation | iCalendar (.ics) |
| Rate Limiting | Flask-Limiter |
| Language | Python 3.12 |

## Technical Details

### How It Works

1. **PDF Parsing** — The app uses `pypdf` to extract text from your EAF
2. **Schedule Extraction** — Pattern matching identifies courses, meeting days, and time ranges
3. **Timezone Handling** — All times are stored in Philippine Time (UTC+8) for consistent exports
4. **ICS Generation** — Creates a standards-compliant calendar file with recurring weekly events
5. **Metadata Extraction** — Pulls your student ID, term number, and academic year from the PDF for file naming
6. **Frontend/API Split** — The React app calls `/inspect` and `/generate` on the Flask backend; `/generate` returns a one-time `/download/<token>` URL that expires after 10 minutes

### File Storage

- Generated calendar files are held in an in-memory token store for up to 10 minutes
- Each generation issues a one-time download token; consuming it removes the file from memory
- Downloads expire after 10 minutes — if the link is no longer valid, generate a new calendar
- Files are never written to disk

## Privacy

- Your EAF PDF is processed in memory by the server and is not forwarded to external services.
- Generated calendar files are held in an in-memory token store and are never written to disk.
- The application uses Google Analytics (via Google Tag Manager) to understand general site usage. No PDF content or personal data extracted from your EAF is sent to analytics.
- Temporary data used for generation is discarded after the download token is consumed or expires.

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

## Running Tests

The fixtures are anonymised: student names and ID numbers are replaced with synthetic
values before anything is written to `tests/fixtures/`, so the suite ships with the repo
while the source EAF PDFs (`EAF Samples/`) stay local and gitignored.

The suite has two layers:

- `test_flow.py` — integration tests for `/inspect`, `/generate`, and the download token
- `test_parser.py` — parser tests against anonymised text fixtures, combining golden-file
  comparison (catches any unanticipated change to parsed output) with named tests for the
  rules that matter: `TBA` fallback, recollection weekday validation, filename derivation

```bash
pytest tests/
```

Rate limiting is automatically disabled in the test fixture so tests run without hitting limits.

If the Archers Hub EAF format changes, regenerate the fixtures from your own samples and
**read the diff** before accepting it — that diff is how format drift becomes visible:

```bash
python tests/make_fixtures.py
```

`make_fixtures.py` reads PDFs from `EAF Samples/` by the neutral filenames listed in its
`SAMPLES` map. Keep those names free of student IDs and real names: the script is committed,
the PDFs are not.

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

### Download link expired
- Download tokens are valid for 10 minutes after generation
- If you see a "Download link expired" message, click "Create another schedule" and generate again

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

The frontend is built with Vite and served as static assets through Flask in production. Use the provided `scripts/sync_static.ps1` to copy a Vite build into `public/`, or copy the `dist` output manually.

The included `Procfile` runs `gunicorn -w 1 run:app`. **Keep the worker count at 1.** The download token store is in-memory and not shared across workers — running multiple workers would cause download tokens generated by one worker to be invisible to others.

Set `FLASK_SECRET` in the environment to a strong random value in production.

Two further variables control how the rate limiter identifies a student. The defaults are correct for the current Render deployment, so they only need setting if the hosting setup changes.

| Variable | Default | What it does |
|---|---|---|
| `TRUST_CF_CONNECTING_IP` | `1` | Trust Cloudflare's `CF-Connecting-IP` header as the student's address. Render fronts every `onrender.com` service with Cloudflare, so this is authoritative in production. Set to `0` anywhere Cloudflare is not in front, where the header would be whatever the client chose to send. |
| `TRUSTED_PROXY_COUNT` | `1` | How many proxies to look past in `X-Forwarded-For`. Used only as a fallback, when the Cloudflare header is absent. Set to `0` when running with no proxy at all. |

Getting either wrong is not a security hole, but it does drop every student into a single rate-limit bucket, which turns the per-IP cap on `/inspect` and `/generate` into a site-wide one.

## License

License: MIT License — see the `LICENSE` file for details.

This project is created for De La Salle University students to manage their academic schedules.
