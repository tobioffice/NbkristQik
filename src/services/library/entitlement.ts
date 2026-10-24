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
