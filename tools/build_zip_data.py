#!/usr/bin/env python3
"""Build data/zips_ca.json: California ZIP (ZCTA) -> places, county, and the
districts on the Nov. 3, 2026 ballot, weighted by 2020 Census population.

Not needed for routine promise updates (build_data.py handles those). Rerun only
if district lines or source files change. Downloads ~1.3 GB (mostly the national ZCTA-block file) into --cache.

Sources (all public, official):
  * U.S. Census Bureau, 2020 ZCTA-to-2020-tabulation-block relationship file
    https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt
  * U.S. Census Bureau, 2020 Census P.L. 94-171 redistricting data, California
    (block populations, county and place names)
    https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/California/ca2020.pl.zip
  * U.S. Census Bureau, 2020 block assignment file, incorporated places/CDPs
    https://www2.census.gov/geo/docs/maps-data/data/baf2020/BlockAssign_ST06_CA.zip
  * U.S. Census Bureau, 120th Congress block equivalency file (California's
    Prop. 50 / AB 604 congressional map, used on the 2026 ballot)
    https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/120-congressional-district-befs/cd120.zip
    (cross-checked block by block against the Legislature's AB 604 equivalency
    file, https://statewidedatabase.org/pub/data/d25/AB604.zip)
  * U.S. Census Bureau, 2026 state legislative block equivalency files
    (California Citizens Redistricting Commission 2021 Assembly/Senate maps)
    https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/2026-state-legislative-bef/
  * California Citizens Redistricting Commission, final 2021 Board of
    Equalization equivalency file  https://wedrawthelines.ca.gov/final-maps/
  * CA Secretary of State, county elections offices (county website links)
    https://www.sos.ca.gov/elections/voting-resources/county-elections-offices
"""
import argparse, csv, io, json, re, html, subprocess, zipfile
from collections import defaultdict
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
URLS = {
    "zcta_block": "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt",
    "pl": "https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/California/ca2020.pl.zip",
    "baf": "https://www2.census.gov/geo/docs/maps-data/data/baf2020/BlockAssign_ST06_CA.zip",
    "cd120": "https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/120-congressional-district-befs/cd120.zip",
    "ab604": "https://statewidedatabase.org/pub/data/d25/AB604.zip",
    "sldl26": "https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/2026-state-legislative-bef/sldl26.zip",
    "sldu26": "https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/2026-state-legislative-bef/sldu26.zip",
    "boe": "https://wedrawthelines.ca.gov/wp-content/uploads/sites/64/2023/01/OneDrive_2023-01-19.zip",
    "sos": "https://www.sos.ca.gov/elections/voting-resources/county-elections-offices",
}


def fetch(cache, key, name):
    p = cache / name
    if not p.exists():
        print("downloading", URLS[key])
        subprocess.run(["curl", "-sSfL", "-A", "Mozilla/5.0", "-o", str(p), URLS[key]], check=True)
    return p


def zip_member(path, pattern):
    z = zipfile.ZipFile(path)
    names = [n for n in z.namelist() if re.search(pattern, n)]
    if not names: raise SystemExit(f"{path}: no member matching {pattern}")
    return io.TextIOWrapper(z.open(names[0]), encoding="utf-8-sig", errors="replace")


def read_bef(f, col):
    out = {}
    rd = csv.DictReader(f)
    for r in rd:
        if r["GEOID"].startswith("06"): out[r["GEOID"]] = int(r[col])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default="/workspace/zipdata/cache")
    a = ap.parse_args()
    cache = Path(a.cache); cache.mkdir(parents=True, exist_ok=True)

    # 1. Block populations + county/place names from the P.L. 94-171 geo header
    pop, county_name, place_name = {}, {}, {}
    with zip_member(fetch(cache, "pl", "ca2020.pl.zip"), r"cageo2020\.pl$") as f:
        for line in f:
            x = line.rstrip("\n").split("|")
            sl = x[2]
            if sl == "750": pop[x[9]] = int(x[-7] or 0)
            elif sl == "050": county_name[x[9][2:]] = x[-11]
            elif sl == "160": place_name[x[9][2:]] = x[-10]
    print("blocks", len(pop))

    # 2. Block -> ZCTA
    blk_z = {}
    zrel = fetch(cache, "zcta_block", "tab20_zcta520_tabblock20_natl.txt")
    with open(zrel, encoding="utf-8-sig") as f:
        hdr = f.readline().rstrip("\n").split("|")
        iz, ib = hdr.index("GEOID_ZCTA5_20"), hdr.index("GEOID_TABBLOCK_20")
        for line in f:
            x = line.rstrip("\n").split("|")
            if x[ib].startswith("06") and x[iz]: blk_z[x[ib]] = x[iz]

    # 3. Block -> place (2020 incorporated places and CDPs)
    blk_place = {}
    with zip_member(fetch(cache, "baf", "BlockAssign_ST06_CA.zip"), r"INCPLACE_CDP") as f:
        next(f)
        for line in f:
            b, p = line.strip().split("|")
            if p: blk_place[b] = p

    # 4. District equivalency files
    cd = read_bef(zip_member(fetch(cache, "cd120", "cd120.zip"), r"CD120_06\.txt$"), "CDFP")
    ab = {r[0]: int(r[1]) for r in csv.reader(zip_member(fetch(cache, "ab604", "AB604.zip"), r"\.csv$"))}
    mism = sum(1 for b, d in cd.items() if ab.get(b) != d)
    print(f"CD120 vs AB 604 equivalency: {len(cd)} blocks, {mism} mismatches")
    if mism: raise SystemExit("Census CD120 file does not match AB 604; check sources")
    ad = read_bef(zip_member(fetch(cache, "sldl26", "sldl26.zip"), r"NationalSLDL26\.txt$"), "SLDLST")
    sd = read_bef(zip_member(fetch(cache, "sldu26", "sldu26.zip"), r"NationalSLDU26\.txt$"), "SLDUST")
    boe = {r[0]: int(r[1]) for r in csv.reader(zip_member(fetch(cache, "boe", "boe_final_equiv.zip"), r"BOE_Final equiv\.csv$"))}

    # 5. Aggregate by ZCTA (population-weighted; land-only blocks still count as overlap)
    agg = defaultdict(lambda: {"pop": 0, "cty": defaultdict(int), "pl": defaultdict(int), "cd": defaultdict(int),
                               "ad": defaultdict(int), "sd": defaultdict(int), "boe": defaultdict(int), "n": 0})
    for b, z in blk_z.items():
        p = pop.get(b, 0); g = agg[z]
        g["pop"] += p; g["n"] += 1
        w = p if p else 0
        g["cty"][b[2:5]] += w
        if b in blk_place: g["pl"][blk_place[b]] += w
        for key, m in (("cd", cd), ("ad", ad), ("sd", sd), ("boe", boe)):
            if b in m: g[key][m[b]] += w

    counties = sorted(set(county_name.values()))
    cidx = {n: i for i, n in enumerate(counties)}

    def shares(d, total, keep_zero):
        items = [(k, v) for k, v in d.items() if v > 0 or (keep_zero and total == 0)]
        items.sort(key=lambda kv: -kv[1])
        return [[k, (round(100 * v / total) if total else None)] for k, v in items]

    out = {}
    for z, g in sorted(agg.items()):
        T = g["pop"]
        if T == 0:  # unpopulated ZCTA: list every overlapping unit, no shares
            for key in ("cty", "cd", "ad", "sd", "boe"):
                g[key] = {k: 1 for k in g[key]}
        rec = {"pop": T}
        rec["c"] = [[cidx[county_name[k].replace(" County", "")] if county_name[k].replace(" County", "") in cidx else cidx[county_name[k]], s]
                    for k, s in shares(g["cty"], T, True)]
        pls = []
        for k, s in shares(g["pl"], T, False)[:5]:
            nm = place_name.get(k, k)
            pls.append([nm, s])
        rec["p"] = pls
        for key in ("cd", "ad", "sd", "boe"):
            rec[key] = shares(g[key], T, True)
        out[z] = rec

    # county names: strip " County"
    counties = [c.replace(" County", "") for c in counties]
    # county election office URLs from the SOS list
    s = fetch(cache, "sos", "sos_county_offices.html").read_text(encoding="utf-8", errors="ignore")
    urls = {html.unescape(n).strip(): u for u, n in re.findall(r'<h2><a href="([^"]+)"[^>]*>([^<]+)</a>(?:&nbsp;|\s)*</h2>', s)}
    missing = [c for c in counties if c not in urls]
    if missing: print("WARNING: no SOS URL for", missing)

    doc = {
        "meta": {
            "built": __import__("datetime").date.today().isoformat(),
            "note": "ZIP = Census 2020 ZIP Code Tabulation Area (ZCTA). Shares are % of the ZCTA's 2020 Census population. cd = U.S. House (Prop. 50 / AB 604 map, 2026 ballot); ad = State Assembly, sd = State Senate (2021 CRC maps); boe = Board of Equalization (2021 CRC map).",
            "sources": [URLS[k] for k in ("zcta_block", "pl", "baf", "cd120", "ab604", "sldl26", "sldu26", "boe", "sos")],
        },
        "counties": counties,
        "county_urls": [urls.get(c, "") for c in counties],
        "z": out,
    }
    dst = SITE / "data" / "zips_ca.json"
    dst.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
    print(f"wrote {dst} ({dst.stat().st_size // 1024} KB, {len(out)} ZCTAs)")


if __name__ == "__main__":
    main()
