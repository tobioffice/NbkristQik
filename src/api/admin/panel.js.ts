// Extracted from the admin panel HTML — composed in ../adminPanel.ts.
export const panelJs = `(function () {
  "use strict";
  var BASE = location.pathname.replace(/\\/+$/, "");
  var $ = function (id) { return document.getElementById(id); };

  var ACTION_LABELS = {
    "roll_lookup": "Roll lookup", "attendance": "Attendance", "midmarks": "Mid marks",
    "bunk": "Bunk plan",
    "command:start": "/start", "command:help": "/help", "command:leaderboard": "/leaderboard",
    "report": "Report to admin", "report_followup": "Thread follow-up"
  };
  var SURFACES = [
    { key: "private", label: "Private chat", color: "var(--accent)" },
    { key: "channel", label: "Channel", color: "var(--text-2)" },
    { key: "group", label: "Group", color: "var(--text-3)" },
    { key: "unknown", label: "Web app", color: "var(--surface-active)" }
  ];
  var surfaceColor = function (k) {
    for (var i = 0; i < SURFACES.length; i++) if (SURFACES[i].key === k) return SURFACES[i].color;
    return "var(--text-2)";
  };
  var surfaceLabel = function (k) {
    for (var i = 0; i < SURFACES.length; i++) if (SURFACES[i].key === k) return SURFACES[i].label;
    return k;
  };

  var fmt = function (n) { return Number(n || 0).toLocaleString("en-IN"); };
  var actionLabel = function (a) { return ACTION_LABELS[a] || a.replace(/_/g, " "); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var ago = function (utc) {
    var t = Date.parse(utc + "Z");
    if (isNaN(t)) return utc;
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  };

  // the DB stores UTC; every wall-clock time shown here is converted to
  // IST (Asia/Kolkata) in the browser, in 12-hour AM/PM format
  var istTimeFmt = null, istDateFmt = null;
  var parseUtc = function (utcStr) {
    return Date.parse(String(utcStr).replace(" ", "T") + "Z");
  };
  var istTime = function (utcStrOrMs) {
    var t =
      typeof utcStrOrMs === "number"
        ? utcStrOrMs
        : parseUtc(utcStrOrMs);
    if (isNaN(t)) return String(utcStrOrMs).slice(11, 16);
    if (!istTimeFmt)
      istTimeFmt = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true,
      });
    return istTimeFmt.format(t);
  };
  var istDate = function (utcMs) {
    if (!istDateFmt)
      istDateFmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
      });
    return istDateFmt.format(utcMs);
  };
  // concrete AM/PM IST clock time for recent entries, relative for older:
  // today -> "9:15 AM", yesterday -> "Yesterday 9:15 PM", else "3d ago"
  var clockOrAgo = function (utcStr) {
    var t = parseUtc(utcStr);
    if (isNaN(t)) return utcStr;
    var day = istDate(t);
    if (day === istDate(Date.now())) return istTime(t);
    if (day === istDate(Date.now() - 86400000)) return "Yesterday " + istTime(t);
    return ago(utcStr);
  };

  var api = function (path) {
    return fetch(BASE + "/api/" + path).then(function (r) {
      if (r.status === 401) { showLogin(); throw new Error("unauthorized"); }
      if (!r.ok) throw new Error("Server error " + r.status);
      return r.json();
    });
  };

  var showLogin = function () {
    $("topbar").style.display = "none";
    $("app").style.display = "none";
    $("loginwrap").classList.add("show");
    var pw = $("pw"); if (pw) pw.focus();
  };
  var showApp = function () {
    $("loginwrap").classList.remove("show");
    $("topbar").style.display = "flex";
    $("app").style.display = "block";
  };

  $("loginform").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("pw").value;
    $("loginerr").textContent = "";
    fetch(BASE + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw })
    }).then(function (r) {
      if (r.ok) { $("pw").value = ""; showApp(); switchView("overview"); return; }
      return r.json().then(function (b) {
        $("loginerr").textContent = b.error || "Sign in failed";
      });
    }).catch(function () { $("loginerr").textContent = "Could not reach the server"; });
  });

  $("signout").addEventListener("click", function () {
    fetch(BASE + "/logout", { method: "POST" }).then(function () { showLogin(); });
  });

  /* ---------- navigation ---------- */
  var current = "overview";
  // don't re-query on every tab switch — each view refetches only when its
  // client-side copy goes stale (mirrors the server-side cache TTLs)
  var lastLoad = {};
  // one request of each kind in flight at most: without this, a timer tick
  // landing mid-reply (or a double-click) fires the same heavy query twice
  var inflight = {};
  // the drawer paints the instant a row is tapped (shell, cache, or sketch)
  // and reconciles in the background — which conversation is on screen, and
  // the warm threads/students behind them
  var drawerIssue = null;
  var threadCache = {};
  var userCache = {};
  var STALE_MS = { overview: 60000, students: 30000, verified: 20000, league: 30000, library: 30000, reports: 60000, papers: 30000, live: 0, health: 300000 };
  var isStale = function (name) {
    return !lastLoad[name] || Date.now() - lastLoad[name] > STALE_MS[name];
  };
  var activateTab = function (name) {
    current = name;
    var tabs = document.querySelectorAll(".nav button");
    for (var i = 0; i < tabs.length; i++) {
      if (tabs[i].dataset.view === name) tabs[i].setAttribute("aria-current", "page");
      else tabs[i].removeAttribute("aria-current");
    }
    var views = document.querySelectorAll(".view");
    for (var j = 0; j < views.length; j++)
      views[j].classList.toggle("active", views[j].id === "view-" + name);
  };
  var switchView = function (name) {
    activateTab(name);
    window.scrollTo(0, 0);
    if (name === "overview" && isStale("overview")) loadOverview();
    if (name === "students" && isStale("students")) loadUsers();
    if (name === "verified" && isStale("verified")) loadVerified();
    if (name === "league" && isStale("league")) loadLeague();
    if (name === "library" && isStale("library")) loadLibrary();
    if (name === "live") loadFeed();
    if (name === "reports" && isStale("reports")) loadReports();
    if (name === "papers" && isStale("papers")) loadPapers();
    if (name === "health" && isStale("health")) loadHealth();
  };
  var tabs = document.querySelectorAll(".nav button");
  for (var i = 0; i < tabs.length; i++)
    tabs[i].addEventListener("click", function () { switchView(this.dataset.view); });

  /* ---------- overview ---------- */
  var overviewData = null;
  var pulseRange = "30d";

  // zero-fills the selected window from the cached overview payload, so
  // switching between monthly and daily costs no extra request.
  // "Today" = since midnight IST (12 AM), growing hour by hour — the
  // backend buckets are IST wall-clock hours, so the keys match directly
  var buildPulsePoints = function () {
    if (!overviewData) return [];
    var out = [];
    if (pulseRange === "24h") {
      var byHour = {};
      var hourly = overviewData.hourly || [];
      for (var i = 0; i < hourly.length; i++) byHour[hourly[i].h] = hourly[i];
      var istNow = new Date(Date.now() + 19800000); // shifted = IST wall clock
      var currentIstHour = istNow.getUTCHours();
      var todayIst = istDate(Date.now());
      // today's IST 00:00 expressed as a UTC instant
      var istMidnightUtc =
        Math.floor((Date.now() + 19800000) / 86400000) * 86400000 - 19800000;
      for (var h = 0; h <= currentIstHour; h++) {
        var hh = (h < 10 ? "0" : "") + h;
        // matches the backend key: strftime('%Y-%m-%d %H', ...,'+330 minutes')
        var rec = byHour[todayIst + " " + hh];
        out.push({
          label: istTime(istMidnightUtc + h * 3600000) + "–" + istTime(istMidnightUtc + (h + 1) * 3600000),
          actions: rec ? rec.actions : 0,
          users: rec ? rec.users : 0,
        });
      }
    } else {
      var byDay = {};
      var daily = overviewData.daily || [];
      for (var j = 0; j < daily.length; j++) byDay[daily[j].day] = daily[j];
      var now = new Date();
      for (var d = 29; d >= 0; d--) {
        var dt = new Date(now.getTime() - d * 86400000);
        var key = istDate(dt.getTime());
        var rec2 = byDay[key];
        out.push({
          label: key,
          actions: rec2 ? rec2.actions : 0,
          users: rec2 ? rec2.users : 0,
        });
      }
    }
    return out;
  };

  var drawPulse = function (points) {
    var svg = $("pulse");
    if (!points.length) return;
    var W = 640, H = 120, pad = 4;
    var max = 1;
    for (var k = 0; k < points.length; k++) {
      max = Math.max(max, points[k].actions);
    }
    var step = (W - pad * 2) / (points.length - 1);
    var y = function (v) { return H - pad - (v / max) * (H - pad * 2 - 8); };
    var pts = [];
    for (var p = 0; p < points.length; p++) pts.push([pad + p * step, y(points[p].actions)]);
    var line = "";
    for (var q = 0; q < pts.length; q++) line += (q ? " L" : "M") + pts[q][0].toFixed(1) + " " + pts[q][1].toFixed(1);
    var area = line + " L" + (W - pad) + " " + H + " L" + pad + " " + H + " Z";
    var svgHtml =
      '<path d="' + area + '" style="fill:var(--accent);fill-opacity:.14"/>' +
      '<path d="' + line + '" style="fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>' +
      '<line x1="' + pts[pts.length - 1][0] + '" y1="' + pts[pts.length - 1][1] + '" x2="' + pts[pts.length - 1][0] + '" y2="' + H + '" style="stroke:var(--accent);stroke-opacity:.35" stroke-dasharray="2 3"/>';
    for (var r = 0; r < points.length; r += 1) {
      var cx = pad + r * step, cy = y(points[r].actions);
      svgHtml += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="7" fill="transparent"><title>' + points[r].label + ": " + points[r].actions + " actions, " + points[r].users + " students</title></circle>";
    }
    svg.innerHTML = svgHtml;
    svg.onmousemove = function (ev) {
      var rect = svg.getBoundingClientRect();
      var idx = Math.round(((ev.clientX - rect.left) / rect.width * (points.length - 1)));
      idx = Math.max(0, Math.min(points.length - 1, idx));
      var pt = points[idx];
      var lab = pulseRange === "24h" ? pt.label : pt.label.slice(5);
      var tip = document.getElementById("pctip");
      if (!tip) {
        tip = document.createElement("div");
        tip.id = "pctip";
        tip.style.cssText = "position:fixed;pointer-events:none;font-size:12px;background:var(--dropdown);border:0;color:var(--text);padding:6px 10px;border-radius:8px;z-index:30;font-family:" + "var(--font)" + ";font-variant-numeric:tabular-nums;white-space:nowrap";
        document.body.appendChild(tip);
      }
      tip.textContent = lab + (pulseRange === "24h" ? " IST" : "") + " · " + pt.actions + " actions · " + pt.users + " students";
      tip.style.left = (ev.clientX + 12) + "px";
      tip.style.top = (ev.clientY - 30) + "px";
      tip.style.display = "block";
    };
    svg.onmouseleave = function () {
      var tip = document.getElementById("pctip");
      if (tip) tip.style.display = "none";
    };
  };

  var pulseBtns = document.querySelectorAll("#pulseseq button");
  for (var pb = 0; pb < pulseBtns.length; pb++)
    pulseBtns[pb].addEventListener("click", function () {
      pulseRange = this.dataset.range;
      for (var k = 0; k < pulseBtns.length; k++)
        pulseBtns[k].setAttribute("aria-pressed", String(pulseBtns[k] === this));
      drawPulse(buildPulsePoints());
    });

  var drawSurfaces = function (surfaces) {
    var total = 0;
    for (var key in surfaces) total += surfaces[key];
    var bar = $("surfaceline"), legend = $("surfacelegend");
    if (!total) { bar.innerHTML = ""; legend.innerHTML = '<span class="hint">No activity recorded yet.</span>'; return; }
    var widths = [];
    var barHtml = "", legendHtml = "";
    for (var s = 0; s < SURFACES.length; s++) {
      var n = surfaces[SURFACES[s].key] || 0;
      if (!n) continue;
      var pct = (n / total) * 100;
      widths.push(pct.toFixed(2) + "%");
      barHtml += '<div style="width:0;background:' + SURFACES[s].color + '"></div>';
      legendHtml += '<span class="item"><span class="dot" style="background:' + SURFACES[s].color + '"></span>' +
        SURFACES[s].label + ' <span class="n">' + fmt(n) + '</span> <span class="dim">' + Math.round(pct) + '%</span></span>';
    }
    bar.innerHTML = barHtml;
    legend.innerHTML = legendHtml;
    // paint at 0 first so the CSS transition animates the segments in
    requestAnimationFrame(function () {
      var segs = bar.children;
      for (var i = 0; i < segs.length && i < widths.length; i++)
        segs[i].style.width = widths[i];
    });
  };

  var drawWeights = function (topActions) {
    var wrap = $("weights");
    var max = 1;
    for (var i = 0; i < topActions.length; i++) max = Math.max(max, topActions[i].count);
    var html = "";
    for (var j = 0; j < topActions.length; j++) {
      var a = topActions[j];
      html += '<div class="weight"><span class="w-label">' + esc(actionLabel(a.action)) + "</span>" +
        '<span class="w-bar"><div style="width:' + (a.count / max * 100).toFixed(1) + '%"></div></span>' +
        '<span class="w-n">' + fmt(a.count) + "</span></div>";
    }
    wrap.innerHTML = html || '<div class="empty">Nothing recorded in the last 7 days.</div>';
  };

  // count-up on the stat numbers — one entrance, skipped for reduced motion
  var reducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var countUp = function (el, target) {
    var from = Number(el.dataset.v || 0);
    el.dataset.v = String(target);
    if (reducedMotion || !isFinite(target) || from === target) {
      el.textContent = fmt(target);
      return;
    }
    var t0 = null;
    var step = function (ts) {
      if (!t0) t0 = ts;
      var k = Math.min(1, (ts - t0) / 650);
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(from + (target - from) * eased));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  // pure render: shared by the loader and the boot probe, so opening the
  // panel costs exactly one overview query instead of two
  var renderOverview = function (d) {
      overviewData = d;
      countUp($("ov-active-today"), d.totals.activeToday);
      $("ov-sub").textContent = fmt(d.totals.totalActions) + " actions recorded all time";
      countUp($("ov-users"), d.totals.users);
      countUp($("ov-active7"), d.totals.active7d);
      countUp($("ov-active30"), d.totals.active30d);
      countUp($("ov-actions"), d.totals.totalActions);
      drawPulse(buildPulsePoints());
      drawSurfaces(d.surfaces || {});
      drawWeights(d.topActions || []);
  };

  var loadOverview = function () {
    if (inflight.overview) return;
    inflight.overview = true;
    lastLoad.overview = Date.now();
    api("overview").then(function (d) {
      renderOverview(d);
    }).catch(function () {}).then(function () { inflight.overview = false; });
  };

  /* ---------- students ---------- */
  var userQuery = "", userSort = "recent";
  var loadUsers = function () {
    if (inflight.students) return;
    inflight.students = true;
    lastLoad.students = Date.now();
    api("users?q=" + encodeURIComponent(userQuery) + "&sort=" + userSort + "&limit=100").then(function (d) {
      var rows = $("userrows");
      var html = "";
      for (var i = 0; i < d.users.length; i++) {
        var u = d.users[i];
        var name = u.firstName || u.username || ("ID " + u.userId);
        var handle = u.username ? "@" + u.username : "";
        html += '<tr data-uid="' + u.userId + '">' +
          '<td class="who"><div class="name">' + esc(name) + (handle ? ' <span class="handle">' + esc(handle) + "</span>" : "") + "</div></td>" +
          '<td class="mono rolls">' + (u.rollNo ? esc(u.rollNo) : "&ndash;") + "</td>" +
          '<td class="dim">' + clockOrAgo(u.lastSeen) + "</td>" +
          '<td class="num mono">' + fmt(u.totalActions) + "</td>" +
          '<td class="num mono">' + fmt(u.privateActions) + "</td>" +
          '<td class="num mono">' + fmt(u.channelActions) + "</td>" +
          '<td class="num mono">' + fmt(u.groupActions) + "</td>" +
          "</tr>";
      }
      rows.innerHTML = html;
      $("userempty").style.display = d.users.length ? "none" : "block";
      var trs = rows.querySelectorAll("tr");
      for (var t = 0; t < trs.length; t++)
        trs[t].addEventListener("click", function () { openDrawer(this.dataset.uid); });
    }).catch(function () {}).then(function () { inflight.students = false; });
  };
  /* ---------- verified rolls ---------- */
  var verifiedQuery = "";
  var verifiedTimer = null;
  var loadVerified = function () {
    if (inflight.verified) return;
    inflight.verified = true;
    lastLoad.verified = Date.now();
    api("verified?q=" + encodeURIComponent(verifiedQuery) + "&limit=200").then(function (d) {
      var html = "";
      for (var i = 0; i < d.claims.length; i++) {
        var c = d.claims[i];
        var name = c.displayName || c.masterName || c.firstName || c.username || ("ID " + c.userId);
        var handle = c.username ? ' <span class="handle">@' + esc(c.username) + "</span>" : "";
        var when = istDate(parseUtc(c.verifiedAt)) + " " + istTime(parseUtc(c.verifiedAt));
        var privacy = "";
        if (c.hideLeaderboard) privacy += '<span class="badge">Hidden</span>';
        if (c.blockLookups) privacy += '<span class="badge">Owner only</span>';
        if (c.blockRegistration) privacy += '<span class="badge">Locked</span>';
        if (!privacy) privacy = '<span class="dim">Open</span>';
        html += '<tr data-uid="' + (c.userId == null ? "" : c.userId) + '">' +
          '<td class="who"><div class="name">' + esc(name) + handle + "</div></td>" +
          '<td class="mono rolls">' + esc(c.rollNo) + "</td>" +
          '<td class="mono">' + esc(c.email) + "</td>" +
          '<td class="dim">' + when + "</td>" +
          "<td>" + privacy + "</td>" +
          "</tr>";
      }
      $("verifiedrows").innerHTML = html;
      $("verifiedempty").style.display = d.claims.length ? "none" : "block";
      var trs = $("verifiedrows").querySelectorAll("tr");
      for (var t = 0; t < trs.length; t++) {
        var uid = trs[t].dataset.uid;
        if (uid) trs[t].addEventListener("click", function () { openDrawer(this.dataset.uid); });
      }
    }).catch(function () {}).then(function () { inflight.verified = false; });
  };
  $("verifiedsearch").addEventListener("input", function () {
    clearTimeout(verifiedTimer);
    var v = this.value;
    verifiedTimer = setTimeout(function () {
      var q = v.trim();
      if (q === verifiedQuery) return;
      verifiedQuery = q;
      loadVerified();
    }, 250);
  });
  $("verifiedrefresh").addEventListener("click", function () { loadVerified(); });

  /* ---------- league boards ---------- */
  var loadLeague = function () {
    if (inflight.league) return;
    inflight.league = true;
    lastLoad.league = Date.now();
    api("league").then(function (d) {
      var stats = d.stats || {};
      $("league-week").textContent =
        (d.weekLabel || "this week") + " \u00b7 " +
        fmt(stats.playersToday) + " finished today";
      $("league-players-count").textContent = fmt(stats.players);
      $("league-verified-count").textContent = fmt(stats.verified);
      $("league-sections-count").textContent = fmt(stats.sections);
      $("league-runs-count").textContent = fmt(stats.runsToday);

      var sections = "";
      for (var i = 0; i < d.sections.length; i++) {
        var section = d.sections[i];
        sections += "<tr>" +
          '<td class="dim mono">' + (i + 1) + "</td>" +
          '<td class="who"><div class="name">' + esc(section.label) + "</div></td>" +
          '<td class="num mono">' + fmt(section.players) + "</td>" +
          '<td class="num mono">' + fmt(section.points) + "</td>" +
          "</tr>";
      }
      $("league-section-rows").innerHTML = sections;
      $("league-sections-empty").style.display = d.sections.length ? "none" : "block";

      var hint = "showing " + fmt(d.playersShown) + " of " + fmt(d.playerTotal);
      if (d.playersShown >= d.playerTotal) hint = fmt(d.playerTotal) + " scorers";
      $("league-player-hint").textContent = hint;

      var players = "";
      for (var j = 0; j < d.players.length; j++) {
        var p = d.players[j];
        var name = p.displayName || p.firstName || (p.username ? "@" + p.username : "") || ("ID " + p.userId);
        var handle = p.username && name !== "@" + p.username
          ? ' <span class="handle">@' + esc(p.username) + "</span>"
          : "";
        var status = p.verified
          ? '<span class="badge">Verified</span>'
          : '<span class="dim">Unverified</span>';
        if (p.hidden) status += ' <span class="badge">Hidden</span>';
        players += '<tr data-uid="' + p.userId + '">' +
          '<td class="dim mono">' + (j + 1) + "</td>" +
          '<td class="who"><div class="name">' + esc(name) + handle + "</div></td>" +
          '<td class="mono rolls">' + esc(p.rollNo) + "</td>" +
          '<td class="dim">' + (p.sectionLabel ? esc(p.sectionLabel) : "&ndash;") + "</td>" +
          "<td>" + status + "</td>" +
          '<td class="num mono">' + fmt(p.points) + "</td>" +
          "</tr>";
      }
      $("league-player-rows").innerHTML = players;
      $("league-players-empty").style.display = d.players.length ? "none" : "block";
      var trs = $("league-player-rows").querySelectorAll("tr");
      for (var t = 0; t < trs.length; t++)
        trs[t].addEventListener("click", function () { openDrawer(this.dataset.uid); });
    }).catch(function () {}).then(function () { inflight.league = false; });
  };
  $("leaguerefresh").addEventListener("click", function () { loadLeague(); });

  var searchTimer = null;
  $("usersearch").addEventListener("input", function () {
    clearTimeout(searchTimer);
    var v = this.value;
    searchTimer = setTimeout(function () { var q = v.trim(); if (q === userQuery) return; userQuery = q; loadUsers(); }, 250);
  });
  var sortBtns = document.querySelectorAll("#usersort button");
  for (var sb = 0; sb < sortBtns.length; sb++)
    sortBtns[sb].addEventListener("click", function () {
      userSort = this.dataset.sort;
      for (var k = 0; k < sortBtns.length; k++)
        sortBtns[k].setAttribute("aria-pressed", String(sortBtns[k] === this));
      loadUsers();
    });

  /* ---------- library ---------- */
  var libQuery = "", libSort = "recent";
  var libReaderLabel = function (r) {
    var name = r.displayName || r.collegeName || r.firstName || r.username || ("ID " + r.userId);
    var handle = r.username ? "@" + r.username : "";
    return { name: name, handle: handle };
  };
  var loadLibrary = function () {
    if (inflight.library) return;
    inflight.library = true;
    lastLoad.library = Date.now();
    var readersUrl = "library/readers?q=" + encodeURIComponent(libQuery) + "&sort=" + libSort + "&limit=100";
    Promise.all([
      api("library/summary"),
      api(readersUrl),
      api("library/documents"),
      api("library/recent?limit=60"),
    ]).then(function (parts) {
      renderLibrarySummary(parts[0]);
      renderLibraryReaders(parts[1]);
      renderLibraryDocs(parts[2]);
      renderLibraryFeed(parts[3]);
    }).catch(function () {}).then(function () { inflight.library = false; });
  };
  var renderLibrarySummary = function (d) {
    $("lib-readers").textContent = fmt(d.readers);
    $("lib-pages").textContent = fmt(d.pagesRead);
    $("lib-downloads").textContent = fmt(d.pdfDownloads);
    $("lib-docs").textContent = fmt(d.docs);
  };
  var renderLibraryReaders = function (d) {
    var rows = $("libreaders");
    var html = "";
    for (var i = 0; i < d.readers.length; i++) {
      var r = d.readers[i];
      var label = libReaderLabel(r);
      html += '<tr data-uid="' + esc(String(r.userId)) + '">' +
        '<td class="who"><div class="name">' + esc(label.name) + (label.handle ? ' <span class="handle">' + esc(label.handle) + "</span>" : "") + "</div></td>" +
        '<td class="mono rolls">' + (r.rollNo ? esc(r.rollNo) : "&ndash;") + "</td>" +
        '<td class="num mono">' + fmt(r.docsRead) + "</td>" +
        '<td class="num mono">' + fmt(r.pagesRead) + "</td>" +
        '<td class="num mono">' + fmt(r.pdfDownloads) + "</td>" +
        '<td class="dim">' + clockOrAgo(r.lastAt) + "</td></tr>";
    }
    rows.innerHTML = html;
    $("libreaderempty").style.display = d.readers.length ? "none" : "block";
    $("lib-reader-hint").textContent = d.readers.length ? d.readers.length + " readers" : "";
    var trs = rows.querySelectorAll("tr");
    for (var t = 0; t < trs.length; t++)
      trs[t].addEventListener("click", function () { openLibraryDrawer(this.dataset.uid); });
  };
  var renderLibraryDocs = function (d) {
    var rows = $("libdocs");
    var html = "";
    for (var i = 0; i < d.documents.length; i++) {
      var doc = d.documents[i];
      html += "<tr>" +
        '<td class="mono rolls">' + esc(doc.code) + "</td>" +
        '<td class="who"><div class="name">' + esc(doc.title) + "</div></td>" +
        '<td class="mono rolls">' + (doc.unit ? esc(doc.unit) : "&ndash;") + "</td>" +
        '<td class="num mono">' + fmt(doc.readers) + "</td>" +
        '<td class="num mono">' + fmt(doc.pagesRead) + "</td>" +
        '<td class="num mono">' + fmt(doc.pdfDownloads) + "</td>" +
        '<td class="num mono">' + fmt(doc.completionPct) + "%</td>" +
        '<td class="dim">' + clockOrAgo(doc.lastAt) + "</td></tr>";
    }
    rows.innerHTML = html;
    $("libdocsempty").style.display = d.documents.length ? "none" : "block";
  };
  var renderLibraryFeed = function (d) {
    var el = $("libfeed");
    if (!d.events.length) {
      el.innerHTML = '<div class="empty">No library activity yet. Page views and PDF downloads appear here.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < d.events.length; i++) {
      var e = d.events[i];
      var who = e.displayName || e.collegeName || e.firstName || e.username || ("ID " + e.userId);
      var what = e.page === 0 ? "PDF" : "p" + e.page;
      var docLabel = e.code ? e.code + (e.unit ? " · Unit " + e.unit : "") : (e.title || e.docId);
      html += '<div class="feedrow"><span class="when">' + istTime(e.at) + "</span>" +
        '<span class="what"><span class="badge">' + esc(what) + "</span>" +
        esc(who) + (e.rollNo ? ' <span class="detail mono">' + esc(e.rollNo) + "</span>" : "") +
        '<span class="detail">' + esc(docLabel) + " · " + esc(e.surface) + "</span></span></div>";
    }
    el.innerHTML = html;
  };
  var libSearchTimer = null;
  $("libsearch").addEventListener("input", function () {
    clearTimeout(libSearchTimer);
    var v = this.value;
    libSearchTimer = setTimeout(function () { var q = v.trim(); if (q === libQuery) return; libQuery = q; lastLoad.library = 0; loadLibrary(); }, 250);
  });
  var libSortBtns = document.querySelectorAll("#libsort button");
  for (var lb = 0; lb < libSortBtns.length; lb++)
    libSortBtns[lb].addEventListener("click", function () {
      libSort = this.dataset.sort;
      for (var k2 = 0; k2 < libSortBtns.length; k2++)
        libSortBtns[k2].setAttribute("aria-pressed", String(libSortBtns[k2] === this));
      lastLoad.library = 0;
      loadLibrary();
    });
  $("librefresh").addEventListener("click", function () { lastLoad.library = 0; loadLibrary(); });
  $("libresolve").addEventListener("click", function () {
    var token = $("libtoken").value.trim().toUpperCase();
    var box = $("libresolved");
    if (!token) { box.innerHTML = '<div class="empty">Paste a mark to resolve it.</div>'; return; }
    box.innerHTML = '<div class="empty">Resolving&hellip;</div>';
    api("library/resolve?token=" + encodeURIComponent(token)).then(function (d) {
      var reads = d.reads || [];
      var first = reads[0] || {};
      var who = first.displayName || first.collegeName || first.firstName || first.username || ("ID " + first.userId);
      var html = '<div class="section" style="margin-top:20px"><div class="section-head"><h2>Watermark resolved</h2><span class="hint">' + esc(d.token) + "</span></div>" +
        '<div class="rrow"><div class="rhead"><span class="rname">' + esc(who) +
        ' <span class="mono" style="opacity:.7">' + esc(String(first.userId || "")) + "</span></span>" +
        (first.rollNo ? '<span class="mono rolls">' + esc(first.rollNo) + "</span>" : "") + "</div>" +
        '<div class="rsum">' + reads.length + " reads · " + clockOrAgo(first.at) + "</div></div>";
      for (var i = 0; i < reads.length; i++) {
        var r = reads[i];
        html += '<div class="feedrow" style="margin-top:2px"><span class="when">' + istTime(r.at) + "</span>" +
          '<span class="what"><span class="badge">' + (r.page === 0 ? "PDF" : "p" + r.page) + "</span>" +
          esc(r.code || r.docId) + (r.unit ? " · Unit " + esc(r.unit) : "") + '<span class="detail">' + esc(r.title || "") + " · " + esc(r.surface) + "</span></span></div>";
      }
      box.innerHTML = html + "</div>";
    }).catch(function (err) {
      box.innerHTML = '<div class="empty">' + esc(err && err.message ? err.message : "Could not resolve that mark.") + "</div>";
    });
  });
  var openLibraryDrawer = function (userId) {
    openDrawerShell(userId);
    refreshLibraryDrawer(userId);
  };
  var refreshLibraryDrawer = function (userId) {
    var key = "user:" + userId;
    if (inflight.libraryUser) return;
    inflight.libraryUser = true;
    // reuse the warm user cache lane for the drawer shell, then reconcile
    // against the library detail (which carries per-document depth).
    api("library/readers/" + userId).then(function (d) {
      if (drawerIssue === key) renderLibraryDrawer(d);
    }).catch(function () {
      if (drawerIssue === key) renderThreadError(function () { refreshLibraryDrawer(userId); });
    }).then(function () { inflight.libraryUser = false; });
  };
  var renderLibraryDrawer = function (d) {
    var r = d.reader;
    var label = libReaderLabel(r);
    var name = label.name;
    var html = '<div class="dhead"><div><h3 id="drawer-title">' + esc(name) + "</h3>" +
      '<div class="meta mono">' + (label.handle ? esc(label.handle) + " · " : "") + "ID " + esc(String(r.userId)) +
      (r.rollNo ? " · " + esc(r.rollNo) : "") + (r.collegeName ? " · " + esc(r.collegeName) : "") + "</div></div>" +
      '<button class="x" id="dclose" aria-label="Close">&times;</button></div>' +
      '<div class="dstats">' +
      '<div class="stat"><div class="n">' + fmt(r.docsRead) + '</div><div class="l">docs</div></div>' +
      '<div class="stat"><div class="n">' + fmt(r.pagesRead) + '</div><div class="l">pages</div></div>' +
      '<div class="stat"><div class="n">' + fmt(r.pdfDownloads) + '</div><div class="l">pdfs</div></div>' +
      "</div>" +
      '<div class="dim" style="font-size:12.5px">first read ' + istDate(parseUtc(r.firstAt)) + " " + istTime(r.firstAt) +
      " · last read " + ago(r.lastAt) + " · " + istTime(r.lastAt) + "</div>" +
      "<h4>Documents</h4>" +
      '<div class="dfeed">';
    for (var i = 0; i < d.docs.length; i++) {
      var doc = d.docs[i];
      html += '<div class="feedrow"><span class="when">' + esc(doc.code || "") + "</span>" +
        '<span class="what">' + esc(doc.title || doc.docId) + (doc.unit ? " · Unit " + esc(doc.unit) : "") +
        '<span class="detail">' + fmt(doc.pagesRead) + " pages · " + fmt(doc.completionPct) + "% done" +
        (doc.pdfDownloads ? " · " + fmt(doc.pdfDownloads) + " PDF" : "") + "</span></span></div>";
    }
    html += '</div><h4>Recent</h4><div class="dfeed">';
    for (var j = 0; j < d.recent.length; j++) {
      var e = d.recent[j];
      html += '<div class="feedrow"><span class="when">' + istDate(parseUtc(e.at)).slice(5) + " " + istTime(e.at) + "</span>" +
        '<span class="what"><span class="badge">' + (e.page === 0 ? "PDF" : "p" + e.page) + "</span>" +
        esc(e.code || e.title || "") + '<span class="detail">' + esc(e.surface) + "</span></span></div>";
    }
    html += "</div>";
    $("drawer").innerHTML = html;
    $("dclose").addEventListener("click", closeDrawer);
    drawerIssue = "user:" + r.userId;
    showDrawer();
  };

  /* ---------- live ---------- */
  var feedRow = function (e) {
    var ts = Date.parse(e.at + "Z");
    var isFresh = !isNaN(ts) && Date.now() - ts < 120000;
    return '<div class="feedrow' + (isFresh ? " fresh" : "") + '">' +
      '<span class="when">' + istTime(e.at) + "</span>" +
      '<span class="what"><span class="badge">' + esc(actionLabel(e.action)) + "</span>" +
      esc(e.name || e.username || "ID " + e.userId) +
      (e.detail ? '<span class="detail">' + esc(e.detail) + "</span>" : "") + "</span>" +
      '<span class="surf"><span class="sdot" style="background:' + surfaceColor(e.chatType) + '"></span>' + esc(surfaceLabel(e.chatType)) + "</span>" +
      "</div>";
  };
  var loadFeed = function () {
    if (inflight.live) return;
    inflight.live = true;
    lastLoad.live = Date.now();
    api("recent?limit=60").then(function (d) {
      $("feed").innerHTML = d.events.length
        ? d.events.map(feedRow).join("")
        : '<div class="empty">Nothing recorded yet. Activity appears as students use the bot.</div>';
    }).catch(function () {}).then(function () { inflight.live = false; });
  };
  setInterval(function () {
    if (current === "live" && document.visibilityState === "visible") loadFeed();
  }, 10000);


  /* ---------- reports ---------- */
  var reportStatus = "open";
  var REPORT_DOT = { open: "var(--text-2)", answered: "var(--warning)", resolved: "var(--good)" };

  var reporterLabel = function (r) {
    return esc(r.name || r.username || ("ID " + r.userId));
  };

  // the list already in memory is patched directly after every action, so a
  // reply/close/reopen costs zero list refetches (each is a heavy query)
  var markRowRead = function (issueId) {
    if (!lastReports) return;
    for (var i = 0; i < lastReports.length; i++) {
      if (lastReports[i].issueId === issueId && lastReports[i].unread) {
        lastReports[i].unread = 0;
        renderReports(lastReports);
        return;
      }
    }
  };

  var newUtcNow = function () {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) +
      " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds());
  };

  var updateRowAfterReply = function (issueId, text) {
    if (!lastReports) return;
    var kept = [];
    for (var i = 0; i < lastReports.length; i++) {
      var r = lastReports[i];
      if (r.issueId === issueId) {
        r.adminReply = text;
        r.status = "answered";
        r.messageCount = (r.messageCount || 1) + 1;
        r.lastAuthor = "admin";
        r.lastMessageAt = newUtcNow();
        r.unread = 0;
        if (reportStatus !== "all" && r.status !== reportStatus) continue;
      }
      kept.push(r);
    }
    lastReports = kept;
    renderReports(lastReports);
    // the warm thread (and the drawer, if it is on this issue) follows —
    // the authoritative copy still arrives via refreshThread
    var c = threadCache[issueId];
    if (c) {
      c.messages.push({ author: "admin", body: text, createdAt: newUtcNow() });
      c.messageCount = c.messages.length;
      c.status = "answered";
      if (drawerIssue === issueId) renderThread(c);
    }
  };

  var updateRowStatus = function (issueId, status) {
    if (!lastReports) return;
    if (threadCache[issueId]) threadCache[issueId].status = status;
    // a row that no longer matches the active filter drops out of the list
    var kept = [];
    for (var i = 0; i < lastReports.length; i++) {
      if (lastReports[i].issueId === issueId) {
        if (reportStatus !== "all" && status !== reportStatus) continue;
        lastReports[i].status = status;
      }
      kept.push(lastReports[i]);
    }
    lastReports = kept;
    renderReports(lastReports);
  };

  // Every issue is a thread now: the row is a summary, the drawer is the
  // conversation. Replying there is the same action as /reply in Telegram.
  // The drawer opens the instant a row is tapped — from the warm cache when
  // the thread was opened before, otherwise a shell with the head we already
  // hold and skeleton message blocks — and the fetch reconciles quietly.
  var openThreadShell = function (issueId) {
    var row = null;
    if (lastReports) {
      for (var i = 0; i < lastReports.length; i++) {
        if (lastReports[i].issueId === issueId) { row = lastReports[i]; break; }
      }
    }
    var sub = row
      ? reporterLabel(row) + ' <span class="mono">' + esc(String(row.userId)) + "</span> · " + esc(row.status)
      : "loading the conversation…";
    var sk = "";
    for (var k = 0; k < 3; k++) sk += '<div class="tmsg sk sk-pulse" style="height:64px"></div>';
    $("drawer").innerHTML =
      '<div class="dhead"><div><h3 id="drawer-title">' + esc(issueId) + "</h3>" +
      '<div class="meta">' + sub + "</div></div>" +
      '<button class="x" id="dclose" aria-label="Close">&times;</button></div>' +
      '<div class="dthread">' + sk + "</div>";
    $("dclose").addEventListener("click", closeDrawer);
    drawerIssue = issueId;
    showDrawer();
  };

  var renderThreadError = function (retry) {
    if ($("dretry")) return;
    var el = document.createElement("div");
    el.className = "empty";
    el.innerHTML = 'That thread did not load. <button class="linkbtn" id="dretry">Retry</button>';
    $("drawer").appendChild(el);
    $("dretry").addEventListener("click", function () {
      var err = $("drawer").querySelector(".empty");
      if (err) err.remove();
      retry();
    });
  };

  var openThread = function (issueId) {
    var cached = threadCache[issueId];
    if (cached) {
      renderThread(cached);
      markRowRead(issueId);
    } else if (drawerIssue !== issueId) {
      openThreadShell(issueId);
      markRowRead(issueId);
    }
    refreshThread(issueId);
  };

  var refreshThread = function (issueId) {
    if (inflight.thread) {
      // A send that lands mid-fetch still needs its screenshots painted; the
      // in-flight response may predate the reply. Refresh once more when it
      // finishes instead of dropping the request.
      inflight.threadAgain = issueId;
      return;
    }
    inflight.thread = true;
    api("reports/" + issueId).then(function (d) {
      var t = d.thread;
      threadCache[issueId] = t;
      if (drawerIssue === issueId) renderThread(t);
      markRowRead(issueId);
    }).catch(function () {
      if (drawerIssue === issueId && !threadCache[issueId])
        renderThreadError(function () { refreshThread(issueId); });
    }).then(function () {
      inflight.thread = false;
      var again = inflight.threadAgain;
      inflight.threadAgain = null;
      if (again) refreshThread(again);
    });
  };

  // Screenshots ride with their message: a small strip of thumbnails,
  // each opening the full image in a new tab. The URL comes from the server
  // and is escaped like every other value.
  var attachmentHtml = function (list) {
    if (!list || !list.length) return "";
    var html = '<div class="tattachments">';
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      html += '<a class="tattachment" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' +
        '<img src="' + esc(a.url) + '" alt="Screenshot ' + (i + 1) + '" loading="lazy" decoding="async">' +
        "</a>";
    }
    return html + "</div>";
  };

  // Screenshots on an admin reply. Files stay in memory until Send; the
  // server sniffs their bytes with the same limits as the student form.
  var MAX_SHOTS = 3;
  var MAX_SHOT_BYTES = 5 * 1024 * 1024;
  var threadShots = [];
  var threadShotsIssue = null;

  var clearThreadShots = function () {
    for (var i = 0; i < threadShots.length; i++) {
      if (threadShots[i].url) URL.revokeObjectURL(threadShots[i].url);
    }
    threadShots = [];
  };

  var setShotHint = function (message, bad) {
    var hint = $("dshothint");
    if (!hint) return;
    hint.textContent = message;
    hint.className = "hint" + (bad ? " error" : "");
  };

  var renderThreadShots = function () {
    var wrap = $("dpreviews");
    if (!wrap) return;
    var html = "";
    for (var i = 0; i < threadShots.length; i++) {
      html += '<span class="rshot"><img src="' + esc(threadShots[i].url) +
        '" alt="Selected screenshot ' + (i + 1) + '">' +
        '<button type="button" data-shotremove="' + i +
        '" aria-label="Remove screenshot ' + (i + 1) + '">&times;</button></span>';
    }
    wrap.innerHTML = html;
    var btns = wrap.querySelectorAll("[data-shotremove]");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function () {
        var at = Number(this.dataset.shotremove);
        if (threadShots[at] && threadShots[at].url)
          URL.revokeObjectURL(threadShots[at].url);
        threadShots.splice(at, 1);
        renderThreadShots();
        setShotHint(threadShots.length
          ? threadShots.length + " of " + MAX_SHOTS + " selected"
          : "Up to 3, 5 MB each", false);
      });
    }
    var addBtn = $("dshotsbtn");
    if (addBtn) {
      addBtn.disabled = threadShots.length >= MAX_SHOTS;
      addBtn.textContent = threadShots.length ? "Add another" : "Attach screenshots";
    }
  };

  var addThreadShots = function (fileList) {
    if (!fileList || !fileList.length) return;
    var error = "";
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      if (threadShots.length >= MAX_SHOTS) {
        error = "Up to 3 screenshots per message.";
        break;
      }
      if (file.type && !/^image\\/(png|jpeg|webp)$/.test(file.type)) {
        error = "Screenshots need to be PNG, JPEG or WebP.";
        continue;
      }
      if (file.size > MAX_SHOT_BYTES) {
        error = "Each screenshot must be under 5 MB.";
        continue;
      }
      threadShots.push({ file: file, url: URL.createObjectURL(file) });
    }
    renderThreadShots();
    if (error) setShotHint(error, true);
    else setShotHint(threadShots.length
      ? threadShots.length + " of " + MAX_SHOTS + " selected"
      : "Up to 3, 5 MB each", false);
  };

  // full thread paint: head, messages, composer, actions. A draft being
  // typed survives background reconciles — the send flow clears the box
  // itself when the message goes out.
  var renderThread = function (t) {
      if (threadShotsIssue !== t.issueId) {
        clearThreadShots();
        threadShotsIssue = t.issueId;
      }
      var prevReply = $("dreply");
      var draft = prevReply ? prevReply.value : null;
      var html = '<div class="dhead"><div><h3 id="drawer-title">' + esc(t.issueId) + "</h3>" +
        '<div class="meta">' + reporterLabel(t) + ' <span class="mono">' + esc(String(t.userId)) + "</span>" +
        " · " + esc(t.status) + " · opened " + istDate(parseUtc(t.createdAt)) + "</div></div>" +
        '<button class="x" id="dclose" aria-label="Close">&times;</button></div>' +
        '<div class="dthread">';
      for (var i = 0; i < t.messages.length; i++) {
        var m = t.messages[i];
        html += '<div class="tmsg ' + (m.author === "admin" ? "admin" : "student") + '">' +
          '<div class="tmeta"><b>' + (m.author === "admin" ? "you · admin" : "student") + "</b>" +
          "<span>" + istDate(parseUtc(m.createdAt)).slice(5) + " " + istTime(m.createdAt) + "</span></div>" +
          (m.body ? '<div class="tbody">' + esc(m.body) + "</div>" : "") +
          attachmentHtml(m.attachments) + "</div>";
      }
      html += "</div>" +
        '<div class="rform show"><div class="rform-main">' +
        '<textarea id="dreply" placeholder="Write to the reporter. It is added to the thread and DM\\'d to them."></textarea>' +
        '<div class="rattach"><button type="button" class="rattach-btn" id="dshotsbtn">Attach screenshots</button>' +
        '<input type="file" id="dshots" class="rattach-input" accept="image/png,image/jpeg,image/webp" multiple tabindex="-1" aria-hidden="true">' +
        '<span class="hint" id="dshothint">Up to 3, 5 MB each</span></div>' +
        '<div class="rshots" id="dpreviews"></div>' +
        '<div class="hint error" id="dshoterr" style="display:none"></div>' +
        "</div>" +
        '<button class="send" id="dsend">Send</button></div>' +
        '<div class="rbtns" id="dactions"></div>';
      $("drawer").innerHTML = html;

      $("dactions").innerHTML = t.status === "resolved"
        ? '<button id="dreopen">Reopen</button>'
        : '<button id="dresolve">Mark resolved</button>';

      $("dclose").addEventListener("click", closeDrawer);

      var shotInput = $("dshots");
      $("dshotsbtn").addEventListener("click", function () {
        shotInput.click();
      });
      shotInput.addEventListener("change", function () {
        addThreadShots(this.files);
        this.value = "";
      });
      renderThreadShots();
      if (threadShots.length)
        setShotHint(threadShots.length + " of " + MAX_SHOTS + " selected", false);

      var ta = $("dreply");
      var sendBtn = $("dsend");
      if (t.status === "resolved")
        ta.placeholder = "This issue is resolved. A message reopens it.";

      var send = function () {
        var text = ta.value.trim();
        if ((!text && !threadShots.length) || sendBtn.disabled) return;
        sendBtn.disabled = true;
        sendBtn.textContent = "Sending...";
        var request;
        if (threadShots.length) {
          var form = new FormData();
          if (text) form.append("reply", text);
          for (var s = 0; s < threadShots.length; s++)
            form.append("screenshots", threadShots[s].file, threadShots[s].file.name);
          request = fetch(BASE + "/api/reports/" + t.issueId + "/reply", {
            method: "POST",
            body: form
          });
        } else {
          request = fetch(BASE + "/api/reports/" + t.issueId + "/reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reply: text })
          });
        }
        request.then(function (r) {
          if (r.ok) return r.json();
          return r.json().catch(function () { return {}; }).then(function (b) {
            throw new Error(b.error || "Could not send. Try again.");
          });
        }).then(function () {
          ta.value = "";
          clearThreadShots();
          updateRowAfterReply(t.issueId, text);
          refreshThread(t.issueId); // drawer stays put, updates when it lands
        }).catch(function (err) {
          sendBtn.disabled = false;
          sendBtn.textContent = "Send";
          var cur = $("dreply");
          if (cur && !cur.value) cur.value = text;
          var errEl = $("dshoterr");
          if (errEl) {
            errEl.textContent = err && err.message ? err.message : "Could not send. Try again.";
            errEl.style.display = "block";
          }
        });
      };
      sendBtn.addEventListener("click", send);
      ta.addEventListener("keydown", function (e) {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
      });
      if (draft) ta.value = draft;

      if (t.status === "resolved") {
        $("dreopen").addEventListener("click", function () {
          fetch(BASE + "/api/reports/" + t.issueId + "/reopen", { method: "POST" })
            .then(function () { updateRowStatus(t.issueId, "open"); closeDrawer(); })
            .catch(function () {});
        });
      } else {
        $("dresolve").addEventListener("click", function () {
          fetch(BASE + "/api/reports/" + t.issueId + "/close", { method: "POST" })
            .then(function () { updateRowStatus(t.issueId, "resolved"); closeDrawer(); })
            .catch(function () {});
        });
      }

      drawerIssue = t.issueId;
      var drawer = $("drawer");
      showDrawer();
      drawer.scrollTop = drawer.scrollHeight;
  };

  var renderReports = function (rows) {
    var el = $("reports");
    if (!rows.length) {
      el.innerHTML = '<div class="empty">No reports here yet. When a student files one it shows up with an issue id.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var stamp = r.unread > 0 ? '<span class="rnew">' + r.unread + " new</span>" : "";
      var threadLine = r.messageCount > 1
        ? '<div class="rsum">' + r.messageCount + " messages · " +
          (r.lastAuthor === "admin" ? "you wrote last" : "student wrote last") +
          (r.lastMessageAt ? " · " + esc(ago(r.lastMessageAt)) : "") + "</div>"
        : '<div class="rsum">1 message · waiting for an answer</div>';
      var replied = r.adminReply
        ? '<div class="rreplyblock"><b>your last reply</b>' + esc(r.adminReply) + "</div>"
        : "";
      var btns = '<div class="rbtns">' +
        '<button data-thread="' + r.issueId + '">Open thread' +
        (r.messageCount > 1 ? " (" + r.messageCount + ")" : "") + "</button>" +
        (r.status === "resolved"
          ? '<button data-reopen="' + r.issueId + '">Reopen</button>'
          : '<button data-close="' + r.issueId + '">Mark resolved</button>') +
        "</div>";
      html +=
        '<div class="rrow ' + r.status + (r.unread > 0 ? " hasnew" : "") + '">' +
        '<div class="rhead"><span class="rid">' + esc(r.issueId) + '</span>' + stamp +
        '<span class="rstatus ' + r.status + '"><span class="dot" style="background:' + (REPORT_DOT[r.status] || "") + '"></span>' + esc(r.status) + '</span>' +
        '<span class="rname">' + reporterLabel(r) + '  <span class="mono" style="opacity:.7">' + esc(String(r.userId)) + "</span></span>" +
        '<span class="rtime">' + esc(clockOrAgo(r.createdAt)) + "</span></div>" +
        '<div class="rmsg">' + esc(r.message) + "</div>" + threadLine + replied + btns + "</div>";
    }
    el.innerHTML = html;

    var threadBtns = el.querySelectorAll("[data-thread]");
    for (var tb = 0; tb < threadBtns.length; tb++) {
      threadBtns[tb].addEventListener("click", function () {
        openThread(this.dataset.thread);
      });
    }
    var closeBtns = el.querySelectorAll("[data-close]");
    for (var cb2 = 0; cb2 < closeBtns.length; cb2++) {
      closeBtns[cb2].addEventListener("click", function () {
        var id = this.dataset.close;
        fetch(BASE + "/api/reports/" + id + "/close", { method: "POST" })
          .then(function () { updateRowStatus(id, "resolved"); })
          .catch(function () {});
      });
    }
    var reopenBtns = el.querySelectorAll("[data-reopen]");
    for (var ob = 0; ob < reopenBtns.length; ob++) {
      reopenBtns[ob].addEventListener("click", function () {
        var id = this.dataset.reopen;
        fetch(BASE + "/api/reports/" + id + "/reopen", { method: "POST" })
          .then(function () { updateRowStatus(id, "open"); })
          .catch(function () {});
      });
    }
  };

  var lastReports = null;
  var reportFilterBtns = document.querySelectorAll("#reportfilter button");
  for (var rf = 0; rf < reportFilterBtns.length; rf++) {
    reportFilterBtns[rf].addEventListener("click", function () {
      if (this.dataset.status === reportStatus || inflight.reports) return;
      reportStatus = this.dataset.status;
      for (var k = 0; k < reportFilterBtns.length; k++)
        reportFilterBtns[k].setAttribute("aria-pressed", String(reportFilterBtns[k] === this));
      loadReports();
    });
  }

  var loadReports = function () {
    if (inflight.reports) return;
    inflight.reports = true;
    lastLoad.reports = Date.now();
    api("reports?status=" + encodeURIComponent(reportStatus) + "&limit=100").then(function (d) {
      lastReports = d.reports || [];
      renderReports(lastReports);
    }).catch(function () {}).then(function () { inflight.reports = false; });
  };

  var reportsRefresh = $("reportsrefresh");
  if (reportsRefresh) reportsRefresh.addEventListener("click", loadReports);
  setInterval(function () {
    if (current === "reports" && document.visibilityState === "visible" && isStale("reports")) loadReports();
  }, 30000);

  /* ---------- question papers ---------- */
  var lastPapers = [];
  var paperFilter = "";

  var paperMatches = function (p) {
    if (!paperFilter) return true;
    var haystack = [p.subject, p.exam, p.note, p.name, p.username, String(p.userId)]
      .join(" ")
      .toLowerCase();
    return haystack.indexOf(paperFilter.toLowerCase()) !== -1;
  };

  var renderPapers = function () {
    var rows = lastPapers.filter(paperMatches);
    var el = $("paperrows");
    var empty = $("paperempty");
    if (!rows.length) {
      el.innerHTML = "";
      empty.style.display = "block";
      empty.textContent = lastPapers.length
        ? "No papers match."
        : "No papers uploaded yet.";
      return;
    }
    empty.style.display = "none";
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i];
      var coverUrl = p.images && p.images.length ? p.images[0] : null;
      var cover = coverUrl
        ? '<button type="button" class="paperthumb" data-paperview="' + p.id + '" aria-label="View the pages of ' + esc(p.subject) + '">' +
          '<img src="' + esc(coverUrl) + '" alt="" loading="lazy" width="40" height="52"></button>'
        : '<span class="paperthumb paperthumb--empty" aria-hidden="true"></span>';
      var pages = p.pageCount + (p.pageCount === 1 ? " page" : " pages");
      html +=
        '<tr><td><div class="papercell">' + cover +
        '<div class="paperbody"><span class="papertitle">' + esc(p.subject) + "</span>" +
        '<span class="papersub">' + esc(p.exam) + " · " + pages + "</span>" +
        (p.note ? '<span class="papernote">' + esc(p.note) + "</span>" : "") +
        "</div></div></td>" +
        '<td><div class="who"><span class="name">' + reporterLabel(p) + "</span>" +
        '<span class="handle">' + esc(String(p.userId)) +
        (p.username ? " · @" + esc(p.username) : "") + "</span></div></td>" +
        '<td class="num">' + p.pageCount + "</td>" +
        "<td>" + esc(clockOrAgo(p.createdAt)) + "</td>" +
        '<td><div class="rowactions">' +
        '<button class="btn-ghost" data-paperview="' + p.id + '">View pages</button>' +
        '<button class="btn-ghost danger" data-paperdel="' + p.id + '">Remove</button>' +
        "</div></td></tr>";
    }
    el.innerHTML = html;

    var viewBtns = el.querySelectorAll("[data-paperview]");
    for (var vb = 0; vb < viewBtns.length; vb++) {
      viewBtns[vb].addEventListener("click", function () {
        var id = String(this.dataset.paperview);
        for (var k = 0; k < lastPapers.length; k++) {
          if (String(lastPapers[k].id) === id) {
            openPaperViewer(lastPapers[k]);
            return;
          }
        }
      });
    }

    var btns = el.querySelectorAll("[data-paperdel]");
    for (var b = 0; b < btns.length; b++) {
      btns[b].addEventListener("click", function () {
        var btn = this;
        var id = this.dataset.paperdel;
        if (!window.confirm("Remove this paper from the collection? This cannot be undone.")) return;
        btn.disabled = true;
        fetch(BASE + "/api/papers/" + id, { method: "DELETE" })
          .then(function (r) {
            if (!r.ok) throw new Error("delete failed");
            lastPapers = lastPapers.filter(function (p) {
              return String(p.id) !== String(id);
            });
            renderPapers();
          })
          .catch(function () {
            btn.disabled = false;
          });
      });
    }
  };

  var openPaperViewer = function (paper) {
    var pages = paper.images || [];
    var html = '<div class="dhead"><div><h3 id="drawer-title">' +
      esc(paper.subject) + " · " + esc(paper.exam) + "</h3>" +
      '<div class="meta">' + reporterLabel(paper) + " · " +
      paper.pageCount + (paper.pageCount === 1 ? " page" : " pages") +
      " · " + esc(clockOrAgo(paper.createdAt)) + "</div></div>" +
      '<button class="x" id="dclose" aria-label="Close">&times;</button></div>';
    if (paper.note) html += '<p class="paperviewnote">' + esc(paper.note) + "</p>";
    html += '<div class="paperviewer">';
    for (var i = 0; i < pages.length; i++) {
      html += '<a class="paperview" href="' + esc(pages[i]) +
        '" target="_blank" rel="noopener noreferrer">' +
        '<img src="' + esc(pages[i]) + '" alt="Page ' + (i + 1) + ' of ' +
        pages.length + '" loading="lazy" decoding="async"></a>';
    }
    html += "</div>";
    $("drawer").innerHTML = html;
    $("dclose").addEventListener("click", closeDrawer);
    drawerIssue = null;
    showDrawer();
    $("drawer").scrollTop = 0;
  };

  var loadPapers = function () {
    if (inflight.papers) return;
    inflight.papers = true;
    lastLoad.papers = Date.now();
    api("papers?limit=500").then(function (d) {
      lastPapers = d.papers || [];
      renderPapers();
    }).catch(function () {}).then(function () { inflight.papers = false; });
  };

  var papersRefresh = $("papersrefresh");
  if (papersRefresh) papersRefresh.addEventListener("click", loadPapers);
  var papersSearch = $("papersearch");
  if (papersSearch) papersSearch.addEventListener("input", function () {
    paperFilter = this.value.trim();
    renderPapers();
  });
  setInterval(function () {
    if (current === "papers" && document.visibilityState === "visible" && isStale("papers")) loadPapers();
  }, 30000);

  /* ---------- health ---------- */
  // "lookup" is the synthetic answer check; the operator reads it as Answers.
  var HEALTH_LABELS = { lookup: "Answers" };
  var loadHealth = function () {
    lastLoad.health = Date.now();
    api("health").then(function (d) {
      var html = "";
      for (var i = 0; i < d.components.length; i++) {
        var c = d.components[i];
        var bars = "";
        var byDay = {};
        for (var b = 0; b < c.buckets.length; b++) byDay[c.buckets[b].day] = c.buckets[b];
        var nowD = new Date();
        for (var day = 89; day >= 0; day--) {
          var dt = new Date(nowD.getTime() - day * 86400000);
          var key = istDate(dt.getTime());
          var bucket = byDay[key];
          var cls = "miss", h = 30;
          if (bucket) {
            cls = bucket.ups === bucket.pings ? "" : "down";
            h = 8 + Math.min(22, (bucket.pings / 300) * 22);
          }
          bars += '<i class="' + cls + '" style="height:' + (bucket ? h : 4) + 'px"><title>' + key + (bucket ? ": " + bucket.ups + "/" + bucket.pings + " up" : ": no data") + "</title></i>";
        }
        // "Operational" / "Down" / "No data" mirrors the public status page:
        // a stale heartbeat means the monitor stopped reporting, not that the
        // component recovered, so stale wins over the last recorded status.
        var stateWord = c.stale ? "No data" : c.current === "up" ? "Operational" : "Down";
        var stateColor = c.current === "up" ? "var(--good)" : c.stale ? "var(--warning)" : "var(--danger)";
        var ageSec =
          typeof c.lastPingAgeSec === "number" && isFinite(c.lastPingAgeSec)
            ? Math.max(0, c.lastPingAgeSec)
            : null;
        var probeAge =
          ageSec == null ? "no probe yet" :
          ageSec < 90 ? "probed just now" :
          ageSec < 3600 ? "probed " + Math.floor(ageSec / 60) + "m ago" :
          ageSec < 86400 ? "probed " + Math.floor(ageSec / 3600) + "h ago" :
          "probed " + Math.floor(ageSec / 86400) + "d ago";
        html += '<div class="hrow"><div class="hname">' + esc(HEALTH_LABELS[c.component] || c.component) + "</div>" +
          '<div class="ubars">' + bars + "</div>" +
          '<div class="hstat"><div class="pct" style="color:' + stateColor + '">' + stateWord + "</div>" +
          '<div class="lat">' + esc(probeAge) + "</div>" +
          '<div class="lat" style="font-variant-numeric:tabular-nums">' + c.uptimePct.toFixed(2) + "% up" +
          (c.avgLatencyMs != null ? " · " + c.avgLatencyMs + "ms avg" : "") + "</div></div></div>";
      }
      $("healthrows").innerHTML = html || '<div class="empty">No probes recorded yet.</div>';
    }).catch(function () {});
  };

  /* ---------- drawer ---------- */
  var showDrawer = function () {
    var drawer = $("drawer");
    if (!drawer.open) drawer.showModal();
  };
  var closeDrawer = function () {
    var drawer = $("drawer");
    if (drawer.open) drawer.close();
  };
  // Native modal dialogs give the drawer focus containment, an inert page,
  // the top layer and Esc/back dismissal. Only the screenshot buffers need
  // clearing on close; the dialog's own close event covers every path.
  $("drawer").addEventListener("close", function () {
    drawerIssue = null;
    clearThreadShots();
    threadShotsIssue = null;
  });
  // Safari lacks closedby="any"; keep click-outside working there without a
  // manual scrim. The pointer check avoids closing on a drag that ends outside.
  if (
    typeof HTMLDialogElement !== "undefined" &&
    !("closedBy" in HTMLDialogElement.prototype)
  ) {
    var pressedOutside = false;
    var outsideDrawer = function (e, dialog) {
      var r = dialog.getBoundingClientRect();
      return (
        e.clientX < r.left || e.clientX > r.right ||
        e.clientY < r.top || e.clientY > r.bottom
      );
    };
    var drawerEl = $("drawer");
    drawerEl.addEventListener("pointerdown", function (e) {
      pressedOutside = outsideDrawer(e, drawerEl);
    });
    drawerEl.addEventListener("pointerup", function (e) {
      if (pressedOutside && outsideDrawer(e, drawerEl)) drawerEl.close();
      pressedOutside = false;
    });
  }

  // same instant-open contract as threads: shell, warm cache, reconcile
  var openDrawerShell = function (userId) {
    var sk = "";
    for (var k = 0; k < 4; k++) sk += '<div class="sk sk-pulse" style="height:14px;margin:10px 0"></div>';
    $("drawer").innerHTML =
      '<div class="dhead"><div><h3 id="drawer-title">ID ' + esc(String(userId)) + "</h3>" +
      '<div class="meta">loading the student…</div></div>' +
      '<button class="x" id="dclose" aria-label="Close">&times;</button></div>' +
      '<div class="dfeed">' + sk + "</div>";
    $("dclose").addEventListener("click", closeDrawer);
    drawerIssue = "user:" + userId;
    showDrawer();
  };

  var openDrawer = function (userId) {
    var key = "user:" + userId;
    var cached = userCache[key];
    if (cached) {
      renderUserDrawer(cached);
    } else if (drawerIssue !== key) {
      openDrawerShell(userId);
    }
    refreshUserDrawer(userId);
  };

  var refreshUserDrawer = function (userId) {
    var key = "user:" + userId;
    if (inflight.user) return;
    inflight.user = true;
    api("users/" + userId).then(function (d) {
      userCache[key] = d;
      if (drawerIssue === key) renderUserDrawer(d);
    }).catch(function () {
      if (drawerIssue === key && !userCache[key])
        renderThreadError(function () { refreshUserDrawer(userId); });
    }).then(function () { inflight.user = false; });
  };

  var renderUserDrawer = function (d) {
      var p = d.profile;
      var name = p.firstName || p.username || "ID " + p.userId;
      var html = '<div class="dhead"><div><h3 id="drawer-title">' + esc(name) + "</h3>" +
        '<div class="meta mono">' + (p.username ? "@" + esc(p.username) + " · " : "") + "ID " + p.userId +
        (p.rollNo ? " · " + esc(p.rollNo) : "") + "</div></div>" +
        '<button class="x" id="dclose" aria-label="Close">&times;</button></div>' +
        '<div class="dstats">' +
        '<div class="stat"><div class="n">' + fmt(p.totalActions) + '</div><div class="l">actions</div></div>' +
        '<div class="stat"><div class="n">' + fmt(p.privateActions) + '</div><div class="l">private</div></div>' +
        '<div class="stat"><div class="n">' + fmt(p.channelActions) + '</div><div class="l">channel</div></div>' +
        "</div>" +
        '<h4>Last 30 days</h4><div class="dmini" id="dmini"></div>' +
        '<div class="dim" style="font-size:12.5px">first seen ' + istDate(parseUtc(p.firstSeen)) + " " + istTime(parseUtc(p.firstSeen)) + " · last seen " + ago(p.lastSeen) + "</div>" +
        '<h4>Recent activity</h4><div class="dfeed">';
      for (var i = 0; i < d.recent.length; i++) {
        var e2 = d.recent[i];
        html += '<div class="feedrow"><span class="when">' + istDate(parseUtc(e2.at)).slice(5) + " " + istTime(e2.at) + "</span>" +
          '<span class="what"><span class="badge">' + esc(actionLabel(e2.action)) + "</span>" +
          '<span class="sdot" style="background:' + surfaceColor(e2.chatType) + '"></span> ' +
          (e2.detail ? '<span class="detail">' + esc(e2.detail) + "</span>" : "") + "</span></div>";
      }
      html += "</div>";
      $("drawer").innerHTML = html;
      $("dclose").addEventListener("click", closeDrawer);

      var mini = $("dmini");
      var byDay2 = {};
      var maxN = 1;
      for (var m = 0; m < d.daily.length; m++) { byDay2[d.daily[m].day] = d.daily[m].count; maxN = Math.max(maxN, d.daily[m].count); }
      var now2 = new Date(), miniHtml = "";
      for (var dd = 29; dd >= 0; dd--) {
        var dt2 = new Date(now2.getTime() - dd * 86400000);
        var key2 = istDate(dt2.getTime());
        var n2 = byDay2[key2] || 0;
        miniHtml += '<i style="height:' + Math.max(2, (n2 / maxN) * 34) + 'px" title="' + key2 + ": " + n2 + '"></i>';
      }
      mini.innerHTML = miniHtml;

      drawerIssue = "user:" + p.userId;
      showDrawer();
  };

  /* ---------- boot ---------- */
  // the probe doubles as the first overview render — going through
  // switchView here would fire the same query a second time
  api("overview").then(function (d) {
    showApp();
    activateTab("overview");
    lastLoad.overview = Date.now();
    renderOverview(d);
  }).catch(function () { /* login screen already shown */ });
})();`;
