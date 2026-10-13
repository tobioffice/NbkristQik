// Extracted from the admin panel HTML — composed in ../adminPanel.ts.
// The Attendance Register world: paper ground, ink text, cloth band,
// red-ballpoint corrections. Same class contract as the JS renders against.
export const panelCss = `:root {
  --paper: #e7dcc3;
  --paper-2: #efe5cd;
  --paper-3: #f6efdd;
  --raised: #f2ead6;
  --raised-2: #e9deca;
  --ink: #1e2a38;
  --ink-2: #5a5140;
  --ink-3: #675d4b;
  --ink-4: #675d4b;
  --cloth: #3f6457;
  --cloth-deep: #33544a;
  --red: #c33b2e;
  --red-ink: #a62f22;
  --amber: #8a6a12;
  --amber-text: #6e5410;
  --green: #2f5c46;
  --line: rgba(30, 42, 56, 0.2);
  --line-2: rgba(30, 42, 56, 0.45);
  --line-soft: rgba(30, 42, 56, 0.12);
  --font-display: "Zilla Slab", "Roboto Slab", Georgia, serif;
  --mono: "Public Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { color-scheme: light; }
body {
  background: var(--paper);
  color: var(--ink);
  font-family: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.5;
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
::selection { background: rgba(195, 59, 46, 0.24); }
::-webkit-scrollbar { width: 11px; }
::-webkit-scrollbar-track { background: var(--paper-2); }
::-webkit-scrollbar-thumb { background: var(--ink-3); border: 3px solid var(--paper-2); }
::-webkit-scrollbar-thumb:hover { background: var(--ink-2); }
a { color: inherit; }
button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
input, textarea { font: inherit; color: inherit; caret-color: var(--ink); }
:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; border-radius: 1px; }

.mono { font-variant-numeric: tabular-nums; }

/* ---------- cloth band ---------- */
.topbar {
  display: flex; align-items: center; gap: 24px;
  padding: 0 28px; height: 58px;
  background: var(--cloth); color: var(--paper-3);
  border-bottom: 2px solid var(--cloth-deep);
  position: sticky; top: 0; z-index: 10;
}
.wordmark {
  font-family: var(--font-display);
  font-size: 19px; font-weight: 600; letter-spacing: 0.01em; white-space: nowrap;
  color: var(--paper-3);
}
.wordmark span { color: rgba(246, 239, 221, 0.85); font-weight: 600; }
.nav { display: flex; gap: 2px; flex: 1; overflow-x: auto; scrollbar-width: none; }
.nav::-webkit-scrollbar { display: none; }
.nav button {
  padding: 7px 14px; border-radius: 2px;
  color: rgba(246, 239, 221, 0.85); font-weight: 600; font-size: 13.5px;
  letter-spacing: 0.02em;
  transition: color .15s, background .15s;
  white-space: nowrap;
}
.nav button:hover { color: var(--paper-3); }
.nav button[aria-selected="true"] { color: var(--ink); background: var(--paper-3); }
.signout {
  color: rgba(246, 239, 221, 0.85); font-size: 13px; padding: 7px 12px; border-radius: 2px;
  border: 1px solid transparent; transition: color .15s, border-color .15s;
  white-space: nowrap;
}
.signout:hover { color: var(--paper-3); border-color: rgba(246, 239, 221, 0.4); }

main { max-width: 1060px; margin: 0 auto; padding: 36px 28px 80px; }
.view { display: none; }
.view.active { display: block; }

/* ---------- overview: ledger head ---------- */
.hero { display: flex; gap: 40px; align-items: flex-end; flex-wrap: wrap; }
.hero .now { min-width: 200px; }
.now .big {
  font-weight: 700;
  font-size: clamp(56px, 9vw, 80px); line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
.now .label { color: var(--ink-2); margin-top: 8px; font-size: 14.5px; }
.now .sub { color: var(--ink-3); font-size: 13px; margin-top: 4px; }
.pulse { flex: 1; min-width: 320px; }
.pulse-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.pulse-head .legend { color: var(--ink-3); font-size: 12.5px; }
.pulse-head .legend b { color: var(--ink); font-weight: 600; }

.statline {
  display: flex; gap: 0; margin-top: 34px; flex-wrap: wrap;
  border-top: 1.5px solid var(--ink); border-bottom: 1.5px solid var(--ink);
}
.stat { padding: 16px 32px 16px 0; margin-right: 32px; border-right: 1px solid var(--line-soft); }
.stat:last-child { border-right: none; margin-right: 0; }
.stat .n { font-size: 25px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
.stat .l {
  color: var(--ink-3); font-size: 11px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase; margin-top: 5px;
}

/* ---------- sections ---------- */
.section { margin-top: 44px; }
.section-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 16px; margin-bottom: 16px;
}
.section-head h2 { font-family: var(--font-display); font-size: 17px; font-weight: 600; letter-spacing: 0.01em; }
.section-head .hint { color: var(--ink-3); font-size: 12.5px; }

/* surface split */
.surfaceline { display: flex; height: 10px; overflow: hidden; background: var(--raised); border: 1px solid var(--line); }
.surfaceline div { height: 100%; transition: width .4s ease; }
.legend-row { display: flex; gap: 24px; margin-top: 12px; flex-wrap: wrap; }
.legend-row .item { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--ink-2); }
.legend-row .dot { width: 9px; height: 9px; }
.legend-row .n { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }

/* action weights */
.weights { display: flex; flex-direction: column; gap: 9px; }
.weight { display: grid; grid-template-columns: 150px 1fr 60px; gap: 14px; align-items: center; }
.weight .w-label { color: var(--ink-2); font-size: 13.5px; text-align: right; }
.weight .w-bar { height: 8px; background: var(--raised-2); overflow: hidden; border: 1px solid var(--line-soft); }
.weight .w-bar div { height: 100%; background: var(--ink); opacity: .8; }
.weight .w-n { font-size: 13px; color: var(--ink-2); text-align: left; font-variant-numeric: tabular-nums; }

/* ---------- table ---------- */
.tablewrap { overflow-x: auto; border: 1.5px solid var(--ink); border-radius: 2px; background: var(--paper); }
table { width: 100%; border-collapse: collapse; min-width: 760px; }
th {
  text-align: left; font-size: 11px; font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-2);
  padding: 11px 16px; border-bottom: 1.5px solid var(--ink);
  position: sticky; top: 0; background: var(--paper-2); white-space: nowrap;
}
th.num, td.num { text-align: right; }
td {
  padding: 11px 16px; border-bottom: 1px solid var(--line-soft);
  font-size: 14px; white-space: nowrap;
}
tbody tr { cursor: pointer; transition: background .12s; }
tbody tr:hover { background: var(--paper-3); }
tbody tr:last-child td { border-bottom: none; }
.who .name { font-weight: 600; }
.who .handle { color: var(--ink-3); font-size: 12.5px; }
td .surfn { display: inline-block; min-width: 30px; text-align: right; }
.rolls { color: var(--ink-2); }
.dim { color: var(--ink-3); }

.toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
.search {
  flex: 1; min-width: 220px; max-width: 380px;
  background: var(--paper-2); border: 1.5px solid var(--ink); border-radius: 2px;
  padding: 9px 14px; color: var(--ink); font-size: 14px;
}
.search::placeholder { color: var(--ink-4); }
.search:focus { outline: none; border-color: var(--red-ink); }
.search:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
.seg { display: flex; border: 1.5px solid var(--ink); border-radius: 2px; overflow: hidden; }
.seg button { padding: 8px 14px; font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.seg button:hover { color: var(--ink); }
.seg button[aria-selected="true"] { background: var(--ink); color: var(--paper-3); }
.seg-sm { display: inline-flex; }
.seg-sm button { padding: 5px 11px; font-size: 12px; }

/* ---------- live feed ---------- */
.feed { border: 1.5px solid var(--ink); border-radius: 2px; overflow: hidden; background: var(--paper); }
.feedrow {
  display: grid; grid-template-columns: 64px 1fr auto; gap: 14px; align-items: baseline;
  padding: 10px 16px; border-bottom: 1px solid var(--line-soft);
  animation: feedin .25s steps(4, end);
  transition: background .2s;
}
.feedrow:last-child { border-bottom: none; }
.feedrow .when { font-size: 12px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.feedrow .what { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.feedrow .what .detail { font-size: 12.5px; color: var(--ink-2); margin-left: 8px; font-variant-numeric: tabular-nums; }
.feedrow .surf { font-size: 12px; color: var(--ink-3); display: flex; align-items: center; gap: 6px; }
.sdot { width: 8px; height: 8px; display: inline-block; }
@keyframes feedin { from { opacity: 0; } to { opacity: 1; } }

.badge {
  display: inline-block; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  padding: 2px 8px; border-radius: 2px;
  background: var(--paper-2); color: var(--ink-2); margin-right: 8px;
  border: 1px solid var(--line-soft);
}

/* fresh row: the red pen just marked it */
.feedrow.fresh { background: rgba(183, 121, 31, 0.1); }
.feedrow.fresh .when { color: var(--amber-text); font-weight: 700; }

/* ---------- health ---------- */
.hrow { display: grid; grid-template-columns: 140px 1fr 150px; gap: 18px; align-items: center; padding: 14px 0; border-bottom: 1px solid var(--line-soft); }
.hrow:last-child { border-bottom: none; }
.hrow .hname { font-weight: 600; font-size: 14.5px; }
.ubars { display: flex; gap: 1.5px; align-items: flex-end; height: 30px; }
.ubars i { flex: 1; min-width: 2px; background: var(--green); opacity: .85; }
.ubars i.down { background: var(--red-ink); }
.ubars i.miss { background: var(--line-soft); }
.hstat { text-align: right; }
.hstat .pct { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.hstat .lat { color: var(--ink-3); font-size: 12px; }

/* ---------- drawer ---------- */
.scrim {
  position: fixed; inset: 0; background: rgba(20, 28, 36, 0.45);
  opacity: 0; pointer-events: none; transition: opacity .2s; z-index: 20;
}
.scrim.open { opacity: 1; pointer-events: auto; }
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0; width: min(430px, 94vw);
  background: var(--paper-3); border-left: 1.5px solid var(--ink);
  transform: translateX(102%); transition: transform .22s steps(6, end); z-index: 21;
  padding: 26px 26px 40px; overflow-y: auto;
}
.drawer.open { transform: none; }
.drawer .dhead { display: flex; justify-content: space-between; align-items: start; gap: 10px; }
.drawer h3 { font-family: var(--font-display); font-size: 20px; font-weight: 600; letter-spacing: 0.01em; }
.drawer .x { color: var(--ink-3); font-size: 20px; padding: 2px 8px; border-radius: 2px; }
.drawer .x:hover { color: var(--ink); background: var(--raised-2); }
.drawer .meta { color: var(--ink-3); font-size: 13px; margin-top: 3px; }
.dstats { display: flex; gap: 0; margin: 22px 0; border-top: 1.5px solid var(--ink); border-bottom: 1.5px solid var(--ink); }
.dstats .stat { padding: 14px 20px 14px 0; margin-right: 20px; }
.dstats .stat .n { font-size: 19px; }
.dmini { display: flex; gap: 2px; align-items: flex-end; height: 34px; margin: 8px 0 4px; }
.dmini i { flex: 1; background: var(--ink); opacity: .65; min-width: 2px; }
.drawer h4 {
  font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3); margin: 26px 0 10px;
}
.dfeed .feedrow { padding: 8px 0; border-bottom: 1px solid var(--line-soft); grid-template-columns: 58px 1fr; }
.dfeed .feedrow:last-child { border: none; }

/* ---------- login ---------- */
.login-wrap { min-height: calc(100vh - 58px); display: none; align-items: center; justify-content: center; padding: 24px; }
.login-wrap.show { display: flex; }
.login { width: 360px; max-width: 100%; border: 1.5px solid var(--ink); background: var(--paper-2); padding: 26px 24px 24px; }
.login .wordmark { font-size: 23px; margin-bottom: 6px; color: var(--ink); }
.login .wordmark span { color: var(--ink-3); }
.login p { color: var(--ink-2); font-size: 14px; margin-bottom: 22px; }
.login input {
  width: 100%; background: var(--paper); border: 1.5px solid var(--ink);
  border-radius: 2px; padding: 12px 15px; color: var(--ink); font-size: 15px;
}
.login input:focus { outline: none; border-color: var(--red-ink); }
.login input:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
.login button {
  width: 100%; margin-top: 12px; padding: 12px; border-radius: 2px;
  background: var(--ink); color: var(--paper-3); font-weight: 700; font-size: 15px;
  border: 1.5px solid var(--ink);
  transition: background .15s, border-color .15s;
}
.login button:hover { background: var(--cloth); border-color: var(--cloth); }
.login .err { color: var(--red-ink); font-size: 13.5px; margin-top: 12px; min-height: 20px; }

.empty { color: var(--ink-3); font-size: 14px; padding: 28px 4px; }

.live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); display: inline-block; margin-right: 7px; animation: blink 2.4s ease infinite; }
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* motion: one orchestrated entrance, view transitions, fresh-row cue */
@keyframes rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes viewfade { from { opacity: 0; } to { opacity: 1; } }
.reveal { animation: rise 0.34s steps(6, end) both; }
.reveal.d1 { animation-delay: 0.07s; }
.reveal.d2 { animation-delay: 0.14s; }
.reveal.d3 { animation-delay: 0.21s; }
.view.active { animation: viewfade 0.2s steps(4, end); }

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

/* issue reports */
.reports { display: flex; flex-direction: column; gap: 10px; }
.rrow {
  border: 1px solid var(--line);
  border-radius: 2px;
  background: var(--paper-2);
  padding: 14px 16px; transition: border-color .15s;
}
.rrow.open { border-color: var(--line-2); }
.rrow.answered { border-color: var(--amber); }
.rrow.resolved { border-color: var(--green); }
.rrow.resolved { opacity: .82; }
.rhead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.rid { font-size: 13px; color: var(--ink); font-weight: 700; letter-spacing: 0.06em; font-variant-numeric: tabular-nums; }
.rstatus { font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--ink-3); display: inline-flex; align-items: center; gap: 6px; }
.rstatus .dot { width: 8px; height: 8px; border-radius: 50%; }
.rstatus.open .dot { background: var(--ink-3); }
.rstatus.answered .dot { background: var(--amber); }
.rstatus.resolved .dot { background: var(--green); }
.rname { font-size: 13px; color: var(--ink-2); }
.rtime { font-size: 11px; color: var(--ink-4); margin-left: auto; font-variant-numeric: tabular-nums; }
.rmsg { margin-top: 8px; font-size: 13.5px; line-height: 1.55; color: var(--ink); white-space: pre-wrap; overflow-wrap: anywhere; }
.rreplyblock {
  margin-top: 10px; padding: 10px 12px;
  border-left: 1px solid var(--ink-3);
  background: rgba(30, 42, 56, 0.04);
  font-size: 13px; line-height: 1.5; color: var(--ink-2);
  font-style: italic;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.rreplyblock b { color: var(--ink-3); font-style: normal; font-weight: 700; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; display: block; margin-bottom: 3px; }
.rform { margin-top: 10px; display: none; gap: 8px; }
.rform.show { display: flex; }
.rform textarea {
  flex: 1; background: var(--paper-3); border: 1.5px solid var(--ink);
  border-radius: 2px; padding: 9px 12px; color: var(--ink);
  font-size: 13.5px; line-height: 1.5; resize: vertical;
  min-height: 60px;
}
.rform textarea:focus { outline: none; border-color: var(--red-ink); }
.rform textarea:focus-visible { outline: 2px solid var(--red); outline-offset: 2px; }
.rform .send {
  background: var(--ink); color: var(--paper-3); font-weight: 700; font-size: 13px;
  border: 1.5px solid var(--ink); border-radius: 2px; padding: 0 16px;
}
.rform .send:hover { background: var(--cloth); border-color: var(--cloth); }
.btn-ghost {
  font-size: 12.5px; font-weight: 600; color: var(--ink-2); border: 1.5px solid var(--ink);
  border-radius: 2px; padding: 6px 12px; background: var(--paper-2);
}
.btn-ghost:hover { color: var(--ink); background: var(--paper-3); }
.rbtns { margin-top: 10px; display: flex; gap: 8px; }
.rbtns button {
  font-size: 12px; font-weight: 600; border: 1.5px solid var(--ink); border-radius: 2px;
  padding: 5px 10px; color: var(--ink-2); background: var(--paper);
}
.rbtns button:hover { color: var(--ink); background: var(--paper-3); }
.rform + .rbtns { margin-top: 8px; }

/* a thread that moved on since it was last read */
.rrow.hasnew { border-color: var(--red); }
.rnew {
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--red-ink); border: 1.5px solid var(--red); border-radius: 1px;
  padding: 1px 6px; transform: rotate(-2deg); display: inline-block;
  font-variant-numeric: tabular-nums;
}
.rsum {
  margin-top: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--ink-3); font-variant-numeric: tabular-nums;
}
/* ---------- thread drawer ---------- */
.dthread {
  margin-top: 16px; border-top: 1.5px solid var(--ink);
}
.tmsg { padding: 12px 0 13px; border-bottom: 1px solid var(--line-soft); }
.tmsg.admin {
  padding: 12px 12px 13px 13px; border-left: 1.5px solid var(--ink);
  background: var(--paper-3);
}
.tmsg .tmeta {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font-size: 10.5px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3);
}
.tmsg.admin .tmeta b { color: var(--ink); }
.tmsg .tmeta span { font-weight: 500; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }
.tmsg .tbody {
  margin-top: 6px; font-size: 13.5px; line-height: 1.55; color: var(--ink);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
`;
