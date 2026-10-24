#!/usr/bin/env node
/**
 * Refreshes the syllabus catalogue snapshot.
 *
 *   node dist/tools/syncSyllabusCatalog.js               # every department
 *   node dist/tools/syncSyllabusCatalog.js CSE ECE       # only these
 *
 * Fetches the college's own syllabus pages, parses them into
 * data/syllabus-catalog.json, and prints what landed. The snapshot is
 * committed to the repo: the request path never touches the college site.
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { buildCatalog } from "../services/library/syllabusParser.js";
import { logger } from "../config/logger.js";

/** The department folders the college site serves. */
const SITE_DEPTS = [
  "CSE",
  "ECE",
  "EEE",
  "IT",
  "ME",
  "CE",
  "AIDS",
  "CSE(DS)",
  "CSE(AIML)",
];

const OUT_PATH =
  process.env.LIBRARY_CATALOG_PATH?.trim() ||
  path.resolve(process.cwd(), "data", "syllabus-catalog.json");

const fetchPage = async (dept: string): Promise<string | null> => {
  const url = `https://at.nbkrist.org/Syllabi/showSyllabi.php?dept=${encodeURIComponent(dept)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "NbkristQik catalogue sync" },
    });
    if (!res.ok) {
      logger.warn(`[catalogue] ${dept}: HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    logger.warn(`[catalogue] ${dept}: fetch failed`, e);
    return null;
  }
};

const main = async () => {
  const wanted =
    process.argv.slice(2).filter((a) => !a.startsWith("-")).length > 0
      ? process.argv.slice(2).filter((a) => !a.startsWith("-"))
      : SITE_DEPTS;

  const pages: { dept: string; html: string }[] = [];
  for (const dept of wanted) {
    const html = await fetchPage(dept);
    if (!html) continue;
    pages.push({ dept, html });
    logger.info(`[catalogue] ${dept}: fetched ${html.length} bytes`);
  }

  const { catalog, skipped, empty } = buildCatalog(
    pages,
    new Date().toISOString(),
  );

  for (const [dept, regs] of Object.entries(catalog.departments)) {
    const counts = Object.entries(regs).map(
      ([reg, yearSems]) => `${reg}:${Object.keys(yearSems).length} year-sems`,
    );
    logger.info(`[catalogue] ${dept} → ${counts.join(", ")}`);
  }

  if (empty.length)
    logger.warn(`[catalogue] no subjects parsed: ${empty.join(", ")}`);
  if (skipped)
    logger.warn(`[catalogue] ${skipped} links had no usable subject code`);

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  logger.info(`[catalogue] written ${OUT_PATH}`);
};

main().catch((e) => {
  logger.error("[catalogue] sync failed:", e);
  process.exitCode = 1;
});
