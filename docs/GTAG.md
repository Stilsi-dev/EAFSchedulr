Google Analytics (gtag.js) setup
=================================

This project currently includes the `gtag.js` snippet in both:

- `templates/index.html` (Flask template served in production)
- `frontend/index.html` (Vite dev entry)

By default the snippet uses the placeholder Measurement ID `G-XXXXXXXXXX`.

Quick options
-------------

1) Manual (quick): replace `G-XXXXXXXXXX` with your Measurement ID in both files.

2) Flask env var (recommended for production):

  - Update `templates/index.html` to use a Jinja variable, e.g.:

    <script async src="https://www.googletagmanager.com/gtag/js?id={{ GA_MEASUREMENT_ID }}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      {% if GA_MEASUREMENT_ID %}gtag('config', '{{ GA_MEASUREMENT_ID }}');{% endif %}
    </script>

  - Set the env var before starting Flask (PowerShell):

    $env:GA_MEASUREMENT_ID = 'G-YYYYYYYYYY'
    python run.py

  - Or load it in `app/config.py` and inject into the template context.

3) Vite/dev (frontend) env var:

  - Use a Vite env variable like `VITE_GA_ID` and reference it in runtime code (e.g. in `src/main.tsx`). Example:

    // read at runtime
    const GA_ID = import.meta.env.VITE_GA_ID;
    if (GA_ID) {
      // dynamically load gtag and call gtag('config', GA_ID)
    }

Notes
-----
- Keeping both `templates/index.html` and `frontend/index.html` is recommended: the former is used by Flask in production, the latter is used by Vite during development.
- If you want, I can implement the env-var wiring in Flask and the frontend (injecting the ID securely), or remove the hardcoded placeholder and leave an example. Tell me which you prefer.

EOF
