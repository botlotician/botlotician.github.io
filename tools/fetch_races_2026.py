#!/usr/bin/env python3
"""Build data/races_2026.csv: every U.S. Senate, governor (DC: mayor) and U.S. House
general election on the Nov. 3, 2026 ballot, with Ballotpedia race-page links and the
general-election candidates Ballotpedia lists (write-ins excluded).

Source: Ballotpedia (https://ballotpedia.org), pages:
  United_States_Senate_elections,_2026          (33 regular + 2 special Senate races)
  Gubernatorial_elections,_2026                 (36 governor races)
  United_States_House_of_Representatives_elections_in_<State>,_2026 (district pages)
  Mayoral_election_in_Washington,_D.C._(2026)
Only pages Ballotpedia actually links are used, so every URL exists. Rerun to refresh candidates.
"""
import csv, html, re, sys, time, datetime, subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
BP = "https://ballotpedia.org/"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
          "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
          "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
          "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
          "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
          "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
          "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}
BY_NAME = {v: k for k, v in STATES.items()}


def get(path):
    for attempt in range(4):
        r = subprocess.run(["curl", "-sL", "-A", UA, "--max-time", "60", "-w", "\n%{http_code}", BP + path], capture_output=True, text=True)
        body, _, code = r.stdout.rpartition("\n")
        if code == "200": return body
        time.sleep(2 + attempt * 3)
    print("FAILED", path, code, file=sys.stderr); return ""


def candidates(page):
    """Return (candidate list, note) for the Nov. 3, 2026 contest on a Ballotpedia race page.
    Uses the first 'General election for ...' votebox; if there is none, a 2026 'Nonpartisan
    primary election for ...' votebox held Nov. 3 (Louisiana-style), noting the later runoff."""
    blocks = list(re.finditer(r'<h5 class="votebox-header-election-type">(.*?)</h5>(.*?)</table>', page, flags=re.S))
    pick, note = None, ""
    for b in blocks:
        head = re.sub(r"\s+", " ", b.group(1)).strip()
        text = re.sub(r"<[^>]+>|\s+", " ", b.group(2))
        # only the 2026 contest (older cycles on the same page say "defeated"/"ran")
        if head.startswith("General election for") and ("are running" in text or "November 3, 2026" in text): pick = b; break
    if pick is None:
        for b in blocks:
            head = re.sub(r"\s+", " ", b.group(1)).strip()
            text = re.sub(r"<[^>]+>|\s+", " ", b.group(2))
            if head.startswith("Nonpartisan primary election for") and ("are running" in text or "November 3, 2026" in text):
                pick = b
                plain = re.sub(r"<[^>]+>", "", page)
                m = re.search(r"The general election (?:is|will occur on) ([A-Z][a-z]+ \d+, 2026)", plain) or re.search(r"General: ([A-Z][a-z]+ \d+, 2026)", plain)
                note = "Nov. 3 is a nonpartisan primary" + (f"; if no candidate wins a majority, the top two meet on {m.group(1)}." if m else ".")
                break
    if pick is None: return None, ""
    out = []
    for row in re.findall(r'<td class="votebox-results-cell--text">(.*?)</td>', pick.group(2), flags=re.S):
        txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", row))).strip()
        if "Write-in" in txt: continue
        txt = re.sub(r"\s+\)", ")", txt)
        if txt: out.append(txt)
    return out, note


def main():
    rows = []
    sen = get("United_States_Senate_elections,_2026")
    for path in sorted(set(re.findall(r'href="/(United_States_Senate_(?:special_)?election_in_[^"#]+?,_2026)"', sen))):
        special = "_special_" in path
        name = html.unescape(path.split("_in_", 1)[1].rsplit(",_", 1)[0].replace("_", " "))
        st = BY_NAME[name]
        rows.append({"race_id": f"US-SEN-{st}" + ("-SPECIAL" if special else ""), "state": st, "office": "U.S. Senate" + (" (special election)" if special else ""), "district": "", "path": path})
    gov = get("Gubernatorial_elections,_2026")
    paths = set(re.findall(r'href="/([A-Z][A-Za-z_]+_gubernatorial(?:_and_lieutenant_gubernatorial)?_election,_2026)"', gov))
    for st, name in STATES.items():
        a, b = name.replace(" ", "_") + "_gubernatorial_election,_2026", name.replace(" ", "_") + "_gubernatorial_and_lieutenant_gubernatorial_election,_2026"
        p = a if a in paths else b if b in paths else None
        if p: rows.append({"race_id": f"GOV-{st}", "state": st, "office": "Governor", "district": "", "path": p})
    rows.append({"race_id": "MAYOR-DC", "state": "DC", "office": "Mayor of the District of Columbia", "district": "", "path": "Mayoral_election_in_Washington,_D.C._(2026)"})

    def house_state(item):
        st, name = item
        pg = get(f"United_States_House_of_Representatives_elections_in_{name.replace(' ', '_')},_2026")
        out = []
        for p in sorted(set(re.findall(r'href="/([^"]*?(?:%27|\')s?_([0-9]+(?:st|nd|rd|th)|At-large)_Congressional_District_election,_2026)"', pg))):
            path, d = p
            dist = "AL" if d == "At-large" else re.match(r"\d+", d).group(0)
            out.append({"race_id": f"US-HOUSE-{st}-{dist}", "state": st, "office": "U.S. House" if st != "DC" else "Delegate to the U.S. House (non-voting)", "district": dist, "path": path.replace("%27", "'")})
        return out
    with ThreadPoolExecutor(4) as ex:
        for out in ex.map(house_state, STATES.items()): rows += out

    def fill(r):
        pg = get(r["path"].replace("'", "%27"))
        c, note = candidates(pg) if pg else (None, "")
        r["candidates"] = "; ".join(c) if c else ""
        r["note"] = note
        return r
    with ThreadPoolExecutor(4) as ex:
        rows = list(ex.map(fill, rows))
    today = datetime.date.today().isoformat()
    dst = SITE / "data" / "races_2026.csv"
    with open(dst, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["race_id", "state", "office", "district", "on_ballot", "candidates", "ballotpedia_url", "note", "source", "retrieved"])
        for r in sorted(rows, key=lambda r: (r["state"], r["race_id"])):
            w.writerow([r["race_id"], r["state"], r["office"], r["district"], "yes", r["candidates"], BP + r["path"].replace("'", "%27"), r["note"], "Ballotpedia", today])
    print(f"wrote {dst}: {len(rows)} races; without general-election candidate list: {sum(1 for r in rows if not r['candidates'])}")


if __name__ == "__main__":
    main()
