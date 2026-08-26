# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

De La Salle University students who have just enrolled and downloaded their Enrollment
Assessment Form (EAF) PDF from Archers Hub. They arrive at the start of a term, often within
days of enrollment, on a mix of phones and laptops.

The job: get every class — its meeting days, exact times, room or `Online`, and weekly
recurrence — into Google Calendar without retyping it by hand, and get Lasallian Recollections
(LASARE) placed correctly as one-time events rather than weekly repeats.

This is a one-shot product per term, not a returning-user product. A student may use it once, or
a few times if their schedule changes. Nothing about the design should assume familiarity from a
prior visit.

## Product Purpose

EAF Schedulr reads a DLSU Archers Hub EAF PDF, extracts the enrolled schedule, and generates a
standards-compliant `.ics` calendar file the student imports into Google Calendar.

Success is a single import that produces a correct term: every section present, every time in
Philippine Standard Time, every room preserved, weekly classes recurring for the term length,
and each recollection sitting as a single event on the date the student chose.

Failure is a silently wrong calendar. A student who does not notice a missing class until they
miss it is worse off than one the app told upfront it could not read a row.

## Positioning

Built specifically against the *current* Archers Hub EAF format, after existing converters broke
when DLSU changed it. Two things a neighboring tool could not truthfully copy:

- **Recollections are modeled correctly.** LASARE 1, 2, and 3 are emitted as single-occurrence
  timed events on a student-chosen date — not weekly repeats, not all-day blocks. The chosen
  date is validated against the weekday in the EAF, in the browser and again on the server.
- **Unreadable rows are surfaced, never dropped.** Rows the parser cannot interpret are returned
  to the student, must be explicitly acknowledged before a calendar is generated, and are
  copyable as a report for a bug filing. Format drift becomes the student's visible decision
  rather than an invisible omission.

## Operating Context

- **Trigger:** enrollment completes; the student downloads their EAF from Archers Hub.
- **Session shape:** one uninterrupted sitting — upload, review, generate, download, import.
- **Handoff:** the student finishes the job outside the app, in Google Calendar
  (Settings → Import & Export → Import Calendar). The app's last mile is a file, not a synced
  calendar, so the import instructions are part of the product, not an afterthought.
- **Calendar clients:** Google Calendar is the primary target, but `.ics` portability means
  Apple Calendar and Outlook users are served identically. This is deliberate.
- **Term shape:** DLSU trimesters, typically 14 weeks (the default); the student sets the term
  start date and the week count.
- **Timezone:** Philippine Standard Time throughout.

## Capabilities and Constraints

**Flow and endpoints**

- `POST /inspect` — validates and parses the uploaded PDF; returns events, course and event
  counts, recollection codes with their weekdays, ambiguous rows, and a suggested filename.
- `POST /generate` — re-parses, validates the term start date, week count (1–52, default 14),
  and any recollection dates; builds the ICS and returns a one-time `/download/<token>` URL plus
  a timetable preview.
- `GET /download/<token>` — serves the file once, then discards it.

**What the parser extracts**

Course code, section, course name, meeting day, start and end time, location (or `Online`), plus
student ID, term number, and academic year for the filename
`[StudentID]_T[Term]_AY[AcademicYear]_Schedule.ics`. Unmatched metadata falls back to
`eaf-calendar.ics`.

**Hard technical constraints**

- 10 MB PDF limit, with a 12 MB request cap so an oversized file gets a specific message rather
  than an opaque 413.
- 20 requests per minute per IP on `/inspect` and `/generate`.
- Download tokens live in an in-memory store with a 10-minute TTL and are single-use. This
  requires `gunicorn -w 1` — multiple workers would make tokens invisible across processes.
- Fixed UTC+8 offset; ICS timezone id `Asia/Manila`.
- Strict Content-Security-Policy (`default-src 'self'`). Google Tag Manager / Google Analytics is
  the only permitted third-party script, and `font-src` is `'self'` only. Any change to what the
  page may load is a deliberate CSP edit in `app/__init__.py`, never an incidental one.
- Files are never written to disk, at any stage.
- Parse-shape logging records counts and course codes only — never schedule content, never
  anything identifying a student.
- `tests/` is gitignored because its fixtures derive from real students' EAFs. A fresh clone has
  no test suite.

**Terminology — use the students' words, not invented ones**

EAF, Archers Hub, LASARE / Lasallian Recollection, term, academic year, section, ID number.

**Explicitly undecided**

- **Direct Google Calendar OAuth sync.** The `.ics` download is the committed endpoint. Sync is a
  possible later addition, not a commitment — it would require Google's verification for the
  sensitive `calendar.events` scope, a sign-in step, and token handling. Future work must not
  assume it is coming, and must not design the current flow as a stopgap around it.

## Brand Commitments

- **Name:** EAF Schedulr. Live at `animo.li/eafschedulr`.
- **Logo assets:** `frontend/src/assets/logo/` (Black, Color, White SVG) and
  `public/schedulr-logo.svg`.
- **Voice:** peer to peer, plainspoken, in-group Lasallian — "Made by a Lasallian for
  Lasallians", "Built for DLSU students". Never institutional, never corporate.
- **Unofficial status is binding.** Copy must never imply DLSU endorsement, affiliation, or
  official status. This is a student-built tool and must read as one.
- **Dark and light modes** with a persisted preference are an existing commitment, not an
  optional enhancement.
- **Support surfaces:** `angelo_nuque@dlsu.edu.ph` and GitHub issues at `Stilsi-dev/EAFSchedulr`.
- **Attribution:** shadcn/ui components used under MIT — see `frontend/ATTRIBUTIONS.md`.
- Project is MIT licensed.

## Evidence on Hand

- **Live deployment:** `https://animo.li/eafschedulr`.
- **Public repository and issue tracker:** `https://github.com/Stilsi-dev/EAFSchedulr`.
- **Real EAF samples:** four PDFs in `EAF Samples/`. These contain real student data. They are
  reference material for parsing only — never publish them, never render them in a UI, never use
  them as screenshot content.
- **Origin story (true, usable):** built after a friend from COB asked for a converter, because
  the previous generation of tools stopped working when the Archers Hub EAF format changed.

**Absences future work must not fabricate:** there are no testimonials, no user counts, no
ratings, no download totals, no institutional partnership, and no published usage metrics. Google
Analytics is installed, but no figure from it has been confirmed for public use. Do not invent
social proof, adoption numbers, or endorsements of any kind.

## Product Principles

1. **Nothing is dropped silently.** Every row the parser cannot read is shown, acknowledged by
   the student, and exportable as a report. Visible failure beats invisible omission.
2. **One sitting, one page, no account.** The whole job completes without signup, onboarding, or
   a return visit. No login wall may ever stand ahead of the core task.
3. **Correctness outranks convenience.** Recollection weekday validation runs in the browser and
   again on the server. A student should not be able to generate a wrong calendar by accident.
4. **The student's data leaves no trace.** In-memory processing, a single-use expiring download,
   nothing on disk, nothing forwarded to a third party — and the product says so plainly where
   the student can see it.
5. **Format drift is expected and must stay observable.** The parser will break again when DLSU
   changes the EAF. The product's job is to make that break loud, diagnosable, and reportable.

## Accessibility & Inclusion

**WCAG 2.1 AA is a hard requirement, not best-effort.** Contrast ratios, full keyboard
operability, and screen-reader support are non-negotiable, and must hold in *both* dark and light
modes.

Context that sharpens this: students arrive on mixed devices with mobile heavily represented,
often on campus wifi, and use the product exactly once per term — so nothing may depend on
learned behavior, remembered state, or a second attempt.
