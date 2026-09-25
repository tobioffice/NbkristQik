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
import crypto from "crypto";
import { bot } from "./bot.js";
import { ADMIN_ID, N_USERNAME, N_PASSWORD } from "../config/environmentals.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { turso } from "../db/db.js";
import { buildStudentRow, StudentRow } from "../db/student.model.js";
import * as cheerio from "cheerio";
import axios from "axios";

const BASE = "http://103.203.175.91";
const LOGIN_URL = `${BASE}/attendance/attendanceLogin.php`;
const REPORT_URL = `${BASE}/attendance/attendanceTillTodayReport.php`;
const PAGE_URL = `${BASE}/attendance/attendanceTillADate.php`;
const NAME_URL = `${BASE}/attendance/getStudentName.php?q=`;

const BRANCHES: Record<string, string> = {
   "5": "CSE", "23": "AIDS", "7": "MECH", "4": "ECE", "2": "EEE",
   "11": "CIV", "22": "IT", "32": "CSE_DS", "33": "CSE_AIML",
};

interface SyncProgress {
   chatId: number;
   msgId: number;
   lines: string[];
   updated: number;
   inserted: number;
   total: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function editProgress(p: SyncProgress) {
   try {
      await bot.editMessageText(
         `<b>🔄 Semester Sync in progress...</b>\n\n${p.lines.join("\n")}`,
         { chat_id: p.chatId, message_id: p.msgId, parse_mode: "HTML" }
      );
   } catch {
      /* edit race — ignore */
   }
}

export const registerSyncDbCommand = () => {
   // ---------- /setsem 1|2 ----------
   bot.onText(/\/setsem ?([12])?$/, async (msg, match) => {
      if (msg.from?.id !== ADMIN_ID) return;
      const chatId = msg.chat.id;
      const redis = await getClient();

      const current = await redis.get("sync:semType");
      const arg = match?.[1];

      if (!arg) {
         await bot.sendMessage(
            chatId,
            `Current semester setting: <b>${current === "2" ? "2nd semester (12/22/32/42)" : current === "1" ? "1st semester (11/21/31/41)" : "not set — syncdb scans all 8 sessions"}</b>\n\n` +
               `Set it with:\n<code>/setsem 1</code> — odd semesters (11/21/31/41)\n<code>/setsem 2</code> — even semesters (12/22/32/42)\n\n` +
               `The college site can't tell us which semester is running, so set this once at semester start, then <code>/syncdb</code> just works.`,
            { parse_mode: "HTML" }
         );
         return;
      }

      await redis.set("sync:semType", arg);
      const label = arg === "1" ? "1st semester (11/21/31/41)" : "2nd semester (12/22/32/42)";
      await bot.sendMessage(
         chatId,
         `✅ Semester set to <b>${label}</b>.\n\nRun <code>/syncdb</code> to pull the new sections.`
      );
   });

   // ---------- /syncdb ----------
   bot.onText(/\/syncdb( .+)?$/, async (msg, match) => {
      if (msg.from?.id !== ADMIN_ID) return;

      const chatId = msg.chat.id;
      const argStr = (match?.[1] || "").trim();
      // accept: "1", "2", "2025-26", "1 2025-26", "2 2025-26", "" (use stored)
      const semMatch = argStr.match(/^([12])\b/);
      const yearMatch = argStr.match(/(\d{4}-\d{2})/);
      const semArg = semMatch?.[1];
      const yearArg = yearMatch?.[1];

      const redis = await getClient();
      const storedSem = await redis.get("sync:semType");
      const semType = semArg || storedSem || null; // "1" | "2" | null(all)

      // persist if provided explicitly
      if (semArg && semArg !== storedSem) {
         await redis.set("sync:semType", semArg);
      }

      const semLabel =
         semType === "1" ? "1st sems (11/21/31/41)" : semType === "2" ? "2nd sems (12/22/32/42)" : "all 8 sessions";

      const progress = await bot.sendMessage(
         chatId,
         `🔄 <b>Sync started...</b>\nSemester mode: <b>${semLabel}</b>\nLogging into college portal...`,
         { parse_mode: "HTML" }
      );

      const p: SyncProgress = { chatId, msgId: progress.message_id, lines: [], updated: 0, inserted: 0, total: 0 };

      try {
         // ---------- 1. LOGIN ----------
         const sessionToken = `ggpmgfj8dssskkp2q2h6db${crypto.randomBytes(3).toString("hex")}0`;
         await axios.post(
            LOGIN_URL,
            `username=${N_USERNAME}&password=${N_PASSWORD}&captcha=`,
            {
               headers: {
                  "content-type": "application/x-www-form-urlencoded",
                  cookie: `PHPSESSID=${sessionToken}`,
                  referer: `${BASE}/attendance/attendanceLogin.php`,
                  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
               },
               maxRedirects: 0,
               timeout: 15000,
               validateStatus: (s) => s >= 200 && s < 303,
            }
         );
         p.lines.push("✅ Logged in");
         await editProgress(p);

         // ---------- 2. DETECT ACADEMIC YEAR ----------
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

         if (yearSems.length === 0) {
            await bot.editMessageText(
               `❌ No matching sessions found for semester type <b>${semType}</b>. Check /setsem.`,
               { chat_id: p.chatId, message_id: p.msgId, parse_mode: "HTML" }
            );
            return;
         }

         p.lines.push(`📅 Academic year: <b>${acadYear}</b>`);
         p.lines.push(`📚 Sessions to scan: ${yearSems.join(", ")}`);
         await editProgress(p);

         // ---------- 3. SCRAPE ALL COMBOS ----------
         const branchIds = Object.keys(BRANCHES);
         const sections = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "-"];

          const students = new Map<string, StudentRow>();

         const combos: Array<{ yearSem: string; branch: string; section: string }> = [];
         for (const yearSem of yearSems) {
            for (const branch of branchIds) {
               for (const section of sections) {
                  combos.push({ yearSem, branch, section });
               }
            }
         }
         p.total = combos.length;

         let valid = 0;
         let done = 0;
         let lastEdit = Date.now();

         for (const { yearSem, branch, section } of combos) {
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
                        origin: BASE,
                        referer: PAGE_URL,
                        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
                     },
                     timeout: 30000,
                  }
               );

               if (!res.data.includes("<td>1.</td>")) continue; // no class here
               valid++;

               const $ = cheerio.load(res.data);
               const rolls = $("td.tdRollNo")
                  .map((_, el) => $(el).attr("id"))
                  .get()
                  .map((id) => (id || "").replace(/^./, ""))
                  .filter(Boolean);

                for (const roll of rolls) {
                   const key = roll.toUpperCase();
                   if (!students.has(key)) {
                      students.set(key, buildStudentRow(yearSem, branch, section, roll));
                   }
                }
            } catch {
               /* combo not offered — skip */
            }

            // live progress edit every ~10 combos or 5s
            if (done % 10 === 0 || done === combos.length) {
               if (Date.now() - lastEdit > 5000) {
                  lastEdit = Date.now();
                  p.lines[2] = `🔍 Scanned ${done}/${combos.length} — ${valid} classes found, ${students.size} students`;
                  await editProgress(p);
               }
            }

            await sleep(120); // polite to college server
         }

         p.lines.push(`🔍 Scanned ${done}/${combos.length} — ${valid} classes, ${students.size} students`);
         await editProgress(p);

         // ---------- 4. FETCH NAMES + UPSERT ----------
         let nameFetched = 0;
         for (const [key, row] of students) {
            if (!row.name) {
               try {
                  const res = await axios.get(`${NAME_URL}${key}`, { timeout: 10000 });
                  row.name = res.data ? String(res.data).split("\n")[0].trim() || null : null;
                  nameFetched++;
               } catch {
                  row.name = null;
               }
               await sleep(60);
            }
         }
         p.lines.push(`👤 Names fetched for ${nameFetched}/${students.size}`);
         await editProgress(p);

         // upsert in batches
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
                     .catch(() => {})
               )
            );
         }

         p.lines.push(`💾 Upserted ${rows.length} students (sections + year updated)`);
         await editProgress(p);

         // ---------- 5. FLUSH CACHES ----------
         const redis = await getClient();
         const patterns = ["student:*", "attendance:*", "midmarks:*", "lb:*"];
         for (const pattern of patterns) {
            let cursor = "0";
            do {
               const { cursor: next, keys } = await redis.scan(cursor as any, {
                  COUNT: 500,
                  MATCH: pattern,
               } as any);
               cursor = next;
               if (keys.length) await redis.del(keys);
            } while (cursor !== "0");
         }
         p.lines.push(`🗑️ Cache flushed (student/attendance/midmarks/leaderboard)`);

         // summary
         const yearCounts = new Map<string, number>();
         for (const row of rows) {
            const y = row.year;
            yearCounts.set(y, (yearCounts.get(y) || 0) + 1);
         }
         const summary = [...yearCounts.entries()].map(([y, n]) => `${y}: ${n}`).join(" | ");

         await bot.editMessageText(
            `✅ <b>Sync complete!</b>\n\n` +
               p.lines.join("\n") +
               `\n\n📊 <b>Per-session students:</b>\n<code>${summary}</code>\n\n` +
               `<i>Bot is now serving updated sections. Students get their new sections on next check.</i>`,
            { chat_id: p.chatId, message_id: p.msgId, parse_mode: "HTML" }
         );
      } catch (e: any) {
         console.error("[syncdb] error:", e);
         bot.sendMessage(
            chatId,
            `❌ Sync failed: ${e?.message || e}\n\nCheck bot logs: ssh oracle3 'sudo journalctl -u nbkristqik -n 30'`
         ).catch(() => {});
      }
   });
};