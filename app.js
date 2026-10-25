(function () {
  "use strict";
  var DATA = null, ZIPS = null;
  var state = { tab: "president", q: "", topic: "", status: "", zip: "", zipView: null };
  var TABS = ["zip", "president"];
  var LOCAL_HINT = "Hollister and San Benito County local races are now shown by ZIP code. Enter your ZIP (for example 95023 for Hollister) to see the local races on your ballot.";
  var STATE_HINT = "Races for California and every other state are now shown by ZIP code. Enter your ZIP (for example 95023 for Hollister, CA) to see the races on your ballot.";
  var STORE_KEY = "promiseTracker.zip";
  var STATUS_DESC = { "Kept": "Promise kept", "Partially kept": "Compromise / partly kept", "In progress": "In the works", "Stalled": "No progress or blocked", "Broken": "Promise broken", "Not yet addressed": "No action yet" };
  var OFFICE = { cd: "U.S. House", ad: "State Assembly", sd: "State Senate", boe: "Board of Equalization" };
  var PREFIX = { cd: "CA-", ad: "AD-", sd: "SD-", boe: "BOE-" };
  var LINKS = {
    sos: ["California Secretary of State voter guide (statewide races and measures)", "https://voterguide.sos.ca.gov/"],
    status: ["My Voter Status: check registration and find your sample ballot (CA Secretary of State)", "https://voterstatus.sos.ca.gov/"],
    ballotpedia: ["Ballotpedia sample ballot lookup", "https://ballotpedia.org/Sample_Ballot_Lookup"],
    vote411: ["VOTE411 personalized ballot (League of Women Voters)", "https://www.vote411.org/ballot"],
    voteorg: ["Vote.org: check registration and find your polling place", "https://www.vote.org/"],
    usagov: ["Find your state election office (USA.gov)", "https://www.usa.gov/state-election-office"]
  };
  var $ = function (id) { return document.getElementById(id); };
  var MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function fmtDate(d) {
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(d || "");
    if (!m) return d || "";
    return MONTHS[+m[2] - 1] + (m[3] ? " " + (+m[3]) + "," : "") + " " + m[1];
  }
  function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : "#"; }
  function link(u, label) { return '<a href="' + esc(safeUrl(u)) + '" target="_blank" rel="noopener">' + esc(label) + "</a>"; }
  function hl(text) {
    var t = esc(text), q = state.q.trim();
    if (!q) return t;
    var words = q.split(/\s+/).filter(Boolean).map(function (w) { return esc(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); });
    return t.replace(new RegExp("(" + words.join("|") + ")", "gi"), "<mark>$1</mark>");
  }
  function matches(hay) {
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    hay = hay.toLowerCase();
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function uniq(a) { var s = {}; a.forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(function (x, y) { return x.localeCompare(y); }); }
  function pct(s) { return s == null ? "" : (s < 1 ? "<1%" : s + "%"); }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------- race applicability (data-driven from race.area) ---------- */
  var TERRITORY = { "006": "PR", "007": "PR", "008": "VI", "009": "PR", "969": "GU", "967": "AS" };
  var MILITARY = /^(09\d|340|96[2-6])$/;
  function placeBase(name) {
    return name.replace(/ \(balance\)$/, "").replace(/ (city and borough|consolidated government|metropolitan government|metro government|unified government|urban county|city|town|village|borough|municipality|plantation|CDP)$/, "");
  }
  function isCDP(name) { return / CDP$/.test(name); }
  function countyBase(n) { return n.replace(/ County$/, ""); }
  function districtIds(rec, key) { return (rec[key] || []).map(function (d) { return String(+d[0]); }); }
  function caPart(v) { return v && v.parts ? v.parts.filter(function (p) { return p.st === "CA"; })[0] : null; }
  function raceApplies(r, v) {
    var a = r.area || {};
    if (!v || !v.parts) return false;
    if (a.type === "race") return v.raceIds.indexOf(a.id) !== -1;
    var ca = caPart(v);
    if (!ca) return false;
    if (a.type === "state") return true;
    var rec = ca.rec;
    if (!rec) return false;
    if (a.type in OFFICE) return districtIds(rec, a.type).indexOf(String(+a.id)) !== -1;
    if (a.type === "county") return ca.counties.indexOf(a.id) !== -1;
    if (a.type === "city") return ca.counties.indexOf(a.county) !== -1 && rec.p.some(function (p) { return !isCDP(p[0]) && placeBase(p[0]) === a.id; });
    return false;
  }
  function trackedDistricts(type) {
    var out = {};
    DATA.races.forEach(function (r) { if (r.area && r.area.type === type) out[String(+r.area.id)] = r; });
    return out;
  }
  function trackedById(id) { return DATA.races.filter(function (r) { return r.race_id === id; })[0] || null; }
  function onBallot(type, id) {
    var rule = ((DATA.coverage || {}).on_ballot_2026 || {})[type] || "all";
    if (rule === "even") return +id % 2 === 0;
    if (rule === "odd") return +id % 2 === 1;
    return rule !== "none";
  }

  /* ---------- ZIP lookup (lazy: tiny index, then one file per state) ---------- */
  var cache = {}, IDX = null, NAT = null;
  function getJSON(u) {
    if (!cache[u]) cache[u] = fetch(u).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status + " for " + u); return r.json(); });
    return cache[u];
  }
  function loadFor(zip) {
    return Promise.all([getJSON("data/zips/index.json"), getJSON("data/races_2026.json")]).then(function (a) {
      IDX = a[0]; NAT = a[1];
      var po = ((DATA.coverage || {}).po_box_zips || {})[zip];
      var key = po ? po.enclosing_zcta : zip;
      var sts = IDX.prefix[key.slice(0, 3)] || [];
      return Promise.all(sts.map(function (st) { return getJSON("data/zips/" + st + ".json"); }));
    }).then(function (files) { ZIPS = files; });
  }
  function natRaces(st) { return NAT.races.filter(function (r) { return r.st === st; }); }
  function houseId(st, d) { return "US-HOUSE-" + st + "-" + (+d === 0 || +d === 98 ? "AL" : String(+d)); }
  function buildView(zip) {
    var v = { zip: zip, parts: null, kind: "", note: "", raceIds: [] };
    var po = ((DATA.coverage || {}).po_box_zips || {})[zip];
    var key = zip, parts = [];
    if (po) {
      key = po.enclosing_zcta;
      v.note = zip + " is a PO Box ZIP for " + po.city + ", so it has no area of its own. Showing the districts for " + po.enclosing_zcta + ", the " + po.city + " ZIP it sits inside. Your races depend on your home address.";
    }
    ZIPS.forEach(function (f) {
      var rec = f.z[key];
      if (rec) parts.push({ st: f.meta.state, name: f.meta.name, rec: rec, file: f, counties: rec.c.map(function (c) { return countyBase(f.counties[c[0]]); }),
        share: rec.st ? rec.st.filter(function (s) { return s[0] === f.meta.state; })[0][1] : 100 });
    });
    parts.sort(function (a, b) { return (b.share || 0) - (a.share || 0); });
    var pre = zip.slice(0, 3);
    if (parts.length) { v.kind = "found"; v.parts = parts; }
    else if (TERRITORY[pre] || MILITARY.test(pre)) v.kind = MILITARY.test(pre) ? "military" : "territory";
    else {
      var sts = (IDX.prefix[pre] || []);
      v.kind = sts.length ? "unknown" : "none";
      if (sts.length) v.parts = sts.map(function (st) { var f = ZIPS.filter(function (x) { return x.meta.state === st; })[0]; return { st: st, name: f ? f.meta.name : st, rec: null, counties: [] }; });
    }
    (v.parts || []).forEach(function (p) {
      natRaces(p.st).forEach(function (r) {
        if (!r.on_ballot) return;
        if (/^US-HOUSE-/.test(r.id)) { if (p.rec && p.rec.cd.some(function (d) { return houseId(p.st, d[0]) === r.id; })) v.raceIds.push(r.id); }
        else v.raceIds.push(r.id);
      });
    });
    return v;
  }
  function placeLabel(p) {
    var rec = p.rec, f = p.file, pl = rec.p, cn = f.counties[rec.c[0][0]];
    var main = pl.length && pl[0][1] >= 50 ? pl[0][0] : null;
    var stl = p.st === "DC" ? "DC" : p.st;
    if (p.st === "DC") return (main ? placeBase(main) : "Washington") + ", DC";
    return (main ? placeBase(main) + (isCDP(main) ? " (unincorporated)" : "") : (pl.length ? placeBase(pl[0][0]) + " area" : "")) + (main || pl.length ? ", " : "") + cn + ", " + stl;
  }
  function placeDetail(rec) {
    var bits = rec.p.map(function (p) { return placeBase(p[0]) + (isCDP(p[0]) ? " (unincorporated community)" : " (inside city/town limits)") + " " + pct(p[1]); });
    var inPlaces = rec.p.reduce(function (s, p) { return s + (p[1] || 0); }, 0);
    if (rec.pop && inPlaces < 99) bits.push("outside any city or named community about " + Math.max(0, 100 - inPlaces) + "%");
    return bits;
  }
  var ST_TRACKED = '<span class="st st-yes">Promises documented</span>', ST_NOT = '<span class="st st-no">Promises not documented yet</span>', ST_OFF = '<span class="st st-off">Not on the 2026 ballot</span>';
  function raceLine(r, label, share) {
    var t = trackedById(r.id), bits = [];
    bits.push("<strong>" + esc(label) + "</strong>" + (share != null ? ' <span class="muted">(' + pct(share) + " of residents)</span>" : ""));
    if (t) bits.push(ST_TRACKED + ' <a href="#race-' + slug(t.race) + '">see promises</a>');
    else bits.push(ST_NOT);
    var extra = "";
    if (!t) {
      extra = r.candidates.length ? '<span class="cands">Candidates: ' + r.candidates.map(esc).join("; ") + ".</span> " : '<span class="cands">Candidate list not available yet.</span> ';
      extra += r.url ? link(r.url, "Race on Ballotpedia") : link(LINKS.ballotpedia[1], LINKS.ballotpedia[0]);
      var off = NAT && NAT.offices && NAT.offices[r.st];
      if (off) extra += " · " + link(off.url, (r.st === "DC" ? "D.C. Board of Elections" : off.name + " election office") + " (official)");
    }
    if (r.note) extra += ' <span class="small muted">' + esc(r.note) + "</span>";
    return "<li>" + bits.join(" ") + (extra ? '<br><span class="small">' + extra + "</span>" : "") + "</li>";
  }
  function districtLabel(st, d) {
    if (st === "DC") return "D.C. Delegate (non-voting)";
    if (+d === 0) return st + " at-large (whole state)";
    return st + "-" + (+d);
  }
  function stateRows(p, multi) {
    var rows = [], st = p.st, rec = p.rec, races = natRaces(st), pre = multi ? p.st + ": " : "";
    // U.S. House
    if (rec) {
      var items = rec.cd.map(function (d) {
        var id = houseId(st, d[0]), r = races.filter(function (x) { return x.id === id; })[0];
        var label = districtLabel(st, d[0]);
        if (!r) return "<li><strong>" + esc(label) + "</strong> " + ST_NOT + ' <span class="small">' + link(LINKS.ballotpedia[1], LINKS.ballotpedia[0]) + "</span></li>";
        return raceLine(r, label, rec.cd.length > 1 ? d[1] : null);
      });
      var hname = st === "DC" ? "U.S. House (non-voting delegate)" : "U.S. House";
      var hnote = st === "DC" ? '<p class="small muted">D.C. elects one Delegate, who can vote in committees but not on final passage of bills. D.C. has no U.S. Senators.</p>' : (+rec.cd[0][0] === 0 && rec.cd.length === 1 ? '<p class="small muted">' + esc(p.name) + " has one at-large House seat, so every voter in the state votes in this race.</p>" : "");
      rows.push([pre + hname + (rec.cd.length > 1 ? ' <span class="muted small">(this ZIP is split)</span>' : ""), "<ul>" + items.join("") + "</ul>" + hnote]);
    } else rows.push([pre + "U.S. House", "Unknown for this ZIP. " + ST_NOT + " " + link(LINKS.ballotpedia[1], "Find your district (Ballotpedia sample ballot lookup)")]);
    // U.S. Senate
    var sen = races.filter(function (r) { return /^US-SEN-/.test(r.id) && r.on_ballot; });
    if (st === "DC") rows.push([pre + "U.S. Senate", '<span class="muted">D.C. has no U.S. Senators.</span>']);
    else if (!sen.length) rows.push([pre + "U.S. Senate", ST_OFF + ' <span class="small muted">No U.S. Senate seat from ' + esc(p.name) + " is up in 2026.</span>"]);
    else rows.push([pre + "U.S. Senate" + (sen.length > 1 ? " (2 races)" : ""), "<ul>" + sen.map(function (r) { return raceLine(r, /-SPECIAL$/.test(r.id) ? "Special election (" + st + ")" : "Regular election (" + st + ")"); }).join("") + "</ul>" + (sen.length > 1 ? '<p class="small muted">Both of ' + esc(p.name) + "'s Senate seats are on the ballot. Every voter in the state votes in both races.</p>" : "")]);
    // Governor / Mayor
    var gov = races.filter(function (r) { return (/^GOV-/.test(r.id) || /^MAYOR-/.test(r.id)) && r.on_ballot; });
    if (st === "DC") rows.push([pre + "Mayor (D.C. has no governor)", gov.length ? "<ul>" + gov.map(function (r) { return raceLine(r, "Mayor of the District of Columbia"); }).join("") + "</ul>" : ST_OFF]);
    else if (!gov.length) rows.push([pre + "Governor", ST_OFF + ' <span class="small muted">' + esc(p.name) + " does not elect a governor in 2026.</span>"]);
    else rows.push([pre + "Governor", "<ul>" + gov.map(function (r) { return raceLine(r, "Governor of " + p.name); }).join("") + "</ul>"]);
    // California extras
    if (st === "CA") {
      rows.push(["Other California statewide offices", "<ul><li><strong>Lt. Governor through Superintendent of Public Instruction</strong> " + ST_TRACKED + ' <a href="#statewide-races">see promises</a></li></ul>']);
      ["ad", "sd", "boe"].forEach(function (t) {
        var tracked = trackedDistricts(t), ds = rec ? rec[t] : [];
        if (!rec) { rows.push([OFFICE[t], "Unknown for this ZIP. " + ST_NOT]); return; }
        var li = ds.map(function (d) {
          var id = String(+d[0]), name = PREFIX[t] + id;
          var status = !onBallot(t, id) ? ST_OFF : tracked[id] ? ST_TRACKED + ' <a href="#race-' + slug(tracked[id].race) + '">see promises</a>' : ST_NOT;
          return "<li><strong>" + esc(name) + "</strong>" + (ds.length > 1 ? ' <span class="muted">(' + pct(d[1]) + " of residents)</span>" : "") + " " + status + "</li>";
        });
        rows.push([OFFICE[t] + (ds.length > 1 ? ' <span class="muted small">(this ZIP is split)</span>' : ""), "<ul>" + li.join("") + "</ul>"]);
      });
    }
    return rows;
  }
  function localRow(v, p) {
    var rec = p.rec;
    var cityNames = rec ? rec.p.filter(function (x) { return !isCDP(x[0]); }).map(function (x) { return placeBase(x[0]); }) : [];
    var mainCounties = rec ? rec.c.filter(function (c, i) { return i === 0 || c[1] >= 1; }).map(function (c) { return p.file.counties[c[0]]; }) : [];
    var where = p.st === "DC" ? "Washington, DC" : (cityNames.length ? cityNames.join(" / ") + ", " : "") + (mainCounties.length ? mainCounties.join(" / ") + ", " : "") + p.st;
    var local = p.st === "CA" ? DATA.races.filter(function (r) { return r.section === "local" && raceApplies(r, v); }) : [];
    var cell;
    if (local.length) {
      cell = '<span class="st st-yes">Some documented</span> ' + local.length + " local race" + (local.length === 1 ? "" : "s") + " below. Each lists who votes in it.";
      var trackedC = (DATA.coverage || {}).tracked_counties || [];
      var un = p.counties.filter(function (c) { return trackedC.indexOf(c) === -1; });
      if (un.length) cell += " Local races in " + esc(un.join(" County, ")) + " County (also part of this ZIP) aren't tracked yet.";
      if (p.counties.indexOf("San Benito") !== -1 && cityNames.indexOf("Hollister") === -1) cell += " Hollister city races aren't shown, because this ZIP isn't inside Hollister city limits.";
    } else {
      cell = ST_NOT + " " + (p.st === "CA" ? "Local races" : "State legislative, local races and ballot measures") + " for " + esc(where) + " aren't tracked yet. " + link(LINKS.ballotpedia[1], "See them on your sample ballot (Ballotpedia)");
    }
    return { row: [(p.st === "CA" ? "" : (v.parts.length > 1 ? p.st + ": " : "")) + (p.st === "CA" ? "City, county, school and special districts" : "State legislature, local races and measures"), "<strong>" + esc(where) + "</strong><br>" + cell], local: local, where: where };
  }

  function renderZip() {
    var v = state.zipView, out = [];
    if (!v) return '<p class="empty">Enter a 5-digit ZIP code above to see the races on your ballot.</p>';
    var repo = (DATA.coverage || {}).repo;
    function requestLink(where, more) {
      if (!repo) return "";
      var title = "Please add " + (more ? "more " : "") + "races for " + where + " (ZIP " + v.zip + ")";
      var body = "I'd like the tracker to cover the 2026 races for " + where + " (ZIP " + v.zip + ").\n\nRaces I care about (optional):\n\nLinks to candidate statements or questionnaires (optional):\n";
      return '<p class="small">Want your area covered? <a href="https://github.com/' + esc(repo) + "/issues/new?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body) + '" target="_blank" rel="noopener">Request my city</a> (opens a public GitHub issue; a free GitHub account is needed).</p>';
    }
    function official(parts) {
      var li = [];
      (parts || []).forEach(function (p) {
        var o = NAT && NAT.offices[p.st];
        if (o) li.push([(p.st === "DC" ? "D.C. Board of Elections" : o.name + " election office") + " (official, via USA.gov)", o.url]);
        if (p.st === "CA") {
          li.push(LINKS.status, LINKS.sos);
          var f = p.file;
          if (f && p.rec) p.rec.c.forEach(function (c) { var u = (f.county_urls || [])[c[0]]; if (u) li.push([f.counties[c[0]] + " elections office", u]); });
        }
      });
      if (!parts || !parts.length) li.push(LINKS.usagov);
      li.push(LINKS.ballotpedia, LINKS.voteorg, LINKS.vote411);
      return '<div class="official"><h3>Check your real ballot</h3><ul>' + li.map(function (l) { return "<li>" + link(l[1], l[0]) + "</li>"; }).join("") + "</ul></div>";
    }
    function table(rows) {
      return '<table class="cov"><thead><tr><th>Office</th><th>Your race(s) and tracker coverage</th></tr></thead><tbody>' +
        rows.map(function (r) { return "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>"; }).join("") + "</tbody></table>";
    }

    if (v.kind === "territory" || v.kind === "military" || v.kind === "none") {
      $("summary").textContent = "";
      var msg = v.kind === "military" ? "This looks like a military or diplomatic (APO/FPO/DPO) ZIP. Military and overseas voters vote absentee in their home state. See " + link("https://www.fvap.gov/", "FVAP.gov") + " to find your home-state ballot." :
        v.kind === "territory" ? "This ZIP is in a U.S. territory. This tracker covers the 50 states and D.C. Territories elect a non-voting delegate to the U.S. House but don't vote for president or U.S. Senate." :
        "We couldn't match this ZIP to any state. It may not exist. Try the ZIP of your home address.";
      return '<div class="zipcard"><h2>ZIP ' + esc(v.zip) + "</h2><p>" + msg + "</p>" + '<p><a class="btnlink" href="#president">See the President\'s 2024 promises</a></p>' + official(null) + "</div>";
    }
    if (v.kind === "unknown") {
      out.push('<div class="zipcard"><h2>ZIP ' + esc(v.zip) + ": " + esc(v.parts.map(function (p) { return p.name; }).join(" or ")) + "?</h2>");
      out.push("<p>We couldn't find this ZIP in the Census ZIP areas. It may be a PO Box or business ZIP, or it may not exist. From its first three digits it is probably in " + esc(v.parts.map(function (p) { return p.name; }).join(" or ")) + ". Statewide races are shown, but we can't tell your U.S. House district from it. Try the ZIP of your home address.</p>");
      v.parts.forEach(function (p) { out.push(table(stateRows(p, v.parts.length > 1))); });
      out.push(official(v.parts) + "</div>");
      $("summary").textContent = "";
      return out.join("");
    }

    var parts = v.parts, p0 = parts[0], rec0 = p0.rec;
    var split = parts.length > 1 || parts.some(function (p) { var r = p.rec; return ["c", "cd", "ad", "sd", "boe"].some(function (k) { return r[k] && r[k].length > 1; }) || r.p.length > 1 || (r.p.length && r.p[0][1] < 99); });
    out.push('<div class="zipcard"><h2>ZIP ' + esc(v.zip) + ": " + esc(placeLabel(p0)) + "</h2>");
    if (v.note) out.push('<p class="warn">' + esc(v.note) + "</p>");
    if (parts.length > 1) out.push('<p class="warn"><strong>This ZIP crosses state lines:</strong> ' + esc(rec0.st.map(function (s) { return s[0] + " " + pct(s[1]); }).join(", ")) + " of residents. Races for each state are listed below.</p>");
    parts.forEach(function (p) {
      var r = p.rec;
      out.push('<p class="small muted">' + (parts.length > 1 ? "<strong>" + esc(p.name) + ":</strong> " : "") + "County: " + r.c.map(function (c) { return esc(p.file.counties[c[0]]) + (r.c.length > 1 ? " " + pct(c[1]) : ""); }).join(", ") +
        (r.p.length ? ". Areas: " + placeDetail(r).map(esc).join("; ") : "") + ". Shares are of the ZIP's 2020 Census population.</p>");
    });
    if (split) out.push('<p class="warn"><strong>This ZIP may be split.</strong> It crosses city, county or district lines, so the races on your ballot depend on your exact address. Every district that overlaps this ZIP is listed below. Check your sample ballot to be sure.</p>');
    var rows = [], localAll = [], wheres = [];
    parts.forEach(function (p) { rows = rows.concat(stateRows(p, parts.length > 1)); var l = localRow(v, p); rows.push(l.row); localAll = localAll.concat(l.local); wheres.push(l.where); });
    out.push(table(rows));
    out.push(official(parts));
    out.push(requestLink(wheres.join(" / "), localAll.length > 0 || v.raceIds.some(trackedById)));
    out.push("</div>");

    // race cards: tracked races for this ZIP
    var mine = DATA.races.filter(function (r) { return raceApplies(r, v); });
    var federal = mine.filter(function (r) { return r.section === "national" || (r.area && r.area.type === "cd"); });
    var district = mine.filter(function (r) { return r.area && (r.area.type === "ad" || r.area.type === "sd" || r.area.type === "boe"); });
    var local = mine.filter(function (r) { return r.section === "local"; });
    var statewide = mine.filter(function (r) { return r.area && r.area.type === "state"; });
    var a = raceBlocks(federal, { who: true }), b = raceBlocks(district, { who: true }), c = raceBlocks(local, { who: true }), d = raceBlocks(statewide, {});
    if (!mine.length) out.push('<p class="empty">Promises for the races on this ZIP\'s ballot aren\'t documented yet, so there are no promise cards to show. The table above lists the races and candidates on your ballot, with links to more information.</p>');
    if (a.html) out.push('<p class="level-label">Federal and statewide races in this tracker</p>' + a.html);
    if (b.html) out.push('<p class="level-label">Your district races in this tracker</p>' + b.html);
    if (c.html) out.push('<p class="level-label">Local races in this tracker</p>' + c.html);
    if (statewide.length) out.push('<details class="group" id="statewide-races" open><summary>California statewide races (on every California ballot)</summary>' + (d.html || '<p class="empty">No statewide promises match these filters.</p>') + "</details>");
    var shown = a.shown + b.shown + c.shown + d.shown, total = a.total + b.total + c.total + d.total;
    $("summary").textContent = total ? "Showing " + shown + " of " + total + " tracked promises for ZIP " + v.zip + "." : "";
    return out.join("");
  }

  /* ---------- shared race renderer ---------- */
  function raceBlocks(list, opts) {
    var out = [], shown = 0, total = 0, lastGrp = null;
    var labels = { state: "Statewide offices", boe: "Statewide offices", cd: "U.S. Congress", ad: "State Legislature", sd: "State Legislature", county: "County & districts", city: "City" };
    list.forEach(function (r) {
      var candHtml = [];
      r.candidates.forEach(function (c) {
        total += c.promises.length;
        var ps = c.promises.filter(function (p) {
          return (!state.topic || p.topics.indexOf(state.topic) !== -1) && matches([p.text, p.topic, c.name, c.party, r.race].join(" "));
        });
        var noneMatch = !c.promises.length && !state.topic && matches([c.name, r.race, c.note].join(" "));
        if (!ps.length && !noneMatch) return;
        shown += ps.length;
        var h = '<div class="card cand"><h3>' + hl(c.name) + (c.party ? ' <span class="party">' + esc(c.party) + "</span>" : "") + ' <span class="muted small">' + c.promises.length + " promise" + (c.promises.length === 1 ? "" : "s") + "</span></h3>";
        if (ps.length) {
          h += "<ul>" + ps.map(function (p) {
            return "<li>" + hl(p.text) + ' <span class="tag">' + esc(p.topic) + "</span> " + '<span class="small">' + link(p.url, "Source") + (p.date ? ' <span class="muted">(' + esc(fmtDate(p.date)) + ")</span>" : "") + "</span></li>";
          }).join("") + "</ul>";
        } else {
          h += '<p class="small muted">' + esc(c.note || "No sourced promises found.") + "</p>" + (c.sources && c.sources.length ? '<div class="links">' + c.sources.map(function (s, i) { return link(s, "Source " + (i + 1)); }).join("") + "</div>" : "");
        }
        candHtml.push(h + "</div>");
      });
      if (!candHtml.length) return;
      var grp = labels[(r.area || {}).type] || r.level;
      if (opts.groups && grp !== lastGrp) { out.push('<p class="level-label">' + esc(grp) + "</p>"); lastGrp = grp; }
      out.push('<section class="race" id="race-' + slug(r.race) + '"><h2>' + hl(r.race) + "</h2>" +
        (opts.who && r.area && r.area.who_votes ? '<p class="who">Who votes: ' + esc(r.area.who_votes) + "</p>" : "") +
        (r.note ? '<p class="race-note">' + esc(r.note) + "</p>" : "") + candHtml.join("") + "</section>");
    });
    return { html: out.join(""), shown: shown, total: total };
  }

  function renderPresident() {
    var P = DATA.president, out = [];
    out.push('<p class="muted small">Status of ' + P.total + " promises the current president made during his 2024 campaign, as of " + esc(fmtDate(DATA.last_updated)) + ". Ratings mostly follow PolitiFact's MAGA-Meter. Tap a status to filter.</p>");
    out.push('<div class="counts" role="group" aria-label="Filter by status">');
    P.status_order.forEach(function (s) {
      out.push('<button type="button" class="count" data-status="' + esc(s) + '" aria-pressed="' + (state.status === s) + '"><b>' + (P.counts[s] || 0) + '</b><span class="badge s-' + slug(s) + '">' + esc(s) + "</span></button>");
    });
    out.push('</div><div class="bar" aria-hidden="true">');
    P.status_order.forEach(function (s) { if (P.counts[s]) out.push('<span class="s-' + slug(s) + '" style="width:' + (100 * P.counts[s] / P.total).toFixed(2) + '%" title="' + esc(s) + ": " + P.counts[s] + '"></span>'); });
    out.push("</div>");
    var list = P.promises.filter(function (p) {
      return (!state.status || p.status === state.status) && (!state.topic || p.topic === state.topic) &&
        matches([p.promise, p.topic, p.made_where, p.status, p.status_note].join(" "));
    });
    list.forEach(function (p) {
      out.push('<article class="card"><p class="ptitle"><span class="badge s-' + slug(p.status) + '" title="' + esc(STATUS_DESC[p.status] || "") + '">' + esc(p.status) + "</span> " + hl(p.promise) + "</p>" +
        '<p class="small"><span class="tag">' + esc(p.topic) + "</span>" + '<span class="muted">Said: ' + hl(p.made_where) + (p.made_date ? ", " + esc(fmtDate(p.made_date)) : "") + "</span></p>" +
        (p.status_note ? '<p class="small">' + hl(p.status_note) + "</p>" : "") +
        '<div class="links">' + link(p.source_url, "Promise source") + (p.status_source_url ? link(p.status_source_url, "Status source") : "") + "</div></article>");
    });
    if (!list.length) out.push('<p class="empty">No promises match these filters.</p>');
    $("summary").textContent = "Showing " + list.length + " of " + P.total + " promises.";
    return out.join("");
  }

  /* ---------- controls / tabs ---------- */
  function fillSelect(sel, values, first) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(first) + "</option>" + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v.charAt(0).toUpperCase() + v.slice(1)) + "</option>"; }).join("");
    sel.value = values.indexOf(cur) !== -1 ? cur : "";
  }
  function racesForTab() {
    return state.tab === "zip" && state.zipView ? DATA.races.filter(function (r) { return raceApplies(r, state.zipView); }) : [];
  }
  function setupControls() {
    var topics = [];
    if (state.tab === "president") {
      topics = uniq(DATA.president.promises.map(function (p) { return p.topic; }));
      $("status-field").hidden = false;
      fillSelect($("status"), DATA.president.status_order, "All statuses");
    } else {
      racesForTab().forEach(function (r) { r.candidates.forEach(function (c) { c.promises.forEach(function (p) { topics = topics.concat(p.topics); }); }); });
      topics = uniq(topics);
      $("status-field").hidden = true;
      state.status = "";
    }
    fillSelect($("topic"), topics, "All topics");
    state.topic = $("topic").value;
  }
  function render() {
    document.querySelectorAll(".tabs button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === state.tab;
      b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    });
    $("panel").setAttribute("aria-labelledby", "tab-" + state.tab);
    $("panel").innerHTML = state.tab === "president" ? renderPresident() : renderZip();
  }
  function visibleTabs() { return TABS.filter(function (t) { return !$("tab-" + t).hidden; }); }
  function switchTab(t, push) {
    if (TABS.indexOf(t) === -1 || $("tab-" + t).hidden) t = "president";
    state.tab = t;
    setupControls();
    render();
    if (push) history.replaceState(null, "", t === "zip" && state.zip ? "#zip=" + state.zip : "#" + t);
  }
  function showZipTab(zip) {
    var b = $("tab-zip");
    b.hidden = false; b.textContent = "Your ZIP: " + zip;
    document.querySelector(".tabs").classList.add("has-zip");
  }

  function lookup(zip, opts) {
    opts = opts || {};
    $("zip-error").textContent = "";
    $("zip-hint").textContent = "";
    if (!/^\d{5}$/.test(zip)) {
      $("zip-error").textContent = "Please enter a 5-digit ZIP code (numbers only), for example 95023.";
      $("zip").setAttribute("aria-invalid", "true");
      return Promise.resolve(false);
    }
    $("zip").removeAttribute("aria-invalid");
    return loadFor(zip).then(function () {
      state.zip = zip; state.zipView = buildView(zip);
      store(STORE_KEY, zip);
      showZipTab(zip);
      if (opts.switchTab !== false) {
        switchTab("zip", true);
        if (opts.scroll) document.querySelector(".tabs").scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return true;
    }).catch(function (err) {
      $("zip-error").textContent = "Sorry, the ZIP data could not be loaded (" + err.message + "). Please try again.";
      return false;
    });
  }

  function raceForHash(h) { return DATA.races.filter(function (x) { return "race-" + slug(x.race) === h; })[0] || null; }
  // Old #state, #local and #race-... links: those tabs are gone, so open the ZIP results
  // if the saved ZIP covers the race, otherwise point visitors to the ZIP box.
  function wantsFallback(h) { return h === "local" || h === "state" || (/^race-/.test(h) && !!raceForHash(h)); }
  function routeFromHash() {
    var h = location.hash.slice(1);
    var m = /^zip=(\d{5})$/.exec(h);
    if (m) { $("zip").value = m[1]; lookup(m[1]); return; }
    if (/^race-/.test(h)) {
      var el = document.getElementById(h);
      if (el) { el.scrollIntoView(); return; }
      if (raceForHash(h)) fallback(h);
      return;
    }
    if (h === "local" || h === "state") { fallback(h); return; }
    if (h === "statewide-races") { var e3 = document.getElementById(h); if (e3) e3.scrollIntoView(); return; }
    if (h === "zip-form" || h === "methodology" || h === "main") return;
    if (TABS.indexOf(h) !== -1) switchTab(h, false);
  }
  function fallback(h) {
    var v = state.zipView, r = /^race-/.test(h) ? raceForHash(h) : null;
    var ok = v && v.parts && (r ? raceApplies(r, v) :
      h === "local" ? DATA.races.some(function (x) { return x.section === "local" && raceApplies(x, v); }) : !!caPart(v));
    if (ok) {
      switchTab("zip", false);
      history.replaceState(null, "", r ? "#" + h : "#zip=" + state.zip);
      if (r) { var el = document.getElementById(h); if (el) el.scrollIntoView(); }
      return;
    }
    if (state.tab === "zip" || TABS.indexOf(state.tab) === -1) switchTab("president", false);
    history.replaceState(null, "", "#zip-form");
    $("zip-hint").textContent = (h === "local" || (r && r.section === "local")) ? LOCAL_HINT : STATE_HINT;
    var f = $("zip-form"); f.scrollIntoView({ block: "start" });
    try { $("zip").focus({ preventScroll: true }); } catch (e) { $("zip").focus(); }
  }

  function init(data) {
    DATA = data;
    var tc = $("tracked-count"); if (tc) tc.textContent = String(data.races.filter(function (r) { return /^(US-SEN-|GOV-|MAYOR-)/.test(r.race_id || ""); }).length);
    if (data.last_updated) { $("last-updated").textContent = fmtDate(data.last_updated); $("last-updated").setAttribute("datetime", data.last_updated); }
    var items = [];
    data.races.forEach(function (r) { r.candidates.forEach(function (c) { if (!c.promises.length) items.push("<li><strong>" + esc(r.race) + ":</strong> " + esc(c.name) + ". " + esc(c.note) + "</li>"); }); });
    data.races_without_promises.forEach(function (t) { items.push("<li>" + esc(t) + "</li>"); });
    $("no-promises").innerHTML = items.join("");

    document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab"), true); }); });
    document.querySelector(".tabs").addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var tabs = visibleTabs(), i = tabs.indexOf(state.tab), n = tabs.length;
      i = (i + (e.key === "ArrowRight" ? 1 : n - 1)) % n; switchTab(tabs[i], true); $("tab-" + tabs[i]).focus();
    });
    $("zip-form").addEventListener("submit", function (e) { e.preventDefault(); lookup($("zip").value.trim(), { scroll: true }); });
    $("zip").addEventListener("input", function () { var v = this.value.replace(/\D/g, "").slice(0, 5); if (v !== this.value) this.value = v; $("zip-error").textContent = ""; });
    var timer;
    $("q").addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(function () { state.q = $("q").value; render(); }, 120); });
    $("topic").addEventListener("change", function () { state.topic = $("topic").value; render(); });
    $("status").addEventListener("change", function () { state.status = $("status").value; render(); });
    $("reset").addEventListener("click", function () { state.q = state.topic = state.status = ""; $("q").value = ""; $("topic").value = ""; $("status").value = ""; render(); });
    $("panel").addEventListener("click", function (e) {
      var b = e.target.closest(".count");
      if (!b) return;
      var s = b.getAttribute("data-status");
      state.status = state.status === s ? "" : s; $("status").value = state.status; render();
    });
    window.addEventListener("hashchange", routeFromHash);

    var h = location.hash.slice(1), saved = load(STORE_KEY);
    if (/^zip=\d{5}$/.test(h)) { routeFromHash(); return; }
    var fb = wantsFallback(h);
    switchTab(TABS.indexOf(h) !== -1 && h !== "zip" ? h : "president", false);
    if (saved && /^\d{5}$/.test(saved)) {
      $("zip").value = saved;
      // Returning visitor: reopen their ZIP unless the link asked for a specific tab.
      lookup(saved, { switchTab: !h || fb }).then(function () { if (fb) fallback(h); });
    } else if (fb) fallback(h);
  }

  fetch("data/promises.json", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(init).catch(function (err) {
    $("panel").innerHTML = '<p class="empty">Could not load the data (' + esc(err.message) + '). The raw data is available as <a href="data/promises_2026.csv">promises_2026.csv</a> and <a href="data/president_2024.csv">president_2024.csv</a>.</p>';
    if (window.console) console.error(err);
  });
})();
