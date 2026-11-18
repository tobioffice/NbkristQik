#!/usr/bin/env node
/**
 * Renders the daily stats history as a standalone SVG chart.
 *
 *   node scripts/render-stats-chart.mjs
 *   node scripts/render-stats-chart.mjs --file /tmp/history.csv --out /tmp/history.svg
 *
 * The chart follows the paper register palette: manila ground, ink figures,
 * a cloth-green series, red for daily activity and amber for the week. It is
 * self-contained (system fonts only, no external links), responsive through
 * its viewBox, and readable with a single day as well as a long history.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const WIDTH = 960;
const HEIGHT = 420;

const PALETTE = {
  paper: "#e7dcc3",
  ink: "#1e2a38",
  softInk: "#5a5140",
  cloth: "#3f6457",
  red: "#a62f22",
  amber: "#8a6a12",
};

const LEFT = 70;
const RIGHT = 926;
const TOP = 132;
const BOTTOM = 360;
const PLOT_WIDTH = RIGHT - LEFT;
const PLOT_HEIGHT = BOTTOM - TOP;

const SERIES = [
  { key: "registered_users", label: "registered users", color: PALETTE.ink },
  { key: "dau", label: "daily active", color: PALETTE.red },
  { key: "wau", label: "weekly active", color: PALETTE.amber },
  {
    key: "mau",
    label: "monthly active",
    color: PALETTE.cloth,
    dash: "5 3",
  },
];

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const die = (message) => {
  console.error(`[stats-chart] ${message}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = { file: "stats/history.csv", out: "stats/history.svg" };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--file":
        args.file = argv[++i];
        if (!args.file) die("--file needs a value");
        break;
      case "--out":
        args.out = argv[++i];
        if (!args.out) die("--out needs a value");
        break;
      default:
        break;
    }
  }
  return args;
};

const isDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });

const formatCount = (value) =>
  String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const formatDate = (isoDate) => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
};

const round = (value) => Math.round(value * 10) / 10;

/** A rounded maximum and an integer step that yield four or five gridlines. */
const niceScale = (maximum) => {
  if (!(maximum > 0)) return { max: 4, step: 1 };

  const rough = maximum / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const factor =
    normalized <= 1
      ? 1
      : normalized <= 2
        ? 2
        : normalized <= 2.5
          ? 2.5
          : normalized <= 5
            ? 5
            : 10;
  const step = Math.max(1, Math.ceil(factor * magnitude));
  let max = Math.ceil(maximum / step) * step;
  while (max / step < 3) max += step;
  return { max, step };
};

const readCsv = async (file) => {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    die(`cannot read ${file}: ${error?.message ?? error}`);
  }

  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) die(`${file} is empty`);

  const header = lines[0].split(",").map((cell) => cell.trim());
  const column = new Map(header.map((name, index) => [name, index]));
  const required = ["date", ...SERIES.map((series) => series.key)];
  const missing = required.filter((name) => !column.has(name));
  if (missing.length > 0) {
    die(`${file} is missing column(s): ${missing.join(", ")}`);
  }

  const rows = [];
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const cells = line.split(",").map((cell) => cell.trim());
    const date = cells[column.get("date")];
    if (!isDate(date)) {
      die(`${file} has a malformed date on line ${index + 1}: ${line}`);
    }

    const row = { date };
    for (const series of SERIES) {
      const raw = cells[column.get(series.key)];
      if (!/^\d+$/.test(raw ?? "")) {
        die(`${file} has a non-numeric ${series.key} on line ${index + 1}`);
      }
      const value = Number(raw);
      if (!Number.isSafeInteger(value)) {
        die(`${file} has an unsafe ${series.key} on line ${index + 1}`);
      }
      row[series.key] = value;
    }
    rows.push(row);
  }

  if (rows.length === 0) die(`${file} has no data rows`);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
};

const writeAtomic = async (file, text) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
};

const args = parseArgs(process.argv.slice(2));
const rows = await readCsv(args.file);

const maximum = Math.max(
  ...rows.flatMap((row) => SERIES.map((series) => row[series.key])),
);
const { max, step } = niceScale(maximum);
const ticks = Array.from(
  { length: max / step + 1 },
  (_, index) => index * step,
);

const xAt = (index) =>
  rows.length === 1
    ? (LEFT + RIGHT) / 2
    : LEFT + (index / (rows.length - 1)) * PLOT_WIDTH;
const yAt = (value) => TOP + (1 - value / max) * PLOT_HEIGHT;

const labelled = new Set(
  rows.length <= 2
    ? rows.map((_, index) => index)
    : [0, Math.floor(rows.length / 2), rows.length - 1],
);

const grid = ticks
  .map((value) => {
    const y = round(yAt(value));
    return `<line x1="${LEFT}" y1="${y}" x2="${RIGHT}" y2="${y}" stroke="${PALETTE.ink}" stroke-opacity="${value === 0 ? 0.45 : 0.14}" />
      <text x="${LEFT - 12}" y="${y + 4}" text-anchor="end" class="axis">${formatCount(value)}</text>`;
  })
  .join("\n      ");

const xLabels = rows
  .map((row, index) => {
    if (!labelled.has(index)) return "";
    const anchor =
      rows.length === 1
        ? "middle"
        : index === 0
          ? "start"
          : index === rows.length - 1
            ? "end"
            : "middle";
    return `<text x="${round(xAt(index))}" y="384" text-anchor="${anchor}" class="axis">${escapeXml(formatDate(row.date))}</text>`;
  })
  .filter(Boolean)
  .join("\n      ");

const lines = SERIES.map((series) => {
  const pathData = rows
    .map((row, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${round(xAt(index))} ${round(yAt(row[series.key]))}`;
    })
    .join(" ");
  return `<path class="series" data-series="${series.key}" d="${pathData}" stroke="${series.color}"${series.dash ? ` stroke-dasharray="${series.dash}"` : ""} />`;
}).join("\n      ");

const markers =
  rows.length === 1
    ? SERIES.map((series, index) => {
        const radius = 4.5 - index * 0.7;
        return `<circle class="series-point" data-series="${series.key}" cx="${round(xAt(0))}" cy="${round(yAt(rows[0][series.key]))}" r="${round(radius)}" fill="${series.color}" />`;
      }).join("\n      ")
    : "";

const legend = SERIES.map((series, index) => {
  const x = [44, 250, 430, 610][index];
  return `<g data-series="${series.key}">
        <line x1="${x}" y1="101" x2="${x + 22}" y2="101" stroke="${series.color}" stroke-width="2.5" stroke-linecap="round"${series.dash ? ` stroke-dasharray="${series.dash}"` : ""} />
        <text x="${x + 30}" y="105" class="legend">${escapeXml(series.label)}</text>
      </g>`;
}).join("\n      ");

const firstDate = formatDate(rows[0].date);
const lastDate = formatDate(rows[rows.length - 1].date);
const span =
  rows.length === 1
    ? `the single snapshot on ${firstDate}`
    : `${rows.length} daily snapshots from ${firstDate} to ${lastDate}`;

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" role="img" aria-labelledby="chart-title chart-desc" style="display:block;width:100%;height:auto;max-width:${WIDTH}px">
  <title id="chart-title">NbkristQik usage</title>
  <desc id="chart-desc">Line chart of registered_users, dau, wau and mau across ${escapeXml(span)}. Daily snapshots at 23:30 IST; aggregates only.</desc>
  <style>
    text {
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .axis {
      fill: ${PALETTE.softInk};
      font-size: 11.5px;
      font-variant-numeric: tabular-nums;
    }
    .legend {
      fill: ${PALETTE.ink};
      font-size: 12px;
    }
    .series {
      fill: none;
      stroke-width: 2;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .series-point {
      stroke: ${PALETTE.paper};
      stroke-width: 1;
    }
  </style>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PALETTE.paper}" />
  <rect width="${WIDTH}" height="6" fill="${PALETTE.cloth}" />
  <text x="44" y="50" fill="${PALETTE.ink}" font-size="27" font-weight="600" letter-spacing="-0.02em">NbkristQik usage</text>
  <text x="44" y="74" fill="${PALETTE.softInk}" font-size="13">Daily snapshots, 23:30 IST · aggregates only</text>
  <g>
      ${legend}
  </g>
  <line x1="44" y1="116" x2="${RIGHT}" y2="116" stroke="${PALETTE.ink}" stroke-opacity="0.18" />
  <g>
      ${grid}
  </g>
  <g>
      ${lines}
      ${markers}
  </g>
  <g>
      ${xLabels}
  </g>
</svg>
`;

await writeAtomic(args.out, svg);

console.log(
  `[stats-chart] ${rows.length} row${rows.length === 1 ? "" : "s"} -> ${args.out}`,
);
