"""Shared Flask extension instances (initialized later via init_app)."""

from flask import current_app, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


def client_ip() -> str:
    """The address to rate-limit on: the student, not the infrastructure.

    Render fronts every onrender.com service with Cloudflare, so a request
    reaches gunicorn two hops from the student and `remote_addr` is Render's
    router. ProxyFix can undo that, but only if it is told exactly how many
    proxies to look past, and that count goes silently wrong the day the edge
    topology changes. Wrong is not loud here: it just drops every student back
    into one bucket, and the per-IP cap starts throttling the whole site at
    once.

    `CF-Connecting-IP` sidesteps the counting. Cloudflare sets it to the
    connecting client and overwrites whatever the client sent, so it names the
    student no matter how many hops follow. That only holds while Cloudflare is
    genuinely in front, which is what the config flag records. With the flag
    off, or the header missing, this falls back to the ProxyFix-corrected
    address.
    """
    if current_app.config.get("TRUST_CF_CONNECTING_IP"):
        forwarded_for = request.headers.get("CF-Connecting-IP")
        if forwarded_for:
            return forwarded_for
    return get_remote_address()


limiter = Limiter(
    key_func=client_ip,
    default_limits=[],
    storage_uri="memory://",
)
