#!/bin/bash
# Prepare the per-state inputs for tools/build_zip_national.py in $NAT (default /workspace/zipdata/nat).
# Downloads ~2 GB of official Census files; processes one state at a time to keep memory low.
set -euo pipefail
NAT=${NAT:-/workspace/zipdata/nat}; CACHE=${CACHE:-/workspace/zipdata/cache}
mkdir -p "$NAT"/{pl,zb,cd} "$CACHE"; cd "$NAT"
PL=https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171
# 1. Block population, county / place / state names from each state's P.L. 94-171 geo header (latin1)
for S in $(curl -s $PL/ | grep -o 'href="[A-Z][A-Za-z_]*/"' | sed 's/href="//;s/\/"//' | grep -v -e Puerto_Rico -e National); do
  f=$(curl -s $PL/$S/ | grep -o 'href="[a-z][a-z]2020.pl.zip"' | head -1 | sed 's/href="//;s/"//'); ab=${f:0:2}
  [ -s pl/$ab.txt ] && continue
  curl -sSf -o pl/$f $PL/$S/$f
  unzip -p pl/$f ${ab}geo2020.pl | iconv -f latin1 -t utf-8 | awk -F'|' -v OFS='|' \
    '$3=="750"{print "B",$10,$(NF-6),$30} $3=="050"{print "C",$10,$(NF-9)} $3=="160"{print "P",$10,$(NF-9)} $3=="040"{print "S",$10,$(NF-9)}' > pl/$ab.txt
  rm pl/$f; echo "$S $ab"
done
# 2. ZCTA -> block, split by the block's state FIPS
Z=$CACHE/tab20_zcta520_tabblock20_natl.txt
[ -s "$Z" ] || curl -sSfL -o "$Z" https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tabblock20_natl.txt
awk -F'|' 'NR>1 && $2!="" {print $2","$10 > "zb/" substr($10,1,2) ".txt"}' "$Z"
# 3. Block -> 2026 U.S. House district (Census 120th Congress BEF), split by state FIPS
C=$CACHE/cd120.zip
[ -s "$C" ] || curl -sSfL -o "$C" https://www2.census.gov/programs-surveys/decennial/rdo/mapping-files/2027/120-congressional-district-befs/cd120.zip
unzip -p "$C" NationalCD120.txt | tr -d '\r' | awk -F, 'NR>1 {print $1","$6 > "cd/" substr($1,1,2) ".txt"}'
echo "prepared $(ls pl | wc -l) state PL files, $(ls zb | wc -l) zb files, $(ls cd | wc -l) cd files in $NAT"
