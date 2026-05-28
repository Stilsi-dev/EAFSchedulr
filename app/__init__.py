"""Application factory and initialization.

This module implements the Flask application factory pattern,
enabling flexible configuration and testing setup.
"""

import os

from flask import Flask

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
    app.secret_key = os.environ.get("SECRET_KEY", "eaf-to-gcal-secret-dev")
    
    if config:
        app.config.update(config)
    
    app.calendar_store = CalendarStore()  # type: ignore[attr-defined]

    # Register blueprints
    app.register_blueprint(bp)

    return app
