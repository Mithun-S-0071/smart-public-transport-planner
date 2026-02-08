# Smart Public Transport Planner — Demo

## About (for demo)

**Project:** Smart Public Transport Planner — Maps Traffic Demo

**Purpose:** A web-based mini-project demonstrating **real-time traffic visualization** and basic transport planner UI. Designed to be a drop-in module for a larger planner that would use live vehicle feeds when available. This README (About) is meant to be shown during your demo or included in project documentation.

**Author:** Mithun S

**College / Course:** Sree Sakthi Engineering College / IT
---

## Key features

- Single-page interactive UI with a landing screen and animated transition to the map.
- Light / Dark theme toggle remembered using `localStorage`.
- Embedded Google Maps with **TrafficLayer** for real-time traffic overlay (no vehicle-level tracking).
- Sample route data included for demonstration (drawn as a polyline).
- Lightweight, runs locally with a simple static HTTP server.

---

## How to run (short)

1. Place the project folder on your machine and open it in VS Code.
2. Replace `YOUR_API_KEY_HERE` in `index.html` with a valid Google Maps JavaScript API key (enable Maps JavaScript API and billing).
3. Run a local server in the project root, for example:

```bash
npx live-server
# or
python -m http.server 8000
```

4. Open `http://127.0.0.1:5000` in your browser.

---

## Files included

- `index.html` — single-page app with landing screen and map view.
- `css/style.css` — styles for landing UI, transitions, and map container.
- `js/map.js` and `js/main.js` — map initialization, UI interactions, theme handling, sample-data loading.
- `data/sample_routes.json` — demo route geometry.
- `assets/logo.png` — placeholder logo.
- `README.md` — this file (About/usage info).

---

## Notes & demo script

- When presenting: start on the landing screen. Toggle theme to show the remembered setting. Click **View Live Traffic** — the page will animate and show the map with traffic overlay and a sample route.
- Mention: Coimbatore live vehicle feeds weren’t publicly available at the time; this demo uses Google TrafficLayer as the real-time element. The architecture supports swapping in GTFS‑Realtime or other feeds later.

---

---
