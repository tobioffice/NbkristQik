import crypto from "crypto";
import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
} from "fs/promises";
import path from "path";
import type { LibraryDocument } from "../../db/library.model.js";
import { PdfStampSourceError, stampPdfFile } from "./pdfstamp.js";
import {
  documentDownloadsDir,
  libraryDocsDir,
  libraryDownloadsDir,
} from "./paths.js";

/**
 * Per-reader watermarked PDFs.
 *
 * The source PDF is the store of record and never leaves the box. A download
 * is a copy stamped with the reader's opaque token, so a file that turns up
 * somewhere it should not still names the account it was issued to.
 *
 * The stamp is fixed for a reader, a stamp revision and a document version,
 * so the first download pays for the copy and every later one is a sendfile.
 * The cache filename carries the layout revision, the document version and
 * the byte size: a re-ingest or a layout change can never serve stale bytes.
 *
 * The drawing happens in `native/pdfstamp`, a small Rust binary. Node keeps
 * the source check, the queue, the cache and the atomic rename; the document
 * never enters the JavaScript heap.
 */

/** How long a stamped copy may be reused. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Default disk budget for the download cache. */
const DEFAULT_CACHE_MB = 512;

/** A source larger than this is not a handout document; reject it. */
const MAX_SOURCE_MB = 25;
/** A source with more pages than this needs a different delivery path. */
const MAX_PAGES = 500;

export class PdfTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfTooLargeError";
  }
}

/**
 * One generation per cache path. Two readers on the same account (or one
 * reader double-clicking) must not stamp and write the same file twice.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * A global cap on concurrent PDF stamps. Each stamp is a short-lived native
 * process, so the document lives outside the Node heap; two at a time keeps
 * memory and CPU predictable on the small VM. A 20 MB source measured about
 * 43.5 MB peak and 10.6 ms in the binary, so the cap is about bounding the
 * number of processes, not the JavaScript heap it used to protect. Overflow
 * is a clear 503, never an unbounded fork.
 */
const MAX_CONCURRENT_GENERATIONS = 2;
const MAX_QUEUED_GENERATIONS = 8;
let activeGenerations = 0;
const generationQueue: Array<() => void> = [];

export class PdfBusyError extends Error {
  constructor() {
    super("Too many PDF downloads are being prepared right now.");
    this.name = "PdfBusyError";
  }
}

const acquireGeneration = async (): Promise<void> => {
  if (activeGenerations < MAX_CONCURRENT_GENERATIONS) {
    activeGenerations += 1;
    return;
  }
  if (generationQueue.length >= MAX_QUEUED_GENERATIONS) {
    throw new PdfBusyError();
  }
  await new Promise<void>((resolve) => generationQueue.push(resolve));
  activeGenerations += 1;
};

const releaseGeneration = (): void => {
  activeGenerations -= 1;
  generationQueue.shift()?.();
};

const safeFilePart = (value: string): string =>
  value.replace(/[^A-Za-z0-9._-]/g, "_") || "token";

/**
 * Bumped when the drawing changes. Keep it in sync with the layout in
 * `native/pdfstamp`; the cache filename carries it so a deploy cannot serve a
 * copy stamped the previous way. Old files stay until the seven-day sweep.
 */
const STAMP_REVISION = 4;

/**
 * `<token>-s<stamp>-v<version>-<bytes>.pdf`: the layout, version and size pin
 * the bytes.
 */
const cacheFileName = (doc: LibraryDocument, token: string): string =>
  `${safeFilePart(token)}-s${STAMP_REVISION}-v${doc.version}-${doc.bytes}.pdf`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** A cached copy younger than the TTL, or false. */
const isFresh = async (file: string): Promise<boolean> => {
  try {
    const info = await stat(file);
    return Date.now() - info.mtimeMs < CACHE_TTL_MS;
  } catch {
    return false;
  }
};

/**
 * Resolves the source and applies the limits that keep a stamp bounded:
 * inside the library store, a regular file, under the byte and page caps.
 */
const sourceFileFor = async (doc: LibraryDocument): Promise<string> => {
  const root = path.resolve(libraryDocsDir());
  const source = path.resolve(doc.source_path);
  if (source !== root && !source.startsWith(`${root}${path.sep}`)) {
    throw new Error("the source PDF is outside the library store");
  }

  const info = await lstat(source).catch((e) => {
    throw new Error(`could not read the source PDF: ${errorMessage(e)}`);
  });
  if (!info.isFile()) {
    throw new Error("the source PDF is not a regular file");
  }

  const maxBytes =
    (Number(process.env.LIBRARY_PDF_MAX_MB ?? "") || MAX_SOURCE_MB) *
    1024 *
    1024;
  if (info.size > maxBytes) {
    throw new PdfTooLargeError("This document is too large to download.");
  }
  if (doc.page_count > MAX_PAGES) {
    throw new PdfTooLargeError("This document has too many pages.");
  }

  return source;
};

/**
 * Marks every page with a footer naming the token, the subject and the page.
 * The source never leaves the server.
 *
 * The native binary does the drawing; this function owns the source check
 * and keeps the caller's error wording stable.
 */
const stampPdfToFile = async (
  doc: LibraryDocument,
  token: string,
  output: string,
): Promise<void> => {
  const source = await sourceFileFor(doc);
  try {
    await stampPdfFile({
      source,
      output,
      token,
      code: doc.code,
      unit: doc.unit,
    });
  } catch (error) {
    if (error instanceof PdfStampSourceError) {
      throw new Error(
        `the source PDF is encrypted or unreadable: ${error.message}`,
      );
    }
    throw error;
  }
};

/**
 * The path of a stamped copy of `doc` for this reader, generating it when
 * missing or older than seven days.
 */
export const ensureWatermarkedPdf = async (
  doc: LibraryDocument,
  token: string,
): Promise<string> => {
  const dir = documentDownloadsDir(doc.id);
  const file = path.join(dir, cacheFileName(doc, token));

  if (await isFresh(file)) return file;

  const pending = inFlight.get(file);
  if (pending) return pending;

  const job = (async (): Promise<string> => {
    // another process (a second API worker) may have written it already
    if (await isFresh(file)) return file;

    await mkdir(dir, { recursive: true });

    // The binary writes beside the final name; a reader never sees a
    // half-written PDF, and a crash leaves a temp file, not a broken cache.
    const temp = path.join(
      dir,
      `.${cacheFileName(doc, token)}.${crypto.randomBytes(6).toString("hex")}.tmp`,
    );

    try {
      await acquireGeneration();
      try {
        await stampPdfToFile(doc, token, temp);
      } finally {
        releaseGeneration();
      }
      await rename(temp, file);
    } catch (e) {
      // A failed stamp may have left a partial file under the temp name.
      await unlink(temp).catch(() => {});
      throw e;
    }
    return file;
  })();

  inFlight.set(file, job);
  try {
    return await job;
  } finally {
    inFlight.delete(file);
  }
};

interface CacheFile {
  path: string;
  mtimeMs: number;
  size: number;
}

/** The per-document folders under data/downloads. */
const readCacheDirs = async (): Promise<string[]> => {
  const root = libraryDownloadsDir();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") return [];
    throw e;
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name));
};

const cacheMb = (): number => {
  const parsed = Number(process.env.LIBRARY_DOWNLOAD_CACHE_MB ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_MB;
};

/**
 * Daily housekeeping: drop copies past their seven days, then the oldest
 * copies until the tree fits the disk budget. Empty document folders go too.
 * Best effort from maintenance; a missing tree is not an error.
 */
export const pruneDownloadCache = async (): Promise<void> => {
  const dirs = await readCacheDirs();
  const now = Date.now();
  const fresh: CacheFile[] = [];

  for (const dir of dirs) {
    let names;
    try {
      names = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of names) {
      if (!entry.isFile()) continue;
      const file = path.join(dir, entry.name);
      try {
        const info = await stat(file);
        // A crashed generation leaves a dot-prefixed .tmp file. It is not a
        // cache entry, and after an hour it is safe to remove.
        if (entry.name.endsWith(".tmp")) {
          if (now - info.mtimeMs >= 60 * 60 * 1000) {
            await rm(file, { force: true });
          }
          continue;
        }
        if (!entry.name.endsWith(".pdf")) continue;
        if (now - info.mtimeMs >= CACHE_TTL_MS) {
          await rm(file, { force: true });
          continue;
        }
        fresh.push({ path: file, mtimeMs: info.mtimeMs, size: info.size });
      } catch {
        // a file that vanished under us is already pruned
      }
    }
  }

  const capBytes = cacheMb() * 1024 * 1024;
  let total = fresh.reduce((sum, file) => sum + file.size, 0);
  if (total > capBytes) {
    fresh.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const file of fresh) {
      if (total <= capBytes) break;
      try {
        await rm(file.path, { force: true });
        total -= file.size;
      } catch {
        // best effort: the next run will try again
      }
    }
  }

  for (const dir of dirs) {
    try {
      const left = await readdir(dir);
      if (left.length === 0) await rmdir(dir);
    } catch {
      // already gone
    }
  }
};
