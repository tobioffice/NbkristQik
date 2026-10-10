// Extracted from the admin panel HTML — composed in ../adminPanel.ts.
export const panelCss = `:root {
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

/* issue reports */
.reports { display: flex; flex-direction: column; gap: 10px; }
.rrow {
  border: 1px solid var(--line); border-radius: 12px;
  background: var(--raised);
  padding: 14px 16px; transition: border-color .15s;
}
.rrow.open { border-color: rgba(148, 163, 184, 0.25); }
.rrow.answered { border-color: rgba(251, 191, 36, 0.28); }
.rrow.resolved { border-color: rgba(52, 211, 153, 0.25); }
.rrow.resolved { opacity: .82; }
.rhead { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.rid { font-family: var(--mono); font-size: 13px; color: var(--text); font-weight: 500; letter-spacing: -0.01em; }
.rstatus { font-family: var(--mono); font-size: 11.5px; color: var(--text-3); display: inline-flex; align-items: center; gap: 6px; }
.rstatus .dot { width: 7px; height: 7px; border-radius: 50%; }
.rstatus.open .dot { background: var(--text-3); }
.rstatus.answered .dot { background: var(--amber); }
.rstatus.resolved .dot { background: var(--green); }
.rname { font-size: 13px; color: var(--text-2); }
.rtime { font-family: var(--mono); font-size: 11px; color: var(--text-4); margin-left: auto; }
.rmsg { margin-top: 8px; font-size: 13.5px; line-height: 1.55; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.rreplyblock {
  margin-top: 10px; padding: 10px 12px;
  border-left: 2px solid rgba(167, 139, 250, .5);
  background: rgba(167, 139, 250, .06); border-radius: 6px;
  font-size: 13px; line-height: 1.5; color: var(--text-2);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.rreplyblock b { color: var(--violet); font-weight: 500; font-family: var(--mono); font-size: 11px; display: block; margin-bottom: 3px; }
.rform { margin-top: 10px; display: none; gap: 8px; }
.rform.show { display: flex; }
.rform textarea {
  flex: 1; background: var(--raised-2); border: 1px solid var(--line);
  border-radius: 9px; padding: 9px 12px; color: var(--text);
  font: inherit; font-size: 13.5px; line-height: 1.5; resize: vertical;
  min-height: 60px;
}
.rform textarea:focus { outline: none; border-color: rgba(34, 211, 238, 0.4); }
.rform .send {
  background: var(--cyan); color: #0f1014; font-weight: 600; font-size: 13px;
  border-radius: 9px; padding: 0 16px;
}
.btn-ghost {
  font-size: 12.5px; color: var(--text-3); border: 1px solid var(--line);
  border-radius: 8px; padding: 5px 12px;
}
.btn-ghost:hover { color: var(--text); }
.rbtns { margin-top: 10px; display: flex; gap: 8px; }
.rbtns button {
  font-size: 12px; border: 1px solid var(--line); border-radius: 8px;
  padding: 4px 10px; color: var(--text-2);
}
.rbtns button:hover { color: var(--text); border-color: var(--line-2, rgba(148,163,184,.3)); }
.rform + .rbtns { margin-top: 8px; }
`;
