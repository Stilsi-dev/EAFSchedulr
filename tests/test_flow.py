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
