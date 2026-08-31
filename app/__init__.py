"""Flask application factory.

Provides a simple `create_app` factory that constructs and configures
the Flask application used by `run.py` and any WSGI server.
"""
import gzip
import logging
import os
from pathlib import Path

from flask import Flask, jsonify, request
from werkzeug.middleware.proxy_fix import ProxyFix

from app.config import MAX_PDF_SIZE_MB, MAX_UPLOAD_SIZE_BYTES
from app.extensions import limiter

# Response compression ------------------------------------------------------
#
# The built JS and CSS come to ~280KB uncompressed and ~71KB gzipped. On the
# mobile connections this app is actually opened on, that difference is most of
# the time the student spends looking at an empty page. A CDN in front of the
# app may compress too, but the origin cannot assume one is there.

# Types worth compressing. Anything already compressed (PDF, images, the
# woff2 that a future display face would ship as) only gets bigger.
COMPRESSIBLE_MIMETYPES = frozenset({
	"application/javascript",
	"text/javascript",
	"application/json",
	"image/svg+xml",
})

# Below this, the gzip header costs more than it saves.
COMPRESS_MIN_BYTES = 1024

# A ceiling so a single response can never be buffered without bound. Nothing
# this app serves comes close; generated calendars are a few KB.
COMPRESS_MAX_BYTES = 2 * 1024 * 1024

# Compressed bytes for static assets, keyed by ETag - which for a static file
# already encodes its path, size and mtime, so a rebuilt asset misses and
# recompresses on its own. Bounded because the key space is the handful of
# files in `public/`, and this runs under `gunicorn -w 1`.
_COMPRESSED_CACHE: dict[str, bytes] = {}
_COMPRESSED_CACHE_LIMIT = 32


def _gzip_bytes(data: bytes) -> bytes:
	"""Compress `data` with gzip, without the mtime field.

	`mtime=0` keeps the output byte-identical between runs so it stays
	comparable and cacheable.
	"""
	return gzip.compress(data, compresslevel=9, mtime=0)


def create_app() -> Flask:
		"""Create and configure the Flask application.

		- Serves static files from the repository `public/` directory.
		- Sets a secret key from the `FLASK_SECRET` environment variable (falls
			back to a development key when not provided).
		- Registers the main blueprint from `app.routes`.
		"""
		repo_root = Path(__file__).resolve().parent.parent
		app = Flask(
			__name__,
			static_folder=str(repo_root / "public"),
			static_url_path="",
		)

		# Behind a hosting platform's router, `request.remote_addr` is the
		# router's address, not the student's. Every request then hashes to the
		# same rate-limit bucket, so the cap on /inspect and /generate
		# applies to the whole site at once rather than per student. ProxyFix
		# rewrites remote_addr from X-Forwarded-For so the cap means what the
		# decorator says it means.
		#
		# The count is how many proxies actually sit in front of this app: 1 for
		# a bare PaaS router, 2 if a CDN fronts that. Set it too high and a
		# client can spoof its own address by sending the header itself; too low
		# and students share a proxy's bucket again. Set TRUSTED_PROXY_COUNT to
		# match the real chain, or 0 when running with no proxy at all.
		trusted_proxies = int(os.environ.get("TRUSTED_PROXY_COUNT", "1"))
		if trusted_proxies > 0:
			app.wsgi_app = ProxyFix(
				app.wsgi_app, x_for=trusted_proxies, x_proto=trusted_proxies
			)

		# Cloudflare fronts every onrender.com service, so in production the
		# CF-Connecting-IP header is present and authoritative, and the limiter
		# prefers it over the hop counting above. Set this to 0 if the app is
		# ever served from somewhere Cloudflare is not in front of, where the
		# header would be whatever the client decided to send.
		app.config["TRUST_CF_CONNECTING_IP"] = (
			os.environ.get("TRUST_CF_CONNECTING_IP", "1") != "0"
		)

		# Use a provided secret in production; fall back for local development
		app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-please-change")

		# Reject oversized bodies during request parsing instead of buffering
		# the whole upload and rejecting it in the view.
		app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_SIZE_BYTES

		@app.errorhandler(413)
		def handle_upload_too_large(_error):
			return (
				jsonify({"error": f"File is too large. Maximum size is {MAX_PDF_SIZE_MB}MB."}),
				413,
			)

		# Security headers on every response
		@app.after_request
		def add_security_headers(response):
			response.headers["X-Content-Type-Options"] = "nosniff"
			response.headers["X-Frame-Options"] = "DENY"
			response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
			response.headers["Content-Security-Policy"] = (
				"default-src 'self'; "
				"script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.google-analytics.com; "
				"style-src 'self' 'unsafe-inline'; "
				"img-src 'self' data: https://www.google-analytics.com; "
				"connect-src 'self' https://www.google-analytics.com; "
				"font-src 'self'; "
				"object-src 'none'; "
				"frame-ancestors 'none';"
			)
			return response

		# Cache policy.
		#
		# Vite content-hashes everything under `/assets`, so those URLs can
		# never go stale - a rebuild changes the filename. Flask's default for
		# static files is `no-cache`, which throws that away: every student
		# re-fetches both bundles from the origin, and a CDN in front of the app
		# reports the request as dynamic and declines to hold a copy near them.
		@app.after_request
		def add_cache_headers(response):
			path = request.path

			if path.startswith("/download/"):
				# A single-use link to one student's own schedule. It must not
				# be held anywhere, by anything.
				response.headers["Cache-Control"] = "no-store, private"
			elif path.startswith("/assets/"):
				response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
			elif path in ("/favicon.svg", "/schedulr-logo.svg"):
				# Not content-hashed, and referenced by a stable URL, so these
				# revalidate daily rather than never.
				response.headers["Cache-Control"] = "public, max-age=86400"
			else:
				# The HTML names the current asset hashes, so it has to be
				# revalidated or a student boots yesterday's build.
				response.headers["Cache-Control"] = "no-cache"

			return response

		# Compression. Registered after the cache handler, so it runs first and
		# the two never disagree about Content-Length.
		@app.after_request
		def compress_response(response):
			if "gzip" not in request.headers.get("Accept-Encoding", "").lower():
				return response
			if not (200 <= response.status_code < 300):
				return response
			if "Content-Encoding" in response.headers:
				return response

			mimetype = (response.mimetype or "").lower()
			if not (mimetype.startswith("text/") or mimetype in COMPRESSIBLE_MIMETYPES):
				return response

			# Reject on the declared length before reading anything, so an
			# oversized response is never pulled into memory to measure it.
			declared = response.content_length
			if declared is not None and not (COMPRESS_MIN_BYTES <= declared <= COMPRESS_MAX_BYTES):
				return response

			etag_value = response.get_etag()[0]
			cached = _COMPRESSED_CACHE.get(etag_value) if etag_value else None

			if cached is None:
				# `send_file` streams by default; turning that off is what lets
				# the body be read here. Bounded by the size checks.
				response.direct_passthrough = False
				data = response.get_data()
				if not (COMPRESS_MIN_BYTES <= len(data) <= COMPRESS_MAX_BYTES):
					return response

				cached = _gzip_bytes(data)
				if len(cached) >= len(data):
					# Already-dense content; sending it compressed would be a
					# CPU cost on both ends for nothing.
					return response

				if etag_value:
					if len(_COMPRESSED_CACHE) >= _COMPRESSED_CACHE_LIMIT:
						_COMPRESSED_CACHE.clear()
					_COMPRESSED_CACHE[etag_value] = cached

			response.direct_passthrough = False
			response.set_data(cached)
			response.headers["Content-Encoding"] = "gzip"
			response.headers["Content-Length"] = str(len(cached))
			# Without this, a shared cache could hand the gzipped body to a
			# client that never asked for it.
			response.vary.add("Accept-Encoding")

			return response

		# Parse-shape logging is emitted at INFO; without this the default
		# effective level hides it and format drift stays invisible in prod.
		app.logger.setLevel(logging.INFO)

		# Rate limiting on the heavy endpoints: 60 uploads/minute per client.
		# Sized for a shared address, not a single student. DLSU campus wifi
		# puts a whole building behind one public IP, and term start is exactly
		# when a lecture hall opens this at once; 20 would have meant one upload
		# every three seconds for all of them together.
		#
		# No site-wide `default_limits` on purpose. A global cap answers 429 to
		# everyone at once, which is the failure this keying was fixed to stop.
		# Overload is absorbed by the worker queueing requests, which delays a
		# student rather than refusing them.
		limiter.init_app(app)

		# Register routes
		from . import routes

		app.register_blueprint(routes.bp)

		return app
