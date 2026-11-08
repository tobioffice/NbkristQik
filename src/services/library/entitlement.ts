import { getRegistration } from "../../db/registration.model.js";
import {
  listLiveDocumentsForSemester,
  listLiveLibraryDocuments,
  type LibraryDocument,
} from "../../db/library.model.js";
import { getStudentCached } from "../redis/utils.js";
import { canPreviewEverything } from "./access.js";
import {
  entryYearFromRoll,
  findSubjectName,
  regulationForEntryYear,
  siteDeptForBranch,
} from "./catalog.js";

/**
 * Who is this student, and therefore which subjects are theirs?
 *
 * The roll number is the only key we have. It carries the entry year, and
 * the college's own master table carries the year-sem and the branch. From
 * those three the catalogue gives the subject list, and the subject codes
 * join to the documents we hold.
 */

export interface StudentContext {
  userId: string;
  rollNo: string;
  name: string | null;
  /** The college year-sem code: 11 … 42 */
  yearSem: string;
  /** The portal's branch id: 5 = CSE */
  branch: string;
  /** The college site's department folder: CSE, ECE, … */
  dept: string | null;
  /** The scheme the student follows: R23, R20, … */
  regulation: string;
  entryYear: number | null;
}

/**
 * Resolves a Telegram user to a student. Null means "not registered", or
 * "registered with a roll the college has no record of".
 */
export const resolveStudentContext = async (
  userId: string,
): Promise<StudentContext | null> => {
  const registration = await getRegistration(userId).catch(() => null);
  if (!registration?.roll_no) return null;

  const student = await getStudentCached(registration.roll_no).catch(
    () => null,
  );
  if (!student) return null;

  const rollNo = student.roll_no ?? registration.roll_no;
  const entryYear = entryYearFromRoll(rollNo);

  return {
    userId,
    rollNo,
    name: student.name ?? null,
    yearSem: student.year,
    branch: student.branch,
    dept: siteDeptForBranch(student.branch),
    regulation: entryYear ? regulationForEntryYear(entryYear) : "R23",
    entryYear,
  };
};

/**
 * A one-minute, in-process cache of resolved readers.
 *
 * Every page of a unit used to cost a registration read plus a student
 * Redis/DB read just to answer "who is this?" again. A reader turns twenty
 * pages in a minute, so the answer is cached per session token: the token is
 * the thing every request already carries, and a token dropped at logout can
 * never be asked for again.
 *
 * The cache is deliberately short-lived rather than invalidated everywhere:
 * a registration edit may be written by the bot or the profile API, and both
 * are outside this module. `invalidateStudentContext` is the exact hook for
 * those writers; until they call it, a minute is the worst-case staleness.
 *
 * A *missing* registration is not cached. The reader is about to save a roll,
 * and the next request must see it — caching "not registered" for a minute
 * would turn a successful save into "Save your roll number first."
 */
const CONTEXT_TTL_MS = 60_000;
const CONTEXT_CACHE_LIMIT = 1_000;

const contextCache = new Map<
  string,
  { ctx: StudentContext; expiresAt: number }
>();

/**
 * Resolves the reader behind a session token, from cache when fresh.
 *
 * The caller supplies the user id too: a token is only reused when it still
 * belongs to the same Telegram account, so a stale or recycled cookie cannot
 * inherit someone else's student.
 */
export const resolveStudentContextCached = async (
  token: string,
  userId: string,
): Promise<StudentContext | null> => {
  const hit = contextCache.get(token);
  if (hit && hit.ctx.userId === userId && hit.expiresAt > Date.now()) {
    return hit.ctx;
  }
  if (hit) contextCache.delete(token);

  const ctx = await resolveStudentContext(userId);

  // negative answers are not cached: see the note above
  if (!ctx) return null;

  // bounded: the oldest insertion leaves first, and Redis already bounds how
  // many live tokens exist
  if (!contextCache.has(token) && contextCache.size >= CONTEXT_CACHE_LIMIT) {
    const oldest = contextCache.keys().next();
    if (!oldest.done) contextCache.delete(oldest.value);
  }
  contextCache.set(token, { ctx, expiresAt: Date.now() + CONTEXT_TTL_MS });
  return ctx;
};

/**
 * Drops every cached reader for one Telegram account.
 *
 * Registration writers call this after changing a roll number, so the next
 * request resolves the new year-sem immediately instead of after the cache
 * window. It scans at most `CONTEXT_CACHE_LIMIT` entries, which is cheaper
 * than making every page request pay for a version lookup.
 */
export const invalidateStudentContext = (userId: string): void => {
  for (const [token, entry] of contextCache) {
    if (entry.ctx.userId === userId) contextCache.delete(token);
  }
};

/** Test seam: forget every cached reader. */
export const clearStudentContextCache = (): void => {
  contextCache.clear();
};

export interface LibrarySubjectUnit {
  /** The document id, which is what the reader asks for */
  id: string;
  unit: string | null;
  pages: number;
}

/** The student, as the mini app needs them: no internals, no ids. */
export interface StudentView {
  rollNo: string;
  name: string | null;
  yearSem: string;
  branch: string;
  dept: string | null;
  regulation: string;
}

/** Projects a resolved student into what the client is told about them. */
export const studentView = (ctx: StudentContext): StudentView => ({
  rollNo: ctx.rollNo,
  name: ctx.name,
  yearSem: ctx.yearSem,
  branch: ctx.branch,
  dept: ctx.dept,
  regulation: ctx.regulation,
});

/**
 * May this student read this document?
 *
 * The shelf is our own material, so the rule is the document's own semester:
 * the reader's department, regulation and year-sem must match the document's.
 * A document id alone gets nothing.
 */
export const mayReadDocument = (
  ctx: StudentContext,
  doc: LibraryDocument,
): boolean => {
  // the admin previews any live document while the library is theirs
  if (canPreviewEverything(ctx.userId)) return true;
  if (!ctx.dept) return false;
  return (
    doc.dept === ctx.dept &&
    doc.regulation === ctx.regulation &&
    doc.year_sem === ctx.yearSem
  );
};

export interface LibrarySubject {
  code: string;
  name: string;
  /** True when we hold at least one unit of this subject */
  live: boolean;
  units: LibrarySubjectUnit[];
}

/**
 * Groups documents into shelf rows, one per subject.
 *
 * Only material we actually hold is listed. The catalogue gives the name
 * when it still lists the code; the document's own title is the fallback.
 */
const groupByCode = (documents: LibraryDocument[]): LibrarySubject[] => {
  const byCode = new Map<string, LibrarySubject>();

  for (const doc of documents) {
    let subject = byCode.get(doc.code);
    if (!subject) {
      subject = {
        code: doc.code,
        name: findSubjectName(doc.code) ?? doc.title,
        live: true,
        units: [],
      };
      byCode.set(doc.code, subject);
    }
    subject.units.push({
      id: doc.id,
      unit: doc.unit,
      pages: doc.page_count,
    });
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
};

/**
 * The material we hold for the student's own semester.
 *
 * The shelf is our corpus, not the syllabus: a student sees the subjects we
 * have cut for their department, regulation and year-sem, and nothing else.
 * A semester we have not reached yet gets an empty shelf, not a list of
 * promises.
 */
export const listSubjectsForStudent = async (
  ctx: StudentContext,
): Promise<LibrarySubject[]> => {
  if (!ctx.dept) return [];

  const documents = await listLiveDocumentsForSemester(
    ctx.dept,
    ctx.regulation,
    ctx.yearSem,
  ).catch((): LibraryDocument[] => []);

  return groupByCode(documents);
};

/**
 * Everything on the shelf, grouped by subject.
 *
 * The admin's preview reads this instead of the student list: the shelf is
 * shown as it is, whatever the admin's own year-sem.
 */
export const listAllLiveSubjects = async (): Promise<LibrarySubject[]> => {
  const documents = await listLiveLibraryDocuments().catch(
    (): LibraryDocument[] => [],
  );

  return groupByCode(documents);
};
