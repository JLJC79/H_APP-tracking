#!/usr/bin/env python3
"""Export new data from the MEDICAL folder's tables for the Health Dashboard phone app.

Put this file in MEDICAL/_system/ and run it from anywhere:

    python3 _system/export_for_app.py              # export what's new
    python3 _system/export_for_app.py --dry-run    # only show what it would do
    python3 _system/export_for_app.py --mark-existing   # first run only: treat every current
                                                        # results.csv row as already exported

It writes into MEDICAL/_dashboard-inbox/ (created if missing):
    labs/labs_export_<today>.json     new numeric rows of _system/data/results.csv, in the app's
                                      "health-dashboard-labs" format (reviewed in the app before
                                      anything is saved)
    wearables/<name>_<today>.csv      copies of _system/data/wearable_daily.csv and
                                      withings_daily.csv, only when they have changed

It reads nothing else, changes nothing else in MEDICAL, and never touches the originals.
Progress is kept in _system/data/app_export_state.json and every action is appended to
_system/data/dashboard-handoff.txt. Files it wrote are deleted from _dashboard-inbox after
60 days (they are copies). Python 3 standard library only.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import shutil
import sys
from pathlib import Path

SYSTEM = Path(__file__).resolve().parent
MEDICAL = SYSTEM.parent
DATA = SYSTEM / "data"
INBOX = MEDICAL / "_dashboard-inbox"
STATE_FILE = DATA / "app_export_state.json"
LOG_FILE = DATA / "dashboard-handoff.txt"
RESULTS = DATA / "results.csv"
WEARABLE_FILES = ["wearable_daily.csv", "withings_daily.csv"]
KEEP_DAYS = 60
QUALIFIERS = ("<", ">", "≤", "≥")


def today():
    return dt.date.today().isoformat()


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    return None


def num(s):
    """Plain number or None. Accepts '5.2' and '5,2'; rejects '', 'Not detected', '<5'."""
    s = (s or "").strip().replace(",", ".")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean(n):
    """Whole numbers as ints so the JSON reads naturally (142 rather than 142.0)."""
    return int(n) if n is not None and float(n).is_integer() else n


def row_key(r):
    """Identifies a results.csv row; a corrected row (new value) counts as new."""
    parts = [r.get(k, "").strip() for k in ("date", "analyte", "value", "unit", "lab", "source_file")]
    return "|".join(parts)


def read_results():
    if not RESULTS.exists():
        sys.exit(f"Not found: {RESULTS}")
    with RESULTS.open(newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    needed = {"date", "analyte", "value", "value_num", "unit", "ref_low", "ref_high"}
    missing = needed - set(rows[0].keys() if rows else needed)
    if missing:
        sys.exit(f"results.csv is missing column(s): {', '.join(sorted(missing))}")
    return rows


def to_lab(r):
    """App row for a results.csv row, or (None, reason) when it can't be a plain number."""
    printed = (r.get("value") or "").strip()
    if printed.startswith(QUALIFIERS):
        return None, f'value "{printed}" has a qualifier'
    value = num(r.get("value_num"))
    if value is None:
        value = num(printed)
    if value is None:
        return None, f'value "{printed}" is not a number'
    date = (r.get("date") or "").strip()
    try:
        dt.date.fromisoformat(date)
    except ValueError:
        return None, f'date "{date}" is not YYYY-MM-DD'
    low, high = num(r.get("ref_low")), num(r.get("ref_high"))
    if low is not None and high is not None and low > high:
        low = high = None  # unreadable range: leave it out rather than store it wrong
    notes = [x for x in [(r.get("lab") or "").strip()] if x]
    if (r.get("ref_type") or "").strip().lower() == "target":
        notes.append("range is a treatment target")
    if (r.get("fasting") or "").strip():
        notes.append(r["fasting"].strip())
    return {
        "test": r["analyte"].strip(),
        "value": clean(value),
        "units": (r.get("unit") or "").strip(),
        "low": clean(low),
        "high": clean(high),
        "date": date,
        "notes": " · ".join(notes),
    }, None


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--dry-run", action="store_true", help="show what would happen; write nothing")
    ap.add_argument("--mark-existing", action="store_true",
                    help="first run only: record every current results.csv row as exported without writing it")
    args = ap.parse_args()

    state = load_state()
    first_run = state is None
    if args.mark_existing and not first_run:
        sys.exit("--mark-existing is only for the first run (app_export_state.json already exists).")
    state = state or {"exported_rows": [], "wearables": {}, "written": []}
    done = set(state["exported_rows"])
    log, actions = [], []

    def note(kind, source, detail):
        log.append(f"{today()} | {kind:<8} | {source} | {detail}")

    # ---- Labs
    rows = read_results()
    new_rows = [r for r in rows if row_key(r) not in done]
    labs, left_out = [], []
    for r in new_rows:
        lab, why = to_lab(r)
        if lab:
            labs.append(lab)
        else:
            left_out.append((r, why))

    if args.mark_existing:
        actions.append(f"Marked {len(new_rows)} existing results.csv rows as exported (nothing written).")
        note("MARKED", "_system/data/results.csv", f"{len(new_rows)} existing rows treated as already exported")
    else:
        if labs:
            name = f"labs_export_{today()}.json"
            out = INBOX / "labs" / name
            n = 2
            while out.exists():  # second run on the same day
                out = INBOX / "labs" / f"labs_export_{today()}_{n}.json"
                n += 1
            payload = {
                "format": "health-dashboard-labs",
                "version": 1,
                "source": "_system/data/results.csv",
                "labs": sorted(labs, key=lambda x: (x["date"], x["test"])),
            }
            actions.append(f"Wrote {len(labs)} lab result(s) to {out.relative_to(MEDICAL)}")
            note("WROTE", "_system/data/results.csv", f"{out.name} ({len(labs)} results)")
            if not args.dry_run:
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                state["written"].append({"file": str(out.relative_to(MEDICAL)), "date": today()})
        for r, why in left_out:
            note("LEFT OUT", r.get("source_file", "").strip() or "_system/data/results.csv",
                 f'{r.get("date", "").strip()} {r.get("analyte", "").strip()}: {why}')
        if left_out:
            actions.append(f"Left out {len(left_out)} non-numeric result(s) (listed in the log).")
    if not args.dry_run:
        state["exported_rows"].extend(row_key(r) for r in new_rows)

    # ---- Wearables: copy the daily tables when they have changed
    for fname in WEARABLE_FILES:
        src = DATA / fname
        if not src.exists():
            continue
        digest = sha256(src)
        if state["wearables"].get(fname) == digest:
            continue
        out = INBOX / "wearables" / f"{src.stem}_{today()}.csv"
        n = 2
        while out.exists():  # changed again on the same day: keep both, newest has the higher number
            out = INBOX / "wearables" / f"{src.stem}_{today()}_{n}.csv"
            n += 1
        actions.append(f"Copied {fname} to {out.relative_to(MEDICAL)}")
        note("COPIED", f"_system/data/{fname}", out.name)
        if not args.dry_run:
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out)
            state["wearables"][fname] = digest
            state["written"].append({"file": str(out.relative_to(MEDICAL)), "date": today()})

    # ---- Clean-up: only files this script wrote, by the date it wrote them
    cutoff = (dt.date.today() - dt.timedelta(days=KEEP_DAYS)).isoformat()
    keep = []
    for w in state["written"]:
        path = MEDICAL / w["file"]
        if w["date"] < cutoff:
            if path.exists():
                actions.append(f"Deleted old copy {w['file']}")
                note("DELETED", w["file"], f"written {w['date']}, older than {KEEP_DAYS} days")
                if not args.dry_run:
                    path.unlink()
            if args.dry_run:
                keep.append(w)
        else:
            keep.append(w)
    state["written"] = keep

    # ---- Save
    if not actions:
        actions.append("Nothing new to export.")
    print(("DRY RUN — nothing written.\n" if args.dry_run else "") + "\n".join(actions))
    if not args.dry_run:
        DATA.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
        if log:
            with LOG_FILE.open("a", encoding="utf-8") as f:
                f.write("\n".join(log) + "\n")


if __name__ == "__main__":
    main()
