# 2026 Promise Tracker: Hollister & California

Static site (no build step). `index.html` + `styles.css` + `app.js` load `data/promises.json`.

## Update the data
1. Replace `data/promises_2026.csv` and/or `data/president_2024.csv` (same columns), or run
   `python3 build_data.py --from /workspace/promises` to copy them in.
2. Edit `data/notes.json` for the "last updated" date, race notes, and races with no promises.
3. Run `python3 build_data.py` (validates the CSVs and rewrites `data/promises.json`).
4. Preview: `python3 -m http.server 8000` and open http://localhost:8000
5. Publish: `git add -A && git commit -m "Data update" && git push` (GitHub Pages redeploys automatically).
