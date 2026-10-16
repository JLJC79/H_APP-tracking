# Cowork instructions: feeding the Health Dashboard

Add the text in the box below to the Cowork task that sorts your medical inbox. It tells Cowork to
copy wearable exports and write lab result files into the app's OneDrive folder. The app then
picks them up when you tap **Sync**.

The app's folder only exists after you have connected OneDrive in the app and synced once
(Settings → OneDrive sync → Connect, then Sync now). On a PC with OneDrive it is at:

```
C:\Users\jleec\OneDrive\Apps\Health Dashboard\
```

---

```text
HEALTH DASHBOARD HAND-OFF (run after filing new items)

App inbox folders:
  WEARABLES = C:\Users\jleec\OneDrive\Apps\Health Dashboard\inbox\wearables\
  LABS      = C:\Users\jleec\OneDrive\Apps\Health Dashboard\inbox\labs\
Only ever write into these two folders. Never copy anything else there.
Keep a record of what you have handed off in MEDICAL\_system\data\dashboard-handoff.txt
(one line per file: date, source path, file written) and never hand off the same source twice.

1. WEARABLE EXPORTS
When a new folder appears in MEDICAL\09_Wearable-Data:
- samsunghealth_export_<date>: copy ONLY these files (names end in .<timestamp>.csv) to WEARABLES,
  unchanged:
    com.samsung.shealth.step_daily_trend.*.csv
    com.samsung.shealth.tracker.heart_rate.*.csv
    com.samsung.shealth.sleep.<timestamp>.csv   (not sleep_data, sleep_combined, sleep_goal etc.)
    com.samsung.shealth.tracker.oxygen_saturation.*.csv
    com.samsung.health.respiratory_rate.*.csv
    com.samsung.health.skin_temperature.*.csv
    com.samsung.shealth.stress.<timestamp>.csv  (not stress.histogram etc.)
  Do NOT copy Samsung weight or blood_pressure files (those come from Withings).
- withings_export_<date>: copy ONLY weight.csv and bp.csv to WEARABLES, renamed to
  withings_weight_<date>.csv and withings_bp_<date>.csv (use the export folder's date).
Copy, never move: the originals stay where they are.

2. LAB RESULTS
For each NEW pathology report filed into MEDICAL\01_Pathology that contains numeric results,
write one JSON file to LABS named labs_<collection-date>_<lab-name>.json, in exactly this format:

{
  "format": "health-dashboard-labs",
  "version": 1,
  "source": "01_Pathology/<file name of the report>",
  "labs": [
    { "test": "Ferritin", "value": 45, "units": "ug/L", "low": 30, "high": 300,
      "date": "2026-03-12", "notes": "<lab or clinic name>" }
  ]
}

Rules:
- One entry per numeric result. "value", "low" and "high" are plain numbers (no units, no text).
  Use null for "low" or "high" when the report gives no limit (e.g. "<5.0" → low null, high 5.0).
- "date" is the COLLECTION date (YYYY-MM-DD), not the report or print date.
- Use the test name exactly as on the report, but keep it consistent: if the same test already
  appears in an earlier labs_*.json you wrote, reuse that exact spelling.
- Units exactly as printed (e.g. "mmol/L", "x10^9/L", "%").
- Leave a result OUT (do not guess) when: the value is not a plain number (e.g. "<5", "positive",
  "see comment"), the text is unclear, or you are not sure which row a value belongs to.
  List what you left out in the hand-off log instead.
- Never invent or estimate a value or range. The app shows every file to the user for review
  before saving, but accuracy here matters.
- Do not write lab files for imaging, letters, procedures, billing or anything outside
  01_Pathology.
```

---

## Notes

- **Why copy rather than point the app at MEDICAL?** The app is only allowed to see its own
  folder (`Apps/Health Dashboard`). It can't read `MEDICAL` or anything else in your OneDrive.
- **Withings files** don't have built-in mappings yet. The first time each one arrives, the app
  asks you to map its columns once (Sync → Map them now); after that they import automatically.
- **Duplicates are safe.** Re-importing a wearable file updates the same days. A lab file whose
  results are already saved shows them as *Already saved* and unticked.
- After a successful sync the app moves each file from `inbox` to `done`, with the date added to
  the name. You can delete files in `done` at any time.
