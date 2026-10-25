#!/usr/bin/env python3
"""Regenerate data/promises.json from the CSV files in data/.

Usage:
  python3 build_data.py                      # read data/*.csv (+ data/notes.json)
  python3 build_data.py --from /workspace/promises   # copy fresh CSVs in first
                                             # (national_2026.csv too, if present there)

Inputs (in data/):
  promises_2026.csv   race,level,candidate,party,promise,topic,source_url,source_date
  president_2024.csv  promise,topic,made_where,made_date,source_url,status,status_note,status_source_url
  national_2026.csv   optional: race,level,state,race_id,candidate,party,promise,topic,source_url,source_date
                      level federal|statewide; race_id must exist in races_2026.csv
                      (e.g. US-SEN-TX, US-SEN-OH-SPECIAL, GOV-TX, US-HOUSE-TX-23, US-HOUSE-AK-AL)
  races_2026.csv      every 2026 U.S. Senate, governor and U.S. House general election by state
                      (from tools/fetch_races_2026.py, Ballotpedia); marks which are on the ballot
  state_election_offices.csv  one official election office link per state + DC (USA.gov)
  races.csv           race,area_type,area_id,county,who_votes[,race_id]  (California tracked races; drives ZIP lookup)
                      area_type: state (area_id CA) | cd | ad | sd | boe (area_id = district number)
                                 | county (area_id = county name) | city (area_id = city name, county = its county)
  notes.json          optional: last_updated, race notes, races/candidates with no promises, coverage config
Output:
  data/promises.json  (loaded by index.html)
  data/races_2026.json (loaded on ZIP lookup: national race list, tracked flags, election offices)
"""
import argparse, csv, json, re, shutil, sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
CAND_COLS = ["race", "level", "candidate", "party", "promise", "topic", "source_url", "source_date"]
PRES_COLS = ["promise", "topic", "made_where", "made_date", "source_url", "status", "status_note", "status_source_url"]
STATUSES = ["Kept", "Partially kept", "In progress", "Stalled", "Broken", "Not yet addressed"]
LEVELS = {"state", "federal", "local"}
AREA_TYPES = {"state", "cd", "ad", "sd", "boe", "county", "city"}
RACE_COLS = ["race", "area_type", "area_id", "county", "who_votes"]
NAT_COLS = ["race", "level", "state", "race_id", "candidate", "party", "promise", "topic", "source_url", "source_date"]
R26_COLS = ["race_id", "state", "office", "district", "on_ballot", "candidates", "ballotpedia_url", "note", "source", "retrieved"]
STATES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split())
RACE_ID = re.compile(r"^(US-SEN-([A-Z]{2})(-SPECIAL)?|GOV-([A-Z]{2})|MAYOR-(DC)|US-HOUSE-([A-Z]{2})-([1-9][0-9]?|AL))$")


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
        if (Path(a.src) / "national_2026.csv").exists():
            shutil.copy2(Path(a.src) / "national_2026.csv", DATA / "national_2026.csv")
            print(f"copied national_2026.csv from {a.src}")

    errors = []
    cand = read_csv(DATA / "promises_2026.csv", CAND_COLS)
    pres = read_csv(DATA / "president_2024.csv", PRES_COLS)
    notes = json.loads((DATA / "notes.json").read_text()) if (DATA / "notes.json").exists() else {}
    areas = {}
    # national race list (all 2026 Senate / governor / House contests)
    r26 = read_csv(DATA / "races_2026.csv", R26_COLS)
    r26_by_id = {}
    for i, r in enumerate(r26, 2):
        m = RACE_ID.match(r["race_id"])
        if not m: errors.append(f"races_2026.csv line {i}: bad race_id {r['race_id']!r}")
        elif r["state"] not in STATES or r["race_id"].split("-")[2 if r["race_id"].startswith("US-") else 1] != r["state"]:
            errors.append(f"races_2026.csv line {i}: state {r['state']!r} does not match race_id {r['race_id']!r}")
        if r["on_ballot"] not in ("yes", "no"): errors.append(f"races_2026.csv line {i}: on_ballot must be yes/no")
        if r["ballotpedia_url"] and not r["ballotpedia_url"].startswith("https://ballotpedia.org/"): errors.append(f"races_2026.csv line {i}: bad ballotpedia_url")
        if r["race_id"] in r26_by_id: errors.append(f"races_2026.csv line {i}: duplicate race_id {r['race_id']}")
        r26_by_id[r["race_id"]] = r
    offices = {}
    for i, r in enumerate(read_csv(DATA / "state_election_offices.csv", ["state", "name", "url", "source"]), 2):
        if r["state"] in STATES:
            if not r["url"].startswith("http"): errors.append(f"state_election_offices.csv line {i}: bad url")
            offices[r["state"]] = {"name": r["name"], "url": r["url"]}
    for st in sorted(STATES - set(offices)): errors.append(f"state_election_offices.csv: no office for {st}")

    nat = []
    if (DATA / "national_2026.csv").exists():
        nat = read_csv(DATA / "national_2026.csv", NAT_COLS)
        for i, r in enumerate(nat, 2):
            where = f"national_2026.csv line {i}"
            if r["level"] not in ("federal", "statewide"): errors.append(f"{where}: level must be federal or statewide, not {r['level']!r}")
            if r["state"] not in STATES: errors.append(f"{where}: bad state {r['state']!r}")
            if not RACE_ID.match(r["race_id"]): errors.append(f"{where}: bad race_id {r['race_id']!r}")
            elif r["race_id"] not in r26_by_id: errors.append(f"{where}: race_id {r['race_id']} is not a 2026 race in races_2026.csv")
            elif r26_by_id[r["race_id"]]["state"] != r["state"]: errors.append(f"{where}: state {r['state']} does not match {r['race_id']}")
            elif r26_by_id[r["race_id"]]["on_ballot"] != "yes": errors.append(f"{where}: {r['race_id']} is not on the Nov. 3, 2026 ballot")
            if r["race_id"].startswith(("US-", "MAYOR-")) != (r["level"] == "federal") and not r["race_id"].startswith("MAYOR-"):
                errors.append(f"{where}: level {r['level']!r} does not fit {r['race_id']}")
            if not r["source_url"].startswith("http"): errors.append(f"{where}: missing source_url")
            if r["source_date"] and not re.match(r"^\d{4}-\d{2}(-\d{2})?$", r["source_date"]): errors.append(f"{where}: source_date should be YYYY-MM-DD")
            if not r["promise"] or not r["race"] or not r["candidate"]: errors.append(f"{where}: empty race/candidate/promise")
            r["topics"] = [t.lower() for t in topics(r["topic"])]

    for i, r in enumerate(read_csv(DATA / "races.csv", RACE_COLS + (["race_id"] if "race_id" in open(DATA / "races.csv").readline() else [])), 2):
        if r.get("race_id") and r["race_id"] not in r26_by_id: errors.append(f"races.csv line {i}: race_id {r['race_id']} not in races_2026.csv")
        if r["area_type"] not in AREA_TYPES: errors.append(f"races.csv line {i}: bad area_type {r['area_type']!r}")
        if not r["area_id"]: errors.append(f"races.csv line {i}: missing area_id")
        if r["area_type"] in ("cd", "ad", "sd", "boe") and not r["area_id"].isdigit(): errors.append(f"races.csv line {i}: district area_id must be a number")
        if r["area_type"] == "city" and not r["county"]: errors.append(f"races.csv line {i}: city races need a county")
        areas[r["race"]] = r

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
        ar = areas.get(rc["race"])
        if not ar:
            errors.append(f"race {rc['race']!r} has no row in races.csv (needed for ZIP lookup)")
            continue
        rc["area"] = {"type": ar["area_type"], "id": ar["area_id"], "county": ar["county"], "who_votes": ar["who_votes"]}
        if ar.get("race_id"): rc["race_id"] = ar["race_id"]
        rc["candidates"] = list(rc["candidates"].values())
        race_list.append(rc)

    # national tracked races (from national_2026.csv)
    nraces = {}
    for r in nat:
        rid = r["race_id"]; info = r26_by_id[rid]
        rc = nraces.get(rid)
        if rc is None:
            rc = nraces[rid] = {"race": r["race"], "level": r["level"], "section": "national", "race_id": rid,
                                "note": notes.get("race_notes", {}).get(rid, "") or info["note"], "candidates": {},
                                "area": {"type": "race", "id": rid, "state": r["state"], "county": "",
                                         "who_votes": ("Voters in " + info["office"].replace("U.S. House ", "") if rid.startswith("US-HOUSE") else "All " + r["state"] + " voters")}}
        c = rc["candidates"].setdefault(r["candidate"], {"name": r["candidate"], "party": r["party"], "promises": [], "note": "", "sources": []})
        c["promises"].append({"text": r["promise"], "topic": r["topic"], "topics": r["topics"], "url": r["source_url"], "date": r["source_date"]})
    for rc in nraces.values():
        rc["candidates"] = list(rc["candidates"].values()); race_list.append(rc)
    tracked = sorted({rc["race_id"] for rc in race_list if rc.get("race_id")})

    if errors:
        sys.exit("Data errors:\n  " + "\n  ".join(errors))
    nat_doc = {
        "retrieved": max((r["retrieved"] for r in r26), default=""),
        "source": "Ballotpedia 2026 U.S. Senate, gubernatorial, U.S. House and D.C. mayoral election pages (see tools/fetch_races_2026.py)",
        "tracked": tracked,
        "offices": offices,
        "races": [{"id": r["race_id"], "st": r["state"], "office": r["office"], "district": r["district"],
                   "on_ballot": r["on_ballot"] == "yes", "candidates": [c for c in r["candidates"].split("; ") if c],
                   "url": r["ballotpedia_url"], "note": r["note"]} for r in r26],
    }
    (DATA / "races_2026.json").write_text(json.dumps(nat_doc, ensure_ascii=False, separators=(",", ":")))
    counts = Counter(r["status"] for r in pres)
    out = {
        "last_updated": notes.get("last_updated", ""),
        "election_date": notes.get("election_date", ""),
        "president": {"promises": pres, "status_order": [s for s in STATUSES if counts[s] or s != "Not yet addressed"],
                      "counts": {s: counts.get(s, 0) for s in STATUSES}, "total": len(pres)},
        "races": race_list,
        "races_without_promises": notes.get("races_without_promises", []),
        "coverage": notes.get("coverage", {}),
        "stats": {"candidate_promises": len(cand) + len(nat), "national_promises": len(nat), "races": len(race_list),
                  "candidates": sum(len(r["candidates"]) for r in race_list)},
    }
    (DATA / "promises.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"wrote data/promises.json: {len(pres)} presidential promises {dict(counts)}; "
          f"{len(cand)} California + {len(nat)} national candidate promises in {len(race_list)} tracked races "
          f"({', '.join(tracked)} matched to the national list); races_2026.json: {len(r26)} races")


if __name__ == "__main__":
    main()
