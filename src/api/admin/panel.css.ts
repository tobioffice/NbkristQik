// Extracted from the admin panel HTML — composed in ../adminPanel.ts.
// The Mini App's Telegram surface: dark ground, grouped rows, sentence case,
// two blues, tabular figures. Same class contract as the JS renders against.
export const panelCss = `:root {
  --ground: #1a2026;
  --footer: #111417;
  --surface: #212a33;
  --surface-hover: #293440;
  --surface-active: #2d3a47;
  --text: #ffffff;
  --text-2: #8794a1;
  --text-3: #8494a3;
  --placeholder: #8a98a6;
  --accent: #4cb2ff;
  --action: #248bda;
  --action-hover: #207cc2;
  --danger: #f88277;
  --warning: #ff9953;
  --good: #7ed176;
  --ring: #838f9c;
  --dropdown: #2e3a47;
  --admin-wash: #253747;
  --fresh: rgba(255, 153, 83, 0.10);
  --scrim: rgba(0, 0, 0, 0.6);
  --font: "Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --radius: 8px;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html {
  background: var(--ground);
  color-scheme: dark;
  scrollbar-color: var(--text-3) var(--footer);
}
@supports not (scrollbar-color: auto) {
  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-track { background: var(--footer); }
  ::-webkit-scrollbar-thumb {
    background: var(--text-3);
    border: 2px solid var(--footer);
    border-radius: 20px;
  }
  ::-webkit-scrollbar-thumb:hover { background: var(--text-2); }
}
body {
  background: var(--ground);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 20px;
  font-weight: 400;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
::selection { background: rgba(36, 139, 218, 0.35); }
a { color: inherit; }
button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
input, textarea { font: inherit; color: inherit; caret-color: var(--accent); }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 8px; }

.mono { font-variant-numeric: tabular-nums; }

/* ---------- band ---------- */
.topbar {
  display: flex; align-items: center; gap: 20px;
  min-height: calc(56px + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) max(16px, env(safe-area-inset-right)) 0 max(16px, env(safe-area-inset-left));
  background: var(--surface);
  position: sticky; top: 0; z-index: 10;
}
.wordmark {
  font-family: var(--font);
  font-size: 17px; line-height: 24px; font-weight: 600;
  color: var(--text); white-space: nowrap;
}
.wordmark span {
  display: block;
  font-family: var(--font);
  font-size: 12px; line-height: 16px; font-weight: 400;
  color: var(--text-2);
}
.nav {
  display: flex; gap: 2px; flex: 1;
  overflow-x: auto;
  scrollbar-color: var(--text-3) var(--surface);
}
.nav button {
  min-height: 40px;
  position: relative;
  padding: 8px 12px; border-radius: 8px;
  color: var(--text-2); font-weight: 600; font-size: 13px;
  white-space: nowrap;
  transition: color .12s, background .12s;
}
.nav button:hover { color: var(--text); background: var(--surface-hover); }
.nav button[aria-current="page"] { color: var(--accent); background: transparent; }
.nav button[aria-current="page"]::after {
  content: "";
  position: absolute;
  inset: auto 12px 2px;
  border-bottom: 2px solid var(--accent);
}
.signout {
  min-height: 40px;
  color: var(--text-2); font-size: 13px; padding: 8px 12px; border-radius: 8px;
  white-space: nowrap;
  transition: color .12s, background .12s;
}
.signout:hover { color: var(--text); background: var(--surface-hover); }

main {
  max-width: 1120px; margin: 0 auto;
  padding: 24px max(16px, env(safe-area-inset-right)) max(64px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
}
.view { display: none; }
.view.active { display: block; }

/* ---------- overview ---------- */
.hero {
  display: flex; gap: 32px; align-items: flex-end; flex-wrap: wrap;
  background: var(--surface); border-radius: 8px; padding: 20px;
}
.hero .now { min-width: 180px; }
.now .big {
  font-family: var(--font);
  font-size: clamp(48px, 7vw, 64px); line-height: 1; font-weight: 700;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}
.now .label { color: var(--text-2); margin-top: 6px; font-size: 13px; line-height: 18px; }
.now .sub { color: var(--text-3); font-size: 12px; line-height: 16px; margin-top: 2px; }
.pulse { flex: 1; min-width: 300px; }
.pulse-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.pulse-head .legend { color: var(--text-2); font-size: 12px; line-height: 16px; }
.pulse-head .legend b { color: var(--accent); font-weight: 600; }

.statline {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 1px; margin-top: 16px;
  background: var(--ground); border-radius: 8px; overflow: hidden;
}
.stat { background: var(--surface); padding: 14px 16px; }
.stat .n {
  font-family: var(--font);
  font-size: 22px; line-height: 28px; font-weight: 600;
  letter-spacing: -0.01em;
  font-variant-numeric: tabular-nums;
}
.stat .l { color: var(--text-2); font-size: 12px; line-height: 16px; margin-top: 2px; }

/* ---------- sections ---------- */
.section { margin-top: 24px; }
.section-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; margin-bottom: 10px;
}
.section-head h2 { font-family: var(--font); font-size: 17px; line-height: 24px; font-weight: 600; }
.section-head .hint { color: var(--text-2); font-size: 12px; line-height: 16px; }

/* surface split */
.surfaceline {
  display: flex; height: 8px; overflow: hidden;
  background: var(--surface); border-radius: 20px;
}
.surfaceline div { height: 100%; transition: width .4s ease; }
.legend-row { display: flex; gap: 20px; margin-top: 10px; flex-wrap: wrap; }
.legend-row .item { display: flex; align-items: center; gap: 6px; font-size: 13px; line-height: 18px; color: var(--text-2); }
.legend-row .dot { width: 8px; height: 8px; border-radius: 50%; }
.legend-row .n { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }

/* action weights */
.weights { display: flex; flex-direction: column; gap: 8px; }
.weight { display: grid; grid-template-columns: 140px 1fr 56px; gap: 12px; align-items: center; }
.weight .w-label { color: var(--text-2); font-size: 13px; line-height: 18px; text-align: right; }
.weight .w-bar { height: 6px; background: var(--surface-active); border-radius: 20px; overflow: hidden; }
.weight .w-bar div { height: 100%; background: var(--accent); border-radius: 20px; }
.weight .w-n { font-size: 13px; line-height: 18px; color: var(--text-2); text-align: left; font-variant-numeric: tabular-nums; }

/* ---------- table ---------- */
.tablewrap { overflow-x: auto; border-radius: 8px; background: var(--ground); }
table { width: 100%; border-collapse: collapse; min-width: 760px; }
th {
  text-align: left; font-size: 12px; line-height: 16px; font-weight: 600;
  color: var(--text-2);
  padding: 10px 14px;
  background: var(--surface-hover);
  position: sticky; top: 0; white-space: nowrap;
}
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
td {
  padding: 10px 14px;
  background: var(--surface);
  font-size: 14px; line-height: 20px;
  border-bottom: 1px solid var(--ground);
  white-space: nowrap;
}
tbody tr { cursor: pointer; }
tbody tr:hover td { background: var(--surface-hover); }
tbody tr:last-child td { border-bottom: none; }
.who .name { font-weight: 600; color: var(--text); }
.who .handle { color: var(--text-2); font-size: 12px; line-height: 16px; }
td .surfn { display: inline-block; min-width: 28px; text-align: right; }
.rolls { color: var(--text-2); }
.dim { color: var(--text-3); }

/* ---------- controls ---------- */
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.search {
  flex: 1; min-width: 220px; max-width: 380px; height: 48px;
  background: var(--surface); border: none; border-radius: 12px;
  padding: 0 14px; color: var(--text); font-size: 16px;
}
.search::placeholder { color: var(--placeholder); }
.search:focus { outline: none; }
.search:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.seg {
  display: flex; gap: 2px; padding: 2px;
  background: var(--surface); border-radius: 10px;
}
.seg button {
  height: 32px; padding: 0 12px; border-radius: 8px;
  font-size: 13px; line-height: 18px; font-weight: 500; color: var(--text-2);
}
.seg button:hover { color: var(--text); }
.seg button[aria-pressed="true"] { background: var(--surface-active); color: var(--text); font-weight: 600; }
.seg-sm { display: inline-flex; }
.seg-sm button { height: 28px; padding: 0 10px; font-size: 12px; }
.btn-ghost {
  height: 48px; padding: 0 14px;
  font-size: 13px; line-height: 18px; font-weight: 600;
  color: var(--text); background: var(--surface);
  border-radius: 8px;
}
.btn-ghost:hover { background: var(--surface-hover); }

/* ---------- live feed ---------- */
.feed {
  display: flex; flex-direction: column; gap: 1px;
  background: var(--ground); border-radius: 8px; overflow: hidden;
}
.feedrow {
  display: grid; grid-template-columns: 64px 1fr auto; gap: 12px; align-items: baseline;
  padding: 10px 14px;
  background: var(--surface);
  animation: feedin .25s ease;
  transition: background .12s;
}
.feedrow:hover { background: var(--surface-hover); }
.feedrow .when { font-size: 12px; line-height: 16px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.feedrow .what { font-size: 14px; line-height: 20px; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text); }
.feedrow .what .detail { font-size: 12px; line-height: 16px; color: var(--text-2); margin-left: 6px; font-variant-numeric: tabular-nums; }
.feedrow .surf { font-size: 12px; line-height: 16px; color: var(--text-2); display: flex; align-items: center; gap: 6px; }
.sdot { width: 8px; height: 8px; display: inline-block; border-radius: 50%; }
@keyframes feedin { from { opacity: 0; } to { opacity: 1; } }

.badge {
  display: inline-block; font-size: 11px; line-height: 16px; font-weight: 600;
  padding: 1px 8px; border-radius: 20px;
  background: var(--surface-active); color: var(--text); margin-right: 6px;
}

.feedrow.fresh { background: var(--fresh); }
.feedrow.fresh .when { color: var(--warning); font-weight: 600; }

/* ---------- health ---------- */
#healthrows {
  display: flex; flex-direction: column; gap: 1px;
  background: var(--ground); border-radius: 8px; overflow: hidden;
}
.hrow { display: grid; grid-template-columns: 140px 1fr 150px; gap: 16px; align-items: center; padding: 14px; background: var(--surface); }
.hrow .hname { font-weight: 600; font-size: 14px; line-height: 20px; }
.ubars { display: flex; gap: 1px; align-items: flex-end; height: 28px; }
.ubars i { flex: 1; min-width: 2px; background: var(--good); opacity: .9; border-radius: 2px 2px 0 0; }
.ubars i.down { background: var(--danger); }
.ubars i.miss { background: var(--surface-active); }
.hstat { text-align: right; }
.hstat .pct { font-size: 15px; line-height: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
.hstat .lat { color: var(--text-2); font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; }

/* ---------- drawer ---------- */
/* Native modal dialog: top layer, inert page, focus containment and the
   platform's Esc/back dismissal. ::backdrop replaces the old scrim div. */
.drawer {
  position: fixed; inset: 0 0 0 auto;
  width: min(460px, 96vw); height: 100%;
  max-width: none; max-height: none;
  margin: 0; border: 0; border-radius: 16px 0 0 16px;
  padding: max(20px, env(safe-area-inset-top)) 20px max(32px, env(safe-area-inset-bottom));
  background: var(--ground); color: var(--text);
  overflow-y: auto;
  opacity: 0;
  transition-property: opacity, transform, display, overlay;
  transition-duration: .2s;
  transition-timing-function: ease;
  transition-behavior: allow-discrete;
}
.drawer[open] { opacity: 1; }
@starting-style {
  .drawer[open] { opacity: 0; }
}
.drawer::backdrop {
  background-color: transparent;
  overflow: hidden;
  overscroll-behavior: contain;
  transition-property: background-color, display, overlay;
  transition-duration: .2s;
  transition-timing-function: ease;
  transition-behavior: allow-discrete;
}
.drawer[open]::backdrop { background-color: rgba(0, 0, 0, 0.6); }
@starting-style {
  .drawer[open]::backdrop { background-color: transparent; }
}
.drawer:modal { overscroll-behavior: contain; }
@media (prefers-reduced-motion: no-preference) {
  .drawer { transform: translateX(100%); }
  .drawer[open] { transform: none; }
  @starting-style {
    .drawer[open] { transform: translateX(100%); }
  }
}
.drawer .dhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.drawer h3 { font-family: var(--font); font-size: 20px; line-height: 26px; font-weight: 600; }
.drawer .x { color: var(--text-2); font-size: 20px; padding: 8px 10px; margin: -8px -10px 0 0; border-radius: 8px; }
.drawer .x:hover { color: var(--text); background: var(--surface-hover); }
.drawer .meta { color: var(--text-2); font-size: 12px; line-height: 16px; margin-top: 2px; font-variant-numeric: tabular-nums; }
.dstats {
  display: flex; gap: 1px; margin: 16px 0;
  background: var(--ground); border-radius: 8px; overflow: hidden;
}
.dstats .stat { padding: 12px 14px; margin: 0; background: var(--surface); }
.dstats .stat .n { font-size: 19px; line-height: 25px; }
.dmini { display: flex; gap: 1px; align-items: flex-end; height: 32px; margin: 8px 0 4px; }
.dmini i { flex: 1; background: var(--accent); opacity: .7; min-width: 2px; border-radius: 2px 2px 0 0; }
.drawer h4 { font-size: 12px; line-height: 16px; font-weight: 600; color: var(--text-2); margin: 20px 0 8px; }
.dfeed { display: flex; flex-direction: column; gap: 1px; background: var(--ground); border-radius: 8px; overflow: hidden; }
.dfeed .feedrow { padding: 8px 12px; grid-template-columns: 58px 1fr; }

/* ---------- login ---------- */
.login-wrap { min-height: 100vh; display: none; align-items: center; justify-content: center; padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)); }
.login-wrap.show { display: flex; }
.login { width: 380px; max-width: 100%; }
.login .wordmark { font-size: 22px; line-height: 30px; margin-bottom: 4px; }
.login .wordmark span { font-size: 12px; line-height: 16px; color: var(--text-2); }
.login p { color: var(--text-2); font-size: 13px; line-height: 18px; margin-bottom: 18px; }
.login input {
  width: 100%; height: 48px;
  background: var(--surface); border: none; border-radius: 8px;
  padding: 0 14px; color: var(--text); font-size: 16px;
}
.login input::placeholder { color: var(--placeholder); }
.login input:focus { outline: none; }
.login input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.login button {
  width: 100%; height: 48px; margin-top: 10px; border-radius: 8px;
  background: var(--action); color: var(--text);
  font-weight: 700; font-size: 15px;
  transition: background .12s;
}
.login button:hover { background: var(--action-hover); }
.login .err { color: var(--danger); font-size: 13px; line-height: 18px; margin-top: 10px; min-height: 18px; }

.empty { color: var(--text-2); font-size: 13px; line-height: 18px; padding: 24px 4px; }
.reports > .empty, .feed > .empty, #healthrows > .empty { background: var(--surface); }

.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); display: inline-block; margin-right: 6px; animation: blink 2.4s ease infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* motion: one short entrance, view transitions, fresh-row cue */
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes viewfade { from { opacity: 0; } to { opacity: 1; } }
.reveal { animation: rise .2s ease both; }
.reveal.d1 { animation-delay: .04s; }
.reveal.d2 { animation-delay: .08s; }
.reveal.d3 { animation-delay: .12s; }
.view.active { animation: viewfade .2s ease; }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
@media (min-width: 721px) {
  .rform .send { font-size: 15px; }
}
@media (max-width: 720px) {
  .topbar { gap: 10px; padding: env(safe-area-inset-top) max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left)); }
  main { padding: 16px max(12px, env(safe-area-inset-right)) max(56px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
  .hero { gap: 20px; padding: 16px; }
  .pulse { min-width: 0; width: 100%; }
  .statline { grid-template-columns: repeat(2, 1fr); }
  .weight { grid-template-columns: 110px 1fr 48px; }
  .hrow { grid-template-columns: 1fr; gap: 8px; }
  .hstat { text-align: left; display: flex; gap: 12px; align-items: baseline; }
  .drawer {
    inset: 0;
    width: auto;
    border-radius: 16px 16px 0 0;
  }
}
@media (prefers-reduced-motion: no-preference) and (max-width: 720px) {
  .drawer { transform: translateY(100%); }
  .drawer[open] { transform: none; }
  @starting-style {
    .drawer[open] { transform: translateY(100%); }
  }
}

/* ---------- issue reports ---------- */
.reports {
  display: flex; flex-direction: column; gap: 1px;
  background: var(--ground); border-radius: 8px; overflow: hidden;
}
.rrow { background: var(--surface); padding: 12px 14px; transition: background .12s; }
.rrow:hover { background: var(--surface-hover); }
.rrow.resolved { opacity: .82; }
.rhead { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.rid { font-size: 13px; line-height: 18px; color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
.rstatus {
  font-size: 12px; line-height: 16px; font-weight: 500; color: var(--text-2);
  display: inline-flex; align-items: center; gap: 6px;
}
.rstatus .dot { width: 7px; height: 7px; border-radius: 50%; }
.rstatus.open .dot { background: var(--text-2); }
.rstatus.answered .dot { background: var(--warning); }
.rstatus.resolved .dot { background: var(--good); }
.rname { font-size: 12px; line-height: 16px; color: var(--text-2); }
.rtime { font-size: 12px; line-height: 16px; color: var(--text-3); margin-left: auto; font-variant-numeric: tabular-nums; }
.rmsg { margin-top: 6px; font-size: 14px; line-height: 20px; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.rreplyblock {
  margin-top: 8px; padding: 10px 12px;
  border-radius: 6px; background: var(--admin-wash);
  font-size: 13px; line-height: 18px; color: var(--text-2);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.rreplyblock b {
  color: var(--accent); font-weight: 600; font-size: 11px; line-height: 16px;
  display: block; margin-bottom: 2px;
}
.rform { margin-top: 10px; display: none; gap: 8px; align-items: flex-start; }
.rform.show { display: flex; }
.rform-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.rform textarea {
  width: 100%; background: var(--surface); border: none; border-radius: 8px;
  padding: 12px 14px; color: var(--text);
  font-size: 16px; line-height: 22px; resize: vertical;
  min-height: 132px;
}
.rform textarea::placeholder { color: var(--placeholder); }
.rform textarea:focus { outline: none; }
.rform textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.rform .send {
  align-self: flex-start;
  background: var(--action); color: var(--text);
  font-weight: 700; font-size: 13px; line-height: 18px;
  border-radius: 8px; padding: 12px 16px;
}
.rform .send:hover { background: var(--action-hover); }
.rattach { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rattach-btn {
  font-size: 13px; line-height: 18px; font-weight: 600; color: var(--text);
  background: var(--surface); border-radius: 8px; padding: 12px 14px;
  cursor: pointer;
}
.rattach-btn:hover { background: var(--surface-hover); }
.rattach-btn:disabled { color: var(--text-3); cursor: default; }
.rattach-input { display: none; }
.rattach .hint { font-size: 12px; line-height: 16px; color: var(--text-2); }
.rattach .hint.error { color: var(--danger); font-weight: 600; }
.rshots { display: flex; gap: 8px; flex-wrap: wrap; }
.rshot {
  position: relative; width: 58px; height: 58px;
  border-radius: 8px; background: var(--surface-active);
}
.rshot img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 8px; }
.rshot button {
  position: absolute; top: -6px; right: -6px; width: 20px; height: 20px;
  padding: 0; line-height: 18px; font-size: 13px;
  background: var(--surface-active); color: var(--text);
  border-radius: 50%;
}
.rshot button:hover { background: var(--surface-hover); color: var(--danger); }
.rbtns { margin-top: 10px; display: flex; gap: 8px; }
.rbtns button {
  font-size: 13px; line-height: 18px; font-weight: 600;
  border-radius: 8px; padding: 12px 14px;
  color: var(--text); background: var(--surface);
}
.rbtns button:hover { background: var(--surface-hover); }
.rform + .rbtns { margin-top: 8px; }
.rnew {
  font-size: 11px; line-height: 16px; font-weight: 600;
  color: var(--text); background: var(--action);
  border-radius: 20px; padding: 1px 8px;
  display: inline-block;
  font-variant-numeric: tabular-nums;
}
.rsum {
  margin-top: 6px; font-size: 12px; line-height: 16px;
  color: var(--text-2); font-variant-numeric: tabular-nums;
}

/* ---------- thread ---------- */
.dthread {
  margin-top: 12px;
  display: flex; flex-direction: column; gap: 1px;
  background: var(--ground); border-radius: 8px; overflow: hidden;
}
.tmsg { background: var(--surface); padding: 12px 14px; }
.tmsg.admin { background: var(--admin-wash); }
.tmsg .tmeta {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font-size: 12px; line-height: 16px; color: var(--text-2);
}
.tmsg .tmeta b { color: var(--text); font-weight: 600; }
.tmsg.admin .tmeta b { color: var(--accent); }
.tmsg .tmeta span { font-weight: 400; color: var(--text-3); font-variant-numeric: tabular-nums; }
.tmsg .tbody {
  margin-top: 4px; font-size: 14px; line-height: 20px; color: var(--text);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.tattachments { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.tattachment {
  display: block; width: 132px; height: 132px; overflow: hidden;
  border-radius: 8px; background: var(--surface-active);
}
.tattachment img { display: block; width: 100%; height: 100%; object-fit: cover; }
.tattachment:hover, .tattachment:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.sk { background: var(--surface-hover); border-radius: 8px; }
.tmsg.sk { min-height: 64px; }
.sk-pulse { animation: skbreathe 1.2s ease-in-out infinite; }
@keyframes skbreathe { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
.linkbtn {
  font-size: 13px; font-weight: 500; color: var(--accent);
  text-decoration: none; padding: 0;
}
.linkbtn:hover { text-decoration: underline; }
`;
