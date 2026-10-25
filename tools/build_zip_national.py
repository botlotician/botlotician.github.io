#!/usr/bin/env python3
"""Build data/zips/ST.json (one file per state + DC) and data/zips/index.json:
ZIP (Census ZCTA) -> state(s), county, places and the U.S. House district used on
the Nov. 3, 2026 ballot, weighted by 2020 Census block population. California
records also carry State Assembly, State Senate and Board of Equalization districts.

Not needed for promise updates (build_data.py handles those). Rerun only if
district lines change. Inputs are prepared per state in --nat (see README):
  pl/<ab>.txt  B|block|pop|placeFP, C|county|name, P|place|name, S|state|name
               from the 2020 Census P.L. 94-171 geo headers (one per state + DC)
               https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/
  zb/<fips>.txt  zcta,block from the 2020 ZCTA-to-tabulation-block relationship file
               https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt
  cd/<fips>.txt  block,cd from the Census 120th Congress block equivalency file
               (the districts for the 2026 elections, incl. the 2025-26 mid-decade redraws)
               https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/120-congressional-district-befs/cd120.zip
California's extra districts come from the files tools/build_zip_data.py uses
(2026 SLDL/SLDU BEFs and the CRC Board of Equalization equivalency file).
"""
import argparse, csv, datetime, json, sys
from collections import defaultdict
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

FIPS = {"01":"AL","02":"AK","04":"AZ","05":"AR","06":"CA","08":"CO","09":"CT","10":"DE","11":"DC","12":"FL","13":"GA","15":"HI","16":"ID","17":"IL","18":"IN","19":"IA","20":"KS","21":"KY","22":"LA","23":"ME","24":"MD","25":"MA","26":"MI","27":"MN","28":"MS","29":"MO","30":"MT","31":"NE","32":"NV","33":"NH","34":"NJ","35":"NM","36":"NY","37":"NC","38":"ND","39":"OH","40":"OK","41":"OR","42":"PA","44":"RI","45":"SC","46":"SD","47":"TN","48":"TX","49":"UT","50":"VT","51":"VA","53":"WA","54":"WV","55":"WI","56":"WY"}


def ca_extras(cache):
    import build_zip_data as b
    ad = b.read_bef(b.zip_member(b.fetch(cache, "sldl26", "sldl26.zip"), r"NationalSLDL26\.txt$"), "SLDLST")
    sd = b.read_bef(b.zip_member(b.fetch(cache, "sldu26", "sldu26.zip"), r"NationalSLDU26\.txt$"), "SLDUST")
    boe = {r[0]: int(r[1]) for r in csv.reader(b.zip_member(b.fetch(cache, "boe", "boe_final_equiv.zip"), r"BOE_Final equiv\.csv$"))}
    import re, html
    s = b.fetch(cache, "sos", "sos_county_offices.html").read_text(encoding="utf-8", errors="ignore")
    urls = {html.unescape(n).strip(): u for u, n in re.findall(r'<h2><a href="([^"]+)"[^>]*>([^<]+)</a>(?:&nbsp;|\s)*</h2>', s)}
    return {"ad": ad, "sd": sd, "boe": boe}, urls


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nat", default="/workspace/zipdata/nat")
    ap.add_argument("--cache", default="/workspace/zipdata/cache")
    a = ap.parse_args()
    nat = Path(a.nat)
    per_state = {}           # ST -> {zcta: agg}
    names = {}               # ST -> (county names, place names, state name)
    zt = defaultdict(int)    # national ZCTA population
    for fp, st in FIPS.items():
        ab = st.lower()
        pop, blk_place, cn, pn, sname = {}, {}, {}, {}, st
        for line in open(nat / "pl" / f"{ab}.txt", encoding="utf-8"):
            x = line.rstrip("\n").split("|")
            if x[0] == "B":
                pop[x[1]] = int(x[2] or 0)
                if x[3] and x[3] != "99999": blk_place[x[1]] = fp + x[3]
            elif x[0] == "C": cn[x[1]] = x[2]
            elif x[0] == "P": pn[x[1]] = x[2]
            elif x[0] == "S": sname = x[2]
        cd = {}
        for line in open(nat / "cd" / f"{fp}.txt"):
            b, d = line.rstrip("\n").split(",")
            if d.isdigit(): cd[b] = int(d)   # "ZZ" = water-only block with no district
        extra = {}
        if st == "CA":
            extra, ca_urls = ca_extras(Path(a.cache))
        agg = defaultdict(lambda: {"pop": 0, "c": defaultdict(int), "p": defaultdict(int), "cd": defaultdict(int),
                                   **{k: defaultdict(int) for k in extra}})
        miss_cd = 0
        for line in open(nat / "zb" / f"{fp}.txt"):
            z, b = line.rstrip("\n").split(",")
            p = pop.get(b, 0); g = agg[z]
            g["pop"] += p
            g["c"][b[:5]] += p
            if b in blk_place: g["p"][blk_place[b]] += p
            if b in cd: g["cd"][cd[b]] += p
            else: miss_cd += 1
            for k, m in extra.items():
                if b in m: g[k][m[b]] += p
        if miss_cd: print(f"WARNING {st}: {miss_cd} ZCTA blocks without a CD")
        for z, g in agg.items(): zt[z] += g["pop"]
        per_state[st] = agg
        names[st] = (cn, pn, sname)
        print(st, len(agg), "ZCTAs", len(cd), "blocks", flush=True)

    zstates = defaultdict(list)
    for st, agg in per_state.items():
        for z, g in agg.items(): zstates[z].append((st, g["pop"]))

    def shares(d, total, keep_zero=True):
        items = [(k, v) for k, v in d.items() if v > 0 or (keep_zero and total == 0)]
        items.sort(key=lambda kv: (-kv[1], str(kv[0])))
        return [[k, (round(100 * v / total) if total else None)] for k, v in items]

    out_dir = SITE / "data" / "zips"; out_dir.mkdir(parents=True, exist_ok=True)
    index = defaultdict(set)
    built = datetime.date.today().isoformat()
    stats = {}
    for st, agg in per_state.items():
        cn, pn, sname = names[st]
        counties = sorted(cn.values())
        cidx = {n: i for i, n in enumerate(counties)}
        recs = {}
        for z, g in sorted(agg.items()):
            T = zt[z]
            rec = {"pop": T}
            sts = sorted(zstates[z], key=lambda t: -t[1])
            if len(sts) > 1:
                rec["st"] = [[s, (round(100 * p / T) if T else None)] for s, p in sts]
            if T == 0:
                for k in g:
                    if k != "pop": g[k] = {kk: 1 for kk in g[k]} if k != "p" else {}
            rec["c"] = [[cidx[cn[k]], s] for k, s in shares(g["c"], T)]
            rec["p"] = [[pn.get(k, k), s] for k, s in shares(g["p"], T, False)[:5]]
            for k in g:
                if k not in ("pop", "c", "p"): rec[k] = shares(g[k], T)
            recs[z] = rec
            index[z[:3]].add(st)
        doc = {"meta": {"state": st, "name": sname, "built": built,
                        "note": "ZIP = Census 2020 ZIP Code Tabulation Area (ZCTA). Shares are % of the ZCTA's 2020 Census population (all states). cd = U.S. House district for the Nov. 3, 2026 election (Census 120th Congress BEF); 0 = at-large, 98 = DC delegate." +
                                (" ad/sd = State Assembly/Senate (2021 CRC maps), boe = Board of Equalization." if st == "CA" else "")},
               "counties": counties, "z": recs}
        if st == "CA":
            doc["county_urls"] = [ca_urls.get(c.replace(" County", ""), "") for c in counties]
        p = out_dir / f"{st}.json"
        p.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False))
        stats[st] = len(recs)
    idx = {"built": built, "note": "3-digit ZIP prefix -> state files that contain ZCTAs with that prefix",
           "states": sorted(per_state), "prefix": {k: sorted(v) for k, v in sorted(index.items())}}
    (out_dir / "index.json").write_text(json.dumps(idx, separators=(",", ":")))
    print("wrote", len(stats), "state files,", sum(stats.values()), "ZCTA records;", len(index), "prefixes;",
          sum(1 for z in zstates if len(zstates[z]) > 1), "multi-state ZCTAs")


if __name__ == "__main__":
    main()
