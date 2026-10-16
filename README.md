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
| **Labs** | Add, edit and delete results (test, value, units, reference low/high, date, notes). The list is grouped by test and flags High ▲ / Low ▼. Each test has a trend chart with the reference range shaded and out-of-range points in red, plus a data table for screen readers. |
| **Log** | Define your own fields: number (with unit and step), scale 1–10, yes/no, or text. The quick-entry screen has big buttons within thumb reach and saves on every tap. Tap a selected button again to clear it. History shows charts and yes/no rates. Fields can be reordered, archived (keeps history) or deleted. |
| **Wearables** | CSV import with a column mapping you set once and the app saves (see below). One chart per metric. Rename/merge a metric, or delete all of its data. |
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

## Wearable CSV import

Most wearable apps, and tools that read Health Connect or Google Fit, can export CSV. To import one, go to **Wearables → Import CSV** and pick the file. The file is read on the phone and nothing is uploaded. Then map its columns once:

- **Long layout:** one row per measurement, with a date column, a metric-name column and a value column ([example](sample-data/fake-wearable-long.csv)).
- **Wide layout:** one row per date and one column per metric. Tick the columns to import ([example](sample-data/fake-wearable-wide.csv)).
- **Date format:** `YYYY-MM-DD` (with or without a time), `DD/MM/YYYY` or `MM/DD/YYYY`. The app guesses, and shows how it reads the first row so you can check. Any time of day is ignored.
- **Several values on one day:** *Automatic* adds up steps, calories, distance and minutes, and averages everything else. You can also choose average, sum or last for all metrics.
- **Check** shows how many daily values each metric will get, and how many cells were unreadable, before anything is saved.

The mapping is saved under the file's exact header row, so the next export from the same app imports with no questions asked. Comma, semicolon and tab delimiters are all detected. Re-importing overlapping dates updates those days rather than duplicating them. If two sources name the same metric differently (for example `hrv_ms` and `HRV (ms)`), use **Rename / merge** on the Wearables screen.

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
