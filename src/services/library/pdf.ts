import crypto from "crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { LibraryDocument } from "../../db/library.model.js";
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
 * The stamp is fixed for a reader and a document version, so the first
 * download pays for the copy and every later one is a sendfile. The cache
 * filename carries the document version and byte size: a re-ingest changes
 * the version, so an old copy can never be served for new bytes.
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

/** The same ink and weights as the page watermark (watermark.ts). */
const INK = rgb(30 / 255, 42 / 255, 56 / 255);
const REPEAT_OPACITY = 0.05;
const FOOTER_OPACITY = 0.42;

/**
 * One generation per cache path. Two readers on the same account (or one
 * reader double-clicking) must not stamp and write the same file twice.
 */
const inFlight = new Map<string, Promise<string>>();

/**
 * A global cap on concurrent PDF stamps. pdf-lib holds the whole document in
 * memory; on the small production VM a burst of different readers must not
 * turn into a burst of 50 MB heaps. The queue is bounded, and overflow is a
 * clear 503 rather than an OOM.
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

/** `<token>-v<version>-<bytes>.pdf`: the version and size pin the bytes. */
const cacheFileName = (doc: LibraryDocument, token: string): string =>
  `${safeFilePart(token)}-v${doc.version}-${doc.bytes}.pdf`;

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
 * Stamps every page: the token repeated diagonally, and a footer naming the
 * token, the subject and the page. The reader's id and roll never appear.
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

const stampPdf = async (
  doc: LibraryDocument,
  token: string,
): Promise<Uint8Array> => {
  const sourcePath = await sourceFileFor(doc);
  let source: Uint8Array;
  try {
    source = await readFile(sourcePath);
  } catch (e) {
    throw new Error(`could not read the source PDF: ${errorMessage(e)}`);
  }

  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(source, { updateMetadata: false });
  } catch (e) {
    // pdf-lib refuses an encrypted PDF unless told to ignore encryption, and
    // a corrupt file throws here too. Either way there is nothing safe to
    // serve, so the route turns this into a 500.
    throw new Error(
      `the source PDF is encrypted or unreadable: ${errorMessage(e)}`,
    );
  }

  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const unit = doc.unit ? ` · Unit ${doc.unit}` : "";

  pdf.getPages().forEach((page, index) => {
    const { width, height } = page.getSize();
    const repeatSize = Math.max(8, Math.round(width / 36));
    const footerSize = Math.max(7, Math.round(width / 52));
    const step = Math.round(height / 3.2);

    for (let row = 0; row < 3; row++) {
      page.drawText(token, {
        x: -height * 0.12,
        y: step * (row + 0.8),
        size: repeatSize,
        font,
        color: INK,
        opacity: REPEAT_OPACITY,
        rotate: degrees(-28),
      });
    }

    page.drawText(`${token} · ${doc.code}${unit} · p${index + 1}`, {
      x: Math.round(width * 0.03),
      y: Math.round(height * 0.02),
      size: footerSize,
      font,
      color: INK,
      opacity: FOOTER_OPACITY,
    });
  });

  return pdf.save();
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

    await acquireGeneration();
    let stamped: Uint8Array;
    try {
      stamped = await stampPdf(doc, token);
    } finally {
      releaseGeneration();
    }

    // Write beside the final name and rename: a reader never sees a
    // half-written PDF, and a crash leaves a temp file, not a broken cache.
    const temp = path.join(
      dir,
      `.${cacheFileName(doc, token)}.${crypto.randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      await writeFile(temp, stamped);
      await rename(temp, file);
    } catch (e) {
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
