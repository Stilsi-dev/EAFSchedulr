"""The rate limiter must key on the student, not on the infrastructure.

`remote_addr` is whatever address opened the TCP connection, which behind a
PaaS router is the router. Left uncorrected, every student lands in the same
bucket and the per-client cap on the upload endpoints throttles the whole site
once. These tests send requests the way the real chain does, so they fail if
either correction (ProxyFix, or the Cloudflare header) is removed.
"""

import os
from unittest.mock import patch

from app import create_app
from app.extensions import client_ip, limiter

# Stands in for Render's router: the address the app's socket actually sees,
# whoever the student is.
ROUTER_ADDR = "10.0.0.1"

# Stands in for the Cloudflare edge, the hop between the student and Render.
EDGE_ADDR = "192.0.2.50"

STUDENT_ADDR = "203.0.113.7"

PROBE_ROUTE = "/__probe_client_ip"


def _app(**overrides):
    """An app built with an explicit environment, so the host's own leaks in."""
    environ = {"TRUSTED_PROXY_COUNT": "1", "TRUST_CF_CONNECTING_IP": "1"}
    environ.update(overrides)
    with patch.dict(os.environ, environ):
        app = create_app()
    app.config["TESTING"] = True

    # Reports the key the limiter would use. Registered here rather than in the
    # blueprint so nothing ships to production purely to be testable.
    app.add_url_rule(PROBE_ROUTE, "probe", client_ip)
    return app


def _bucket_for(app, forwarded_for=None, cf_connecting_ip=None):
    """The limiter key for a request arriving through the proxy chain.

    Goes through `test_client` rather than `test_request_context` on purpose:
    ProxyFix is WSGI middleware, so a bare request context bypasses it and the
    test would pass whether or not the fix is installed.
    """
    headers = {}
    if forwarded_for is not None:
        headers["X-Forwarded-For"] = forwarded_for
    if cf_connecting_ip is not None:
        headers["CF-Connecting-IP"] = cf_connecting_ip

    response = app.test_client().get(
        PROBE_ROUTE,
        environ_base={"REMOTE_ADDR": ROUTER_ADDR},
        headers=headers,
    )
    return response.get_data(as_text=True)


class TestCloudflareHeader:
    """The production path: Cloudflare names the student outright."""

    def test_names_the_student_whatever_the_hop_count(self):
        app = _app()
        assert (
            _bucket_for(
                app,
                forwarded_for=f"{STUDENT_ADDR}, {EDGE_ADDR}",
                cf_connecting_ip=STUDENT_ADDR,
            )
            == STUDENT_ADDR
        )

    def test_wins_over_a_miscounted_proxy_depth(self):
        """The whole point: a wrong TRUSTED_PROXY_COUNT stops mattering."""
        app = _app(TRUSTED_PROXY_COUNT="9")
        assert (
            _bucket_for(
                app,
                forwarded_for=f"{STUDENT_ADDR}, {EDGE_ADDR}",
                cf_connecting_ip=STUDENT_ADDR,
            )
            == STUDENT_ADDR
        )

    def test_is_ignored_when_cloudflare_is_not_in_front(self):
        """Off Cloudflare the header is client-supplied, so it must not count."""
        app = _app(TRUST_CF_CONNECTING_IP="0")
        assert (
            _bucket_for(app, forwarded_for=STUDENT_ADDR, cf_connecting_ip="1.2.3.4")
            == STUDENT_ADDR
        )


class TestForwardedForFallback:
    """The path taken when the Cloudflare header is absent."""

    def test_students_behind_one_router_get_separate_buckets(self):
        app = _app()
        assert _bucket_for(app, forwarded_for=STUDENT_ADDR) == STUDENT_ADDR
        assert _bucket_for(app, forwarded_for="198.51.100.42") == "198.51.100.42"

    def test_two_proxies_deep_looks_past_the_inner_hop(self):
        app = _app(TRUSTED_PROXY_COUNT="2")
        assert (
            _bucket_for(app, forwarded_for=f"{STUDENT_ADDR}, {EDGE_ADDR}")
            == STUDENT_ADDR
        )

    def test_header_is_ignored_when_no_proxy_is_trusted(self):
        """With nothing in front, X-Forwarded-For is unverifiable."""
        app = _app(TRUSTED_PROXY_COUNT="0")
        assert _bucket_for(app, forwarded_for=STUDENT_ADDR) == ROUTER_ADDR

    def test_falls_back_to_the_socket_address_with_no_headers_at_all(self):
        app = _app()
        assert _bucket_for(app) == ROUTER_ADDR


def test_the_limiter_is_actually_wired_to_this_key():
    """End to end: two students, one budget each, not one budget between them.

    The tests above call `client_ip` through a probe route, which would keep
    passing if someone swapped the Limiter's `key_func` back. This one spends a
    real budget through the real extension.
    """
    app = _app()

    @limiter.limit("2 per minute")
    def limited():
        return "ok"

    app.add_url_rule("/__limited", "limited", limited)
    with app.app_context():
        limiter.reset()

    client = app.test_client()

    def hit(student):
        return client.get(
            "/__limited",
            environ_base={"REMOTE_ADDR": ROUTER_ADDR},
            headers={"CF-Connecting-IP": student},
        ).status_code

    assert [hit(STUDENT_ADDR) for _ in range(3)] == [200, 200, 429]
    # A second student arrives with a full budget rather than an exhausted one.
    assert hit("198.51.100.42") == 200
