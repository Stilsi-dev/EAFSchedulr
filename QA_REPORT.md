# QA Report — EAF Schedulr (`dev`)

**Branch:** `dev` @ `2af576a`
**Date:** 2026-09-01
**Method:** source review (backend + frontend), live browser session, HTTP-level probes, existing test suite
**Verdict:** **One blocker** — an unhandled 500 on ordinary input. Everything else is fixable in a follow-up.

> **Revised 2026-09-01 after checking the real EAF corpus.** ISSUE-001 was first filed as Critical on the assumption that a multi-day one-time course was plausible. Measured against the four real samples, it is not: every `Seminar / Workshop` in the corpus meets on exactly one day, and only `Lecture` courses meet twice — which are never offered the checkbox. ISSUE-001 is split below into a latent hazard (001a, not reachable on real data) and the part that does bite every real user (001b, a mislabel on the confirmation screen). **The release verdict changes from block to ship-after-ISSUE-002.**

---

## 1. Executive Summary

The app does its core job well. A clean EAF parses correctly, times land in PHT, weekly recurrence is right, recollections are emitted as single timed events, unreadable rows are surfaced and gated behind an acknowledgement, and the file downloads once before the token dies. The existing suite (59 tests) passes. Upload validation, size caps, gzip, cache headers, security headers and rate limiting all behave as designed.

One defect blocks release:

- **ISSUE-002 (High):** a far-future term start date (reachable by typing; the date inputs have no `max`) raises an unhandled `OverflowError` → HTTP 500. "Try again" fails identically forever with no indication the date is the cause.

Next in line: the success screen labels every student-ticked one-time session "Recurring weekly, 14 weeks" (ISSUE-001b) — the file is correct, the confirmation is not. Then a double-click on Download showing a false "link expired" after a successful download (ISSUE-003), and the upload dropzone having no keyboard-operable control (ISSUE-004), against a stated hard WCAG 2.1 AA requirement.

---

## 2. Feature Understanding

Reads a DLSU Archers Hub EAF PDF, extracts the enrolled schedule, emits an RFC 5545 `.ics` the student imports into Google Calendar. One sitting, no account, nothing written to disk. `POST /inspect` → review → `POST /generate` → single-use `GET /download/<token>`.

Success is a single import producing a correct term. Failure is a calendar that is wrong without the student knowing.

**Dependencies:** pypdf, Flask, flask-limiter (in-memory), Google Analytics (opt-out), a single `gunicorn -w 1` worker (required — download tokens are per-process).

---

## 3. Risk Assessment

| Area | User impact | Failure likelihood | Data sensitivity | Complexity | Priority |
|---|---|---|---|---|---|
| One-time / recollection date assignment | **H** | **L** (corpus-checked) | **H** | M | 3 |
| Term-date & week validation | H | M | M | L | **1** |
| PDF row parsing / format drift | H | M | H | H | 2 |
| Download token lifecycle | M | M | H | L | 4 |
| Accessibility (stated AA requirement) | H | H | L | M | 5 |
| Rate limiting / abuse | L | M | L | M | 6 |
| Analytics consent | M | L | M | L | 7 |

---

## 4. Coverage Dashboard

| Dimension | Coverage | Notes |
|---|---|---|
| Functional | High | All three endpoints, happy + failure + recovery paths |
| Data integrity | High | ICS output byte-inspected against inputs |
| State transitions | High | empty→parsed→error→success→reset, expired-token recovery |
| Chaos | Medium | double-submit, double-download, replay, rapid uploads |
| UI / visual | Medium | 500px and desktop, light + dark |
| UX | High | full flow walked as a first-time user |
| Accessibility | Medium | keyboard, focus, labels, ARIA verified; **contrast not conclusively verified** (see §9) |
| Responsive | Low-Medium | browser floor was 500px; sub-500px not directly testable |

---

## 5. Issue Registry

### ISSUE-001a — One-time handling would collapse a multi-day course (latent)

**Severity: Medium (latent — not reachable on real EAF data)**  ·  **Category: Data Integrity**  ·  **Confidence: High**

**Description**
`build_ics` keys one-time handling on `event.code` ([calendar.py:360](app/services/calendar.py#L360)). If a course code has meetings on more than one weekday and is marked one-time, *every* meeting for that code is emitted on the one chosen date — meetings on other weekdays are relocated, keeping their original clock times. Both validation layers pass it: `weekday_mismatch` ([calendar.py:68](app/services/calendar.py#L68)) accepts a date matching **any** of the course's weekdays, and the browser check does the same.

**Why this is latent, not live.** Measured across the four real EAF samples (aggregate shape only — no schedule content read out):

| Course type | 1 day | 2 days | 3+ days | Offered the checkbox? |
|---|---:|---:|---:|---|
| Seminar / Workshop | 5 | 0 | 0 | **yes** |
| Research / Capstone | 1 | 0 | 0 | no |
| Laboratory | 5 | 0 | 0 | no |
| Lecture | 3 | 21 | 0 | no |

Every course type eligible for the one-time checkbox meets on exactly one day. The only twice-weekly type is `Lecture`, which is never offered the checkbox. **Courses with >1 day that are one-time candidates: 0. Recollections with >1 day: 0.** The collapse does not trigger on any real sample.

Reproduced only with a synthetic two-weekday `Seminar / Workshop`, which the UI does offer the checkbox to (rendering "falls on a **Monday or Thursday**" above a single date field) and which then emits both meetings on the chosen Monday.

**Impact:** none observed today. It is a trap for the next EAF format change or an unusual program — exactly the kind of drift the product expects. Worth closing cheaply rather than carrying.

**Recommendation (one line, one choke point).** `get_one_time_candidates` ([calendar.py:35](app/services/calendar.py#L35)) is the single gate for all three uses — building the offer list ([routes.py:149](app/routes.py#L149)), iterating submitted form fields ([routes.py:260](app/routes.py#L260)), and validation ([calendar.py:97](app/services/calendar.py#L97)). Skipping codes with more than one meeting day there closes the hole in the UI *and* against a hand-crafted POST at once, and it encodes the real rule: **a session that meets once meets on one day.** Separately, make a multi-day recollection a hard error rather than a silent collapse, since that path does not run through this gate.

---

### ISSUE-001b — Success screen labels every ticked one-time session "Recurring weekly"

**Severity: Medium**  ·  **Category: UX / Data Integrity (reporting)**  ·  **Confidence: High**  ·  **Repro: 100%**

**Description**
The success card's one-time test is `course.hasRecollection && recollectionDates[course.code]` ([App.tsx:1499](frontend/src/app/App.tsx#L1499)). `hasRecollection` is only ever true for `LASARE*` codes, so a **student-ticked** one-time session always falls to the else branch and is described as recurring.

This is independent of ISSUE-001a and fires in the ordinary single-day case that real EAFs actually contain. One of the four real samples offers a one-time candidate, so this is live.

**Steps to Reproduce**
1. Upload an EAF with a single-day `Seminar / Workshop` (e.g. `ORIENTE`, WED 08:00–09:00).
2. Tick "meets only once", pick a Wednesday, create the schedule.

**Expected:** the card reads `One-time date · Sep 09, 2026`, as it correctly does for `LASARE3`.

**Actual:** the card reads `Recurring weekly · 14 weeks`, while the generated file correctly contains a single non-recurring `VEVENT`:

```
ORIENTE S05  20260909T080000  ONE-TIME     <- file is right
LASARE3 S13  20260909T151500  ONE-TIME     <- card is right, says "One-time date"
```

**Impact:** the file is correct, so no wrong calendar results — but the confirmation screen is the student's only chance to verify what they are about to import, and it contradicts the file. A student checking their work sees the opposite of what they chose, which is likely to send them back to re-tick or regenerate.

**Recommendation:** drive the label from the one-time set (recollection dates **plus** ticked sessions), not from `hasRecollection`. Add a test asserting a ticked single-day session renders "One-time date".

---

### ISSUE-002 — Far-future term start date raises an unhandled 500

**Severity: High**  ·  **Category: Functional / Robustness**  ·  **Confidence: High**  ·  **Repro: 100%**

**Description**
`next_weekday_on_or_after` ([utils.py:141](app/utils.py#L141)) adds up to 6 days to `term_start`. With a date near `date.max` this raises `OverflowError`, which the `except ValueError` around `build_ics` ([routes.py:283](app/routes.py#L283)) does not catch. Result: HTTP 500. There is no `min`/`max` on any date input and no server-side range check.

**Steps to Reproduce**
1. Upload a valid EAF.
2. Type `9999-12-31` into "Term start date".
3. Fill the recollection date.
4. Create my schedule.

**Expected:** "Enter a term start date within the current academic year" (or similar).

**Actual:** `OverflowError: date value out of range` → 500 → "The app server ran into a problem. Try again in a moment." "Try again" fails identically every time.

**Impact:** any student who fat-fingers a year. The message misattributes the fault to the server and offers no route to the real cause.

**Recommendation:** validate `term_start` against a sane window server-side (e.g. within a few years of today) and return a specific 400; add `min`/`max` to the date inputs; broaden the `except` to `(ValueError, OverflowError)`.

---

### ISSUE-003 — Double-clicking Download reports a false failure

**Severity: Medium**  ·  **Category: UX / Functional**  ·  **Confidence: High**  ·  **Repro: 100%**

**Description**
"Download .ics file" ([App.tsx:1436](frontend/src/app/App.tsx#L1436)) has no `disabled` guard and no in-flight lock, unlike "Create my schedule" which has both. The token is single-use, so a double-click delivers the file on the first request and gets 410 on the second, rendering a red *"Couldn't download your calendar — That download link expired. Create the schedule again."*

Verified with two concurrent requests on one token: click 1 → `200, 1464 bytes`; click 2 → `410`.

**Impact:** double-clicking is common. The student has the correct file and is told the operation failed. Worse, the offered recovery ("Create the schedule again") mints **all-new event UIDs** — verified: 0 shared UIDs between two runs — so a student who already imported the first file and follows the advice duplicates their entire timetable. Google Calendar has no bulk undo. The import instructions mitigate this with the dedicated-calendar advice, but only for students who read and followed it.

**Recommendation:** disable the button while a download is in flight, and ignore repeat clicks once one has succeeded.

---

### ISSUE-004 — Upload dropzone has no keyboard-operable control

**Severity: High (given the stated AA requirement)**  ·  **Category: Accessibility**  ·  **Confidence: High**

**Description**
The file input is `className="hidden"` → `display: none` ([App.tsx:1084](frontend/src/app/App.tsx#L1084)), so it is not focusable and is **absent from the accessibility tree**; its `<label>` has `tabIndex -1`. Confirmed: the input does not appear in the tab order, and `offsetParent` is null.

The "Upload your EAF" card is the page's dominant call to action, yet to a keyboard or screen-reader user it is static text reading *"Drag and drop your EAF PDF here / or click to browse your files"* — instructions for an action with no keyboard equivalent there. WCAG 2.1 **2.1.1 Keyboard** and **4.1.2 Name, Role, Value**.

**Mitigation:** the hero "Upload my EAF" button does open the picker, so the task is completable — this is a gap, not a dead end.

**Recommendation:** replace `hidden` with the visually-hidden-but-focusable pattern (`sr-only` / 1px clip), give the input an accessible name, and add a visible focus ring on the dropzone.

---

### ISSUE-005 — Malformed clock times pass parsing and leak a raw Python error

**Severity: Medium**  ·  **Category: Functional / UX**  ·  **Confidence: High**

**Description**
`SCHEDULE_SEGMENT_PATTERN` accepts `[0-9]{1,2}:[0-9]{2}\s*[AP]M`, so `13:00 PM` and `99:99 AM` match. `/inspect` returns **200** with the row as a normal event, and the student sees the course in the review summary. Only at `/generate` does `parse_clock` fail, surfacing verbatim:

> `time data '13:00 PM' does not match format '%I:%M %p'`

**Impact:** an implementation detail shown to a student, with no route forward — the row should have been flagged unreadable at inspect time, which is the whole point of principle 1 ("format drift must stay loud and diagnosable").

**Recommendation:** validate the clock during parsing and route failures into `ambiguous_rows`; never surface a `strptime` message.

---

### ISSUE-006 — Rate limit bypassable by spoofing `CF-Connecting-IP`

**Severity: Medium**  ·  **Category: Security**  ·  **Confidence: High**

**Description**
`client_ip` trusts `CF-Connecting-IP` whenever `TRUST_CF_CONNECTING_IP` is set, which is the default ([extensions.py:26](app/extensions.py#L26)). Verified against a configured app: a fixed spoofed value is limited correctly (first 429 at request 61), while **rotating** the header yields 65/65 × 200 — unlimited buckets.

This only holds while Cloudflare genuinely fronts every path to the app. Render's `*.onrender.com` origin is typically reachable directly, and the code comment acknowledges the assumption.

**Chained impact:** with the limiter defeated, `/generate` is an unbounded CPU-bound endpoint, and each success adds an uncapped entry to the in-memory token store — no size limit, eviction only on create/consume ([token_store.py](app/token_store.py)). 500 tokens held ≈ 2.4 MB for the full 10-minute TTL. Memory pressure on a single small worker.

**Recommendation:** only trust `CF-Connecting-IP` from Cloudflare's published ranges, or restrict the origin to Cloudflare; cap the token store and evict oldest-first.

---

### ISSUE-007 — Week count silently clamped instead of rejected

**Severity: Low**  ·  **Category: Data Integrity**  ·  **Confidence: High**

`max(1, min(52, int(weeks_raw)))` ([routes.py:228](app/routes.py#L228)). Verified: `weeks=0` → 1, `weeks=-5` → 1, `weeks=999` → 52, all HTTP 200 with no notice. The browser guards the range, so this only bites non-JS or scripted submissions — but a term silently generated at a length the student did not ask for is a data change without consent. A missing `term_start` likewise defaults silently to today.

**Recommendation:** return 400 with a specific message rather than clamping.

---

### ISSUE-008 — Last course lost when an EAF lacks the `Payments` terminator

**Severity: Medium**  ·  **Category: Functional (format drift)**  ·  **Confidence: High**

Row accumulation stops only at a line starting with `Payments` ([parser.py:221](app/services/parser.py#L221)). Without it, the entire footer is absorbed into the final course row, which then fails the schedule pattern. Verified: an EAF whose footer reads `Total Assessment ...` instead yields **0 events and 1 unreadable row**, with the reason naming the footer text.

This degrades safely — the row is surfaced, not dropped — so it is a resilience issue rather than a correctness one. But a single hardcoded string is a thin defence for a format the brief expects to drift.

**Recommendation:** terminate on any non-course line that cannot extend a schedule, or anchor on the table footer more broadly.

---

### ISSUE-009 — `/generate` returns six fields the client never reads

**Severity: Low**  ·  **Category: Performance / Maintainability**  ·  **Confidence: High**

`timetable`, `recollection_summary`, `visible_recollection_codes`, `has_recollection`, `recollection_dates` and `event_count` have **0 references** in the frontend. `build_timetable_preview` runs a full overlap-lane layout computation on every generate and is discarded.

**Recommendation:** drop them, or restore the timetable preview if it was intended to ship.

---

### ISSUE-010 — Documentation drift on the rate limit

**Severity: Low**  ·  **Category: Documentation**  ·  **Confidence: High**

`PRODUCT.md:87` states "20 requests per minute per IP on `/inspect` and `/generate`". The code enforces `60 per minute` (`routes.py:81`, `routes.py:161`), changed in `166f127`. PRODUCT.md is the spec of record and now misstates a hard constraint.

---

### ISSUE-011 — Inconsistent date parsing between two helpers

**Severity: Low**  ·  **Category: Functional**  ·  **Confidence: Medium**

`getSelectedWeekday` uses `new Date(y, m-1, d)` (local) while `formatDisplayDate` uses `new Date("YYYY-MM-DD")` (**UTC**). In any negative UTC offset the displayed date pill is a day earlier than the date validated. Harmless for the PH audience; a correctness trap for anyone travelling, and for future reuse.

**Recommendation:** parse both as local.

---

## 6. Persona Findings

**First-time user (primary persona).** Strong. The three-step "How it works" card sets expectations, the review screen is legible, and the import instructions correctly state the two things a student cannot discover alone (Google Calendar will not import from a phone; use a dedicated calendar). Copy is plainspoken and in-group, with no implied DLSU endorsement.

**Frustrated user.** Recovery is well designed almost everywhere — a submit failure keeps every form value, and an expired download keeps the whole session so recovery is one click. Two gaps: ISSUE-002 gives a loop with no exit, and ISSUE-003 manufactures a failure that did not happen.

**Confused user.** After a failed submit, focus stays on the button and the page does not scroll to the first error; the live region says only *"Some details still need fixing"* without naming a field. The errors themselves are correctly associated (`aria-invalid` + `aria-describedby` → rendered error id, verified). **Recommendation:** move focus to the first invalid control and name the failing fields.

**Accessibility user.** See ISSUE-004. Otherwise good: skip link present and first in tab order; `aria-live` narrates parse, validation, generation and download; the consent region is announced early; decorative layers are `aria-hidden`; the unreadable-row list uses `[overflow-wrap:anywhere]` to stop long tokens widening the page. Focus indicators rely on the browser default outline, which is present and visible — no element removes the outline without supplying a replacement ring.

**Adversarial user.** Upload validation is solid — magic-byte check, extension check, empty-file check, and a two-tier size cap (13 MB → 413 with a friendly message, 11 MB → 400 naming the size). Path-traversal and null-byte filenames are accepted but harmless: nothing is written to disk and the download name comes from parsed EAF metadata. Download tokens are `uuid4`, single-use (410 on replay), `no-store, private`, and unguessable; traversal on the token path 404s. The real weakness is ISSUE-006.

---

## 7. Verified As Working

- Clean EAF → 5 events with correct days, times, rooms, PHT throughout; `LASARE3` emitted as a single timed `VEVENT`, others as `RRULE:FREQ=WEEKLY;COUNT=14`.
- Filename metadata: `12345678_T1_AY26-27_Schedule.ics`; falls back to `eaf-calendar.ics` when unmatched.
- Unreadable rows surfaced, grouped by code, with per-field failure reasons; gated behind an acknowledgement checkbox that blocks generation; copyable report.
- Upload rejections: no file / empty / non-PDF / wrong extension / oversized — all correct and specific.
- Rate limiting: exactly 60/min per client, first 429 at request 61.
- gzip: `index.html` 9217 → 3744 bytes with correct `Vary: Accept-Encoding`; skipped when not requested.
- Cache headers: `no-store, private` on `/download/`, `immutable` on `/assets/`, `no-cache` on HTML.
- Security headers present; CSP restricts to `'self'` plus GA.
- Theme: three-state preference, no flash of the wrong theme (inline bootstrap), system changes followed only while on `system`.
- Consent: `denied` persists, sets `ga-disable-*`, clears `_ga` cookies immediately.
- Consent bar measures itself and insets the page (`--consent-bar-h: 170px` → matching `padding-bottom`), so nothing is trapped beneath it.
- No horizontal overflow at 500px in any state; no console errors other than the ISSUE-002 500.
- Existing suite: **59 passed**.

---

## 8. Notes On Deliberate Decisions

**Analytics loads before consent is given.** `gtag.js` was already injected and had fired a `config` hit before I answered the bar; declining sets the kill switch and clears cookies, but the visit was counted. This is explicitly designed and documented in `index.html` and `PRODUCT.md`, and the code comment is candid that the bar "is a notice wearing a question's clothes". Not filed as a defect — flagged so the choice stays deliberate, since it is the kind of thing that attracts scrutiny under GDPR-style consent expectations.

**Fresh UIDs on every generate.** Intentional, and mitigated by the dedicated-calendar instruction. Relevant here only as the tail of ISSUE-003.

---

## 9. Not Verified

**Colour contrast was not conclusively measured.** Automated sampling failed twice: computed-style walking cannot resolve the gradient grounds this design uses, and element-scoped screenshots came back blank under the backdrop-blur layers. Visual inspection of light and dark renders showed no obvious failures, and the source carries evidence of deliberate contrast work (specific corrected ratios cited in comments). **Given that WCAG 2.1 AA contrast in both themes is a stated hard requirement, this needs a manual axe DevTools or Lighthouse pass before release.** Reported as unverified rather than as either a pass or a fail.

Also not covered: real device testing below 500px (browser viewport floor), screen-reader verification with an actual AT, iOS/Android Safari and Chrome, and the four real EAF samples — deliberately not exercised, so that no real student data entered the QA loop. All fixtures used here were synthetic.

---

## 10. Regression Risks

- Fixing ISSUE-001 touches the shared path for recollections and ticked sessions; the recollection flow needs re-testing alongside it.
- Adding `min`/`max` to date inputs may reject dates users could previously type — intended, but check the recollection field is bounded consistently.
- Making malformed clocks ambiguous (ISSUE-005) will move rows from events into the unreadable list; verify the acknowledgement gate and the counts still read correctly.

---

## 11. Release Recommendation

**SHIP AFTER ISSUE-002.**

| Band | Issues |
|---|---|
| Must fix before release | ISSUE-002 |
| Should fix before term-start traffic | ISSUE-001b, ISSUE-003, ISSUE-004, ISSUE-005 |
| Should schedule | ISSUE-001a, ISSUE-006, ISSUE-008 |
| Backlog | ISSUE-007, ISSUE-009, ISSUE-010, ISSUE-011 |

ISSUE-002 is the only true blocker: a hard 500 on input a student can type, with no path to recovery and a message that blames the server.

No confirmed path to a wrong calendar remains. The one candidate — ISSUE-001a — does not trigger on any real EAF in the corpus, and the fix is a one-line guard at a single choke point that also encodes the real rule (*a session that meets once meets on one day*). ISSUE-001b is a reporting defect, not a data defect: the file is right, the confirmation screen is wrong, and it fires on every ticked one-time session.

The rest of the build is in good shape — error handling, privacy posture, recovery paths and copy are better than typical for a project this size. Fix ISSUE-002, take ISSUE-001a/b together while that code is open, run a manual contrast pass, and this is ready.
