#!/usr/bin/env python3
"""Regenerate data/promises.json from the CSV files in data/.

Usage:
  python3 build_data.py                      # read data/*.csv (+ data/notes.json)
  python3 build_data.py --from /workspace/promises   # copy fresh CSVs in first

Inputs (in data/):
  promises_2026.csv   race,level,candidate,party,promise,topic,source_url,source_date
  president_2024.csv  promise,topic,made_where,made_date,source_url,status,status_note,status_source_url
  notes.json          optional: last_updated, race notes, races/candidates with no promises
Output:
  data/promises.json  (loaded by index.html)
"""
import argparse, csv, json, shutil, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
CAND_COLS = ["race", "level", "candidate", "party", "promise", "topic", "source_url", "source_date"]
PRES_COLS = ["promise", "topic", "made_where", "made_date", "source_url", "status", "status_note", "status_source_url"]
STATUSES = ["Kept", "Partially kept", "In progress", "Stalled", "Broken", "Not yet addressed"]
LEVELS = {"state", "federal", "local"}


def read_csv(path, cols):
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rd = csv.DictReader(fh)
        missing = [c for c in cols if c not in (rd.fieldnames or [])]
        if missing:
            sys.exit(f"{path.name}: missing columns {missing}")
        return [{c: (row.get(c) or "").strip() for c in cols} for row in rd if any((v or "").strip() for v in row.values())]


def topics(t):
    return [p.strip() for p in t.replace("&", "/").split("/") if p.strip()] if "/" in t else ([t.strip()] if t.strip() else [])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="src", help="directory to copy promises_2026.csv / president_2024.csv from first")
    a = ap.parse_args()
    if a.src:
        for n in ("promises_2026.csv", "president_2024.csv"):
            shutil.copy2(Path(a.src) / n, DATA / n)
            print(f"copied {n} from {a.src}")

    errors = []
    cand = read_csv(DATA / "promises_2026.csv", CAND_COLS)
    pres = read_csv(DATA / "president_2024.csv", PRES_COLS)
    notes = json.loads((DATA / "notes.json").read_text()) if (DATA / "notes.json").exists() else {}

    for i, r in enumerate(cand, 2):
        if r["level"] not in LEVELS: errors.append(f"promises_2026.csv line {i}: bad level {r['level']!r}")
        if not r["source_url"].startswith("http"): errors.append(f"promises_2026.csv line {i}: missing source_url")
        if not r["promise"] or not r["race"] or not r["candidate"]: errors.append(f"promises_2026.csv line {i}: empty race/candidate/promise")
        r["topics"] = [t.lower() for t in topics(r["topic"])]
    for i, r in enumerate(pres, 2):
        if r["status"] not in STATUSES: errors.append(f"president_2024.csv line {i}: unknown status {r['status']!r}")
        if not r["source_url"].startswith("http"): errors.append(f"president_2024.csv line {i}: missing source_url")
        if r["status_source_url"] and not r["status_source_url"].startswith("http"): errors.append(f"president_2024.csv line {i}: bad status_source_url")
    if errors:
        sys.exit("Data errors:\n  " + "\n  ".join(errors))

    # Group candidate promises: section -> race -> candidate (order of first appearance in CSV)
    def section(level, race):
        return "local" if level == "local" else "state"
    races = {}
    for r in cand:
        key = r["race"]
        if key not in races:
            races[key] = {"race": key, "level": r["level"], "section": section(r["level"], key),
                          "note": notes.get("race_notes", {}).get(key, ""), "candidates": {}}
        c = races[key]["candidates"].setdefault(r["candidate"], {"name": r["candidate"], "party": r["party"], "promises": [], "note": "", "sources": []})
        c["promises"].append({"text": r["promise"], "topic": r["topic"], "topics": r["topics"], "url": r["source_url"], "date": r["source_date"]})
    for extra in notes.get("candidates_without_promises", []):
        rc = races.get(extra["race"])
        if rc is None:
            lvl = extra.get("level", "local")
            rc = races[extra["race"]] = {"race": extra["race"], "level": lvl, "section": section(lvl, extra["race"]), "note": "", "candidates": {}}
        rc["candidates"].setdefault(extra["candidate"], {"name": extra["candidate"], "party": extra.get("party", ""), "promises": [], "note": extra.get("note", ""), "sources": extra.get("sources", [])})
    race_list = []
    for rc in races.values():
        rc["candidates"] = list(rc["candidates"].values())
        race_list.append(rc)

    counts = Counter(r["status"] for r in pres)
    out = {
        "last_updated": notes.get("last_updated", ""),
        "election_date": notes.get("election_date", ""),
        "president": {"promises": pres, "status_order": [s for s in STATUSES if counts[s] or s != "Not yet addressed"],
                      "counts": {s: counts.get(s, 0) for s in STATUSES}, "total": len(pres)},
        "races": race_list,
        "races_without_promises": notes.get("races_without_promises", []),
        "stats": {"candidate_promises": len(cand), "races": len(race_list),
                  "candidates": sum(len(r["candidates"]) for r in race_list)},
    }
    (DATA / "promises.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"wrote data/promises.json: {len(pres)} presidential promises {dict(counts)}; "
          f"{len(cand)} candidate promises in {len(race_list)} races")


if __name__ == "__main__":
    main()
