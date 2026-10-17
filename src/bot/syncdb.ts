/**
 * /syncdb — one-command semester rollover (admin only).
 *
 * What it does (replaces the manual NbkristDB workflow):
 *  1. Logs into the college site (reuses bot credentials + session token trick)
 *  2. Fetches attendanceTillADate.php and auto-detects:
 *     - current academic year (site defaults the dropdown to it)
 *     - valid yearSem values (only semesters that exist in the dropdown)
 *  3. Scrapes every year x branch x section combo via attendanceTillTodayReport.php
 *  4. Extracts roll numbers per section, fetches each student's name
 *  5. Upserts studentsnew (roll_no PK) — new sections, new 1st-years, re-sectioned students
 *  6. Flushes stale student/attendance/midmarks caches so the bot serves fresh data
 *
 * Admin flow: /setsem 1         -> set current semester type (1st sems: 11/21/31/41)
 *             /setsem 2         -> 2nd sems: 12/22/32/42 (persisted, survives restarts)
 *             /syncdb           -> syncs using stored semester (all 8 if never set)
 *             /syncdb 1         -> sets sem AND syncs
 *             /syncdb 2025-26   -> explicit year override
 *             /syncdb 1 2025-26 -> both
 */
import { bot } from "./bot.js";
import { ADMIN_ID, N_USERNAME, N_PASSWORD } from "../config/environmentals.js";
import { BASE_URL, BRANCHES } from "../constants/index.js";
import { makeSessionToken } from "../services/student.utils/portalSession.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys, cacheFlushPatterns } from "../services/redis/keys.js";
import { turso } from "../db/db.js";
import { buildStudentRow, StudentRow } from "../db/student.model.js";
import { logger } from "../config/logger.js";
import * as cheerio from "cheerio";
import axios from "axios";

const LOGIN_URL = `${BASE_URL}/attendance/attendanceLogin.php`;
const REPORT_URL = `${BASE_URL}/attendance/attendanceTillTodayReport.php`;
const PAGE_URL = `${BASE_URL}/attendance/attendanceTillADate.php`;
const NAME_URL = `${BASE_URL}/attendance/getStudentName.php?q=`;

const SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "-"];

// How many concurrent portal requests per phase. Serial +120ms sleeps take
// tens of minutes for ~400 combos; a small pool keeps the same per-worker
// politeness delay while cutting wall time ~3x.
const CONCURRENCY = 3;

interface SyncProgress {
  /** Telegram message to edit; absent when run from the CLI. */
  chatId?: number;
  msgId?: number;
  lines: string[];
  updated: number;
  upsertFailed: number;
  inserted: number;
  total: number;
}

interface SyncContext {
  sessionToken: string;
  acadYear: string;
  yearSems: string[];
  students: Map<string, StudentRow>;
  p: SyncProgress;
  /** Custom progress sink (CLI). When absent, the Telegram message is edited. */
  onProgress?: (p: SyncProgress) => void | Promise<void>;
}

export interface SyncRunResult {
  lines: string[];
  students: number;
  updated: number;
  upsertFailed: number;
  perYear: string;
}

export interface SyncRunOptions {
  /** "1" (11/21/31/41), "2" (12/22/32/42) or null for all 8 sessions. */
  semType?: string | null;
  /** Explicit academic year like "2025-26"; auto-detected when omitted. */
  yearArg?: string;
  /** Reuse an existing progress record (the Telegram handler shows one). */
  p?: SyncProgress;
  /** Where progress lines go; defaults to editing the Telegram message. */
  onProgress?: (p: SyncProgress) => void | Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function editProgress(p: SyncProgress) {
  if (!p.chatId || !p.msgId) return; // CLI run — no Telegram message to edit
  try {
    await bot.editMessageText(
      `<b>🔄 Semester Sync in progress...</b>\n\n${p.lines.join("\n")}`,
      { chat_id: p.chatId, message_id: p.msgId, parse_mode: "HTML" },
    );
  } catch {
    /* edit race — ignore */
  }
}

/** Report progress: the given sink (CLI) or the Telegram message. Never throws. */
async function reportProgress(ctx: SyncContext): Promise<void> {
  if (ctx.onProgress) {
    try {
      await ctx.onProgress(ctx.p);
    } catch {
      /* progress must never break the sync */
    }
    return;
  }
  await editProgress(ctx.p);
}

// ---------- phase 1: login ----------
async function loginToPortal(): Promise<string> {
  const sessionToken = makeSessionToken();
  await axios.post(
    LOGIN_URL,
    `username=${N_USERNAME}&password=${N_PASSWORD}&captcha=`,
    {
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `PHPSESSID=${sessionToken}`,
        referer: `${BASE_URL}/attendance/attendanceLogin.php`,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
      },
      maxRedirects: 0,
      timeout: 15000,
      validateStatus: (s) => s >= 200 && s < 303,
    },
  );
  return sessionToken;
}

// ---------- phase 2: detect academic year + sessions ----------
async function detectSessions(
  sessionToken: string,
  yearArg: string | undefined,
  semType: string | null,
): Promise<{ acadYear: string; yearSems: string[] }> {
  const pageRes = await axios.get(PAGE_URL, {
    headers: { cookie: `PHPSESSID=${sessionToken}` },
    timeout: 15000,
  });
  const $page = cheerio.load(pageRes.data);

  // acadYear: last option in dropdown = current (site lists ascending, echoes current)
  const yearOptions = $page('select[name="acadYear"] option')
    .map((_, el) => $page(el).attr("value"))
    .get();
  const acadYear = yearArg || yearOptions[yearOptions.length - 1] || "";

  // yearSem: from the dropdown (11-42). Filter by semester type if set.
  // Scanning only the active semester type = 4 sessions instead of 8 = 2x faster.
  const allYearSems = $page('select[name="yearSem"] option')
    .map((_, el) => $page(el).attr("value"))
    .get()
    .filter((v) => /^[1-4][12]$/.test(v || ""));

  const yearSems = semType
    ? allYearSems.filter((v) => v.endsWith(semType))
    : allYearSems;

  return { acadYear, yearSems };
}

// ---------- phase 3: scrape every year x branch x section combo ----------
// portal's login page coming back mid-sync means credentials/session died;
// surfaced so it aborts the sync instead of counting as "combo not offered"
const isLogin = (html: string) => html.includes("name='username'");

async function scrapeCombos(ctx: SyncContext): Promise<void> {
  const { p, sessionToken, acadYear, yearSems, students } = ctx;
  const branchIds = Object.keys(BRANCHES);

  const combos: Array<{ yearSem: string; branch: string; section: string }> =
    [];
  for (const yearSem of yearSems) {
    for (const branch of branchIds) {
      for (const section of SECTIONS) {
        combos.push({ yearSem, branch, section });
      }
    }
  }
  p.total = combos.length;

  let valid = 0;
  let failed = 0;
  let done = 0;
  let authLost = false;
  let lastEdit = Date.now();
  let next = 0;

  const scanWorker = async () => {
    while (!authLost) {
      const idx = next++;
      if (idx >= combos.length) return;
      const { yearSem, branch, section } = combos[idx];
      done++;
      try {
        const res = await axios.post(
          REPORT_URL,
          new URLSearchParams({
            acadYear,
            yearSem,
            branch,
            section,
            dateOfAttendance: "01-01-2030",
          }).toString(),
          {
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              cookie: `PHPSESSID=${sessionToken}`,
              origin: BASE_URL,
              referer: PAGE_URL,
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
            },
            timeout: 30000,
          },
        );

        if (isLogin(res.data)) {
          authLost = true;
          throw new Error(
            "Portal session expired mid-sync (login page returned)",
          );
        }

        if (!res.data.includes("<td>1.</td>")) continue; // no class here
        valid++;

        const $ = cheerio.load(res.data);
        // The canonical roll is the row's id ("26KB101001"): the roll cell's
        // own id is "td" + roll ("td26KB101001") and its text can carry a
        // display space ("26KB1010 01"). Reading only the cell id and trimming
        // a single character used to leave a stray "d" — which uppercased into
        // a bogus leading "D" ("D26KB101001") that no student ever types, so
        // every lookup failed. Prefer the row id, then the cell id without its
        // "td" prefix, then the cell text without spaces.
        const looksLikeRoll = (s: string): boolean =>
          /^[A-Za-z0-9]{6,16}$/.test(s);
        const rolls = $("td.tdRollNo")
          .map((_, el) => {
            const rowRoll = ($(el).closest("tr").attr("id") || "").trim();
            const cellId = ($(el).attr("id") || "").replace(/^td/i, "").trim();
            const cellText = ($(el).text() || "").replace(/\s+/g, "");
            return (
              [rowRoll, cellId, cellText].find((c) => c && looksLikeRoll(c)) ||
              ""
            );
          })
          .get()
          .filter(Boolean);

        for (const roll of rolls) {
          const key = roll.toUpperCase();
          if (!students.has(key)) {
            students.set(key, buildStudentRow(yearSem, branch, section, roll));
          }
        }
      } catch (e) {
        if (authLost) throw e; // abort — Promise.all rethrows below
        failed++;
        logger.debug(
          `[syncdb] combo ${yearSem}/${branch}/${section} skipped:`,
          e,
        );
      }

      await sleep(120); // polite to college server

      // live progress edit at most every 5s
      if (Date.now() - lastEdit > 5000) {
        lastEdit = Date.now();
        p.lines[2] = `🔍 Scanned ${done}/${combos.length}, ${valid} classes found, ${students.size} students`;
        await reportProgress(ctx);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, () => scanWorker()));
  } catch (e) {
    if (authLost) throw e;
    logger.error("[syncdb] scan worker error:", e);
  }

  if (authLost) {
    throw new Error(
      "College portal session expired mid-sync. Run /syncdb again",
    );
  }

  p.lines.push(
    `🔍 Scanned ${done}/${combos.length}, ${valid} classes, ${failed} skipped, ${students.size} students`,
  );
  await reportProgress(ctx);
}

// ---------- phase 4: fetch each student's name ----------
async function fetchStudentNames(ctx: SyncContext): Promise<void> {
  const { students, p } = ctx;
  const pending = [...students.values()].filter((row) => !row.name);
  let nameFetched = 0;
  let next = 0;

  const nameWorker = async () => {
    while (next < pending.length) {
      const row = pending[next++];
      try {
        const res = await axios.get(`${NAME_URL}${row.roll_no}`, {
          timeout: 10000,
        });
        row.name = res.data
          ? String(res.data).split("\n")[0].trim() || null
          : null;
        if (row.name) nameFetched++;
      } catch {
        row.name = null;
      }
      await sleep(60);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, () => nameWorker()));

  p.lines.push(`👤 Names fetched for ${nameFetched}/${students.size}`);
  await reportProgress(ctx);
}

// ---------- phase 5: upsert studentsnew ----------
async function upsertStudents(ctx: SyncContext): Promise<void> {
  const { students, p } = ctx;
  const rows = [...students.values()];
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    await Promise.all(
      batch.map((row) =>
        turso
          .execute({
            sql: `INSERT INTO studentsnew (roll_no, name, section, branch, year)
                  VALUES (?, ?, ?, ?, ?)
                  ON CONFLICT(roll_no) DO UPDATE SET
                    section = excluded.section,
                    branch = excluded.branch,
                    year = excluded.year,
                    name = COALESCE(excluded.name, studentsnew.name)`,
            args: [row.roll_no, row.name, row.section, row.branch, row.year],
          })
          .then(() => {
            p.updated++;
          })
          .catch((e) => {
            p.upsertFailed++;
            logger.error(`[syncdb] upsert failed for ${row.roll_no}:`, e);
          }),
      ),
    );
  }

  p.lines.push(
    p.upsertFailed > 0
      ? `💾 Upserted ${p.updated}/${rows.length} students, ${p.upsertFailed} FAILED (rerun /syncdb)`
      : `💾 Upserted ${rows.length} students (sections + year updated)`,
  );
  await reportProgress(ctx);
}

// ---------- phase 6: flush stale caches ----------
async function flushCaches(ctx: SyncContext): Promise<void> {
  const { p } = ctx;
  const redis = await getClient();
  const patterns = cacheFlushPatterns;
  for (const pattern of patterns) {
    let cursor = "0";
    do {
      const { cursor: nextCursor, keys } = await redis.scan(cursor, {
        COUNT: 500,
        MATCH: pattern,
      });
      cursor = nextCursor;
      if (keys.length) await redis.del(keys);
    } while (cursor !== "0");
  }
  p.lines.push(`🗑️ Cache flushed (student/attendance/midmarks/leaderboard)`);
}

/**
 * Run a full semester sync: log in, detect the sessions, scrape every
 * year x branch x section, fetch names, upsert `studentsnew`, flush caches.
 *
 * Shared by the /syncdb command and the CLI (dist/bot/syncdbCli.js) so both
 * paths behave identically — the bot can be re-synced without Telegram.
 */
export async function runSyncDb(
  opts: SyncRunOptions = {},
): Promise<SyncRunResult> {
  const p: SyncProgress = opts.p ?? {
    lines: [],
    updated: 0,
    upsertFailed: 0,
    inserted: 0,
    total: 0,
  };

  const sessionToken = await loginToPortal();
  p.lines.push("✅ Logged in");

  const ctx: SyncContext = {
    sessionToken,
    acadYear: "",
    yearSems: [],
    students: new Map(),
    p,
    onProgress: opts.onProgress,
  };
  await reportProgress(ctx);

  const detected = await detectSessions(
    sessionToken,
    opts.yearArg,
    opts.semType ?? null,
  );
  ctx.acadYear = detected.acadYear;
  ctx.yearSems = detected.yearSems;

  if (ctx.yearSems.length === 0) {
    throw new Error(
      `No matching sessions found for semester type ${opts.semType}. Check /setsem.`,
    );
  }

  p.lines.push(`📅 Academic year: <b>${ctx.acadYear}</b>`);
  p.lines.push(`📚 Sessions to scan: ${ctx.yearSems.join(", ")}`);
  await reportProgress(ctx);

  await scrapeCombos(ctx);
  await fetchStudentNames(ctx);
  await upsertStudents(ctx);
  await flushCaches(ctx);

  const yearCounts = new Map<string, number>();
  for (const row of ctx.students.values()) {
    yearCounts.set(row.year, (yearCounts.get(row.year) || 0) + 1);
  }
  const perYear = [...yearCounts.entries()]
    .map(([y, n]) => `${y}: ${n}`)
    .join(" | ");

  return {
    lines: p.lines,
    students: ctx.students.size,
    updated: p.updated,
    upsertFailed: p.upsertFailed,
    perYear,
  };
}

export const registerSyncDbCommand = () => {
  // ---------- /setsem 1|2 ----------
  bot.onText(/\/setsem ?([12])?$/, async (msg, match) => {
    if (msg.from?.id !== ADMIN_ID) return;
    const chatId = msg.chat.id;
    const redis = await getClient();

    const current = await redis.get(redisKeys.syncSemType);
    const arg = match?.[1];

    if (!arg) {
      await bot.sendMessage(
        chatId,
        `Semester setting: <b>${current === "2" ? "2nd semester (12/22/32/42)" : current === "1" ? "1st semester (11/21/31/41)" : "not set, syncdb scans all 8 sessions"}</b>\n\n` +
          `Set it with:\n<code>/setsem 1</code> for odd semesters (11/21/31/41)\n<code>/setsem 2</code> for even semesters (12/22/32/42)\n\n` +
          `The college site can't tell us which semester is running, so set this once at semester start, then <code>/syncdb</code> just works.`,
        { parse_mode: "HTML" },
      );
      return;
    }

    await redis.set(redisKeys.syncSemType, arg);
    const label =
      arg === "1" ? "1st semester (11/21/31/41)" : "2nd semester (12/22/32/42)";
    await bot.sendMessage(
      chatId,
      `✅ Semester set to <b>${label}</b>.\n\nRun <code>/syncdb</code> to pull the new sections.`,
    );
  });

  // ---------- /syncdb ----------
  bot.onText(/\/syncdb( .+)?$/, async (msg, match) => {
    if (msg.from?.id !== ADMIN_ID) return;

    const chatId = msg.chat.id;
    const argStr = (match?.[1] || "").trim();
    // accept: "1", "2", "2025-26", "1 2025-26", "2 2025-26", "" (use stored)
    const semArg = argStr.match(/^([12])\b/)?.[1];
    const yearArg = argStr.match(/(\d{4}-\d{2})/)?.[1];

    const redis = await getClient();
    const storedSem = await redis.get(redisKeys.syncSemType);
    const semType = semArg || storedSem || null; // "1" | "2" | null(all)

    // persist if provided explicitly
    if (semArg && semArg !== storedSem) {
      await redis.set(redisKeys.syncSemType, semArg);
    }

    const semLabel =
      semType === "1"
        ? "1st sems (11/21/31/41)"
        : semType === "2"
          ? "2nd sems (12/22/32/42)"
          : "all 8 sessions";

    const progress = await bot.sendMessage(
      chatId,
      `🔄 <b>Sync started...</b>\nSemester mode: <b>${semLabel}</b>\nLogging into college portal...`,
      { parse_mode: "HTML" },
    );

    const p: SyncProgress = {
      chatId,
      msgId: progress.message_id,
      lines: [],
      updated: 0,
      upsertFailed: 0,
      inserted: 0,
      total: 0,
    };

    try {
      const res = await runSyncDb({
        semType,
        yearArg,
        p,
        onProgress: editProgress,
      });

      await bot.editMessageText(
        `✅ <b>Sync complete!</b>\n\n` +
          res.lines.join("\n") +
          `\n\n📊 <b>Per-session students:</b>\n<code>${res.perYear}</code>\n\n` +
          `<i>Bot is now serving updated sections. Students get their new sections on next check.</i>`,
        {
          chat_id: chatId,
          message_id: progress.message_id,
          parse_mode: "HTML",
        },
      );
    } catch (e: unknown) {
      const err = e as Error;
      logger.error("[syncdb] error:", e instanceof Error ? e.message : e);
      bot
        .sendMessage(chatId, `❌ Sync failed: ${err?.message || e}`)
        .catch(() => {});
    }
  });
};
