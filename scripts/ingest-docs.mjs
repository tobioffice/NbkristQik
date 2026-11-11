#!/usr/bin/env node
/**
 * Ingests the NbkristQik-docs corpus into the library.
 *
 *   node scripts/ingest-docs.mjs --docs ~/Projects/NbkristQik-docs
 *   node scripts/ingest-docs.mjs --docs ~/Projects/NbkristQik-docs --run --only CN,SE
 *
 *   # plan here, run on the box that holds the library data
 *   node scripts/ingest-docs.mjs --plan /tmp/library-plan.json
 *   node /tmp/ingest-docs.mjs --app /home/ubuntu/nbkristqik --run-plan /tmp/library-plan.json --run
 *
 * The corpus repo holds one folder per subject (`CSE/<SUBJECT>/final/
 * UNIT-<n>-retypeset.pdf`). This script turns that tree into library rows:
 * it reads the folder's subject code from `queue.json` (or the map below for
 * the folders that predate the code column), checks the code against the
 * committed catalogue snapshot, and derives the department, regulation and
 * year-sem the students are keyed by. Each unit then goes through the
 * ordinary ingest CLI, which copies the PDF, renders the vector pages and
 * writes the row.
 *
 * Mapping: a document is cut once and read by every branch whose catalogue
 * list carries its code. The row's `dept` is the department the corpus was
 * built for (CSE), not a fence: entitlement joins on the code, so IT, AIDS,
 * CSE(DS) and CSE(AIML) students see the same paper at the same semester.
 *
 * Dry run is the default. `--run` executes. `--force` re-ingests even when
 * the source bytes on disk are identical.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Subject folders whose queue entry has no `code` column: they were cut
 * before the queue carried one. The codes are the college's own R23 codes
 * (CSE/_syllabi), the same ones the catalogue snapshot lists.
 */
const LEGACY_CODES = {
  ADSAA: "23CS21T1",
  AI: "23CS31T1",
  ATCD: "23CS31T3",
  CN: "23CS31T2",
  DBMS: "23AD22T1",
  OS: "23CS22T1",
};

const ROMAN = ["I", "II", "III", "IV", "V"];

const parseArgs = (argv) => {
  const args = {
    docs: null,
    app: null,
    run: false,
    force: false,
    only: [],
    plan: null,
    runPlan: null,
    jobs: 1,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    switch (key) {
      case "--docs":
        args.docs = argv[++i];
        break;
      case "--app":
        args.app = argv[++i];
        break;
      case "--run":
        args.run = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "--only":
        args.only = String(argv[++i] ?? "")
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean);
        break;
      case "--plan":
        args.plan = argv[++i];
        break;
      case "--run-plan":
        args.runPlan = argv[++i];
        break;
      case "--jobs":
        args.jobs = Math.max(1, Number(argv[++i]) || 1);
        break;
      default:
        break;
    }
  }
  return args;
};

const args = parseArgs(process.argv.slice(2));
const appRoot = path.resolve(
  args.app ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
);
const docsRoot = path.resolve(
  args.docs ?? path.join(homedir(), "Projects", "NbkristQik-docs"),
);
const catalogPath = path.join(appRoot, "data", "syllabus-catalog.json");
const dataDir = process.env.LIBRARY_DATA_DIR || path.join(appRoot, "data");

const die = (message) => {
  console.error(`[docs-ingest] ${message}`);
  process.exit(1);
};

/** Marks each planned document against the copy already on this box. */
const markCurrent = (plan) =>
  plan.map((item) => {
    const installed = path.join(dataDir, "docs", `${item.id}.pdf`);
    return {
      ...item,
      unchanged:
        existsSync(installed) &&
        existsSync(item.file) &&
        statSync(installed).size === statSync(item.file).size,
    };
  });

/**
 * One entry per unit PDF in the corpus, with the code the catalogue places
 * for it. `skipped` carries the folders that could not be resolved, so the
 * admin sees a subject disappear rather than guessing.
 */
const planFromCorpus = () => {
  if (!existsSync(docsRoot)) die(`no docs checkout at ${docsRoot}`);
  if (!existsSync(catalogPath)) die(`no catalogue snapshot at ${catalogPath}`);

  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const codeIndex = new Map();
  for (const [dept, byReg] of Object.entries(catalog.departments ?? {})) {
    for (const [regulation, bySem] of Object.entries(byReg)) {
      for (const [yearSem, lists] of Object.entries(bySem)) {
        for (const subject of lists.core ?? []) {
          const code = String(subject.code).toUpperCase();
          if (!codeIndex.has(code)) codeIndex.set(code, []);
          codeIndex.get(code).push({ dept, regulation, yearSem, name: subject.name });
        }
      }
    }
  }

  const queuePath = path.join(docsRoot, "queue.json");
  const queueCodes = new Map();
  if (existsSync(queuePath)) {
    const queue = JSON.parse(readFileSync(queuePath, "utf8"));
    for (const task of queue.tasks ?? []) {
      if (task.subject && task.code) {
        queueCodes.set(String(task.subject).toUpperCase(), String(task.code).toUpperCase());
      }
    }
  }

  const subjectsDir = path.join(docsRoot, "CSE");
  if (!existsSync(subjectsDir)) die(`the corpus has no CSE folder at ${subjectsDir}`);

  const plan = [];
  const skipped = [];

  for (const entry of readdirSync(subjectsDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) continue;

    const subject = entry.name.toUpperCase();
    if (args.only.length && !args.only.includes(subject)) continue;

    const code = queueCodes.get(subject) ?? LEGACY_CODES[subject];
    if (!code) {
      skipped.push({ subject, reason: "no subject code in queue.json and no legacy mapping" });
      continue;
    }

    const placements = codeIndex.get(code) ?? [];
    if (!placements.length) {
      skipped.push({ subject, code, reason: "code is not in the catalogue snapshot" });
      continue;
    }
    // the corpus is CSE R23; another department's semester is a fact about
    // that department's list, so prefer CSE, then any R23 entry
    const placement =
      placements.find((p) => p.dept === "CSE" && p.regulation === "R23") ??
      placements.find((p) => p.regulation === "R23") ??
      placements[0];

    const finalDir = path.join(subjectsDir, entry.name, "final");
    if (!existsSync(finalDir)) {
      skipped.push({ subject, code, reason: "no final/ folder" });
      continue;
    }

    for (const unit of ROMAN) {
      const file = path.join(finalDir, `UNIT-${unit}-retypeset.pdf`);
      if (!existsSync(file)) continue;
      plan.push({
        subject,
        code,
        unit,
        id: `${code}-u${unit.toLowerCase()}`,
        title: placement.name,
        dept: placement.dept,
        regulation: placement.regulation,
        yearSem: placement.yearSem,
        file,
        bytes: statSync(file).size,
      });
    }
  }

  return { plan: markCurrent(plan), skipped };
};

/** A plan written by `--plan`; paths are taken as the box they will run on. */
const planFromFile = () => {
  if (!existsSync(args.runPlan)) die(`no plan at ${args.runPlan}`);
  const saved = JSON.parse(readFileSync(args.runPlan, "utf8"));
  return { plan: markCurrent(saved.documents ?? []), skipped: saved.skipped ?? [] };
};

const { plan, skipped } = args.runPlan ? planFromFile() : planFromCorpus();
if (!plan.length && !skipped.length) {
  die(`no documents in ${args.runPlan ?? docsRoot}`);
}

const pending = plan.filter((item) => args.force || !item.unchanged);
console.log(
  `[docs-ingest] ${new Set(plan.map((item) => item.subject)).size} subjects, ${plan.length} units, ` +
    `${pending.length} to ingest, ${plan.length - pending.length} already current`,
);

if (args.plan) {
  writeFileSync(
    args.plan,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), documents: plan, skipped },
      null,
      2,
    ),
  );
  console.log(`[docs-ingest] plan written to ${args.plan}`);
}

for (const item of skipped) {
  console.log(
    `[docs-ingest] skipped ${item.subject}: ${item.reason}${item.code ? ` (${item.code})` : ""}`,
  );
}

if (!args.run) {
  for (const item of pending) {
    console.log(
      `  ${item.id.padEnd(14)} ${String(item.unit).padEnd(3)} ${item.dept} ${item.regulation} ${item.yearSem}  ` +
        `${String(Math.round(item.bytes / 1024)).padStart(5)} KB  ${item.title}`,
    );
  }
  console.log("[docs-ingest] dry run: pass --run to ingest");
  process.exit(0);
}

const ingestCli = path.join(appRoot, "dist", "tools", "ingestLibrary.js");
if (!existsSync(ingestCli)) {
  die(`no built ingest CLI at ${ingestCli}: run the TypeScript build first`);
}

let done = 0;
let failed = 0;
const failures = [];

const ingestOne = async (item) => {
  const argv = [
    ingestCli,
    "--file",
    item.file,
    "--code",
    item.code,
    "--dept",
    item.dept,
    "--year-sem",
    item.yearSem,
    "--regulation",
    item.regulation,
    "--unit",
    item.unit,
    "--kind",
    "material",
    "--title",
    item.title,
  ];
  try {
    const { stdout, stderr } = await run(process.execPath, argv, {
      cwd: appRoot,
      env: process.env,
      maxBuffer: 4 << 20,
    });
    const line =
      `${stdout}${stderr}`.split("\n").find((l) => l.includes("is live")) ?? "";
    done += 1;
    console.log(
      `[docs-ingest] ${String(done + failed).padStart(3)} ${item.id} ${line.replace(/^.*\[ingest\] /, "")}`.trimEnd(),
    );
  } catch (error) {
    failed += 1;
    const message = String(error?.stderr || error?.message || error).trim();
    failures.push({ id: item.id, message });
    console.error(
      `[docs-ingest] FAILED ${item.id}: ${message.split("\n").slice(-2).join(" ")}`,
    );
  }
};

const queue = [...pending];
await Promise.all(
  Array.from({ length: Math.min(args.jobs, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await ingestOne(item);
    }
  }),
);

console.log(
  `[docs-ingest] done: ${done} ingested, ${failed} failed, ${plan.length - pending.length} already current`,
);
process.exit(failed ? 1 : 0);
