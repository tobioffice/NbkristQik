// Extracted from the admin panel HTML — composed in ../adminPanel.ts.
export const panelJs = `(function () {
  "use strict";
  var BASE = location.pathname.replace(/\\/+$/, "");
  var $ = function (id) { return document.getElementById(id); };

  var ACTION_LABELS = {
    "roll_lookup": "Roll lookup", "attendance": "Attendance", "midmarks": "Mid marks",
    "bunk": "Bunk plan", "daily_checkin": "Daily check-in", "leaderboard_webapp": "Opened leaderboard",
    "command:start": "/start", "command:help": "/help", "command:leaderboard": "/leaderboard",
    "report": "Report to admin"
  };
  var SURFACES = [
    { key: "private", label: "Private chat", color: "#22d3ee" },
    { key: "channel", label: "Channel", color: "#a78bfa" },
    { key: "group", label: "Group", color: "#64748b" },
    { key: "unknown", label: "Web app", color: "#34d399" }
  ];
  var surfaceColor = function (k) {
    for (var i = 0; i < SURFACES.length; i++) if (SURFACES[i].key === k) return SURFACES[i].color;
    return "#64748b";
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
  var STALE_MS = { overview: 60000, students: 30000, reports: 15000, live: 0, health: 300000 };
  var isStale = function (name) {
    return !lastLoad[name] || Date.now() - lastLoad[name] > STALE_MS[name];
  };
  var switchView = function (name) {
    current = name;
    var tabs = document.querySelectorAll(".nav button");
    for (var i = 0; i < tabs.length; i++)
      tabs[i].setAttribute("aria-selected", String(tabs[i].dataset.view === name));
    var views = document.querySelectorAll(".view");
    for (var j = 0; j < views.length; j++)
      views[j].classList.toggle("active", views[j].id === "view-" + name);
    if (name === "overview" && isStale("overview")) loadOverview();
    if (name === "students" && isStale("students")) loadUsers();
    if (name === "live") loadFeed();
    if (name === "reports" && isStale("reports")) loadReports();
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
          checkins: rec ? rec.checkins || 0 : 0,
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
          checkins: rec2 ? rec2.checkins || 0 : 0,
        });
      }
    }
    return out;
  };

  var drawPulse = function (points) {
    var svg = $("pulse");
    if (!points.length) return;
    var W = 640, H = 120, pad = 4;
    var max = 1, hasCheckins = false;
    for (var k = 0; k < points.length; k++) {
      max = Math.max(max, points[k].actions);
      if (points[k].checkins > 0) hasCheckins = true;
    }
    var step = (W - pad * 2) / (points.length - 1);
    var y = function (v) { return H - pad - (v / max) * (H - pad * 2 - 8); };
    var pts = [];
    for (var p = 0; p < points.length; p++) pts.push([pad + p * step, y(points[p].actions)]);
    var line = "";
    for (var q = 0; q < pts.length; q++) line += (q ? " L" : "M") + pts[q][0].toFixed(1) + " " + pts[q][1].toFixed(1);
    var area = line + " L" + (W - pad) + " " + H + " L" + pad + " " + H + " Z";
    var svgHtml =
      '<defs><linearGradient id="pulsefill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#22d3ee" stop-opacity="0.28"/>' +
      '<stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#pulsefill)"/>' +
      '<path d="' + line + '" fill="none" stroke="#22d3ee" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<line x1="' + pts[pts.length - 1][0] + '" y1="' + pts[pts.length - 1][1] + '" x2="' + pts[pts.length - 1][0] + '" y2="' + H + '" stroke="#22d3ee" stroke-opacity="0.35" stroke-dasharray="2 3"/>';
    if (hasCheckins) {
      var cline = "";
      for (var c = 0; c < points.length; c++) {
        cline += (c ? " L" : "M") + (pad + c * step).toFixed(1) + " " + y(points[c].checkins).toFixed(1);
      }
      svgHtml += '<path d="' + cline + '" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    for (var r = 0; r < points.length; r += 1) {
      var cx = pad + r * step, cy = y(points[r].actions);
      svgHtml += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="7" fill="transparent"><title>' + points[r].label + ": " + points[r].actions + " actions, " + points[r].users + " students, " + points[r].checkins + " check-ins</title></circle>";
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
        tip.style.cssText = "position:fixed;pointer-events:none;font-size:12px;background:#1b1d24;border:1px solid rgba(148,163,184,.2);padding:5px 9px;border-radius:7px;z-index:30;font-family:" + "var(--mono)" + ";white-space:nowrap";
        document.body.appendChild(tip);
      }
      tip.textContent = lab + (pulseRange === "24h" ? " IST" : "") + " · " + pt.actions + " actions · " + pt.users + " students · " + pt.checkins + " check-ins";
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
        pulseBtns[k].setAttribute("aria-selected", String(pulseBtns[k] === this));
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
      barHtml += '<div style="width:0;background:' + SURFACES[s].color + ';opacity:.8"></div>';
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

  var loadOverview = function () {
    lastLoad.overview = Date.now();
    api("overview").then(function (d) {
      overviewData = d;
      countUp($("ov-active-today"), d.totals.activeToday);
      $("ov-sub").textContent = fmt(d.totals.totalActions) + " actions recorded all time";
      countUp($("ov-users"), d.totals.users);
      countUp($("ov-active7"), d.totals.active7d);
      countUp($("ov-active30"), d.totals.active30d);
      countUp($("ov-actions"), d.totals.totalActions);
      // check-ins today, counted over the IST day from the hourly buckets.
      //backend keys are IST "YYYY-MM-DD HH", so compare the date part
      //directly — parsing an hour-precision key as a date yields NaN.
      var todayIst = istDate(Date.now());
      var todayCheckins = 0;
      var hourlyRows = d.hourly || [];
      for (var hi = 0; hi < hourlyRows.length; hi++) {
        if (String(hourlyRows[hi].h || "").slice(0, 10) === todayIst)
          todayCheckins += hourlyRows[hi].checkins || 0;
      }
      countUp($("ov-checkins"), todayCheckins);
      drawPulse(buildPulsePoints());
      drawSurfaces(d.surfaces || {});
      drawWeights(d.topActions || []);
    }).catch(function () {});
  };

  /* ---------- students ---------- */
  var userQuery = "", userSort = "recent";
  var loadUsers = function () {
    lastLoad.students = Date.now();
    api("users?q=" + encodeURIComponent(userQuery) + "&sort=" + userSort).then(function (d) {
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
    }).catch(function () {});
  };
  var searchTimer = null;
  $("usersearch").addEventListener("input", function () {
    clearTimeout(searchTimer);
    var v = this.value;
    searchTimer = setTimeout(function () { userQuery = v.trim(); loadUsers(); }, 250);
  });
  var sortBtns = document.querySelectorAll(".seg button");
  for (var sb = 0; sb < sortBtns.length; sb++)
    sortBtns[sb].addEventListener("click", function () {
      userSort = this.dataset.sort;
      for (var k = 0; k < sortBtns.length; k++)
        sortBtns[k].setAttribute("aria-selected", String(sortBtns[k] === this));
      loadUsers();
    });

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
    lastLoad.live = Date.now();
    api("recent?limit=60").then(function (d) {
      $("feed").innerHTML = d.events.length
        ? d.events.map(feedRow).join("")
        : '<div class="empty">Nothing recorded yet. Activity appears as students use the bot.</div>';
    }).catch(function () {});
  };
  setInterval(function () {
    if (current === "live" && document.visibilityState === "visible") loadFeed();
  }, 10000);


  /* ---------- reports ---------- */
  var reportStatus = "open";
  var repOpenId = null;
  var REPORT_DOT = { open: "var(--text-3)", answered: "var(--amber)", resolved: "var(--green)" };

  var renderReports = function (rows) {
    var el = $("reports");
    if (!rows.length) {
      el.innerHTML = '<div class="empty">No reports here yet. When a student files one it shows up with an issue id.</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var who = esc(r.name || r.username || ("ID " + r.userId));
      var replied = r.adminReply
        ? '<div class="rreplyblock"><b>your reply</b>' + esc(r.adminReply) + "</div>"
        : "";
      var open = repOpenId === r.issueId
        ? '<div class="rform show" id="rf-' + r.issueId + '"><textarea placeholder="Type your reply. It is recorded on the issue and DM'd to the reporter."></textarea><button class="send" data-send="' + r.issueId + '">Send</button></div>'
        : "";
      var btns = r.status === "resolved"
        ? ""
        : '<div class="rbtns"><button data-reply="' + r.issueId + '">' + (r.status === "answered" ? "Edit reply" : "Reply") + '</button><button data-close="' + r.issueId + '">Mark resolved</button></div>';
      html +=
        '<div class="rrow ' + r.status + '">' +
        '<div class="rhead"><span class="rid">' + esc(r.issueId) + '</span>' +
        '<span class="rstatus ' + r.status + '"><span class="dot" style="background:' + (REPORT_DOT[r.status] || "") + '"></span>' + esc(r.status) + '</span>' +
        '<span class="rname">' + who + '  <span class="mono" style="opacity:.7">' + esc(String(r.userId)) + "</span></span>" +
        '<span class="rtime">' + esc(clockOrAgo(r.createdAt)) + "</span></div>" +
        '<div class="rmsg">' + esc(r.message) + "</div>" + replied + open + btns + "</div>";
    }
    el.innerHTML = html;

    var replyBtns = el.querySelectorAll("[data-reply]");
    for (var rb = 0; rb < replyBtns.length; rb++) {
      replyBtns[rb].addEventListener("click", function () {
        repOpenId = this.dataset.reply;
        renderReports(lastReports || []);
      });
    }
    var sendBtns = el.querySelectorAll("[data-send]");
    for (var sb2 = 0; sb2 < sendBtns.length; sb2++) {
      sendBtns[sb2].addEventListener("click", function () {
        var wrap = this.closest(".rform");
        var ta = wrap ? wrap.querySelector("textarea") : null;
        var text = ta ? ta.value.trim() : "";
        if (!text) return;
        this.textContent = "Sending...";
        this.disabled = true;
        fetch(BASE + "/api/reports/" + this.dataset.send + "/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reply: text })
        }).then(function (r) { return r.json(); }).then(function () {
          repOpenId = null;
          loadReports();
        }).catch(function () { loadReports(); });
      });
    }
    var closeBtns = el.querySelectorAll("[data-close]");
    for (var cb2 = 0; cb2 < closeBtns.length; cb2++) {
      closeBtns[cb2].addEventListener("click", function () {
        fetch(BASE + "/api/reports/" + this.dataset.close + "/close", { method: "POST" })
          .then(function () { loadReports(); })
          .catch(function () {});
      });
    }
  };

  var lastReports = null;
  var reportFilterBtns = document.querySelectorAll("#reportfilter button");
  for (var rf = 0; rf < reportFilterBtns.length; rf++) {
    reportFilterBtns[rf].addEventListener("click", function () {
      reportStatus = this.dataset.status;
      for (var k = 0; k < reportFilterBtns.length; k++)
        reportFilterBtns[k].setAttribute("aria-selected", String(reportFilterBtns[k] === this));
      loadReports();
    });
  }

  var loadReports = function () {
    lastLoad.reports = Date.now();
    api("reports?status=" + encodeURIComponent(reportStatus) + "&limit=100").then(function (d) {
      lastReports = d.reports || [];
      renderReports(lastReports);
    }).catch(function () {});
  };

  var reportsRefresh = $("reportsrefresh");
  if (reportsRefresh) reportsRefresh.addEventListener("click", loadReports);
  setInterval(function () {
    if (current === "reports" && document.visibilityState === "visible" && isStale("reports")) loadReports();
  }, 20000);

  /* ---------- health ---------- */
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
        html += '<div class="hrow"><div class="hname">' + esc(c.component) + "</div>" +
          '<div class="ubars">' + bars + "</div>" +
          '<div class="hstat"><div class="pct">' + c.uptimePct.toFixed(2) + '% up</div>' +
          '<div class="lat">' + (c.avgLatencyMs != null ? c.avgLatencyMs + "ms avg" : "no latency") + "</div></div></div>";
      }
      $("healthrows").innerHTML = html || '<div class="empty">No probes recorded yet.</div>';
    }).catch(function () {});
  };

  /* ---------- drawer ---------- */
  var closeDrawer = function () {
    $("drawer").classList.remove("open");
    $("scrim").classList.remove("open");
    $("drawer").setAttribute("aria-hidden", "true");
  };
  $("scrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDrawer();
  });

  var openDrawer = function (userId) {
    api("users/" + userId).then(function (d) {
      var p = d.profile;
      var name = p.firstName || p.username || "ID " + p.userId;
      var html = '<div class="dhead"><div><h3>' + esc(name) + "</h3>" +
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

      $("drawer").classList.add("open");
      $("scrim").classList.add("open");
      $("drawer").setAttribute("aria-hidden", "false");
    }).catch(function () {});
  };

  /* ---------- boot ---------- */
  api("overview").then(function () {
    showApp();
    switchView("overview");
  }).catch(function () { /* login screen already shown */ });
})();`;
