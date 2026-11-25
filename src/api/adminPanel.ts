/**
 * Self-contained admin panel: one HTML document (CSS + vanilla JS from the
 * sibling `admin/panel.*.ts` modules, so the page stays readable as regular
 * source). No external assets except the Figtree webfont with a system
 * fallback.
 * Served by the API at the secret ADMIN_PANEL_PATH; all data endpoints
 * require the session cookie.
 *
 * Every inline <style>/<script> carries a fresh per-request nonce. The route
 * sends the matching CSP; `unsafe-inline` in style-src keeps the panel's
 * inline style="" attributes working without punching a hole in script-src.
 */
import crypto from "crypto";
import { panelCss } from "./admin/panel.css.js";
import { panelJs } from "./admin/panel.js.js";

/** The Content-Security-Policy for one panel document. */
export const adminPanelCsp = (nonce: string): string =>
  [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self'",
    "img-src 'self' data: blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");

const panelDocument = (nonce: string): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#212a33">
<title>Qik Control</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" rel="stylesheet">
<style nonce="${nonce}">
${panelCss}
</style>
</head>
<body>

<header class="topbar" id="topbar" style="display:none">
  <div class="wordmark">Qik<span> Control</span></div>
  <nav class="nav" aria-label="Admin views">
    <button aria-current="page" data-view="overview">Overview</button>
    <button data-view="students">Students</button>
    <button data-view="verified">Verified</button>
    <button data-view="league">League</button>
    <button data-view="library">Library</button>
    <button data-view="reports">Reports</button>
    <button data-view="chat">Chat</button>
    <button data-view="papers">Papers</button>
    <button data-view="live">Live</button>
    <button data-view="health">Health</button>
  </nav>
  <button class="signout" id="signout">Sign out</button>
</header>

<div class="login-wrap" id="loginwrap">
  <form class="login" id="loginform">
    <div class="wordmark">Qik<span> Control</span></div>
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
      </div>
      <div class="pulse">
        <div class="pulse-head">
          <div class="seg seg-sm" id="pulseseq" role="group" aria-label="Activity range">
            <button aria-pressed="true" data-range="30d">30 days</button>
            <button aria-pressed="false" data-range="24h">Today</button>
          </div>
          <span class="legend">actions</span>
        </div>
        <svg id="pulse" viewBox="0 0 640 120" width="100%" height="120" preserveAspectRatio="none" aria-label="Activity chart"></svg>
      </div>
    </div>

    <div class="statline reveal d1">
      <div class="stat"><div class="n" id="ov-users">&ndash;</div><div class="l">students seen</div></div>
      <div class="stat"><div class="n" id="ov-active7">&ndash;</div><div class="l">active this week</div></div>
      <div class="stat"><div class="n" id="ov-active30">&ndash;</div><div class="l">active this month</div></div>
      <div class="stat"><div class="n" id="ov-actions">&ndash;</div><div class="l">actions all time</div></div>
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
      <div class="seg" id="usersort" role="group" aria-label="Sort students">
        <button aria-pressed="true" data-sort="recent">Recent</button>
        <button aria-pressed="false" data-sort="total">Most active</button>
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

  <section class="view" id="view-verified">
    <div class="section-head" style="margin-bottom:12px">
      <h2>Verified rolls</h2>
    </div>
    <div class="toolbar">
      <input class="search" id="verifiedsearch" placeholder="Search roll, name, email or @username&hellip;" aria-label="Search verified rolls">
      <button class="btn-ghost" id="verifiedrefresh">Refresh</button>
    </div>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Student</th><th>Roll</th><th>College email</th><th>Verified</th>
            <th>Privacy</th>
          </tr>
        </thead>
        <tbody id="verifiedrows"></tbody>
      </table>
    </div>
    <div class="empty" id="verifiedempty" style="display:none">No verified rolls yet.</div>
  </section>

  <section class="view" id="view-league">
    <div class="section-head" style="margin-bottom:12px">
      <h2>League boards</h2>
      <span class="hint" id="league-week">this week</span>
    </div>
    <div class="statline">
      <div class="stat"><div class="n" id="league-players-count">&ndash;</div><div class="l">players this week</div></div>
      <div class="stat"><div class="n" id="league-verified-count">&ndash;</div><div class="l">verified players</div></div>
      <div class="stat"><div class="n" id="league-sections-count">&ndash;</div><div class="l">sections counting</div></div>
      <div class="stat"><div class="n" id="league-runs-count">&ndash;</div><div class="l">runs today</div></div>
    </div>

    <div class="section-head" style="margin:18px 0 10px">
      <h2>Section Wars</h2>
      <span class="hint">best ten verified players per section</span>
    </div>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Section</th><th class="num">Verified players</th><th class="num">Points</th>
          </tr>
        </thead>
        <tbody id="league-section-rows"></tbody>
      </table>
    </div>
    <div class="empty" id="league-sections-empty" style="display:none">No section has scored this week.</div>

    <div class="section-head" style="margin:18px 0 10px">
      <h2>Players</h2>
      <span class="hint" id="league-player-hint">this week</span>
    </div>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Player</th><th>Roll</th><th>Section</th><th>Status</th><th class="num">Runs</th><th class="num">Points</th>
          </tr>
        </thead>
        <tbody id="league-player-rows"></tbody>
      </table>
    </div>
    <div class="empty" id="league-players-empty" style="display:none">No one has played this week.</div>

    <div class="section-head" style="margin:22px 0 10px">
      <h2>Duels</h2>
      <span class="hint" id="league-duel-hint">a match, not a run: no points or board places</span>
    </div>
    <div class="statline">
      <div class="stat"><div class="n" id="league-duel-open">&ndash;</div><div class="l">open challenges</div></div>
      <div class="stat"><div class="n" id="league-duel-finished">&ndash;</div><div class="l">finished this week</div></div>
      <div class="stat"><div class="n" id="league-duel-today">&ndash;</div><div class="l">challenges today</div></div>
      <div class="stat"><div class="n" id="league-duel-players">&ndash;</div><div class="l">duelists this week</div></div>
    </div>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>#</th><th>Challenger</th><th>Opponent</th><th>Result</th>
            <th class="num">Scores</th><th>Status</th><th>When</th>
          </tr>
        </thead>
        <tbody id="league-duel-rows"></tbody>
      </table>
    </div>
    <div class="empty" id="league-duels-empty" style="display:none">No duels yet.</div>

    <div class="toolbar" style="margin-top:14px">
      <button class="btn-ghost" id="leaguerefresh">Refresh</button>
    </div>
  </section>

  <section class="view" id="view-library">
    <div class="section-head" style="margin-bottom:12px">
      <h2>Library reading</h2>
    </div>
    <div class="statline">
      <div class="stat"><div class="n" id="lib-readers">&ndash;</div><div class="l">readers</div></div>
      <div class="stat"><div class="n" id="lib-pages">&ndash;</div><div class="l">pages read</div></div>
      <div class="stat"><div class="n" id="lib-downloads">&ndash;</div><div class="l">pdf downloads</div></div>
      <div class="stat"><div class="n" id="lib-docs">&ndash;</div><div class="l">documents read</div></div>
    </div>
    <div class="toolbar" style="margin-top:16px">
      <input class="search" id="libsearch" placeholder="Search name, @username, roll or ID&hellip;" aria-label="Search readers">
      <div class="seg" role="group" aria-label="Sort readers" id="libsort">
        <button aria-pressed="true" data-sort="recent">Recent</button>
        <button aria-pressed="false" data-sort="pages">Most pages</button>
        <button aria-pressed="false" data-sort="downloads">Most downloads</button>
      </div>
      <button class="btn-ghost" id="librefresh">Refresh</button>
    </div>
    <div class="toolbar">
      <input class="search" id="libtoken" placeholder="Resolve a watermark, e.g. NBK-0000-0000-0000-0000" aria-label="Resolve a watermark token">
      <button class="btn-ghost" id="libresolve">Resolve mark</button>
    </div>
    <div id="libresolved"></div>
    <div class="section" style="margin-top:20px">
      <div class="section-head"><h2>Who is reading</h2><span class="hint" id="lib-reader-hint"></span></div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Student</th><th>Roll</th>
              <th class="num">Docs</th><th class="num">Pages</th>
              <th class="num">PDFs</th><th>Last read</th>
            </tr>
          </thead>
          <tbody id="libreaders"></tbody>
        </table>
      </div>
      <div class="empty" id="libreaderempty" style="display:none">No readers match.</div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Which documents</h2></div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Subject</th><th>Unit</th>
              <th class="num">Readers</th><th class="num">Pages</th>
              <th class="num">PDFs</th><th class="num">Done</th><th>Last read</th>
            </tr>
          </thead>
          <tbody id="libdocs"></tbody>
        </table>
      </div>
      <div class="empty" id="libdocsempty" style="display:none">No documents have been read yet.</div>
    </div>
    <div class="section">
      <div class="section-head"><h2>Latest activity</h2></div>
      <div class="feed" id="libfeed"></div>
    </div>
  </section>

  <section class="view" id="view-live">
    <div class="section-head" style="margin-bottom:12px">
      <h2>Live activity</h2>
    </div>
    <div class="feed" id="feed"></div>
  </section>

  <section class="view" id="view-reports">
    <div class="section-head" style="margin-bottom:12px">
      <h2>Issue reports</h2>
    </div>
    <div class="toolbar">
      <div class="seg" role="group" aria-label="Report status" id="reportfilter">
        <button aria-pressed="false" data-status="all">All</button>
        <button aria-pressed="true" data-status="open">Open</button>
        <button aria-pressed="false" data-status="answered">Answered</button>
        <button aria-pressed="false" data-status="resolved">Resolved</button>
      </div>
      <button class="btn-ghost" id="reportsrefresh">Refresh</button>
    </div>
    <div class="reports" id="reports"></div>
  </section>

  <section class="view" id="view-chat">
    <div class="section-head" style="margin-bottom:12px">
      <h2>Chat regulation</h2>
      <span class="hint">the bot's own rules for the group</span>
    </div>
    <div class="toolbar">
      <button class="btn-ghost" id="chatrefresh">Refresh</button>
    </div>
    <div id="chatstatus"></div>
    <div class="chatnote" style="margin-top:10px">In the group, reply to a member's message with /ban, /mute, /kick or /purge. Ban, mute and kick remove their messages too.</div>

    <div class="statline">
      <div class="stat"><div class="n" id="chat-muted">&ndash;</div><div class="l">muted now</div></div>
      <div class="stat"><div class="n" id="chat-banned">&ndash;</div><div class="l">banned</div></div>
      <div class="stat"><div class="n" id="chat-actions">&ndash;</div><div class="l">actions today</div></div>
      <div class="stat"><div class="n" id="chat-deleted">&ndash;</div><div class="l">messages removed today</div></div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Rule</h2>
        <span class="hint">automatic moderation only, reply commands work regardless</span>
      </div>
      <div class="group" id="chatsettings"></div>
      <div class="toolbar" style="margin-top:10px">
        <button class="btn-ghost" id="chatsave">Save rule</button>
        <span class="chatnote" id="chatsaveresult" style="display:none"></span>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Blocked words</h2>
        <span class="hint" id="chatkwhint"></span>
      </div>
      <div class="toolbar">
        <input class="search" id="chatkw" placeholder="Add a word or phrase&hellip;" aria-label="Add a blocked word">
        <button class="btn-ghost" id="chatkwadd">Add word</button>
      </div>
      <div class="kwlist" id="chatkeywords"></div>
      <div class="chatnote" id="chatkwresult" style="display:none"></div>
      <div class="empty" id="chatkwempty" style="display:none">No blocked words, so nothing is removed automatically.</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Test a message</h2>
        <span class="hint">nothing is removed</span>
      </div>
      <div class="toolbar">
        <input class="search" id="chatchecktext" placeholder="Paste a message&hellip;" aria-label="Test a message against the blocked words">
        <button class="btn-ghost" id="chatcheck">Check</button>
      </div>
      <div class="chatnote" id="chatcheckresult" style="display:none"></div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Act on a user</h2>
        <span class="hint">Telegram user ID; mute uses the saved length</span>
      </div>
      <div class="toolbar">
        <input class="search" id="chatuserid" inputmode="numeric" placeholder="User ID" aria-label="Telegram user ID">
        <button class="btn-ghost danger" id="chatban">Ban</button>
        <button class="btn-ghost" id="chatmute">Mute</button>
        <button class="btn-ghost danger" id="chatkick">Kick</button>
        <button class="btn-ghost danger" id="chatpurge">Remove messages</button>
      </div>
      <div class="chatnote" id="chatuserresult" style="display:none"></div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Muted and banned</h2>
        <span class="hint" id="chatusershint"></span>
      </div>
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>Student</th><th>State</th><th>Until</th><th>Reason</th><th>By</th><th></th>
            </tr>
          </thead>
          <tbody id="chatmoderated"></tbody>
        </table>
      </div>
      <div class="empty" id="chatusersempty" style="display:none">No one is muted or banned.</div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>Recent actions</h2>
        <span class="hint" id="chatactionshint"></span>
      </div>
      <div class="feed" id="chatactions"></div>
    </div>
  </section>

  <section class="view" id="view-papers">
    <div class="section-head" style="margin-bottom:12px">
      <h2>Question papers</h2>
    </div>
    <div class="toolbar">
      <input class="search" id="papersearch" placeholder="Search subject, exam, note or uploader&hellip;" aria-label="Search papers">
      <button class="btn-ghost" id="papersrefresh">Refresh</button>
    </div>
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Paper</th><th>Uploaded by</th>
            <th class="num">Pages</th><th>Added</th><th></th>
          </tr>
        </thead>
        <tbody id="paperrows"></tbody>
      </table>
    </div>
    <div class="empty" id="paperempty" style="display:none">No papers uploaded yet.</div>
  </section>

  <section class="view" id="view-health">
    <div class="section-head" style="margin-bottom:6px">
      <h2>Service health</h2>
      <span class="hint">last 90 days, probed every 5 min</span>
    </div>
    <div id="healthrows"></div>
  </section>
</main>

<dialog class="drawer" id="drawer" aria-labelledby="drawer-title" closedby="any"></dialog>

<script nonce="${nonce}">
${panelJs}
</script>
</body>
</html>`;

/**
 * Builds the panel document and the nonce its CSP must allow.
 * The nonce is generated per request, so a cached copy of another response's
 * policy can never authorise this one.
 */
export const createAdminPanelDocument = (): { html: string; nonce: string } => {
  const nonce = crypto.randomBytes(16).toString("hex");
  return { html: panelDocument(nonce), nonce };
};

/**
 * Backwards-compatible HTML-only helper. The document it returns carries a
 * nonce, but the caller cannot build the matching CSP from it; route handlers
 * that send a CSP must use `createAdminPanelDocument` instead.
 */
export const adminPanelHtml = (): string => createAdminPanelDocument().html;
