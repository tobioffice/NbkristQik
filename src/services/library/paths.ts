import path from "path";

/**
 * Where the library keeps its files on the server.
 *
 *   data/docs/<id>.pdf          the source PDF (the store of record)
 *   data/pages/<id>/            the page SVGs, rendered from the PDF
 *   data/downloads/<id>/        per-reader watermarked copies of the PDF
 *
 * The paths are relative to the working directory, which is the app
 * directory on the server. LIBRARY_DATA_DIR moves the whole tree for tests
 * or a second instance.
 */

const dataDir = (): string =>
  process.env.LIBRARY_DATA_DIR?.trim() || path.resolve(process.cwd(), "data");

export const libraryDocsDir = (): string => path.join(dataDir(), "docs");
export const libraryPagesDir = (): string => path.join(dataDir(), "pages");
export const libraryDownloadsDir = (): string =>
  path.join(dataDir(), "downloads");

/**
 * Keeps a document id from escaping the tree it names. Ids are codes and unit
 * names (`23CS31T2-u2`), so this only guards against a bad row or a bad
 * ingest. `.` and `..` are rejected outright: a directory traversal is not a
 * document id.
 */
const safeSegment = (value: string): string => {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, "_");
  if (!segment || segment === "." || segment === "..") {
    throw new Error("invalid library document id");
  }
  return segment;
};

/** The pages directory of one document. */
export const documentPagesDir = (docId: string): string =>
  path.join(libraryPagesDir(), safeSegment(docId));

/** The watermarked-PDF cache directory of one document. */
export const documentDownloadsDir = (docId: string): string =>
  path.join(libraryDownloadsDir(), safeSegment(docId));

/** The page file name, zero padded so the order is obvious on disk. */
export const pageFileName = (page: number): string =>
  `p${String(page).padStart(3, "0")}.svg`;
