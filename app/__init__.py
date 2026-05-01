"""Application factory and initialization.

This module implements the Flask application factory pattern,
enabling flexible configuration and testing setup.
"""

from flask import Flask

from app.routes import bp


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
    app.secret_key = "eaf-to-gcal-secret"
    
    if config:
        app.config.update(config)
    
    # Register blueprints
    app.register_blueprint(bp)
    
    return app
