(function () {
  "use strict";
  var DATA = null, state = { tab: "president", q: "", topic: "", status: "" };
  var STATUS_DESC = { "Kept": "Promise kept", "Partially kept": "Compromise / partly kept", "In progress": "In the works", "Stalled": "No progress or blocked", "Broken": "Promise broken", "Not yet addressed": "No action yet" };
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

  function fillSelect(sel, values, first) {
    var cur = sel.value;
    sel.innerHTML = '<option value="">' + esc(first) + "</option>" + values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v.charAt(0).toUpperCase() + v.slice(1)) + "</option>"; }).join("");
    sel.value = values.indexOf(cur) !== -1 ? cur : "";
  }

  function setupControls() {
    var topics;
    if (state.tab === "president") {
      topics = uniq(DATA.president.promises.map(function (p) { return p.topic; }));
      $("status-field").hidden = false;
      fillSelect($("status"), DATA.president.status_order, "All statuses");
    } else {
      topics = [];
      DATA.races.filter(function (r) { return r.section === state.tab; }).forEach(function (r) {
        r.candidates.forEach(function (c) { c.promises.forEach(function (p) { topics = topics.concat(p.topics); }); });
      });
      topics = uniq(topics);
      $("status-field").hidden = true;
      state.status = "";
    }
    fillSelect($("topic"), topics, "All topics");
    state.topic = $("topic").value;
  }
  function uniq(a) { var s = {}; a.forEach(function (x) { if (x) s[x] = 1; }); return Object.keys(s).sort(function (x, y) { return x.localeCompare(y); }); }

  function renderPresident() {
    var P = DATA.president, out = [];
    out.push('<p class="muted small">Status of ' + P.total + " promises the current president made during his 2024 campaign, as of " + esc(fmtDate(DATA.last_updated)) + ". Ratings mostly follow PolitiFact's MAGA-Meter. Tap a status to filter.</p>");
    out.push('<div class="counts" role="group" aria-label="Filter by status">');
    P.status_order.forEach(function (s) {
      out.push('<button type="button" class="count" data-status="' + esc(s) + '" aria-pressed="' + (state.status === s) + '"><b>' + (P.counts[s] || 0) + '</b><span class="badge s-' + slug(s) + '">' + esc(s) + "</span></button>");
    });
    out.push("</div><div class=\"bar\" aria-hidden=\"true\">");
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

  function renderRaces(section) {
    var out = [], shown = 0, total = 0, lastLevel = null, racesShown = 0;
    var labels = { state: "Statewide offices", federal: "U.S. Congress", legislature: "State Legislature", local: "Local" };
    if (section === "state") out.push('<p class="muted small">California statewide offices, Board of Equalization District 2, U.S. House District 18 and State Assembly District 29, the districts that include Hollister. Candidates are listed alphabetically.</p>');
    else out.push('<p class="muted small">City of Hollister, San Benito County, school and health care district races. Local offices are nonpartisan. Candidates are listed alphabetically.</p>');
    DATA.races.filter(function (r) { return r.section === section; }).forEach(function (r) {
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
      racesShown++;
      var grp = /^State (Assembly|Senate)/.test(r.race) ? "legislature" : r.level;
      if (section === "state" && grp !== lastLevel) { out.push('<p class="level-label">' + esc(labels[grp] || grp) + "</p>"); lastLevel = grp; }
      out.push('<section class="race" id="race-' + slug(r.race) + '"><h2>' + hl(r.race) + "</h2>" + (r.note ? '<p class="race-note">' + esc(r.note) + "</p>" : "") + candHtml.join("") + "</section>");
    });
    if (!racesShown) out.push('<p class="empty">No promises match these filters.</p>');
    $("summary").textContent = "Showing " + shown + " of " + total + " promises.";
    return out.join("");
  }

  function render() {
    document.querySelectorAll(".tabs button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === state.tab;
      b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1;
    });
    $("panel").setAttribute("aria-labelledby", "tab-" + state.tab);
    $("panel").innerHTML = state.tab === "president" ? renderPresident() : renderRaces(state.tab);
  }

  function switchTab(t, push) {
    if (["president", "state", "local"].indexOf(t) === -1) t = "president";
    state.tab = t;
    setupControls();
    render();
    if (push) history.replaceState(null, "", "#" + t);
  }

  function init(data) {
    DATA = data;
    if (data.last_updated) { $("last-updated").textContent = fmtDate(data.last_updated); $("last-updated").setAttribute("datetime", data.last_updated); }
    var np = $("no-promises"), items = [];
    data.races.forEach(function (r) { r.candidates.forEach(function (c) { if (!c.promises.length) items.push("<li><strong>" + esc(r.race) + ":</strong> " + esc(c.name) + ". " + esc(c.note) + "</li>"); }); });
    data.races_without_promises.forEach(function (t) { items.push("<li>" + esc(t) + "</li>"); });
    np.innerHTML = items.join("");
    document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab"), true); }); });
    document.querySelector(".tabs").addEventListener("keydown", function (e) {
      var tabs = ["president", "state", "local"], i = tabs.indexOf(state.tab);
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { i = (i + (e.key === "ArrowRight" ? 1 : 2)) % 3; switchTab(tabs[i], true); $("tab-" + tabs[i]).focus(); }
    });
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
    window.addEventListener("hashchange", function () { switchTab(location.hash.slice(1), false); });
    switchTab(location.hash.slice(1) || "president", false);
  }

  fetch("data/promises.json", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(init).catch(function (err) {
    $("panel").innerHTML = '<p class="empty">Could not load the data (' + esc(err.message) + '). The raw data is available as <a href="data/promises_2026.csv">promises_2026.csv</a> and <a href="data/president_2024.csv">president_2024.csv</a>.</p>';
  });
})();
