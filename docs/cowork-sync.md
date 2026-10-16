# Feeding the Health Dashboard from the MEDICAL folder

The MEDICAL folder routine ("Process the medical inbox") already keeps checked, canonical tables in
`MEDICAL/_system/data/`: `results.csv` (every lab result, verified against its PDF),
`wearable_daily.csv` (Samsung Health, one row per day) and `withings_daily.csv`.

[`tools/export_for_app.py`](../tools/export_for_app.py) turns what's new in those tables into
files the phone app imports. It is deterministic (no AI reading of documents at this step), uses
only the Python standard library, and changes nothing in MEDICAL except its own output folder,
its state file and its log.

## One-time setup

1. Copy `export_for_app.py` into `MEDICAL\_system\`.
2. **First run, choose one:**
   - If the app **already has your lab history** (you imported the converted backup from the old
     dashboard), run once with `--mark-existing`. Every current `results.csv` row is recorded as
     already exported, so only future results are sent.
     ```
     python3 _system/export_for_app.py --mark-existing
     ```
   - Otherwise run it normally. The first lab file then holds your whole history. That's one long
     review in the app; results that are already there show as *Already saved* and unticked.
   - Add `--dry-run` to either to see what would happen without writing anything.
3. **Add one step to the routine.** In `MEDICAL\_system\README.md`, under *Adding new data (the
   routine)*, step 2, add to the end of the list that starts "Claude will:":
   ```
   → run `python3 _system/export_for_app.py` (files for the phone app, in _dashboard-inbox/)
   ```

## What it writes

```
MEDICAL\_dashboard-inbox\
    labs\labs_export_<date>.json         new numeric rows of results.csv
    wearables\wearable_daily_<date>.csv  copy, only when wearable_daily.csv changed
    wearables\withings_daily_<date>.csv  copy, only when withings_daily.csv changed
MEDICAL\_system\data\app_export_state.json   which rows/files were already exported
MEDICAL\_system\data\dashboard-handoff.txt   one line per action (WROTE, COPIED, LEFT OUT, DELETED)
```

- **Lab rows:** `analyte` → test name, `value_num` → value, `unit`, `ref_low`/`ref_high`, `date`,
  and `lab` in the notes (plus "range is a treatment target" for `ref_type = target`, and the
  fasting status). Results with a qualifier (`<5`, `>90`) or text ("Not detected") are left out and
  listed in the log. A corrected row (new value) is exported again.
- **Wearables:** the whole daily table is copied each time it changes; re-importing updates the
  same days, it never duplicates them.
- **Clean-up:** files it wrote are deleted from `_dashboard-inbox` after 60 days (by the date it
  wrote them). It never deletes anything else.

## On the phone

- **Labs → Import → Browse → OneDrive →** Personal → MEDICAL → _dashboard-inbox → labs: pick the
  new file, check the results, **Save ticked**.
- **Wearables → Import CSV → Browse → OneDrive →** … → _dashboard-inbox → wearables: pick the
  newest `wearable_daily_…` and `withings_daily_…`.
  The first time, the app asks you to map each file. The date column is found automatically; use
  **Save as** to give the columns the names you want to see (pick existing names from the list so
  the data joins your history). The mapping is saved, and later copies import without questions.
