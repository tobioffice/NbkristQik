/**
 * Merge a Turso export into the bot's local database.
 *
 *   node scripts/import-turso-snapshot.mjs /path/to/alex-xha.db
 *
 * How to get the export (Turso reads must be unblocked first — either the
 * monthly quota reset, or overages enabled, since `turso db export` reads
 * through the same quota):
 *
 *   turso db export <database> --output-file /home/ubuntu/turso-export.db --overwrite
 *
 * Merge policy, per table:
 *
 *   reports, report_messages   copied verbatim, but ONLY while the local
 *                              table is still empty — the local ids are an
 *                              AUTOINCREMENT sequence, so the old QIK-####
 *                              ids would collide with newly created reports
 *                              if we merged after new ones existed. If the
 *                              table is no longer empty the script refuses
 *                              and prints what to do instead.
 *   report_reads               INSERT OR IGNORE on (report_id, reader).
 *   registrations              INSERT OR IGNORE on userId — a local row
 *                              (newer) always wins.
 *   tgusers                    INSERT OR IGNORE on userId.
 *   botusers                   INSERT OR IGNORE on user_id.
 *   uptime_log                 rows whose (component, created_at) already
 *                              exist are skipped; ids are reassigned.
 *   student_stats, admin_sessions, activity_log
 *                              deliberately NOT merged: stats are rebuilt
 *                              locally as students use the bot (the Turso
 *                              copy may still carry the old bogus "D…"
 *                              roll numbers), sessions are ephemeral, and
 *                              the activity log is the bulk of the export.
 *
 * Safe to re-run: every statement is idempotent.
 */
import { createClient } from "@libsql/client";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error(
    "usage: node scripts/import-turso-snapshot.mjs <turso-export.db>",
  );
  process.exit(1);
}

const LOCAL_URL =
  process.env.LOCAL_DB_URL || "file:/home/ubuntu/nbkristqik/data/qik.db";

const local = createClient({ url: LOCAL_URL });
const source = createClient({ url: `file:${sourcePath}` });

const rows = async (client, sql, args = []) =>
  (await client.execute({ sql, args })).rows;

const count = async (client, table) =>
  Number((await rows(client, `SELECT COUNT(*) AS n FROM ${table}`))[0].n);

const columnsOf = async (client, table) =>
  (await rows(client, `PRAGMA table_info(${table})`)).map((c) => c.name);

const PLAN = [
  { table: "reports", mode: "onlyIfEmpty" },
  { table: "report_messages", mode: "onlyIfEmpty" },
  { table: "report_reads", mode: "ignore" },
  { table: "registrations", mode: "ignore" },
  { table: "tgusers", mode: "ignore" },
  { table: "botusers", mode: "ignore" },
  { table: "uptime_log", mode: "naturalKey", key: ["component", "created_at"] },
];

const copyVerbatim = async (table) => {
  const cols = await columnsOf(source, table);
  const placeholders = cols.map(() => "?").join(", ");
  const list = cols.join(", ");

  const all = await rows(source, `SELECT ${list} FROM ${table}`);
  let done = 0;
  for (const row of all) {
    const args = cols.map((c) => row[c] ?? null);
    await local.execute({
      sql: `INSERT OR IGNORE INTO ${table} (${list}) VALUES (${placeholders})`,
      args,
    });
    done++;
  }
  return { read: all.length, written: done };
};

const copyNaturalKey = async (table, key) => {
  const cols = await columnsOf(source, table);
  const insertCols = cols.filter((c) => c !== "id");
  const list = insertCols.join(", ");
  const placeholders = insertCols.map(() => "?").join(", ");
  const exists = key.map((k) => `${k} = ?`).join(" AND ");

  const all = await rows(source, `SELECT ${list} FROM ${table}`);
  let written = 0;
  for (const row of all) {
    const args = insertCols.map((c) => row[c] ?? null);
    const res = await local.execute({
      sql: `INSERT INTO ${table} (${list}) SELECT ${placeholders} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${exists})`,
      args: [...args, ...key.map((k) => row[k])],
    });
    written += Number(res.rowsAffected ?? 0);
  }
  return { read: all.length, written };
};

let failures = 0;
for (const step of PLAN) {
  const { table } = step;
  try {
    const srcCount = await count(source, table);
    const before = await count(local, table);

    if (step.mode === "onlyIfEmpty" && before > 0) {
      console.log(
        `SKIP  ${table.padEnd(17)} local already has ${before} rows — merging now would collide ids.`,
      );
      console.log(
        `      Keep this export; merge while the table is empty, or renumber with an offset.`,
      );
      failures++;
      continue;
    }

    const res =
      step.mode === "naturalKey"
        ? await copyNaturalKey(table, step.key)
        : await copyVerbatim(table);

    const after = await count(local, table);
    console.log(
      `OK    ${table.padEnd(17)} source=${String(srcCount).padStart(5)}  local ${before} -> ${after}  (+${after - before})`,
    );
  } catch (e) {
    failures++;
    console.log(
      `FAIL  ${table.padEnd(17)} ${String(e.message ?? e).slice(0, 90)}`,
    );
  }
}

console.log(
  failures === 0
    ? "\nMerge complete."
    : `\nMerge finished with ${failures} table(s) skipped or failed.`,
);
process.exit(failures === 0 ? 0 : 1);
