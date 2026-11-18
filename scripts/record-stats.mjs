#!/usr/bin/env node
/**
 * Records one daily usage snapshot from the public stats endpoint.
 *
 *   node scripts/record-stats.mjs
 *   node scripts/record-stats.mjs --url http://127.0.0.1:3000/api/stats --file /tmp/history.csv
 *
 * The endpoint is checked before anything is written: `generated_at` must be
 * a parseable ISO timestamp, the five counters must be non-negative safe
 * integers, and `uptime_90d` and `method` must be strings. A bad payload
 * exits nonzero and leaves the history untouched.
 *
 * The snapshot date is the first ten characters of `generated_at`. The API
 * emits IST (+05:30), so that is the local day the numbers describe. A row
 * for the same date replaces the old one; rows stay sorted by date. The file
 * is written through a temp file and rename so a failed run cannot truncate
 * the history.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const HEADER = "date,registered_users,dau,wau,mau,commands_7d";
const DEFAULT_URL = "https://checker.tobioffice.online/api/stats";
const DEFAULT_FILE = "stats/history.csv";

const die = (message) => {
  console.error(`[stats] ${message}`);
  process.exit(1);
};

const parseArgs = (argv) => {
  const args = { url: DEFAULT_URL, file: DEFAULT_FILE };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--url":
        args.url = argv[++i];
        if (!args.url) die("--url needs a value");
        break;
      case "--file":
        args.file = argv[++i];
        if (!args.file) die("--file needs a value");
        break;
      default:
        break;
    }
  }
  return args;
};

const isCount = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
};

/** Reads the existing history, refusing a file this script did not write. */
const readHistory = async (file) => {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    die(`cannot read ${file}: ${error?.message ?? error}`);
  }

  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return new Map();
  if (lines[0] !== HEADER) {
    die(`${file} has an unexpected header (expected "${HEADER}")`);
  }

  const rows = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length !== 6 || !isDate(cells[0])) {
      die(`${file} has a malformed row: ${line}`);
    }
    if (!cells.slice(1).every((cell) => /^\d+$/.test(cell))) {
      die(`${file} has a non-numeric count: ${line}`);
    }
    rows.set(cells[0], {
      date: cells[0],
      values: cells.slice(1),
    });
  }
  return rows;
};

const writeAtomic = async (file, text) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, file);
};

const args = parseArgs(process.argv.slice(2));

let response;
try {
  response = await fetch(args.url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
} catch (error) {
  die(`request to ${args.url} failed: ${error?.message ?? error}`);
}
if (!response.ok) {
  die(`${args.url} returned HTTP ${response.status} ${response.statusText}`);
}

let data;
try {
  data = await response.json();
} catch (error) {
  die(`${args.url} returned invalid JSON: ${error?.message ?? error}`);
}

const problems = [];
if (
  typeof data?.generated_at !== "string" ||
  !Number.isFinite(Date.parse(data.generated_at)) ||
  !isDate(data.generated_at.slice(0, 10))
) {
  problems.push("generated_at must be a parseable ISO-ish timestamp");
}
for (const field of [
  "registered_users",
  "dau",
  "wau",
  "mau",
  "commands_7d",
]) {
  if (!isCount(data?.[field])) {
    problems.push(`${field} must be a non-negative safe integer`);
  }
}
for (const field of ["uptime_90d", "method"]) {
  if (typeof data?.[field] !== "string") {
    problems.push(`${field} must be a string`);
  }
}
if (problems.length > 0) {
  die(`bad payload from ${args.url}: ${problems.join("; ")}`);
}

const date = data.generated_at.slice(0, 10);
const rows = await readHistory(args.file);
rows.set(date, {
  date,
  values: [
    data.registered_users,
    data.dau,
    data.wau,
    data.mau,
    data.commands_7d,
  ].map(String),
});

const ordered = [...rows.values()].sort((a, b) =>
  a.date.localeCompare(b.date),
);
const csv = `${[HEADER, ...ordered.map((row) => [row.date, ...row.values].join(","))].join("\n")}\n`;
await writeAtomic(args.file, csv);

console.log(
  `${date} registered_users=${data.registered_users} dau=${data.dau} wau=${data.wau} mau=${data.mau} commands_7d=${data.commands_7d}`,
);
