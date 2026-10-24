import path from "path";

/**
 * Where the library keeps its files on the server.
 *
 *   data/docs/<id>.pdf     the source PDF (the store of record)
 *   data/pages/<id>/       the page SVGs, rendered from the PDF
 *
 * The paths are relative to the working directory, which is the app
 * directory on the server. LIBRARY_DATA_DIR moves the whole tree for tests
 * or a second instance.
 */

const dataDir = (): string =>
  process.env.LIBRARY_DATA_DIR?.trim() || path.resolve(process.cwd(), "data");

export const libraryDataDir = dataDir;
export const libraryDocsDir = (): string => path.join(dataDir(), "docs");
export const libraryPagesDir = (): string => path.join(dataDir(), "pages");

/** The pages directory of one document. */
export const documentPagesDir = (docId: string): string =>
  path.join(libraryPagesDir(), docId);

/** The page file name, zero padded so the order is obvious on disk. */
export const pageFileName = (page: number): string =>
  `p${String(page).padStart(3, "0")}.svg`;
