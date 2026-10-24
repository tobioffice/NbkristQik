/**
 * Types for the library catalogue.
 *
 * The catalogue is a snapshot of the college's own syllabus pages
 * (https://at.nbkrist.org/Syllabi/showSyllabi.php?dept=CSE). It is the map
 * from "a student in year Y, semester S, branch B" to "the subjects that
 * student has", and it is keyed by the college's subject codes so the join
 * to our own library documents is exact, never a title match.
 */

export type SubjectKind = "core" | "elective" | "honours" | "minor";

export interface CatalogSubject {
  /** College subject code, upper case: 23CS31T2 */
  code: string;
  /** Subject title as the college writes it */
  name: string;
}

export interface CatalogYearSem {
  core: CatalogSubject[];
  elective: CatalogSubject[];
}

export interface CatalogDepartment {
  /** Regulation code: R23, R20, R19, R17, R13 */
  [regulation: string]: {
    /** College year-sem code: 11 … 42 */
    [yearSem: string]: CatalogYearSem;
  };
}

export interface SyllabusCatalog {
  version: number;
  generatedAt: string;
  source: string;
  departments: Record<string, CatalogDepartment>;
}
