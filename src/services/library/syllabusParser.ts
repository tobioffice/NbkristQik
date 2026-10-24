import * as cheerio from "cheerio";
import type {
  CatalogDepartment,
  CatalogSubject,
  SubjectKind,
  SyllabusCatalog,
} from "./types.js";

/**
 * Parses the college's syllabus pages into a subject catalogue.
 *
 * The page is one bootstrap accordion:
 *
 *   #accordion
 *     .card                        <- one regulation ("B.Tech - R23 Regulations")
 *       .card-header (button)      <- the regulation label
 *       .card-body
 *         .card-header             <- a section label ("I Year - I Sem", "CORE", "OE-2")
 *         .card-body               <- the subject links for that section
 *
 * A subject link looks like
 *   <a href='R23 Regulations/B.Tech/CSE/31/23CS31T2 –COMPUTER NETWORKS.pdf'>
 *     ( 23CS31T2 ) Computer Networks & Internet Protocols.pdf</a>
 * and an elective like
 *   <a href='R23 Regulations/B.Tech/CSE/32/OE-2/23CS32O1– OPERATING SYSTEMS.pdf'>
 *     ( OE ) 23cs32o1- Operating Systems.pdf</a>
 *
 * Two independent sources of truth are used, in this order:
 *   - the year-sem comes from the href path (…/CSE/31/…), which is exact even
 *     when a section header such as CORE carries no year of its own;
 *   - the code comes from the link text "( 23CS31T2 )" when it is there, and
 *     from the href file name otherwise.
 *
 * Pure functions only: no network, no filesystem. The fetch lives in the CLI
 * tool, so this file is unit tested against a saved fixture.
 */

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

/** Loose code shape, used on the link text: 23CS32T3, 23CS0HP1 */
const TEXT_CODE = /^\d{2}[A-Za-z0-9]{3,8}$/;
/** Strict academic shape, used on a file name: 23 + CS + 32 + T3 */
const FILE_CODE = /^\d{2}[A-Za-z]{2}\d{2}[A-Za-z]{0,3}\d?$/;
/** Honours and minors codes: 23 + CS + 0H + P1 */
const HONOUR_CODE = /^\d{2}[A-Za-z]{2}0[A-Za-z][A-Za-z0-9]{1,2}$/;

const FILE_EXTENSION = /\.(pdf|docx?)$/i;

const ENTITIES: Record<string, string> = {
  "&ndash;": "–",
  "&mdash;": "—",
  "&amp;": "&",
  "&nbsp;": " ",
  "&quot;": '"',
  "&apos;": "'",
  "&#8211;": "–",
  "&#8212;": "—",
};

/**
 * The page mixes raw characters and entities in the same place (an en dash in
 * a link title, the entity in its file name). Normalise both so a code is
 * never split by a stray "&ndash;".
 */
const decodeEntities = (value: string): string =>
  value.replace(
    /&(?:ndash|mdash|amp|nbsp|quot|apos|#8211|#8212);/g,
    (m) => ENTITIES[m] ?? m,
  );

export interface ParsedSubject extends CatalogSubject {
  kind: SubjectKind;
  /** College year-sem code taken from the href path, when the path carries one */
  yearSem: string | null;
}

export interface ParsedSection {
  label: string;
  kind: SubjectKind | "floating";
  /** Year-sem inherited from the section header, when it names one */
  yearSem: string | null;
  /** True when the header names a semester ("III Year - I Sem") */
  isSemester: boolean;
  subjects: ParsedSubject[];
}

export interface ParsedRegulation {
  label: string;
  degree: string;
  regulation: string;
  sections: ParsedSection[];
}

/** "B.Tech - R23 Regulations" → B.Tech / R23; "M.Tech - 2013 Regulations" → R13 */
export const parseRegulationLabel = (
  label: string,
): { degree: string; regulation: string } | null => {
  const m = label.match(/^(.*?)\s*-\s*(.+?)\s*Regulations/i);
  if (!m) return null;

  const degree = m[1].trim();
  const token = m[2].trim();

  const short = token.match(/^R\s*(\d{2})$/i);
  if (short) return { degree, regulation: `R${short[1]}` };

  const year = token.match(/^(\d{4})$/);
  if (year) return { degree, regulation: `R${year[1].slice(2)}` };

  return null;
};

/**
 * Classifies a section header.
 * "I Year - I Sem" names a semester, "CORE" and "CORE SUBJECTS" are the core
 * block of the semester above them, "OE-2"/"P-2"/"MC-II"/"PROFESSIONAL
 * ELECTIVE-I" are choice blocks, and anything else (an open-elective list, a
 * scheme file) floats free of a year.
 */
export const classifySection = (
  label: string,
): {
  kind: SubjectKind | "floating";
  yearSem: string | null;
  isSemester: boolean;
} => {
  const sem = label.match(
    /^(I|II|III|IV|V)\s*Year\s*[-–—]\s*(I|II|III|IV|V)\s*Sem$/i,
  );
  if (sem) {
    const year = ROMAN[sem[1].toUpperCase()];
    const half = ROMAN[sem[2].toUpperCase()];
    return { kind: "core", yearSem: `${year}${half}`, isSemester: true };
  }

  const t = label.trim().toUpperCase();
  if (t.startsWith("CORE")) {
    return { kind: "core", yearSem: null, isSemester: false };
  }
  if (
    /^(OE|P)-\d+$/.test(t) ||
    /^MC-/.test(t) ||
    /ELECTIVE/.test(t) ||
    /^JOB/.test(t) ||
    /^HSMC/.test(t) ||
    /^SKILL/.test(t)
  ) {
    return { kind: "elective", yearSem: null, isSemester: false };
  }
  if (t.startsWith("HONOUR")) {
    return { kind: "honours", yearSem: null, isSemester: false };
  }
  if (t.startsWith("MINOR")) {
    return { kind: "minor", yearSem: null, isSemester: false };
  }
  return { kind: "floating", yearSem: null, isSemester: false };
};

/**
 * A semester block lists the electives inline, with no header of their own.
 * The code tells them apart: …E1 is a professional elective, …O1 an open
 * elective, everything else a subject the student has.
 */
export const kindForCode = (code: string): SubjectKind => {
  if (/E\d$/.test(code)) return "elective";
  if (/O\d$/.test(code)) return "elective";
  return "core";
};

/** The year-sem segment of a syllabus path: ".../CSE/31/23CS31T2 –X.pdf" */
export const yearSemFromHref = (href: string | undefined): string | null => {
  if (!href) return null;
  const segments = href.split(/[\\/]/);
  for (const segment of segments) {
    if (/^\d{2}$/.test(segment)) return segment;
  }
  return null;
};

/**
 * Reads one subject link. Returns null when the link carries no code we can
 * trust (a scheme file, a garbled entry); the caller counts those so the
 * catalogue report never hides a silent drop.
 */
export const parseSubjectLink = (
  rawText: string,
  href: string | undefined,
  kind: SubjectKind,
): ParsedSubject | null => {
  const text = decodeEntities(rawText).replace(/\s+/g, " ").trim();
  if (!text) return null;

  const withoutExt = text.replace(FILE_EXTENSION, "");

  let code: string | null = null;
  let name = withoutExt;

  const paren = withoutExt.match(/\(\s*([^)]*?)\s*\)/);
  if (paren) {
    const inner = paren[1].trim();
    const tail = withoutExt.slice(paren.index! + paren[0].length).trim();
    if (TEXT_CODE.test(inner)) {
      code = inner.toUpperCase();
      name = tail;
    } else {
      // elective form: "( OE ) 23cs32o1- Operating Systems"
      name = tail;
    }
  }

  if (!code) {
    const file = decodeEntities((href || "").split(/[\\/]/).pop() || "");
    const stem = file.split(/[-–— _]/)[0].replace(FILE_EXTENSION, "");
    if (FILE_CODE.test(stem) || HONOUR_CODE.test(stem)) {
      code = stem.toUpperCase();
    }
  }
  if (!code) return null;

  // drop a leading code left in the title: "23cs32o1- Operating Systems"
  name = name.replace(/^\d{2}[A-Za-z0-9]{3,8}\s*[-–—]?\s*/, "");
  name = name.replace(/\s+/g, " ").trim();
  if (!name) return null;

  return { code, name, kind, yearSem: yearSemFromHref(href) };
};

/**
 * Parses one department page into its regulations.
 *
 * The page is a flat sequence of regulation blocks:
 *
 *   div.card-header > h2 > button   "B.Tech - R23 Regulations"
 *   div.card-body                   (the semesters of that regulation)
 *     div > div.card-header > a     "I Year - I Sem"    (a section header)
 *     div > div.card-body           (that semester's subjects)
 *   div.card-header > h2 > button   "B.Tech - 2020 Regulations"
 *   ...
 *
 * The nesting is not consistent (some blocks sit inside a card, some inside a
 * collapse, some beside it), so the page is walked in document order and each
 * regulation owns everything between its header and the next one. A section
 * header is a card-header that carries a link; a regulation header carries a
 * button.
 */
export const parseSyllabusPage = (
  html: string,
): { regulations: ParsedRegulation[]; skipped: number } => {
  const $ = cheerio.load(html);
  const regulations: ParsedRegulation[] = [];
  let skipped = 0;

  const all = $(".card-header, .card-body").toArray();

  // the regulation headers, in document order
  const heads: {
    index: number;
    label: string;
    degree: string;
    regulation: string;
  }[] = [];
  all.forEach((node, index) => {
    const el = $(node);
    if (!el.hasClass("card-header")) return;
    const label = el.text().replace(/\s+/g, " ").trim();
    if (!/Regulations/i.test(label)) return;
    const parsed = parseRegulationLabel(label);
    if (!parsed) return;
    heads.push({ index, label, ...parsed });
  });

  heads.forEach((head, order) => {
    const end = order + 1 < heads.length ? heads[order + 1].index : all.length;
    const sections: ParsedSection[] = [];

    for (let i = head.index + 1; i < end; i++) {
      const el = $(all[i]);

      if (el.hasClass("card-header")) {
        if (el.find("a").length === 0) continue; // not a section header
        const sectionLabel = el.text().replace(/\s+/g, " ").trim();
        if (!sectionLabel) continue;
        const cls = classifySection(sectionLabel);
        sections.push({
          label: sectionLabel,
          kind: cls.kind,
          yearSem: cls.yearSem,
          isSemester: cls.isSemester,
          subjects: [],
        });
        continue;
      }

      // a body with no section above it is the regulation's own body, not a
      // subject list
      const current = sections[sections.length - 1];
      if (!current) continue;

      el.find("a[href]").each((_, anchor) => {
        const a = $(anchor);
        const subject = parseSubjectLink(
          a.text(),
          a.attr("href"),
          current.kind === "floating" ? "elective" : current.kind,
        );
        if (!subject) {
          skipped += 1;
          return;
        }
        current.subjects.push(subject);
      });
    }

    regulations.push({
      label: head.label,
      degree: head.degree,
      regulation: head.regulation,
      sections,
    });
  });

  return { regulations, skipped };
};

export interface CatalogBuildResult {
  catalog: SyllabusCatalog;
  /** Links that carried no usable code, for the report */
  skipped: number;
  /** Department pages that produced nothing at all */
  empty: string[];
}

/** Folds parsed pages into the catalogue that ships with the repo. */
export const buildCatalog = (
  pages: { dept: string; html: string }[],
  generatedAt: string,
): CatalogBuildResult => {
  const departments: SyllabusCatalog["departments"] = {};
  let skipped = 0;
  const empty: string[] = [];

  for (const { dept, html } of pages) {
    const { regulations, skipped: pageSkipped } = parseSyllabusPage(html);
    skipped += pageSkipped;

    const deptEntry: CatalogDepartment = {};
    let subjectsFound = 0;

    for (const reg of regulations) {
      const regEntry = (deptEntry[reg.regulation] ??= {});
      let inheritedYearSem: string | null = null;

      for (const section of reg.sections) {
        if (section.yearSem) inheritedYearSem = section.yearSem;

        for (const subject of section.subjects) {
          const yearSem = subject.yearSem ?? inheritedYearSem;
          if (!yearSem) continue;

          const bucket = (regEntry[yearSem] ??= { core: [], elective: [] });
          // honours and minors are opt-in tracks, not subjects a student has
          if (subject.kind === "honours" || subject.kind === "minor") continue;
          // a semester block lists its electives inline, so the code decides
          const kind = section.isSemester
            ? kindForCode(subject.code)
            : subject.kind;
          const list = kind === "core" ? bucket.core : bucket.elective;
          if (list.some((s) => s.code === subject.code)) continue;
          list.push({ code: subject.code, name: subject.name });
          subjectsFound += 1;
        }
      }
    }

    if (subjectsFound === 0) {
      empty.push(dept);
      continue;
    }
    departments[dept] = deptEntry;
  }

  return {
    catalog: {
      version: 1,
      generatedAt,
      source: "https://at.nbkrist.org/Syllabi/showSyllabi.php?dept=<DEPT>",
      departments,
    },
    skipped,
    empty,
  };
};
