import time
import uuid

_TOKEN_TTL = 600  # seconds

_store: dict[str, tuple[str, str, float]] = {}  # token -> (ics_content, filename, expires_at)


def _evict_expired() -> None:
    now = time.monotonic()
    expired = [t for t, (_, _, exp) in _store.items() if now > exp]
    for t in expired:
        del _store[t]


def create(ics_content: str, filename: str) -> str:
    _evict_expired()
    token = uuid.uuid4().hex
    _store[token] = (ics_content, filename, time.monotonic() + _TOKEN_TTL)
    return token


def consume(token: str) -> tuple[str, str] | None:
    _evict_expired()
    entry = _store.pop(token, None)
    if entry is None:
        return None
    ics_content, filename, expires_at = entry
    if time.monotonic() > expires_at:
        return None
    return ics_content, filename
