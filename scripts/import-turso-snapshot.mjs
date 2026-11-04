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
 *                              table is no longer empty the script reports it
 *                              and exits nonzero.
 *   report_reads               INSERT OR IGNORE on (report_id, reader).
 *   registrations              INSERT OR IGNORE on userId — a local row
 *                              (newer) always wins.
 *   tgusers                    INSERT OR IGNORE on userId.
 *   botusers                   INSERT OR IGNORE on user_id.
 *   studentsnew                INSERT OR IGNORE on roll_no — the local master
 *                              (refreshed by /syncdb after cutover) wins, and
 *                              missing students are filled in from the export.
 *   student_stats              INSERT OR IGNORE on roll_no — locally rebuilt
 *                              stats win. Old Turso copies may still carry the
 *                              bogus "D…" rolls; the leaderboard's INNER JOIN
 *                              on studentsnew keeps them off the board.
 *   library_documents          INSERT OR IGNORE on id — local edits win.
 *   library_reads              copied verbatim, but ONLY while the local table
 *                              is empty: ids are AUTOINCREMENT, so importing
 *                              after new reads exist would collide. On a
 *                              repeated run the local watermark/takedown trail
 *                              is kept and the table is skipped (not a failure).
 *   uptime_log                 rows whose (component, created_at) already
 *                              exist are skipped; ids are reassigned.
 *   admin_sessions, activity_log
 *                              deliberately NOT merged: sessions are
 *                              ephemeral and the activity log is the bulk of
 *                              the export (the external monitor writes its own).
 *
 * A table that is absent from the source export (e.g. an old export made
 * before the library tables existed) is skipped with a message; it does not
 * fail the whole import.
 *
 * Every statement is idempotent. Tables whose ids are an AUTOINCREMENT
 * sequence (reports, report_messages, library_reads) are copied only while
 * locally empty: a later run reports them instead of renumbering. For
 * library_reads the newer local trail wins, so that skip is not a failure.
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

const tableExists = async (client, table) =>
  (
    await rows(
      client,
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
      [table],
    )
  ).length > 0;

const PLAN = [
  { table: "reports", mode: "onlyIfEmpty" },
  { table: "report_messages", mode: "onlyIfEmpty" },
  { table: "report_reads", mode: "ignore" },
  { table: "registrations", mode: "ignore" },
  { table: "tgusers", mode: "ignore" },
  { table: "botusers", mode: "ignore" },
  // student master + leaderboard stats: local rows are newer after cutover
  { table: "studentsnew", mode: "ignore" },
  { table: "student_stats", mode: "ignore" },
  // library registry survives by id; reads are an append-only audit trail and
  // may only be imported before the local table starts collecting new reads
  { table: "library_documents", mode: "ignore" },
  { table: "library_reads", mode: "onlyIfEmpty", optional: true },
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
let skipped = 0;
for (const step of PLAN) {
  const { table } = step;
  try {
    if (!(await tableExists(source, table))) {
      skipped++;
      console.log(
        `SKIP  ${table.padEnd(17)} not present in the source export — continuing.`,
      );
      continue;
    }

    const srcCount = await count(source, table);
    const before = await count(local, table);

    if (step.mode === "onlyIfEmpty" && before > 0) {
      if (step.optional) {
        skipped++;
        console.log(
          `SKIP  ${table.padEnd(17)} local already has ${before} rows — keeping the local trail (import ids would collide).`,
        );
        continue;
      }
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

const skippedNote =
  skipped > 0 ? ` (${skipped} table(s) skipped, see above)` : "";
console.log(
  failures === 0
    ? `\nMerge complete${skippedNote}.`
    : `\nMerge finished with ${failures} table(s) skipped or failed${skippedNote}.`,
);
process.exit(failures === 0 ? 0 : 1);
