import { afterAll, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "fs";
import os from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import type { LibraryDocument } from "../../src/db/library.model.js";
import {
  ensureWatermarkedPdf,
  pruneDownloadCache,
} from "../../src/services/library/pdf.js";
import {
  documentDownloadsDir,
  libraryDownloadsDir,
} from "../../src/services/library/paths.js";

/**
 * Stamping and caching. The fixtures are real PDFs made with the same library
 * the service uses, so the output is loaded back rather than eyeballed.
 */

const previousDataDir = process.env.LIBRARY_DATA_DIR;
const dataDir = mkdtempSync(path.join(os.tmpdir(), "nbq-pdf-test-"));
process.env.LIBRARY_DATA_DIR = dataDir;

const docsDir = path.join(dataDir, "docs");
mkdirSync(docsDir, { recursive: true });
const sourcePath = path.join(docsDir, "23CS31T2-u2.pdf");
const sourcePdf = await PDFDocument.create();
sourcePdf.addPage([595, 842]);
sourcePdf.addPage([595, 842]);
writeFileSync(sourcePath, await sourcePdf.save());

const doc: LibraryDocument = {
  id: "23CS31T2-u2",
  code: "23CS31T2",
  title: "Computer Networks & Internet Protocols",
  dept: "CSE",
  regulation: "R23",
  year_sem: "31",
  unit: "II",
  kind: "material",
  source_path: sourcePath,
  page_count: 2,
  bytes: statSync(sourcePath).size,
  status: "live",
  version: 1,
};

const TOKEN = "NBK-AAAA-BBBB-CCCC-DDDD";

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.LIBRARY_DOWNLOAD_CACHE_MB;
  if (previousDataDir === undefined) delete process.env.LIBRARY_DATA_DIR;
  else process.env.LIBRARY_DATA_DIR = previousDataDir;
});

describe("stamping a PDF", () => {
  it("writes a stamped copy that still loads, with both pages", async () => {
    const file = await ensureWatermarkedPdf(doc, TOKEN);
    const bytes = readFileSync(file);

    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(statSync(sourcePath).size);

    const stamped = await PDFDocument.load(bytes);
    expect(stamped.getPageCount()).toBe(2);
  });

  it("reuses a cached copy instead of stamping again", async () => {
    const first = await ensureWatermarkedPdf(doc, TOKEN);
    expect(existsSync(first)).toBe(true);

    // a marker survives only if the service returns the file without a write
    writeFileSync(first, "MARKER");
    const second = await ensureWatermarkedPdf(doc, TOKEN);

    expect(second).toBe(first);
    expect(readFileSync(second, "utf8")).toBe("MARKER");
  });

  it("gives a re-ingested version a different cache file", async () => {
    const v1 = await ensureWatermarkedPdf(doc, TOKEN);
    const v2 = await ensureWatermarkedPdf({ ...doc, version: 2 }, TOKEN);

    expect(v2).not.toBe(v1);
    expect(path.basename(v2)).toContain(`-v2-${doc.bytes}.pdf`);
    expect(readFileSync(v2).subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("refuses a corrupt source with a clear error", async () => {
    const badPath = path.join(docsDir, "bad.pdf");
    writeFileSync(badPath, "this is not a pdf");

    await expect(
      ensureWatermarkedPdf(
        { ...doc, id: "bad-doc", source_path: badPath },
        TOKEN,
      ),
    ).rejects.toThrow(/encrypted or unreadable/);
  });
});

describe("pruning the download cache", () => {
  it("removes copies older than seven days, and their empty folder", async () => {
    const staleDir = path.join(libraryDownloadsDir(), "stale-doc");
    mkdirSync(staleDir, { recursive: true });
    const stale = path.join(staleDir, "old.pdf");
    writeFileSync(stale, "%PDF-1.4\n");

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    utimesSync(stale, eightDaysAgo, eightDaysAgo);

    await pruneDownloadCache();

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(staleDir)).toBe(false);
  });

  it("drops the oldest copies until the disk budget is met", async () => {
    rmSync(documentDownloadsDir(doc.id), { recursive: true, force: true });

    const capDir = path.join(libraryDownloadsDir(), "cap-doc");
    mkdirSync(capDir, { recursive: true });
    const older = path.join(capDir, "older.pdf");
    const newer = path.join(capDir, "newer.pdf");
    writeFileSync(older, Buffer.alloc(80, 1));
    writeFileSync(newer, Buffer.alloc(80, 2));
    utimesSync(
      older,
      new Date(Date.now() - 60_000),
      new Date(Date.now() - 60_000),
    );
    utimesSync(
      newer,
      new Date(Date.now() - 30_000),
      new Date(Date.now() - 30_000),
    );

    process.env.LIBRARY_DOWNLOAD_CACHE_MB = "0.0001";
    await pruneDownloadCache();

    // cap is ~104 bytes: one 80-byte copy fits, the older one goes
    expect(existsSync(older)).toBe(false);
    expect(existsSync(newer)).toBe(true);
  });
});
