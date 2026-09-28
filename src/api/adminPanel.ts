/**
 * Self-contained admin panel: one HTML document (inline CSS + vanilla JS,
 * no external assets except the Outfit webfont with system fallback).
 * Served by the API at the secret ADMIN_PANEL_PATH; all data endpoints
 * require the session cookie.
 *
 * The client-side JS deliberately avoids template literals so this module
 * can stay a single readable template literal.
 */
export const adminPanelHtml = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Qik Control</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg: #0f1014;
  --raised: #16171d;
  --raised-2: #1b1d24;
  --line: rgba(148, 163, 184, 0.13);
  --line-soft: rgba(148, 163, 184, 0.07);
  --text: #e2e8f0;
  --text-2: #94a3b8;
  --text-3: #64748b;
  --text-4: #4b5563;
  --cyan: #22d3ee;
  --violet: #a78bfa;
  --amber: #fbbf24;
  --red: #f87171;
  --green: #34d399;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { color-scheme: dark; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: "Outfit", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.5;
  min-height: 100vh;
}
::selection { background: rgba(34, 211, 238, 0.25); }
a { color: inherit; }
button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; border-radius: 4px; }

.mono { font-family: var(--mono); font-size: 0.86em; letter-spacing: -0.01em; }

/* ---------- top bar ---------- */
.topbar {
  display: flex; align-items: center; gap: 24px;
  padding: 0 28px; height: 58px;
  border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 10;
  background: rgba(15, 16, 20, 0.86); backdrop-filter: blur(12px);
}
.wordmark { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; white-space: nowrap; }
.wordmark span { color: var(--text-3); font-weight: 300; }
.nav { display: flex; gap: 2px; flex: 1; overflow-x: auto; scrollbar-width: none; }
.nav::-webkit-scrollbar { display: none; }
.nav button {
  padding: 7px 14px; border-radius: 8px;
  color: var(--text-2); font-weight: 500; font-size: 14px;
  transition: color .15s, background .15s;
  white-space: nowrap;
}
.nav button:hover { color: var(--text); }
.nav button[aria-selected="true"] { color: var(--text); background: var(--raised-2); }
.signout {
  color: var(--text-3); font-size: 13px; padding: 7px 12px; border-radius: 8px;
  border: 1px solid transparent; transition: color .15s, border-color .15s;
  white-space: nowrap;
}
.signout:hover { color: var(--text-2); border-color: var(--line); }

main { max-width: 1060px; margin: 0 auto; padding: 36px 28px 80px; }
.view { display: none; }
.view.active { display: block; }

/* ---------- overview: hero ---------- */
.hero { display: flex; gap: 40px; align-items: flex-end; flex-wrap: wrap; }
.hero .now { min-width: 200px; }
.now .big {
  font-family: var(--mono); font-weight: 500;
  font-size: clamp(56px, 9vw, 84px); line-height: 1;
  letter-spacing: -0.04em; color: var(--text);
}
.now .label { color: var(--text-2); margin-top: 8px; font-size: 15px; }
.now .sub { color: var(--text-3); font-size: 13.5px; margin-top: 4px; }
.pulse { flex: 1; min-width: 320px; }
.pulse-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.pulse-head .legend { color: var(--text-3); font-size: 12.5px; }
.pulse-head .legend b { color: var(--cyan); font-weight: 500; }

.statline {
  display: flex; gap: 0; margin-top: 34px; flex-wrap: wrap;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.stat { padding: 18px 32px 18px 0; margin-right: 32px; border-right: 1px solid var(--line-soft); }
.stat:last-child { border-right: none; margin-right: 0; }
.stat .n { font-family: var(--mono); font-size: 26px; font-weight: 500; letter-spacing: -0.02em; }
.stat .l { color: var(--text-3); font-size: 13px; margin-top: 2px; }

/* ---------- sections ---------- */
.section { margin-top: 44px; }
.section-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 16px; margin-bottom: 16px;
}
.section-head h2 { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.section-head .hint { color: var(--text-3); font-size: 13px; }

/* surface split */
.surfaceline { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: var(--raised); }
.surfaceline div { height: 100%; transition: width .4s ease; }
.legend-row { display: flex; gap: 24px; margin-top: 12px; flex-wrap: wrap; }
.legend-row .item { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--text-2); }
.legend-row .dot { width: 9px; height: 9px; border-radius: 3px; }
.legend-row .n { font-family: var(--mono); color: var(--text); }

/* action weights */
.weights { display: flex; flex-direction: column; gap: 9px; }
.weight { display: grid; grid-template-columns: 150px 1fr 60px; gap: 14px; align-items: center; }
.weight .w-label { color: var(--text-2); font-size: 13.5px; text-align: right; }
.weight .w-bar { height: 7px; border-radius: 4px; background: var(--raised); overflow: hidden; }
.weight .w-bar div { height: 100%; border-radius: 4px; background: var(--cyan); opacity: .75; }
.weight .w-n { font-family: var(--mono); font-size: 13px; color: var(--text-2); text-align: left; }

/* ---------- table ---------- */
.tablewrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; min-width: 760px; }
th {
  text-align: left; font-size: 12px; font-weight: 500; color: var(--text-3);
  padding: 11px 16px; border-bottom: 1px solid var(--line);
  position: sticky; top: 0; background: var(--raised); white-space: nowrap;
}
th.num, td.num { text-align: right; }
td {
  padding: 11px 16px; border-bottom: 1px solid var(--line-soft);
  font-size: 14px; white-space: nowrap;
}
tbody tr { cursor: pointer; transition: background .12s; }
tbody tr:hover { background: rgba(34, 211, 238, 0.045); }
tbody tr:last-child td { border-bottom: none; }
.who .name { font-weight: 500; }
.who .handle { color: var(--text-3); font-size: 12.5px; }
td .surfn { display: inline-block; min-width: 30px; text-align: right; }
.rolls { color: var(--text-2); }
.dim { color: var(--text-3); }

.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
.search {
  flex: 1; min-width: 220px; max-width: 380px;
  background: var(--raised); border: 1px solid var(--line); border-radius: 9px;
  padding: 9px 14px; color: var(--text); font: inherit; font-size: 14px;
}
.search::placeholder { color: var(--text-4); }
.search:focus { outline: none; border-color: rgba(34, 211, 238, 0.45); }
.seg { display: flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; }
.seg button { padding: 8px 14px; font-size: 13px; color: var(--text-3); }
.seg button[aria-selected="true"] { background: var(--raised-2); color: var(--text); }
.seg-sm { display: inline-flex; }
.seg-sm button { padding: 4px 11px; font-size: 12.5px; }

/* ---------- live feed ---------- */
.feed { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.feedrow {
  display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; align-items: baseline;
  padding: 10px 16px; border-bottom: 1px solid var(--line-soft);
  animation: feedin .25s ease;
}
.feedrow:last-child { border-bottom: none; }
.feedrow .when { font-family: var(--mono); font-size: 12px; color: var(--text-3); }
.feedrow .what { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.feedrow .what .detail { font-family: var(--mono); font-size: 12.5px; color: var(--text-2); margin-left: 8px; }
.feedrow .surf { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 6px; }
.sdot { width: 7px; height: 7px; border-radius: 2px; display: inline-block; }
@keyframes feedin { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; } }

.badge {
  display: inline-block; font-size: 12px; padding: 1px 8px; border-radius: 5px;
  background: var(--raised-2); color: var(--text-2); margin-right: 8px;
  border: 1px solid var(--line-soft);
}

/* ---------- health ---------- */
.hrow { display: grid; grid-template-columns: 140px 1fr 150px; gap: 18px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line-soft); }
.hrow:last-child { border-bottom: none; }
.hrow .hname { font-weight: 500; font-size: 14.5px; }
.ubars { display: flex; gap: 1.5px; align-items: flex-end; height: 30px; }
.ubars i { flex: 1; min-width: 2px; border-radius: 1px; background: var(--green); opacity: .8; }
.ubars i.down { background: var(--red); }
.ubars i.miss { background: var(--raised-2); }
.hstat { text-align: right; }
.hstat .pct { font-family: var(--mono); font-size: 15px; }
.hstat .lat { color: var(--text-3); font-size: 12px; }

/* ---------- drawer ---------- */
.scrim {
  position: fixed; inset: 0; background: rgba(5, 6, 9, 0.55);
  opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 20;
}
.scrim.open { opacity: 1; pointer-events: auto; }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(430px, 94vw);
  background: var(--raised); border-left: 1px solid var(--line);
  transform: translateX(102%); transition: transform .22s ease; z-index: 21;
  padding: 26px 26px 40px; overflow-y: auto;
}
.drawer.open { transform: none; }
.drawer .dhead { display: flex; justify-content: space-between; align-items: start; gap: 10px; }
.drawer h3 { font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
.drawer .x { color: var(--text-3); font-size: 20px; padding: 2px 8px; border-radius: 6px; }
.drawer .x:hover { color: var(--text); background: var(--raised-2); }
.drawer .meta { color: var(--text-3); font-size: 13px; margin-top: 3px; }
.dstats { display: flex; gap: 0; margin: 22px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.dstats .stat { padding: 14px 20px 14px 0; margin-right: 20px; }
.dstats .stat .n { font-size: 20px; }
.dmini { display: flex; gap: 2px; align-items: flex-end; height: 34px; margin: 8px 0 4px; }
.dmini i { flex: 1; background: var(--cyan); opacity: .7; border-radius: 1px; min-width: 2px; }
.drawer h4 { font-size: 13px; font-weight: 500; color: var(--text-3); margin: 26px 0 10px; }
.dfeed .feedrow { padding: 8px 0; border-bottom: 1px solid var(--line-soft); grid-template-columns: 58px 1fr; }
.dfeed .feedrow:last-child { border: none; }

/* ---------- login ---------- */
.login-wrap { min-height: calc(100vh - 58px); display: none; align-items: center; justify-content: center; padding: 24px; }
.login-wrap.show { display: flex; }
.login { width: 340px; max-width: 100%; }
.login .wordmark { font-size: 21px; margin-bottom: 6px; }
.login p { color: var(--text-3); font-size: 14px; margin-bottom: 26px; }
.login input {
  width: 100%; background: var(--raised); border: 1px solid var(--line);
  border-radius: 10px; padding: 12px 15px; color: var(--text); font: inherit;
}
.login input:focus { outline: none; border-color: rgba(34, 211, 238, 0.45); }
.login button {
  width: 100%; margin-top: 12px; padding: 12px; border-radius: 10px;
  background: var(--cyan); color: #06232a; font-weight: 600; font-size: 15px;
  transition: filter .15s;
}
.login button:hover { filter: brightness(1.08); }
.login .err { color: var(--red); font-size: 13.5px; margin-top: 12px; min-height: 20px; }

.empty { color: var(--text-3); font-size: 14px; padding: 28px 4px; }

.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); display: inline-block; margin-right: 7px; animation: blink 2.4s ease infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* motion: one orchestrated entrance, view transitions, fresh-row cue */
@keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
@keyframes viewfade { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
.reveal { animation: rise 0.5s cubic-bezier(0.2, 0.7, 0.3, 1) both; }
.reveal.d1 { animation-delay: 0.07s; }
.reveal.d2 { animation-delay: 0.14s; }
.reveal.d3 { animation-delay: 0.21s; }
.view.active { animation: viewfade 0.22s ease; }
.feedrow.fresh { box-shadow: inset 2px 0 0 var(--amber); }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
@media (max-width: 720px) {
  .topbar { padding: 0 16px; gap: 12px; }
  main { padding: 24px 16px 60px; }
  .hero { gap: 22px; }
  .stat { padding-right: 18px; margin-right: 18px; }
  .weight { grid-template-columns: 110px 1fr 54px; }
}
</style>
</head>
<body>

<header class="topbar" id="topbar" style="display:none">
  <div class="wordmark">Qik<span> Control</span></div>
  <nav class="nav" role="tablist">
    <button role="tab" aria-selected="true" data-view="overview">Overview</button>
    <button role="tab" aria-selected="false" data-view="students">Students</button>
    <button role="tab" aria-selected="false" data-view="live">Live</button>
    <button role="tab" aria-selected="false" data-view="health">Health</button>
  </nav>
  <button class="signout" id="signout">Sign out</button>
</header>

<div class="login-wrap" id="loginwrap">
  <form class="login" id="loginform">
    <div class="wordmark">Qik<span> Control</span></div>
    <p>Private area. Sign in to see who&rsquo;s using the bot.</p>
    <input type="password" id="pw" placeholder="Password" autocomplete="current-password" autofocus>
    <button type="submit">Sign in</button>
    <div class="err" id="loginerr"></div>
  </form>
</div>

<main id="app" style="display:none">

  <section class="view active" id="view-overview">
    <div class="hero reveal">
      <div class="now">
        <div class="big" id="ov-active-today">&ndash;</div>
        <div class="label">students active today</div>
        <div class="sub" id="ov-sub"></div>
      </div>
      <div class="pulse">
        <div class="pulse-head">
          <div class="seg seg-sm" id="pulseseq" role="tablist">
            <button aria-selected="true" data-range="30d">30 days</button>
            <button aria-selected="false" data-range="24h">Today</button>
          </div>
          <span class="legend"><b>&mdash;</b> actions &nbsp;&nbsp;<b style="color:var(--amber)">&mdash;</b> check-ins &nbsp;&nbsp; distinct students</span>
        </div>
        <svg id="pulse" viewBox="0 0 640 120" width="100%" height="120" preserveAspectRatio="none" aria-label="Activity chart"></svg>
      </div>
    </div>

    <div class="statline reveal d1">
      <div class="stat"><div class="n" id="ov-users">&ndash;</div><div class="l">students seen</div></div>
      <div class="stat"><div class="n" id="ov-active7">&ndash;</div><div class="l">active this week</div></div>
      <div class="stat"><div class="n" id="ov-active30">&ndash;</div><div class="l">active this month</div></div>
      <div class="stat"><div class="n" id="ov-actions">&ndash;</div><div class="l">actions all time</div></div>
      <div class="stat"><div class="n" style="color:var(--amber)" id="ov-checkins">&ndash;</div><div class="l">check-ins today</div></div>
    </div>

    <div class="section reveal d2">
      <div class="section-head">
        <h2>Where students are</h2>
        <span class="hint">last 30 days</span>
      </div>
      <div class="surfaceline" id="surfaceline"></div>
      <div class="legend-row" id="surfacelegend"></div>
    </div>

    <div class="section reveal d3">
      <div class="section-head">
        <h2>What they do</h2>
        <span class="hint">last 7 days</span>
      </div>
      <div class="weights" id="weights"></div>
    </div>
  </section>

  <section class="view" id="view-students">
    <div class="toolbar">
      <input class="search" id="usersearch" placeholder="Search name, @username, roll or ID&hellip;" aria-label="Search students">
      <div class="seg" role="tablist">
        <button aria-selected="true" data-sort="recent">Recent</button>
        <button aria-selected="false" data-sort="total">Most active</button>
      </div>
    </div>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Student</th><th>Roll</th><th>Last seen</th>
            <th class="num">Total</th><th class="num">Private</th>
            <th class="num">Channel</th><th class="num">Group</th>
          </tr>
        </thead>
        <tbody id="userrows"></tbody>
      </table>
    </div>
    <div class="empty" id="userempty" style="display:none">No students match.</div>
  </section>

  <section class="view" id="view-live">
    <div class="section-head" style="margin-bottom:12px">
      <h2><span class="live-dot"></span>Live activity</h2>
      <span class="hint">refreshes every 10s</span>
    </div>
    <div class="feed" id="feed"></div>
  </section>

  <section class="view" id="view-health">
    <div class="section-head" style="margin-bottom:6px">
      <h2>Service health</h2>
      <span class="hint">last 90 days, probed every 5 min</span>
    </div>
    <div id="healthrows"></div>
  </section>
</main>

<div class="scrim" id="scrim"></div>
<aside class="drawer" id="drawer" aria-hidden="true"></aside>

<script>
(function () {
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
  var STALE_MS = { overview: 60000, students: 30000, live: 0, health: 300000 };
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
          '<td class="dim">' + ago(u.lastSeen) + "</td>" +
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
        '<div class="dim" style="font-size:12.5px">first seen ' + istDate(parseUtc(p.firstSeen)) + " · last seen " + ago(p.lastSeen) + "</div>" +
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
})();
</script>
</body>
</html>`;
