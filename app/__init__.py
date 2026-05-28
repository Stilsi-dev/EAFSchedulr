"""Application factory and initialization.

This module implements the Flask application factory pattern,
enabling flexible configuration and testing setup.
"""

import os

from flask import Flask

from app.config import MAX_PDF_SIZE_BYTES
from app.extensions import limiter
from app.routes import bp
from app.store import CalendarStore


def create_app(config: dict | None = None) -> Flask:
    """Create and configure the Flask application.

    Implements the application factory pattern for better testing
    and configuration management.

    Args:
        config: Optional dictionary of configuration values

    Returns:
        Configured Flask application instance
    """
    app = Flask(__name__, template_folder="../templates", static_folder="../static")

    app.config["MAX_CONTENT_LENGTH"] = MAX_PDF_SIZE_BYTES

    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is not set. Set it before running.")
    app.secret_key = secret_key

    app.config["SESSION_COOKIE_SECURE"] = os.environ.get("FLASK_ENV") != "development"
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_HTTPONLY"] = True

    if config:
        app.config.update(config)

    app.calendar_store = CalendarStore()  # type: ignore[attr-defined]

    limiter.init_app(app)
    app.register_blueprint(bp)

    @app.after_request
    def set_security_headers(response):
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' https://www.googletagmanager.com https://www.google-analytics.com; "
            "connect-src 'self' https://www.google-analytics.com; "
            "style-src 'self'; "
            "img-src 'self' data: https://www.google-analytics.com; "
            "frame-ancestors 'none';"
        )
        return response

    return app
