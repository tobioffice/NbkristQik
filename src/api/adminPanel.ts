/**
 * Self-contained admin panel: one HTML document (CSS + vanilla JS from the
 * sibling `admin/panel.*.ts` modules, so the page stays readable as regular
 * source). No external assets except the Outfit webfont with system fallback.
 * Served by the API at the secret ADMIN_PANEL_PATH; all data endpoints
 * require the session cookie.
 */
import { panelCss } from "./admin/panel.css.js";
import { panelJs } from "./admin/panel.js.js";

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
${panelCss}
</style>
</head>
<body>

<header class="topbar" id="topbar" style="display:none">
  <div class="wordmark">Qik<span> Control</span></div>
  <nav class="nav" role="tablist">
    <button role="tab" aria-selected="true" data-view="overview">Overview</button>
    <button role="tab" aria-selected="false" data-view="students">Students</button>
    <button role="tab" aria-selected="false" data-view="reports">Reports</button>
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

  <section class="view" id="view-reports">
    <div class="section-head" style="margin-bottom:12px">
      <h2>Issue reports</h2>
      <span class="hint">replies reach the reporter in Telegram</span>
    </div>
    <div class="toolbar">
      <div class="seg" role="tablist" id="reportfilter">
        <button aria-selected="false" data-status="all">All</button>
        <button aria-selected="true" data-status="open">Open</button>
        <button aria-selected="false" data-status="answered">Answered</button>
        <button aria-selected="false" data-status="resolved">Resolved</button>
      </div>
      <button class="btn-ghost" id="reportsrefresh">Refresh</button>
    </div>
    <div class="reports" id="reports"></div>
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
${panelJs}
</script>
</body>
</html>`;
