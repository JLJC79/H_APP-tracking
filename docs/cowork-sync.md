# Cowork instructions: feeding the Health Dashboard

Add the text in the box below to the Cowork task that sorts your medical inbox. It tells Cowork to
copy the useful wearable files and write lab result files into one folder in your OneDrive:

```
C:\Users\jleec\OneDrive\Personal\MEDICAL\_dashboard-inbox\
    wearables\
    labs\
```

On the phone you then open those files from the app:

- **Wearables → Import CSV → Browse → OneDrive →** Personal → MEDICAL → _dashboard-inbox → wearables,
  and select the new files.
- **Labs → Import → Browse → OneDrive →** … → _dashboard-inbox → labs, pick the new file(s), check
  the results on the review screen and tap **Save ticked**.

The app remembers which file names it has imported and says so in the summary, so you can tell new
files from old ones. Importing a file twice is harmless.

(If you later set up the optional one-tap OneDrive sync, see the README; it uses the app's own
folder `OneDrive\Apps\Health Dashboard\inbox\` instead, with the same `wearables` and `labs`
subfolders.)

---

```text
HEALTH DASHBOARD HAND-OFF (run after filing new items)

Dashboard inbox folders (create them if missing):
  WEARABLES = C:\Users\jleec\OneDrive\Personal\MEDICAL\_dashboard-inbox\wearables\
  LABS      = C:\Users\jleec\OneDrive\Personal\MEDICAL\_dashboard-inbox\labs\
  LOG       = C:\Users\jleec\OneDrive\Personal\MEDICAL\_system\data\dashboard-handoff.txt
Apart from appending to LOG, only ever write into WEARABLES and LABS. Never copy anything else
there, and never change, move or delete anything elsewhere in MEDICAL as part of this hand-off.

THE LOG
- One line per action, fields separated by " | ":
    <today YYYY-MM-DD> | COPIED  | <source path relative to MEDICAL> | <file written>
    <today YYYY-MM-DD> | WROTE   | <source path relative to MEDICAL> | <file written>
    <today YYYY-MM-DD> | LEFT OUT | <source path relative to MEDICAL> | <test name, or ALL>: <reason>
    <today YYYY-MM-DD> | DELETED | <file deleted>
- A source is one file. It is "new" if it does not appear as a source on any COPIED, WROTE or
  LEFT OUT line in LOG. Only hand off new sources; skip the rest silently.
- FIRST RUN (LOG does not exist yet): create LOG. Hand off all wearable export folders that
  exist, but only pathology reports COLLECTED in the last 90 days (older results are already in
  the app). Add one LEFT OUT line per older report: "ALL: older than 90 days on first run".

1. WEARABLE EXPORTS
For each new export folder in MEDICAL\09_Wearable-Data:
- samsunghealth_export_<date>: copy ONLY the files below, unchanged. Each name is exactly
  <prefix>.<14-digit timestamp>.csv; nothing may come between the prefix and the timestamp.
    com.samsung.shealth.step_daily_trend
    com.samsung.shealth.tracker.heart_rate
    com.samsung.shealth.sleep                  (NOT sleep_data, sleep_combined, sleep_goal, sleep_raw_data…)
    com.samsung.shealth.tracker.oxygen_saturation   (NOT com.samsung.health.oxygen_saturation.raw)
    com.samsung.health.respiratory_rate
    com.samsung.health.skin_temperature
    com.samsung.shealth.stress                 (NOT stress.histogram, stress.base_histogram)
  Do NOT copy Samsung weight or blood_pressure files (those come from Withings), and nothing
  from the export's "files" or "jsons" subfolders.
- withings_export_<date>: copy ONLY weight.csv and bp.csv, renamed to
  withings_weight_<date>.csv and withings_bp_<date>.csv (the export folder's date).
Copy, never move: the originals stay where they are.

2. LAB RESULTS
For each new pathology report in MEDICAL\01_Pathology that contains numeric results, write one
JSON file to LABS named labs_<collection date YYYY-MM-DD>_<lab short name>.json, where the short
name uses only letters, digits and hyphens (e.g. labs_2026-03-12_Laverty.json).

Format (the values below are placeholders showing the shape; take every value from the report):
{
  "format": "health-dashboard-labs",
  "version": 1,
  "source": "01_Pathology/<file name of the report>",
  "labs": [
    { "test": "<test name>", "value": 0.0, "units": "<units>", "low": 0.0, "high": 0.0,
      "date": "YYYY-MM-DD", "notes": "<lab or clinic name>" }
  ]
}

Rules:
- One entry per numeric result. "value", "low" and "high" are plain JSON numbers: no units,
  no text, no H/L flags (drop a flag such as "19 L" → 19; the app works out high/low itself).
- Reference ranges: "130 - 180" → low 130, high 180. "< 5" or "<= 5" → low null, high 5.
  "> 50" or ">= 50" → low 50, high null. No range given → both null.
- "date" is the COLLECTION date, not the report or print date. Australian reports write dates
  as DD/MM/YYYY: "12/03/2026" is 12 March 2026 → "2026-03-12".
- Use the test name as printed on the report, but keep it consistent: if the same test already
  appears in an earlier labs_*.json you wrote, reuse that exact spelling.
- Units exactly as printed (e.g. "mmol/L", "x10^9/L", "%").
- Leave a result OUT (do not guess) when: the value is not a plain number (e.g. "<1",
  "positive", "not detected", "see comment"), the text is unclear, or you are not sure which
  row a value belongs to. Add a LEFT OUT line to LOG for each one.
- Never invent or estimate a value or range. The app shows every file to me for review before
  saving, but accuracy here matters.
- Do not write lab files for imaging, letters, procedures, billing or anything outside
  01_Pathology.

3. CLEAN-UP (after steps 1 and 2)
Files in WEARABLES and LABS are only copies. Delete one only when its COPIED or WROTE line in
LOG is dated more than 60 days before today (judge by the LOG date, never by the file's own
date, name or contents), and add a DELETED line. Never delete anything else.
```

---

## Notes

- **Withings files** don't have built-in mappings yet. The first time each kind arrives, the app
  asks you to map its columns once; after that it imports automatically.
- **Duplicates are safe.** Re-importing a wearable file updates the same days. In a lab file,
  results already in the app are shown as *Already saved* and unticked.
