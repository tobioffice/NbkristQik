/**
 * The attendance widget: one HTML document drawn inside a Telegram message.
 *
 * The code is fixed when the widget is sent; only `chat_data` changes. The
 * bot builds the state from the same portal data as the text card, and the
 * widget redraws the facts, meter and table on every `chatDataChanged`.
 */

export interface WidgetLine {
  label: string;
  value: string;
}

export interface WidgetTable {
  headers: string[];
  rows: string[][];
}

export interface WidgetMeter {
  value: number;
  threshold: number;
}

export interface WidgetState {
  v: 1;
  kind?: "att" | "mid" | "bunk";
  loading?: string;
  error?: string;
  note?: string;
  lines?: WidgetLine[];
  meter?: WidgetMeter;
  headline?: string;
  table?: WidgetTable;
  warning?: string;
  footer?: string;
  notice?: string;
}

export interface WidgetCard {
  state: WidgetState;
  /** The short caption, and the fallback for clients without widgets. */
  caption: string;
}

/** Telegram rejects a chat state above 1024 UTF-8 bytes. */
export const WIDGET_STATE_LIMIT = 1024;

export const widgetStateJson = (state: WidgetState): string =>
  JSON.stringify(state);

export const widgetFits = (state: WidgetState): boolean =>
  Buffer.byteLength(widgetStateJson(state), "utf8") <= WIDGET_STATE_LIMIT;

/** The card kind stored in a widget's state, for the text-card fallback. */
export const widgetKind = (
  chatData: string | null | undefined,
): "att" | "mid" | "bunk" => {
  try {
    const state = JSON.parse(chatData ?? "{}") as Partial<WidgetState>;
    return state.kind === "mid" || state.kind === "bunk" ? state.kind : "att";
  } catch {
    return "att";
  }
};

/**
 * The widget document. It uses the chat's theme variables, so light and dark
 * clients both get the native bubble colours. The only fixed colours are the
 * green safe meter and the red 75% line.
 */
export const WIDGET_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    padding: 12px 14px;
    color: var(--tg-theme-text-color);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 15px;
    line-height: 1.42;
    overflow: hidden;
  }
  .facts { display: grid; gap: 1px; margin-bottom: 14px; }
  .fact { display: flex; align-items: baseline; gap: 8px; }
  .fact .k { color: var(--tg-theme-hint-color); min-width: 76px; }
  .fact b { color: var(--tg-theme-text-color); font-weight: 600; font-variant-numeric: tabular-nums; }
  .bar-block { margin: 0 0 16px; }
  .track { position: relative; height: 8px; border-radius: 999px; background: rgba(128,128,128,0.22); }
  .fill {
    position: absolute; top: 0; bottom: 0; left: 0;
    border-radius: 999px;
    background: linear-gradient(90deg, #2fb95a 0%, #63d98a 100%);
    transition: width 0.35s ease;
  }
  .fill::after {
    content: ""; position: absolute; top: 0; bottom: 0; right: 0; width: 10px;
    border-radius: 999px; background: rgba(255,255,255,0.15);
  }
  .tick {
    position: absolute; top: -3px; bottom: -3px; width: 1px;
    background: var(--tg-theme-destructive-text-color);
  }
  .tick-label {
    position: absolute; top: 13px; transform: translateX(-50%);
    color: var(--tg-theme-destructive-text-color);
    font-size: 9px; line-height: 1; white-space: nowrap;
  }
  .scale { position: relative; height: 13px; margin-top: 9px; font-size: 9px; line-height: 1; color: var(--tg-theme-hint-color); }
  .scale .lo { position: absolute; left: 0; }
  .scale .hi { position: absolute; right: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 1.25; }
  th {
    padding: 0 0 7px; text-align: left; font-weight: 500;
    color: var(--tg-theme-hint-color); font-size: 11px;
  }
  td {
    padding: 7px 0; border-top: 1px solid var(--tg-theme-section-separator-color, rgba(128,128,128,0.2));
    color: var(--tg-theme-text-color); font-variant-numeric: tabular-nums;
  }
  th.r, td.r { text-align: right; }
  td.subject { font-weight: 500; }
  td.now { font-weight: 600; }
  td.low { color: var(--tg-theme-destructive-text-color); }
  td.last { color: var(--tg-theme-hint-color); font-size: 12px; }
  .headline { margin: 0 0 10px; font-size: 14px; font-weight: 600; line-height: 1.35; }
  .warning { margin: 13px 0 0; color: var(--tg-theme-destructive-text-color); font-size: 13px; line-height: 1.35; }
  .safe { margin: 6px 0 0; color: var(--tg-theme-hint-color); font-size: 12px; line-height: 1.35; }
  .stamp { margin-top: 10px; color: var(--tg-theme-hint-color); font-size: 11px; line-height: 1; }
  .loading { display: flex; align-items: center; gap: 10px; padding: 16px 2px; color: var(--tg-theme-hint-color); font-size: 14px; }
  .spinner {
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid rgba(128,128,128,0.3); border-top-color: var(--tg-theme-link-color);
    animation: spin 0.8s linear infinite;
  }
  .error { padding: 4px 0; color: var(--tg-theme-destructive-text-color); font-size: 13px; line-height: 1.4; }
  .note { margin: 0 0 12px; padding: 7px 9px; border-radius: 7px; background: rgba(128,128,128,0.12); color: var(--tg-theme-text-color); font-size: 12px; line-height: 1.35; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: none; }
    .fill { transition: none; }
  }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function () {
  var root = document.getElementById("root");
  var W = typeof TelegramWidget !== "undefined" ? TelegramWidget : null;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function facts(lines) {
    if (!lines || !lines.length) return "";
    return '<div class="facts">' + lines.map(function (line) {
      return '<div class="fact"><span class="k">' + esc(line.label) + '</span><b>' + esc(line.value) + '</b></div>';
    }).join("") + '</div>';
  }

  function meter(spec) {
    if (!spec) return "";
    var value = Number(spec.value);
    var threshold = Number(spec.threshold);
    if (!isFinite(value)) value = 0;
    if (!isFinite(threshold)) threshold = 75;
    value = Math.max(0, Math.min(100, value));
    threshold = Math.max(0, Math.min(100, threshold));
    return '<div class="bar-block">' +
      '<div class="track"><div class="fill" style="width:' + value + '%"></div>' +
      '<div class="tick" style="left:' + threshold + '%"></div></div>' +
      '<div class="scale"><span class="lo">0</span>' +
      '<span class="tick-label" style="left:' + threshold + '%">' + threshold + '%</span>' +
      '<span class="hi">100</span></div></div>';
  }

  function table(spec, lowForNow) {
    if (!spec || !spec.rows || !spec.rows.length) return "";
    var head = spec.headers.map(function (label, index) {
      return '<th class="' + (index === 0 ? "" : "r") + '">' + esc(label) + '</th>';
    }).join("");
    var body = spec.rows.map(function (row) {
      return "<tr>" + row.map(function (cell, index) {
        var low = lowForNow && spec.headers[index] === "Now" && /%$/.test(cell) && parseFloat(cell) < 75;
        var cls = (index === 0 ? "subject" : "r") + (low ? " low" : "") + (spec.headers[index] === "Last" ? " last" : "");
        return '<td class="' + cls + '">' + esc(cell) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    return "<table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table>";
  }

  function render() {
    var state = {};
    try { state = JSON.parse((W && W.chatData) || "{}"); } catch (e) { state = {}; }

    if (state.loading) {
      root.innerHTML = '<div class="loading"><span class="spinner"></span>' + esc(state.loading) + "</div>";
      return;
    }
    if (state.error) {
      root.innerHTML = '<div class="error">' + esc(state.error) + "</div>";
      return;
    }

    var html = "";
    if (state.note) html += '<p class="note">' + esc(state.note) + "</p>";
    html += facts(state.lines) + meter(state.meter);
    if (state.headline) html += '<p class="headline">' + esc(state.headline) + "</p>";
    html += table(state.table, state.kind === "att");
    if (state.warning) html += '<p class="warning">' + esc(state.warning) + "</p>";
    if (state.footer) html += '<p class="safe">' + esc(state.footer) + "</p>";
    if (state.notice) html += '<div class="stamp">' + esc(state.notice) + "</div>";
    root.innerHTML = html;
  }

  render();
  if (W) {
    W.onEvent("chatDataChanged", render);
    if (W.ready) W.ready();
  }
})();
</script>
</body>
</html>`;

/** The widget document size Telegram enforces before compression. */
export const WIDGET_HTML_LIMIT = 32768;
