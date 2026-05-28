"""Flask application factory.

Provides a simple `create_app` factory that constructs and configures
the Flask application used by `run.py` and any WSGI server.
"""
import os
from pathlib import Path

from flask import Flask

from app.extensions import limiter


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

		# Use a provided secret in production; fall back for local development
		app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-please-change")

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

		# Rate limiting: 20 PDF uploads/minute per IP on the heavy endpoints
		limiter.init_app(app)

		# Register routes
		from . import routes

		app.register_blueprint(routes.bp)

		return app
