"""Application entry point.

This is the main script to run the Flask development server.
Execute with: python run.py
"""

from app import create_app

app = create_app()

if __name__ == "__main__":
    # Keep a single stable process in local dev so Vite proxy does not lose
    # the backend when Flask's reloader restarts.
    app.run(debug=True, use_reloader=False)
