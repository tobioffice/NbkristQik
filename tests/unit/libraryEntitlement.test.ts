import { describe, it, expect, beforeAll } from "vitest";
import {
  mayReadDocument,
  type StudentContext,
} from "../../src/services/library/entitlement.js";
import type { LibraryDocument } from "../../src/db/library.model.js";

/**
 * The shelf maps documents to students by subject code, not by the department
 * the corpus was built for: one cut paper serves every branch whose R23 list
 * carries that code. The shelf route itself is covered by
 * tests/integration/libraryRoutes.test.ts.
 */

const doc = (over: Partial<LibraryDocument>): LibraryDocument => ({
  id: "23CS31T2-u2",
  code: "23CS31T2",
  title: "Computer Networks & Internet Protocols",
  dept: "CSE",
  regulation: "R23",
  year_sem: "31",
  unit: "II",
  kind: "material",
  source_path: "data/docs/23CS31T2-u2.pdf",
  page_count: 23,
  bytes: 1024,
  status: "live",
  version: 1,
  ...over,
});

const student = (over: Partial<StudentContext>): StudentContext => ({
  userId: "111",
  rollNo: "23CS1042",
  name: "TEST STUDENT",
  yearSem: "31",
  branch: "5",
  dept: "CSE",
  regulation: "R23",
  entryYear: 2023,
  ...over,
});

beforeAll(() => {
  // the open shelf: every check below is the student rule, not the admin's
  // preview
  process.env.LIBRARY_ACCESS = "all";
});

describe("who a document belongs to", () => {
  it("gives a CSE-cut subject to its own branch", () => {
    expect(mayReadDocument(student({}), doc({}))).toBe(true);
  });

  it("gives the same subject to another branch that lists the code", () => {
    // IT 3-1 lists 23CS31T2 exactly like CSE 3-1
    const it = student({ branch: "22", dept: "IT", rollNo: "23IT1042" });
    expect(mayReadDocument(it, doc({}))).toBe(true);
  });

  it("keeps a subject the branch does not list off the shelf", () => {
    const it = student({ branch: "22", dept: "IT", rollNo: "23IT1042" });
    // ADSAA is on the CSE 2-1 list, not on IT 3-1's
    const adsaa = doc({
      id: "23CS21T1-u1",
      code: "23CS21T1",
      unit: "I",
      year_sem: "21",
    });
    expect(mayReadDocument(it, adsaa)).toBe(false);
  });

  it("keeps another regulation out", () => {
    const r20 = student({ regulation: "R20", entryYear: 2021 });
    expect(mayReadDocument(r20, doc({}))).toBe(false);
  });

  it("falls back to the row's own department when the snapshot cannot place a code", () => {
    const unknown = doc({ code: "23CS99T9", dept: "CSE", year_sem: "31" });
    expect(mayReadDocument(student({}), unknown)).toBe(true);
    expect(
      mayReadDocument(student({ dept: "IT", branch: "22" }), unknown),
    ).toBe(false);
  });

  it("refuses a student with no department", () => {
    expect(mayReadDocument(student({ dept: null }), doc({}))).toBe(false);
  });
});
