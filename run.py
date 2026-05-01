"""Application entry point.

This is the main script to run the Flask development server.
Execute with: python run.py
"""

from app import create_app

app = create_app()

if __name__ == "__main__":
    app.run()
