# Health Dashboard

A private, offline health dashboard that you install on an Android phone from Chrome. It tracks lab results, imported wearable data and a daily log, and it stores everything **on your device only**.

**Live app:** https://jljc79.github.io/H_APP-tracking/

## Privacy model

- **Your data never leaves the phone.** It is stored in the browser's IndexedDB storage for this app. There is no server, account or analytics, and the app sends no network requests with your data. A Content-Security-Policy blocks requests to any other site.
- **This repository contains code only.** It is public so it can be hosted free on GitHub Pages. Anyone who opens the site gets an empty app with its own separate storage. They cannot see yours.
- **Never commit real data.** `.gitignore` blocks backup files and CSVs outside `sample-data/`. The deploy workflow also refuses to publish if one slips in. Everything in `sample-data/` is fake.
- **The PIN is a screen lock, not encryption.** It hides the app when it opens and after 1 minute in the background. It does not protect against someone with full access to your unlocked phone. Use your phone's own screen lock too.
- **Backups are plain, unencrypted JSON.** Keep them somewhere private, such as your own cloud drive folder. Don't put them in a shared folder or in this repo.

## Install on Android

1. Open the live app link in **Chrome** on the phone.
2. Tap the **⋮** menu → **Install app** (on some versions **Add to Home screen** → **Install**).
3. Open it from the home screen icon. It runs full-screen and works with no connection.
4. Optional: in the app, go to **Settings → Load demo data** to explore with fake data, then **Remove demo data** when you're done. Demo data can only be loaded into an empty app, so it never mixes with your own.

Installing also lets Chrome mark the app's storage as *persistent*, so it isn't cleared automatically when the phone is low on space. **Settings → Storage** shows whether this is on.

**Updates:** the app updates itself the next time it's opened with a connection, and the new version is used from the following launch.

## Features

| Screen | What it does |
|---|---|
| **Overview** | Time range 1M / 6M / 1Y / All. Shows today's log progress, the latest lab result per test with out-of-range flags, and key metric tiles (latest, average, sparkline). Star metrics on the Wearables or Log history screens to choose the tiles. |
| **Labs** | Add, edit and delete results (test, value, units, reference low/high, date, notes). **+ Visit** enters every result from one doctor visit or lab report at once (see below). The list is grouped by test and flags High ▲ / Low ▼. Each test has a trend chart with the reference range shaded and out-of-range points in red, plus a data table for screen readers. |
| **Log** | Define your own fields: number (with unit and step), scale 1–10, yes/no, or text. The quick-entry screen has big buttons within thumb reach and saves on every tap. Tap a selected button again to clear it. History shows charts and yes/no rates. Fields can be reordered, archived (keeps history) or deleted. |
| **Wearables** | CSV import (several files at once, Samsung Health supported) with a column mapping you set once and the app saves (see below). One chart per metric. Rename/merge a metric, or delete all of its data. |
| **Settings** | Export/import backup, PIN lock, theme (system/light/dark), demo data, storage status, delete everything. |

## Back up your data

Because the data lives only on the phone, **uninstalling the app or clearing Chrome's site data deletes it.** Back up regularly:

1. **Settings → Export backup**. This downloads `health-backup-YYYY-MM-DD.json` to the phone's Downloads.
2. Move the file somewhere private, such as your personal Google Drive.
3. To restore, or to move to a new phone: install the app, then go to **Settings → Import a backup file** and pick the file.
   - **Merge** adds records to what's already there. A record with the same id (or the same metric and day) is updated.
   - **Replace** deletes the current data first.

Settings shows the date of your last backup. The PIN is never included in a backup.

## Backup / import file format

A backup is one UTF-8 JSON object. You can also prepare one elsewhere (in a spreadsheet, a script, or by hand) to bulk-load data. Rules:

- `format` must be `"health-dashboard-backup"` and `version` must be `1`.
- Every section is optional. Leave out the ones you don't need.
- Dates are `YYYY-MM-DD` strings.
- Numbers can be JSON numbers or numeric strings. `"5,6"` (comma decimal) is accepted.
- **Invalid records are skipped, not fatal.** Before importing, the app lists each skipped record and the reason.
- Unknown extra properties (such as `_comment`) are ignored.

```jsonc
{
  "format": "health-dashboard-backup",   // required, exactly this
  "version": 1,                           // required
  "exportedAt": "2025-03-01T09:00:00Z",   // optional, informational

  "labs": [{
    "id": "optional-any-string",          // optional; generated if missing. Same id = update on merge
    "test": "Vitamin D",                  // required
    "value": 68,                          // required, number
    "units": "nmol/L",                    // optional
    "low": 50,                            // optional reference low  (number or null)
    "high": 125,                          // optional reference high (number or null)
    "date": "2025-02-20",                 // required
    "notes": ""                           // optional
  }],

  "metrics": [{                           // wearable / daily values, one per metric per day
    "metric": "resting_hr",               // required; any name
    "date": "2025-02-28",                 // required
    "value": 58,                          // required, number
    "source": "my-script"                 // optional
  }],

  "logFields": [{
    "id": "mood",                         // optional; generated if missing (needed to reference by id)
    "name": "Mood",                       // required
    "type": "scale",                      // required: "number" | "scale" | "bool" | "text"
    "unit": "",                           // optional, for "number"
    "step": 1,                            // optional, +/− step for "number"
    "order": 0,                           // optional, position on quick entry
    "archived": false                     // optional
  }],

  "logEntries": [{
    "date": "2025-02-28",                 // required
    "fieldId": "mood",                    // a field id ...
    "field": "Mood",                      // ... OR a field name (case-insensitive); fields in the file or already in the app
    "value": 7                            // scale: whole number 1–10 · number: number · bool: true/false/"yes"/"no" · text: string
  }],

  "settings": {                           // optional
    "csvMappings": [],                    // saved CSV column mappings (as exported)
    "overviewKeys": ["metric:resting_hr", "log:mood"]   // starred overview tiles
  }
}
```

One entry per field per day. Importing a second entry for the same day and field replaces the first.

**Sample file:** [`sample-data/fake-sample-backup.json`](sample-data/fake-sample-backup.json) uses every section, including log entries that reference fields by name. All its values are fake.

## Lab results from a visit
**Labs → + Visit** enters a whole lab report in one go. Enter the date and, if you like, the clinic or lab (saved in each result's notes). Then add one row per test: name, value, units and reference range.

- Pick a test you have entered before, and its units and range are filled in.
- **Repeat tests from a previous visit** adds a row for each test from that date, with units and ranges filled in. You type only the new values.
- Rows without a value are ignored, so you can leave tests that weren't done this time. A row with a value needs a test name, and the same test can't appear twice.
- **Save all** saves every row together.

## Wearable CSV import
Most wearable apps, and tools that read Health Connect or Google Fit, can export CSV. Go to **Wearables → Import CSV** and pick one or more files. Files are read on the phone and nothing is uploaded. Map each new kind of file once:

- **Column names are on:** some exports put a line of information above the column names. The app finds the real header row, and you can pick a different one.
- **Long layout:** one row per measurement, with a date column, a metric-name column and a value column ([example](sample-data/fake-wearable-long.csv)).
- **Wide layout:** one row per date and one column per metric. Tick the columns to import ([example](sample-data/fake-wearable-wide.csv)). Id, version, time and device columns aren't ticked by default.
- **Save as:** for each ticked column you can give the metric name to store it under. Pick an existing name from the list (for example `Steps` or `Heart rate avg (bpm)`) so new data joins the history you already have.
- **Date format:** `YYYY-MM-DD` (with or without a time), `DD/MM/YYYY`, `MM/DD/YYYY` or a Unix timestamp. The app guesses, and shows how it reads the first row so you can check.
- **Times are UTC:** converts times to your phone's local day before grouping by day. It's on by default when the file has a `time_offset` column (Samsung Health). When it's off, any time of day is ignored.
- **Several values on one day:** *Automatic* adds up steps, calories, distance and minutes, and averages everything else. You can also choose average, sum or last for all metrics.
- **Check** shows how many daily values each metric will get, and how many cells were unreadable, before anything is saved.

The mapping is saved under the file's exact header row. With **Import files with saved mappings automatically** on (the default), the next export from the same app imports with no questions asked. Turn it off to review each file. A summary of every file is shown at the end. Comma, semicolon and tab delimiters are all detected. Re-importing overlapping dates updates those days rather than duplicating them. If two sources name the same metric differently (for example `hrv_ms` and `HRV (ms)`), use **Rename / merge** on the Wearables screen.

### Samsung Health
1. On the phone, open **Samsung Health → ☰ / ⋮ → Settings → Download personal data** and confirm. (The menu wording varies a little between versions.)
2. The export lands in **Download/Samsung Health/** as a folder with one CSV per data type, such as `com.samsung.shealth.tracker.heart_rate.<date>.csv` or `com.samsung.shealth.step_daily_trend.<date>.csv`.
3. In this app, **Wearables → Import CSV**, open that folder and select the files you want (long-press to select several).
4. The first time, map each file: the app skips Samsung's information line, drops the `com.samsung.health…` prefixes from column names and ticks UTC. Use **Save as** to name the columns you care about (for example `heart_rate` → `Heart rate avg (bpm)`, `count` → `Steps`). Next time, the same files import automatically.

Fake examples in the Samsung layout: [`fake-samsung-heart_rate…csv`](sample-data/fake-samsung-heart_rate.20250430120000.csv) and [`fake-samsung-step_daily_trend…csv`](sample-data/fake-samsung-step_daily_trend.20250430120000.csv).

## Keeping it up to date
- **After a doctor visit:** Labs → **+ Visit**, choose **Repeat tests from a previous visit**, type the new values, **Save all**.
- **Wearables (weekly or monthly):** export from Samsung Health (or your app), then Wearables → Import CSV and select the new files. Saved mappings import them automatically. Overlapping days are updated, not duplicated. Delete the export from Download afterwards if you don't want copies lying around.
- **Daily:** Log → quick entry.
- **Back up regularly:** Settings → **Export backup** after each batch of changes, or at least monthly. Keep the file in a private place, such as your own Google Drive, and delete older copies you no longer need. The Settings screen shows the date of your last export.

## Development

Plain HTML, CSS and ES modules. There is no framework, build step or third-party code, and charts are hand-written SVG.

```
index.html, css/app.css      app shell, theme tokens (light/dark, WCAG AA contrast)
js/app.js                    hash router, PIN lock, service worker registration
js/db.js                     IndexedDB wrapper (stores: labs, metrics, logFields, logEntries, settings)
js/backup.js                 export, validation, import
js/csv.js                    CSV parser and column mapping
js/chart.js                  SVG line chart with reference band, sparkline, data table
js/views/*.js                one module per screen
sw.js                        offline cache. Bump VERSION when any file changes
tools/serve.ps1              local static server (Windows, no Python/Node needed)
tools/make-icons.ps1         regenerates icons/*.png
```

Run locally:

```bash
powershell -ExecutionPolicy Bypass -File tools/serve.ps1
```

Then open http://localhost:8080. The service worker caches files aggressively. While developing, use Chrome DevTools → Application → Service workers → *Update on reload*, or bump `VERSION` in `sw.js`.

**Releasing:** bump `VERSION` in `sw.js` (otherwise installed phones keep the old cached files), commit and push to `main`. The workflow in `.github/workflows/pages.yml` deploys automatically.

### GitHub Pages setup (one time)

Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. After that, every push to `main` deploys.
