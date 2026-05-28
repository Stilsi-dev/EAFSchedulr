"""In-memory store for generated ICS calendar files."""

import time


class CalendarStore:
    TTL_SECONDS = 300  # 5 minutes

    def __init__(self) -> None:
        self._entries: dict[str, tuple[str, str, float]] = {}

    def put(self, token: str, content: str, filename: str) -> None:
        self._prune()
        self._entries[token] = (content, filename, time.monotonic())

    def pop(self, token: str) -> tuple[str, str] | None:
        entry = self._entries.pop(token, None)
        if entry is None:
            return None
        content, filename, _ = entry
        return content, filename

    def _prune(self) -> None:
        now = time.monotonic()
        expired = [t for t, (_, _, ts) in self._entries.items() if now - ts > self.TTL_SECONDS]
        for t in expired:
            del self._entries[t]
