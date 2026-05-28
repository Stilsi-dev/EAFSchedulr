"""In-memory store for generated ICS calendar files."""


class CalendarStore:
    def __init__(self) -> None:
        self._content: dict[str, str] = {}
        self._names: dict[str, str] = {}

    def put(self, token: str, content: str, filename: str) -> None:
        self._content[token] = content
        self._names[token] = filename

    def pop(self, token: str) -> tuple[str, str] | None:
        content = self._content.pop(token, None)
        if content is None:
            return None
        return content, self._names.pop(token, "eaf-calendar.ics")
