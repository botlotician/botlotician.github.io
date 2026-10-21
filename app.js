(function () {
  "use strict";
  var DATA = null, ZIPS = null, zipPromise = null;
  var state = { tab: "president", q: "", topic: "", status: "", zip: "", zipView: null };
  var TABS = ["zip", "president", "state", "local"];
  var STORE_KEY = "promiseTracker.zip";
  var STATUS_DESC = { "Kept": "Promise kept", "Partially kept": "Compromise / partly kept", "In progress": "In the works", "Stalled": "No progress or blocked", "Broken": "Promise broken", "Not yet addressed": "No action yet" };
  var OFFICE = { cd: "U.S. House", ad: "State Assembly", sd: "State Senate", boe: "Board of Equalization" };
  var PREFIX = { cd: "CA-", ad: "AD-", sd: "SD-", boe: "BOE-" };
  var LINKS = {
    sos: ["California Secretary of State voter guide (statewide races and measures)", "https://voterguide.sos.ca.gov/"],
    status: ["My Voter Status: check registration and find your sample ballot (CA Secretary of State)", "https://voterstatus.sos.ca.gov/"],
    ballotpedia: ["Ballotpedia sample ballot lookup", "https://ballotpedia.org/Sample_Ballot_Lookup"],
    vote411: ["VOTE411 personalized ballot (League of Women Voters)", "https://www.vote411.org/ballot"],
    counties: ["All California county elections offices (Secretary of State list)", "https://www.sos.ca.gov/elections/voting-resources/county-elections-offices"]
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
  function isCAZip(z) { var p = +z.slice(0, 3); return p >= 900 && p <= 961; }
  function placeBase(name) { return name.replace(/ (city|town|CDP)$/, ""); }
  function districtIds(rec, key) { return (rec[key] || []).map(function (d) { return String(+d[0]); }); }
  function raceApplies(r, v) {
    var a = r.area || {}, rec = v.rec;
    if (a.type === "state") return true;
    if (!rec) return false;
    if (a.type in OFFICE) return districtIds(rec, a.type).indexOf(String(+a.id)) !== -1;
    if (a.type === "county") return v.counties.indexOf(a.id) !== -1;
    if (a.type === "city") return v.counties.indexOf(a.county) !== -1 && rec.p.some(function (p) { return / city$| town$/.test(p[0]) && placeBase(p[0]) === a.id; });
    return false;
  }
  function trackedDistricts(type) {
    var out = {};
    DATA.races.forEach(function (r) { if (r.area && r.area.type === type) out[String(+r.area.id)] = r; });
    return out;
  }
  function onBallot(type, id) {
    var rule = ((DATA.coverage || {}).on_ballot_2026 || {})[type] || "all";
    if (rule === "even") return +id % 2 === 0;
    if (rule === "odd") return +id % 2 === 1;
    return rule !== "none";
  }

  /* ---------- ZIP lookup ---------- */
  function getZips() {
    if (!zipPromise) zipPromise = fetch("data/zips_ca.json").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (d) { ZIPS = d; return d; });
    return zipPromise;
  }
  function buildView(zip) {
    var v = { zip: zip, rec: null, kind: "", counties: [], note: "" };
    var po = ((DATA.coverage || {}).po_box_zips || {})[zip];
    var rec = ZIPS.z[zip];
    if (!rec && po && ZIPS.z[po.enclosing_zcta]) {
      rec = ZIPS.z[po.enclosing_zcta];
      v.note = zip + " is a PO Box ZIP for " + po.city + ", so it has no area of its own. Showing the districts for " + po.enclosing_zcta + ", the " + po.city + " ZIP it sits inside. Your races depend on your home address.";
      v.po = po;
    }
    if (rec) {
      v.rec = rec; v.kind = "ca";
      v.counties = rec.c.map(function (c) { return ZIPS.counties[c[0]]; });
      if (!isCAZip(zip)) { v.kind = "ca-partial"; v.note = "ZIP " + zip + " is mostly outside California. Only its California part is described here."; }
    } else if (isCAZip(zip)) v.kind = "ca-unknown";
    else v.kind = "non-ca";
    return v;
  }
  function placeSummary(rec) {
    var p = rec.p, cnty = rec.c.map(function (c) { return ZIPS.counties[c[0]]; });
    var main = p.length && p[0][1] >= 50 ? p[0][0] : null;
    var label = main ? placeBase(main) + (/ CDP$/.test(main) ? " (unincorporated)" : "") + ", " + cnty[0] + " County" : (p.length ? placeBase(p[0][0]) + " area, " : "") + cnty[0] + " County";
    return label;
  }
  function placeDetail(rec) {
    var bits = rec.p.map(function (p) { return placeBase(p[0]) + (/ CDP$/.test(p[0]) ? " (unincorporated community)" : " (city limits)") + " " + pct(p[1]); });
    var inPlaces = rec.p.reduce(function (s, p) { return s + (p[1] || 0); }, 0);
    if (rec.pop && inPlaces < 99) bits.push("outside any city or named community about " + Math.max(0, 100 - inPlaces) + "%");
    return bits;
  }

  function coverageRows(v) {
    var rows = [], rec = v.rec;
    rows.push(["Statewide offices (Governor through Superintendent)", "All California voters", '<span class="st st-yes">Tracked</span> <a href="#state">see races</a>']);
    ["cd", "ad", "sd", "boe"].forEach(function (t) {
      var tracked = trackedDistricts(t), ds = rec ? rec[t] : [];
      if (!rec) { rows.push([OFFICE[t], "Unknown for this ZIP", '<span class="st st-no">Check your sample ballot</span>']); return; }
      var items = ds.map(function (d) {
        var id = String(+d[0]), name = PREFIX[t] + id;
        var status = !onBallot(t, id) ? '<span class="st st-off">Not on the 2026 ballot</span>' :
          tracked[id] ? '<span class="st st-yes">Tracked</span> <a href="#race-' + slug(tracked[id].race) + '">see race</a>' : '<span class="st st-no">Not tracked yet</span>';
        return "<li><strong>" + esc(name) + "</strong>" + (ds.length > 1 ? ' <span class="muted">(' + pct(d[1]) + " of residents)</span>" : "") + " " + status + "</li>";
      });
      rows.push([OFFICE[t] + (ds.length > 1 ? ' <span class="muted small">(this ZIP is split)</span>' : ""), "<ul>" + items.join("") + "</ul>", ""]);
    });
    return rows;
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
    function official(counties) {
      var li = [];
      if (v.kind !== "non-ca") {
        li.push(LINKS.status, LINKS.sos);
        (counties || []).forEach(function (c) {
          var i = ZIPS.counties.indexOf(c), u = i >= 0 ? ZIPS.county_urls[i] : "";
          if (u) li.push([c + " County elections office", u]);
        });
        if (!counties || !counties.length) li.push(LINKS.counties);
      }
      li.push(LINKS.ballotpedia, LINKS.vote411);
      return '<div class="official"><h3>Check your real ballot</h3><ul>' + li.map(function (l) { return "<li>" + link(l[1], l[0]) + "</li>"; }).join("") + "</ul></div>";
    }

    if (v.kind === "non-ca") {
      $("summary").textContent = "";
      return '<div class="zipcard"><h2>ZIP ' + esc(v.zip) + ": outside California</h2><p>This tracker currently covers California only, so it has no races for this ZIP. The president's 2024 promises apply nationwide.</p>" +
        '<p><a class="btnlink" href="#president">See the President\'s 2024 promises</a></p>' + official(null) + "</div>";
    }
    if (v.kind === "ca-unknown") {
      out.push('<div class="zipcard"><h2>ZIP ' + esc(v.zip) + "</h2><p>We couldn't find this ZIP in the Census ZIP areas. It may be a PO Box or business ZIP, or it may not exist. If it's a California ZIP, the <a href=\"#state\">statewide races</a> are on your ballot, but we can't tell your districts or local races from it. Try the ZIP of your home address.</p>" + official(null) + "</div>");
      $("summary").textContent = "";
      return out.join("");
    }

    var rec = v.rec, where = placeSummary(rec), counties = v.counties;
    var split = ["c", "cd", "ad", "sd", "boe"].some(function (k) { return rec[k].length > 1; }) || rec.p.length > 1 || (rec.p.length && rec.p[0][1] < 99);
    out.push('<div class="zipcard"><h2>ZIP ' + esc(v.zip) + ": " + esc(where) + "</h2>");
    if (v.note) out.push('<p class="warn">' + esc(v.note) + "</p>");
    out.push('<p class="small muted">County: ' + rec.c.map(function (c) { return esc(ZIPS.counties[c[0]]) + (rec.c.length > 1 ? " " + pct(c[1]) : ""); }).join(", ") +
      (rec.p.length ? ". Areas: " + placeDetail(rec).map(esc).join("; ") : "") + ". Shares are of the ZIP's 2020 Census population.</p>");
    if (split) out.push('<p class="warn"><strong>This ZIP may be split.</strong> It crosses city or district lines, so the races on your ballot depend on your exact address. Every district that overlaps this ZIP is listed below. Check your sample ballot to be sure.</p>');
    out.push('<table class="cov"><thead><tr><th>Office</th><th>Your district(s) and tracker coverage</th></tr></thead><tbody>');
    coverageRows(v).forEach(function (r) { out.push("<tr><td>" + r[0] + "</td><td>" + r[1] + (r[2] ? " " + r[2] : "") + "</td></tr>"); });
    // local
    var local = DATA.races.filter(function (r) { return r.section === "local" && raceApplies(r, v); });
    var cityNames = rec.p.filter(function (p) { return / city$| town$/.test(p[0]); }).map(function (p) { return placeBase(p[0]); });
    var mainCounties = rec.c.filter(function (c, i) { return i === 0 || c[1] >= 1; }).map(function (c) { return ZIPS.counties[c[0]]; });
    var localWhere = (cityNames.length ? cityNames.join(" / ") + ", " : "") + mainCounties.join(" County / ") + " County";
    var trackedC = (DATA.coverage || {}).tracked_counties || [];
    var untrackedCounties = counties.filter(function (c) { return trackedC.indexOf(c) === -1; });
    var localCell = local.length ? '<span class="st st-yes">Some tracked</span> ' + local.length + " local race" + (local.length === 1 ? "" : "s") + " below. Each lists who votes in it." : '<span class="st st-no">Not tracked yet</span>';
    if (!local.length) localCell += " Local races for " + esc(localWhere) + " aren't tracked yet.";
    else if (untrackedCounties.length) localCell += " Local races in " + esc(untrackedCounties.join(" County, ")) + " County (also part of this ZIP) aren't tracked yet.";
    if (local.length && counties.indexOf("San Benito") !== -1 && cityNames.indexOf("Hollister") === -1) localCell += " Hollister city races aren't shown, because this ZIP isn't inside Hollister city limits.";
    out.push("<tr><td>City, county, school and special districts</td><td><strong>" + esc(localWhere) + "</strong><br>" + localCell + "</td></tr>");
    out.push("</tbody></table>");
    out.push(official(counties));
    out.push(requestLink(localWhere, local.length > 0));
    out.push("</div>");

    // race cards: district + local first, then statewide
    var districtRaces = DATA.races.filter(function (r) { return r.area && r.area.type in OFFICE && raceApplies(r, v); });
    var statewide = DATA.races.filter(function (r) { return r.area && r.area.type === "state"; });
    var a = raceBlocks(districtRaces, { who: true }), b = raceBlocks(local, { who: true }), c = raceBlocks(statewide, {});
    if (a.html) out.push('<p class="level-label">Your district races in this tracker</p>' + a.html);
    if (b.html) out.push('<p class="level-label">Local races in this tracker</p>' + b.html);
    out.push('<details class="group" open><summary>Statewide races (on every California ballot)</summary>' + (c.html || '<p class="empty">No statewide promises match these filters.</p>') + "</details>");
    $("summary").textContent = "Showing " + (a.shown + b.shown + c.shown) + " of " + (a.total + b.total + c.total) + " promises for ZIP " + v.zip + ".";
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

  function renderSection(section) {
    var intro = section === "state"
      ? '<p class="muted small">California statewide offices, Board of Equalization District 2, U.S. House District 18 and State Assembly District 29, the districts that include Hollister. Candidates are listed alphabetically. <a href="#zip-form">Enter your ZIP</a> to see which apply to you.</p>'
      : '<p class="muted small">City of Hollister, San Benito County, school and health care district races. Local offices are nonpartisan. Candidates are listed alphabetically. Many of these races cover only part of the county; the line under each race says who votes in it.</p>';
    var res = raceBlocks(DATA.races.filter(function (r) { return r.section === section; }), { groups: section === "state", who: section === "local" });
    $("summary").textContent = "Showing " + res.shown + " of " + res.total + " promises.";
    return intro + (res.html || '<p class="empty">No promises match these filters.</p>');
  }

  /* ---------- controls / tabs ---------- */
  function fillSelect(sel, values, first) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(first) + "</option>" + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v.charAt(0).toUpperCase() + v.slice(1)) + "</option>"; }).join("");
    sel.value = values.indexOf(cur) !== -1 ? cur : "";
  }
  function racesForTab() {
    if (state.tab === "zip") return state.zipView && state.zipView.kind !== "non-ca" ? DATA.races.filter(function (r) { return raceApplies(r, state.zipView); }) : [];
    return DATA.races.filter(function (r) { return r.section === state.tab; });
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
    $("panel").innerHTML = state.tab === "president" ? renderPresident() : state.tab === "zip" ? renderZip() : renderSection(state.tab);
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
    if (!/^\d{5}$/.test(zip)) {
      $("zip-error").textContent = "Please enter a 5-digit ZIP code (numbers only), for example 95023.";
      $("zip").setAttribute("aria-invalid", "true");
      return Promise.resolve(false);
    }
    $("zip").removeAttribute("aria-invalid");
    return getZips().then(function () {
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

  function routeFromHash() {
    var h = location.hash.slice(1);
    var m = /^zip=(\d{5})$/.exec(h);
    if (m) { $("zip").value = m[1]; lookup(m[1]); return; }
    if (/^race-/.test(h)) {
      var el = document.getElementById(h);
      if (el) { el.scrollIntoView(); return; }
      var r = DATA.races.filter(function (x) { return "race-" + slug(x.race) === h; })[0];
      if (r) { switchTab(r.section, false); var e2 = document.getElementById(h); if (e2) e2.scrollIntoView(); }
      return;
    }
    if (h === "zip-form" || h === "methodology" || h === "main") return;
    if (TABS.indexOf(h) !== -1) switchTab(h, false);
  }

  function init(data) {
    DATA = data;
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
    switchTab(TABS.indexOf(h) !== -1 && h !== "zip" ? h : "president", false);
    if (/^race-/.test(h)) routeFromHash();
    if (saved && /^\d{5}$/.test(saved)) {
      $("zip").value = saved;
      // Returning visitor: reopen their ZIP unless the link asked for a specific tab.
      lookup(saved, { switchTab: !h });
    }
  }

  fetch("data/promises.json", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(init).catch(function (err) {
    $("panel").innerHTML = '<p class="empty">Could not load the data (' + esc(err.message) + '). The raw data is available as <a href="data/promises_2026.csv">promises_2026.csv</a> and <a href="data/president_2024.csv">president_2024.csv</a>.</p>';
    if (window.console) console.error(err);
  });
})();
