"""Parser tests against anonymised text fixtures.

Two layers, deliberately:

* `test_matches_golden` pins the *entire* parsed result for each fixture. It
  catches changes nobody thought to look for - which is what format drift is.
* The named tests below document the rules that matter, so a failure explains
  itself instead of leaving you to read a JSON diff.

Regenerate fixtures with `python tests/make_fixtures.py`, then read the diff.
"""

import dataclasses
import json
from pathlib import Path

import pytest

from app.config import RECOLLECTION_TITLES
from app.services.calendar import validate_recollection_dates
from app.services.parser import parse_eaf_text

FIXTURES_DIR = Path(__file__).parent / "fixtures"
FIXTURE_SLUGS = sorted(path.stem for path in FIXTURES_DIR.glob("*.txt"))


def load_fixture(slug: str) -> str:
    return (FIXTURES_DIR / f"{slug}.txt").read_text(encoding="utf-8")


def load_golden(slug: str) -> dict:
    return json.loads((FIXTURES_DIR / f"{slug}.golden.json").read_text(encoding="utf-8"))


def parse_fixture(slug: str):
    return parse_eaf_text(load_fixture(slug))


def test_fixtures_exist():
    assert FIXTURE_SLUGS, "no fixtures found - run tests/make_fixtures.py"


@pytest.mark.parametrize("slug", FIXTURE_SLUGS)
def test_matches_golden(slug):
    """Full-fidelity drift detection: every field of every event."""
    parsed = parse_fixture(slug)
    actual = {
        "suggested_filename": parsed.suggested_filename,
        "events": [dataclasses.asdict(event) for event in parsed.events],
        "ambiguous_rows": [dataclasses.asdict(row) for row in parsed.ambiguous_rows],
    }
    expected = load_golden(slug)

    if actual != expected:
        differing = [
            f"  event {i}: expected {e} got {a}"
            for i, (e, a) in enumerate(zip(expected["events"], actual["events"]))
            if e != a
        ]
        detail = "\n".join(differing[:5]) or "  (structural difference, see full diff)"
        pytest.fail(
            f"{slug} no longer parses as recorded.\n{detail}\n"
            "If this change is intentional, run tests/make_fixtures.py and "
            "review the golden diff before committing."
        )


@pytest.mark.parametrize("slug", FIXTURE_SLUGS)
def test_every_known_sample_parses_cleanly(slug):
    """No sample we ship should produce ambiguous rows."""
    parsed = parse_fixture(slug)
    assert parsed.ambiguous_rows == [], (
        f"{slug} produced ambiguous rows: "
        f"{[row.text for row in parsed.ambiguous_rows]}"
    )
    assert parsed.events, f"{slug} produced no events"


def test_filename_derives_from_student_id_and_term():
    parsed = parse_fixture("cs_lasare3_wed")
    assert parsed.suggested_filename == "11900003_T3_AY25-26_Schedule.ics"


def test_filename_falls_back_when_metadata_missing():
    parsed = parse_eaf_text(
        "Sr.No Course Course Type Section Credits Day/Time/Room\n"
        "1 CSSWENG-SOFTWARE ENGINEERING Lecture S01 3.00 MON | 09:15 AM-10:45 AM | G206\n"
    )
    assert parsed.suggested_filename == "eaf-calendar.ics"
    assert len(parsed.events) == 1


def test_missing_room_becomes_tba():
    parsed = parse_fixture("bsece_lasare3_wed_tba")
    tba = [event for event in parsed.events if event.location == "TBA"]
    assert tba, "expected at least one meeting with no room assigned"


def test_online_location_is_normalised():
    parsed = parse_fixture("cs_lasare3_wed")
    assert any(event.location == "Online" for event in parsed.events)


def test_recollection_is_detected_with_its_weekday():
    parsed = parse_fixture("bsfin_lasare2_thu")
    recollections = [e for e in parsed.events if e.code in RECOLLECTION_TITLES]
    assert [e.code for e in recollections] == ["LASARE2"]
    assert recollections[0].day == "THU"


def test_recollection_date_must_match_its_weekday():
    from datetime import date

    parsed = parse_fixture("bsfin_lasare2_thu")  # LASARE2 falls on a Thursday

    validate_recollection_dates(parsed.events, {"LASARE2": date(2026, 9, 3)})  # Thursday

    with pytest.raises(ValueError, match="Thursday"):
        validate_recollection_dates(parsed.events, {"LASARE2": date(2026, 9, 4)})  # Friday


def test_unreadable_row_becomes_an_ambiguous_row_not_a_silent_drop():
    parsed = parse_eaf_text(
        "Sr.No Course Course Type Section Credits Day/Time/Room\n"
        "1 CSSWENG-SOFTWARE ENGINEERING Lecture S01 3.00 MON | 09:15 AM-10:45 AM | G206\n"
        "2 GESTSOC-SCIENCE AND SOCIETY Lecture Z30 3.00 MON | 0915-1045 | G206\n"
    )
    assert len(parsed.events) == 1
    assert len(parsed.ambiguous_rows) == 1
    assert parsed.ambiguous_rows[0].code == "GESTSOC"


def test_extra_schedule_column_is_flagged_not_absorbed():
    """A new pipe-delimited column must fail the row, not corrupt the room.

    With a permissive `[^,]*` location group this row parsed "successfully"
    with location "G206 | Face-to-Face" - a wrong room, silently. The student
    would have been sent to the wrong place with no warning anywhere.
    """
    parsed = parse_eaf_text(
        "Sr.No Course Course Type Section Credits Day/Time/Room" + chr(10) +
        "1 CSSWENG-SOFTWARE ENGINEERING Lecture S01 3.00 "
        "MON | 09:15 AM-10:45 AM | G206 | Face-to-Face" + chr(10)
    )
    assert parsed.events == []
    assert len(parsed.ambiguous_rows) == 1
    assert parsed.ambiguous_rows[0].code == "CSSWENG"
    assert "Face-to-Face" in parsed.ambiguous_rows[0].text


def test_ordinary_room_and_empty_room_still_parse():
    """The hardening must not reject anything that exists today."""
    parsed = parse_eaf_text(
        "Sr.No Course Course Type Section Credits Day/Time/Room" + chr(10) +
        "1 CSSWENG-SOFTWARE ENGINEERING Lecture S01 3.00 "
        "MON | 09:15 AM-10:45 AM | G206,  SAT | 06:00 PM-09:15 PM |" + chr(10)
    )
    assert parsed.ambiguous_rows == []
    assert [e.location for e in parsed.events] == ["G206", "TBA"]
