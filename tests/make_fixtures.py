"""Regenerate parser test fixtures from local EAF PDFs.

The real PDFs live in `EAF Samples/` and are gitignored: they contain student
names and ID numbers. This script strips both, keeps the course rows verbatim
(they are what the parser is actually tested against), and writes:

    tests/fixtures/<slug>.txt          anonymised extracted text
    tests/fixtures/<slug>.golden.json  the full parsed result for that text

Run after adding a new sample, or when a parser change is intentional:

    python tests/make_fixtures.py

Then read the golden diff before committing it. That diff is the whole point.
"""

from __future__ import annotations

import dataclasses
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pypdf import PdfReader

from app.services.parser import parse_eaf_text

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLES_DIR = REPO_ROOT / "EAF Samples"
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures"

# Explicit source -> (slug, fake student id). Explicit so that adding a sample
# is a deliberate act and the fixture names stay descriptive.
#
# Source filenames are neutral on purpose. This file is committed; the PDFs are
# not. A name like `<student id>.pdf` or `<first name> ASSESSMENT FORM.pdf`
# would publish the very identifiers `anonymise` strips out of the text.
SAMPLES: dict[str, tuple[str, str]] = {
    "sample-bsfin.pdf": ("bsfin_lasare2_thu", "11900001"),
    "sample-bsece.pdf": ("bsece_lasare3_wed_tba", "11900002"),
    "sample-cs.pdf": ("cs_lasare3_wed", "11900003"),
    "sample-cpe.pdf": ("cpe_lasare3_wed", "11900004"),
    # The form that surfaced "Practicum / Internship". Drop the PDF in to
    # generate it; until then this entry skips.
    "sample-bsit.pdf": ("bsit_practicum_sat", "11900005"),
}

COURSE_ROW_START = re.compile(r"^\d+\s+[A-Z0-9]+-")


def anonymise(text: str, fake_student_id: str) -> str:
    """Replace the identifying header with a synthetic one.

    Everything before the first course row is discarded except the academic
    session line, which the filename regex depends on. The course rows
    themselves carry no name or ID, so they are kept exactly as extracted.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    first_row = next(
        (i for i, line in enumerate(lines) if COURSE_ROW_START.match(line)), None
    )
    if first_row is None:
        raise ValueError("no course rows found - is this an EAF?")

    header = lines[:first_row]
    session_line = next((line for line in header if "ACADEMIC SESSION" in line), None)
    if session_line is None:
        raise ValueError("no ACADEMIC SESSION line - filename derivation is untestable")

    # Drop any program prefix: it is not needed and narrows the field of
    # students this fixture could belong to.
    session_line = session_line[session_line.index("ACADEMIC SESSION"):]

    column_header = next((line for line in header if line.startswith("Sr.No")), None)

    body: list[str] = []
    for line in lines[first_row:]:
        body.append(line)
        if line.startswith("Payments"):
            break  # everything past here is fee data

    rebuilt = [
        "ENROLLMENT ASSESSMENT FORM",
        "STUDENT NAME : SAMPLE STUDENT",
        f"STUDENT ID : {fake_student_id}",
        session_line,
    ]
    if column_header:
        rebuilt.append(column_header)
    rebuilt.extend(body)
    return "\n".join(rebuilt) + "\n"


def main() -> int:
    if not SAMPLES_DIR.is_dir():
        print(f"{SAMPLES_DIR} not found - nothing to regenerate.", file=sys.stderr)
        return 1

    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    for source_name, (slug, fake_id) in SAMPLES.items():
        source = SAMPLES_DIR / source_name
        if not source.exists():
            print(f"skip {slug}: {source_name} not present locally")
            continue

        reader = PdfReader(str(source))
        raw = "\n".join(page.extract_text() or "" for page in reader.pages)
        text = anonymise(raw.replace("\r", ""), fake_id)

        leaked = re.findall(r"\b\d{6,}\b", text)
        assert set(leaked) <= {fake_id}, f"{slug}: unmasked digit run {set(leaked)}"

        parsed = parse_eaf_text(text)
        golden = {
            "suggested_filename": parsed.suggested_filename,
            "events": [dataclasses.asdict(event) for event in parsed.events],
            "ambiguous_rows": [dataclasses.asdict(row) for row in parsed.ambiguous_rows],
        }

        (FIXTURES_DIR / f"{slug}.txt").write_text(text, encoding="utf-8")
        (FIXTURES_DIR / f"{slug}.golden.json").write_text(
            json.dumps(golden, indent=2) + "\n", encoding="utf-8"
        )
        print(
            f"wrote {slug}: {len(parsed.events)} events, "
            f"{len(parsed.ambiguous_rows)} ambiguous"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
