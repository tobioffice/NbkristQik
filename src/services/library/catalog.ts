import { existsSync, readFileSync } from "fs";
import path from "path";
import { logger } from "../../config/logger.js";
import type { CatalogSubject, SyllabusCatalog } from "./types.js";

/**
 * Reads the syllabus catalogue snapshot and answers the two questions the
 * library asks: "which regulation is this student under" and "which subjects
 * does this student have".
 *
 * The snapshot is a committed file (data/syllabus-catalog.json), refreshed by
 * `node dist/tools/syncSyllabusCatalog.js`. Nothing in a request path ever
 * touches the college site.
 */

const CATALOG_PATH =
  process.env.LIBRARY_CATALOG_PATH?.trim() ||
  path.resolve(process.cwd(), "data", "syllabus-catalog.json");

let cached: SyllabusCatalog | null = null;
let loaded = false;

export const catalogPath = (): string => CATALOG_PATH;

export const loadCatalog = (): SyllabusCatalog | null => {
  if (loaded) return cached;
  loaded = true;

  try {
    if (!existsSync(CATALOG_PATH)) {
      logger.warn(
        `[library] catalogue snapshot missing at ${CATALOG_PATH} — the library will show no subjects`,
      );
      return null;
    }
    cached = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as SyllabusCatalog;
    logger.info(
      `[library] catalogue loaded: ${Object.keys(cached.departments || {}).length} departments`,
    );
  } catch (e) {
    logger.error("[library] catalogue load failed:", e);
    cached = null;
  }
  return cached;
};

/** Test seam: forget the cached snapshot. */
export const resetCatalogCache = (): void => {
  cached = null;
  loaded = false;
};

/**
 * The regulation a student who entered in `entryYear` follows.
 * The college switched schemes in 2017, 2019, 2020 and 2023.
 */
export const regulationForEntryYear = (entryYear: number): string => {
  if (entryYear >= 2023) return "R23";
  if (entryYear >= 2020) return "R20";
  if (entryYear === 2019) return "R19";
  if (entryYear >= 2017) return "R17";
  return "R13";
};

/** The entry year encoded in a roll number: 23CS1042 → 2023 */
export const entryYearFromRoll = (roll: string): number | null => {
  const m = roll
    .trim()
    .toUpperCase()
    .match(/^(\d{2})/);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  return year >= 2000 && year <= 2100 ? year : null;
};

/**
 * Portal branch id → the college site's department folder.
 * The names differ (the portal says AI_DS, the site says AIDS), so the
 * mapping is written out here rather than guessed at runtime. The MTech and
 * diploma branches have no site page and return null.
 */
const SITE_DEPT_BY_BRANCH: Record<string, string> = {
  "5": "CSE",
  "23": "AIDS",
  "32": "CSE(DS)",
  "33": "CSE(AIML)",
  "34": "CSE(AIML)",
  "4": "ECE",
  "2": "EEE",
  "11": "CE",
  "7": "ME",
  "22": "IT",
};

export const siteDeptForBranch = (branch: string): string | null =>
  SITE_DEPT_BY_BRANCH[String(branch).trim()] ?? null;

/** The core subjects of one year-sem, or an empty list. */
export const getSubjectsFor = (
  dept: string,
  regulation: string,
  yearSem: string,
): CatalogSubject[] => {
  const catalog = loadCatalog();
  if (!catalog) return [];
  return catalog.departments?.[dept]?.[regulation]?.[yearSem]?.core ?? [];
};

/** Every regulation the catalogue holds for a department. */
export const regulationsFor = (dept: string): string[] => {
  const catalog = loadCatalog();
  if (!catalog) return [];
  return Object.keys(catalog.departments?.[dept] ?? {});
};

/** The year-sems the catalogue holds for a department and regulation. */
export const yearSemsFor = (dept: string, regulation: string): string[] => {
  const catalog = loadCatalog();
  if (!catalog) return [];
  return Object.keys(catalog.departments?.[dept]?.[regulation] ?? {});
};

/**
 * The college's name for a subject code, wherever it is listed.
 *
 * The shelf asks this when it shows a document that is not on the reader's
 * own list — the admin's preview. Null means the catalogue no longer lists
 * the code, and the caller falls back to the document's own title.
 */
export const findSubjectName = (code: string): string | null => {
  const catalog = loadCatalog();
  if (!catalog) return null;

  const wanted = code.trim().toUpperCase();
  for (const dept of Object.values(catalog.departments ?? {})) {
    for (const regulation of Object.values(dept)) {
      for (const yearSem of Object.values(regulation)) {
        const subject = [...yearSem.core, ...yearSem.elective].find(
          (s) => s.code.toUpperCase() === wanted,
        );
        if (subject) return subject.name;
      }
    }
  }
  return null;
};
