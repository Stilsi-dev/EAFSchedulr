"""Integration tests for the /inspect and /generate endpoints."""

import pytest
from io import BytesIO
from unittest.mock import patch
from datetime import date

from app import create_app
from app.models import Event
from app.services.parser import AmbiguousRow, ParsedEAF


@pytest.fixture
def app():
    app = create_app()
    app.config["TESTING"] = True
    app.config["RATELIMIT_ENABLED"] = False
    return app


@pytest.fixture
def client(app):
    return app.test_client()


def _fake_pdf():
    return (BytesIO(b"%PDF-fake"), "test.pdf")


SAMPLE_EVENT = Event(
    code="LASCS11",
    title="LASCS11 L01",
    course_name="COMPUTER SCIENCE FUNDAMENTALS",
    course_type="Lecture",
    day="MON",
    start_time="7:30 AM",
    end_time="9:00 AM",
    location="G205",
)

SAMPLE_PARSED = ParsedEAF(
    events=[SAMPLE_EVENT],
    ambiguous_rows=[],
    suggested_filename="12345678_T1_AY24-25_Schedule.ics",
)


class TestInspect:
    def test_happy_path(self, client):
        with patch("app.routes.parse_eaf_pdf", return_value=SAMPLE_PARSED), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            resp = client.post(
                "/inspect",
                data={"eaf_pdf": _fake_pdf()},
                content_type="multipart/form-data",
            )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["event_count"] == 1
        assert body["course_count"] == 1
        assert body["generated_filename"] == "12345678_T1_AY24-25_Schedule.ics"
        assert body["has_recollection"] is False

    def test_no_file_returns_400(self, client):
        resp = client.post("/inspect", data={}, content_type="multipart/form-data")
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_invalid_pdf_returns_400(self, client):
        with patch("app.routes.validate_pdf_file", return_value=(False, "Only PDF files are accepted.")):
            resp = client.post(
                "/inspect",
                data={"eaf_pdf": (BytesIO(b"not a pdf"), "bad.txt")},
                content_type="multipart/form-data",
            )
        assert resp.status_code == 400
        assert resp.get_json()["error"] == "Only PDF files are accepted."


class TestGenerate:
    def test_happy_path(self, client):
        with patch("app.routes.parse_eaf_pdf", return_value=SAMPLE_PARSED), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            resp = client.post(
                "/generate",
                data={
                    "eaf_pdf": _fake_pdf(),
                    "term_start": "2025-08-25",
                    "weeks": "14",
                },
                content_type="multipart/form-data",
                headers={"Accept": "application/json"},
            )
        assert resp.status_code == 200
        body = resp.get_json()
        assert "download_url" in body
        assert body["generated_filename"] == "12345678_T1_AY24-25_Schedule.ics"
        assert body["event_count"] == 1
        assert body["weeks"] == 14

    def test_no_file_returns_400(self, client):
        resp = client.post(
            "/generate",
            data={},
            content_type="multipart/form-data",
            headers={"Accept": "application/json"},
        )
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_invalid_term_start_returns_400(self, client):
        with patch("app.routes.parse_eaf_pdf", return_value=SAMPLE_PARSED), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            resp = client.post(
                "/generate",
                data={
                    "eaf_pdf": _fake_pdf(),
                    "term_start": "not-a-date",
                    "weeks": "14",
                },
                content_type="multipart/form-data",
                headers={"Accept": "application/json"},
            )
        assert resp.status_code == 400
        assert "error" in resp.get_json()

    def test_download_token_works(self, client):
        with patch("app.routes.parse_eaf_pdf", return_value=SAMPLE_PARSED), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            gen_resp = client.post(
                "/generate",
                data={
                    "eaf_pdf": _fake_pdf(),
                    "term_start": "2025-08-25",
                    "weeks": "14",
                },
                content_type="multipart/form-data",
                headers={"Accept": "application/json"},
            )
        assert gen_resp.status_code == 200
        download_url = gen_resp.get_json()["download_url"]
        dl_resp = client.get(download_url)
        assert dl_resp.status_code == 200
        assert dl_resp.headers["Content-Type"] == "text/calendar; charset=utf-8"

    def test_expired_token_redirects(self, client):
        resp = client.get("/download/nonexistent-token")
        assert resp.status_code == 302


PARTIAL_PARSED = ParsedEAF(
    events=[SAMPLE_EVENT],
    ambiguous_rows=[
        AmbiguousRow(
            code="GESTSOC",
            row_number=2,
            text="2 GESTSOC-SCIENCE AND SOCIETY Lecture Z30 3.00 MON | 0915-1045 | G206",
            reason="Could not confidently parse the schedule fragment: MON | 0915-1045 | G206",
        )
    ],
    suggested_filename="12345678_T1_AY24-25_Schedule.ics",
)


class TestPartialParse:
    """A partially-readable EAF must surface what was dropped, not hide it."""

    def test_inspect_returns_ambiguous_rows_alongside_events(self, client):
        with patch("app.routes.parse_eaf_pdf", return_value=PARTIAL_PARSED),              patch("app.routes.validate_pdf_file", return_value=(True, "")):
            resp = client.post(
                "/inspect",
                data={"eaf_pdf": _fake_pdf()},
                content_type="multipart/form-data",
            )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["event_count"] == 1
        assert len(body["ambiguous_rows"]) == 1

        row = body["ambiguous_rows"][0]
        assert row["code"] == "GESTSOC"
        assert row["row_number"] == 2
        assert "0915-1045" in row["text"], "raw row text is what the user reports back"
        assert row["reason"]


TOTAL_FAILURE_PARSED = ParsedEAF(
    events=[],
    ambiguous_rows=[
        AmbiguousRow(
            code="CSSWENG",
            row_number=1,
            text="1 CSSWENG-SOFTWARE ENGINEERING Lecture S01 3.00 MON | 09:15 AM-10:45 AM | G206 | Face-to-Face",
            reason="Could not confidently parse the schedule fragment.",
        )
    ],
    suggested_filename="eaf-calendar.ics",
)


def test_inspect_returns_rows_when_nothing_parses(client):
    """When the whole format has drifted, the rows are all the user can report."""
    with patch("app.routes.parse_eaf_pdf", return_value=TOTAL_FAILURE_PARSED),          patch("app.routes.validate_pdf_file", return_value=(True, "")):
        resp = client.post(
            "/inspect",
            data={"eaf_pdf": _fake_pdf()},
            content_type="multipart/form-data",
        )

    assert resp.status_code == 400
    body = resp.get_json()
    assert "error" in body
    assert len(body["ambiguous_rows"]) == 1
    assert body["ambiguous_rows"][0]["code"] == "CSSWENG"


def test_expired_download_token_answers_json_for_the_app(client):
    """The app fetches this endpoint, so a refusal has to be readable.

    A redirect would be followed to the shell, whose 200 the client reads as
    success, and the flash it carries has nothing to render it: `index` serves
    a static file rather than a template.
    """
    response = client.get("/download/deadbeef", headers={"Accept": "application/json"})

    assert response.status_code == 410
    assert response.headers["Content-Type"].startswith("application/json")
    assert "expired" in response.get_json()["error"].lower()


def test_expired_download_token_still_redirects_plain_navigation(client):
    """A browser following the link directly keeps the old behaviour."""
    response = client.get("/download/deadbeef")

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/")


SEMINAR_EVENT = Event(
    code="SAS2000",
    title="SAS2000 C02",
    course_name="STUDENT AFFAIRS SERVICES",
    course_type="Seminar / Workshop",
    day="WED",
    start_time="08:00 AM",
    end_time="11:00 AM",
    location="L209",
)

PARSED_WITH_SEMINAR = ParsedEAF(
    events=[SAMPLE_EVENT, SEMINAR_EVENT],
    ambiguous_rows=[],
    suggested_filename="12345678_T1_AY24-25_Schedule.ics",
)


class TestOneTimeSessions:
    def test_inspect_offers_the_seminar_and_not_the_lecture(self, client):
        """The hint reaches the UI, so it can ask rather than assume."""
        with patch("app.routes.parse_eaf_pdf", return_value=PARSED_WITH_SEMINAR), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            resp = client.post(
                "/inspect",
                data={"eaf_pdf": _fake_pdf()},
                content_type="multipart/form-data",
            )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["one_time_candidates"] == {"SAS2000": ["WED"]}

    def test_a_marked_course_is_generated_as_a_single_session(self, client):
        with patch("app.routes.parse_eaf_pdf", return_value=PARSED_WITH_SEMINAR), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            gen_resp = client.post(
                "/generate",
                data={
                    "eaf_pdf": _fake_pdf(),
                    "term_start": "2025-08-25",
                    "weeks": "14",
                    "one_time_date_SAS2000": "2025-08-27",
                },
                content_type="multipart/form-data",
                headers={"Accept": "application/json"},
            )
        assert gen_resp.status_code == 200
        ics = client.get(gen_resp.get_json()["download_url"]).get_data(as_text=True)

        seminar = [b for b in ics.split("BEGIN:VEVENT") if "SAS2000" in b]
        assert len(seminar) == 1
        assert "RRULE" not in seminar[0]
        assert "20250827" in seminar[0]

    def test_an_unmarked_course_still_repeats_weekly(self, client):
        """Unchecked is the default, and the default must not lose classes."""
        with patch("app.routes.parse_eaf_pdf", return_value=PARSED_WITH_SEMINAR), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            gen_resp = client.post(
                "/generate",
                data={
                    "eaf_pdf": _fake_pdf(),
                    "term_start": "2025-08-25",
                    "weeks": "14",
                },
                content_type="multipart/form-data",
                headers={"Accept": "application/json"},
            )
        assert gen_resp.status_code == 200
        ics = client.get(gen_resp.get_json()["download_url"]).get_data(as_text=True)

        seminar = [b for b in ics.split("BEGIN:VEVENT") if "SAS2000" in b]
        assert len(seminar) == 1
        assert "RRULE" in seminar[0]

    def test_a_bad_one_time_date_is_refused_not_ignored(self, client):
        """Silently dropping it would repeat a session the student said was once."""
        with patch("app.routes.parse_eaf_pdf", return_value=PARSED_WITH_SEMINAR), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            resp = client.post(
                "/generate",
                data={
                    "eaf_pdf": _fake_pdf(),
                    "term_start": "2025-08-25",
                    "weeks": "14",
                    "one_time_date_SAS2000": "not-a-date",
                },
                content_type="multipart/form-data",
                headers={"Accept": "application/json"},
            )
        assert resp.status_code == 400
        assert "SAS2000" in resp.get_json()["error"]

    def test_a_one_time_date_must_fall_on_the_scheduled_weekday(self, client):
        """SAS2000 meets on a Wednesday, so a Thursday date is a typo.

        The student is the authority on whether a course meets once. They are
        not the authority on which weekday the EAF printed, so a mismatch is
        worth catching before it reaches a calendar.
        """
        with patch("app.routes.parse_eaf_pdf", return_value=PARSED_WITH_SEMINAR), \
             patch("app.routes.validate_pdf_file", return_value=(True, "")):
            resp = client.post(
                "/generate",
                data={
                    "eaf_pdf": _fake_pdf(),
                    "term_start": "2025-08-25",
                    "weeks": "14",
                    "one_time_date_SAS2000": "2025-08-28",  # a Thursday
                },
                content_type="multipart/form-data",
                headers={"Accept": "application/json"},
            )
        assert resp.status_code == 400
        assert "Wednesday" in resp.get_json()["error"]
