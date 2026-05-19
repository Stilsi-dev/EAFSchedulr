"""Flask application factory.

Provides a simple `create_app` factory that constructs and configures
the Flask application used by `run.py` and any WSGI server.
"""
import os
from pathlib import Path

from flask import Flask


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

		# Register routes
		from . import routes

		app.register_blueprint(routes.bp)

		return app
