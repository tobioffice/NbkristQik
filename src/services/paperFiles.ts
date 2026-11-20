/**
 * Question-paper photos.
 *
 * The Mini App sends one paper as multipart/form-data: `subject`, `exam`, an
 * optional `note`, and up to five `images` files. Files are written to a
 * private per-request directory first, identified by their magic bytes (the
 * client's MIME claim is never trusted), stripped of EXIF/XMP metadata, then
 * moved under an opaque random name.
 *
 * The database rows are the authority: a file with no row, or a row with no
 * file, is a bug. Accepted formats are PNG, JPEG and WebP; SVG and HTML are
 * deliberately absent because both are script-bearing documents, not photos.
 */
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import formidable from "formidable";
import type { Request } from "express";
import { logger } from "../config/logger.js";
import {
  sniffImageKind,
  stripImageMetadata,
  type ImageKind,
} from "./imageSanitize.js";

export const MAX_PAPER_IMAGES = 5;
export const MAX_PAPER_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PAPER_UPLOAD_BYTES =
  MAX_PAPER_IMAGES * MAX_PAPER_IMAGE_BYTES + 1024 * 1024;
export const MAX_PAPER_SUBJECT = 60;
export const MAX_PAPER_EXAM = 60;
export const MAX_PAPER_NOTE = 240;

/** Overridable so tests (and a data volume) can keep files elsewhere. */
export const paperImagesDir = (): string =>
  process.env.PAPER_FILES_DIR?.trim() ||
  path.resolve(process.cwd(), "data", "papers");

const EXTENSION_BY_KIND: Record<ImageKind, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
};

const MIME_BY_KIND: Record<ImageKind, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const STORED_NAME = /^[a-f0-9]{32}\.(png|jpg|webp)$/;

/** True only for a name this service could have written. */
export const isPaperImageName = (name: string): boolean =>
  STORED_NAME.test(name);

/** Remove stored image files, ignoring names that are not ours. */
export const removePaperImageFiles = async (
  fileNames: string[],
): Promise<void> => {
  const dir = paperImagesDir();
  await Promise.all(
    fileNames.map((name) => {
      if (!isPaperImageName(name)) return Promise.resolve();
      return unlink(path.join(dir, name)).catch(() => undefined);
    }),
  );
};

export class PaperUploadError extends Error {}

export interface StoredPaperImage {
  fileName: string;
  mimeType: string;
  byteSize: number;
  /** Absolute path on this host; temporary until commit moves it. */
  path: string;
}

export interface PendingPaperUpload {
  /** Trimmed, whitespace-collapsed form fields. Length is checked by the route. */
  subject: string;
  exam: string;
  note: string;
  fileCount: number;
  /** Move the validated files into the served directory. */
  commit: () => Promise<StoredPaperImage[]>;
  /** Remove every byte this request wrote, committed or not. */
  discard: () => Promise<void>;
}

/** A single-line field: trim and collapse runs of whitespace. */
const cleanText = (value: unknown): string =>
  Array.from(String(value ?? ""))
    .map((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : char;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

const uploadError = (error: unknown): PaperUploadError => {
  if (error instanceof PaperUploadError) return error;
  const code = (error as { code?: number } | null)?.code;
  if (code === 1015) {
    return new PaperUploadError(`Up to ${MAX_PAPER_IMAGES} photos per paper.`);
  }
  if (code === 1009 || code === 1016) {
    return new PaperUploadError("Each photo must be under 5 MB.");
  }
  if (code === 1008 || code === 1010) {
    return new PaperUploadError("That photo was empty. Try another.");
  }
  if (code === 1012 || code === 1013 || code === 1014) {
    return new PaperUploadError("Couldn't read the photos. Try again.");
  }
  logger.warn("[papers] upload failed:", error);
  return new PaperUploadError("Couldn't read the photos. Try again.");
};

/**
 * Parse and validate one multipart paper submission.
 *
 * Every error path removes the temporary directory before throwing, so a
 * rejected request never leaves a file behind. The caller owns the result:
 * `commit()` on success, `discard()` when the fields or the database say no
 * after the files were already accepted.
 */
export const readPaperUpload = async (
  req: Request,
): Promise<PendingPaperUpload> => {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_PAPER_UPLOAD_BYTES) {
    throw new PaperUploadError(
      `Up to ${MAX_PAPER_IMAGES} photos per paper, 5 MB each.`,
    );
  }

  const dir = paperImagesDir();
  await mkdir(dir, { recursive: true });
  const tempDir = await mkdtemp(path.join(dir, ".upload-"));

  const form = formidable({
    uploadDir: tempDir,
    maxFiles: MAX_PAPER_IMAGES,
    maxFileSize: MAX_PAPER_IMAGE_BYTES,
    maxTotalFileSize: MAX_PAPER_IMAGES * MAX_PAPER_IMAGE_BYTES,
    maxFields: 4,
    maxFieldsSize: 16 * 1024,
    allowEmptyFiles: false,
    multiples: true,
  });

  let fields: Record<string, string[] | undefined>;
  let files: Record<string, formidable.File[] | undefined>;
  try {
    [fields, files] = await form.parse(req);
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw uploadError(error);
  }

  // Only the `images` field is accepted. Any other file field would be
  // silently dropped by commit(), and a client bug must not cost a page.
  for (const name of Object.keys(files)) {
    if (name !== "images") {
      await rm(tempDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw new PaperUploadError("Send the photos as 'images'.");
    }
  }

  const uploaded = files.images ?? [];
  if (uploaded.length === 0) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw new PaperUploadError("Add at least one photo of the paper.");
  }
  if (uploaded.length > MAX_PAPER_IMAGES) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw new PaperUploadError(`Up to ${MAX_PAPER_IMAGES} photos per paper.`);
  }

  const pending: StoredPaperImage[] = [];
  try {
    for (const file of uploaded) {
      const original = await stat(file.filepath);
      if (original.size <= 0) {
        throw new PaperUploadError("That photo was empty. Try another.");
      }
      if (original.size > MAX_PAPER_IMAGE_BYTES) {
        throw new PaperUploadError("Each photo must be under 5 MB.");
      }

      const raw = await readFile(file.filepath);
      const kind = sniffImageKind(raw);
      if (!kind) {
        throw new PaperUploadError("Photos need to be PNG, JPEG or WebP.");
      }

      // The collected photo must not carry EXIF GPS or a device serial.
      // Rewriting the container also proves the file parses beyond its first
      // bytes.
      const cleaned = stripImageMetadata(raw, kind);
      if (!cleaned) {
        throw new PaperUploadError("Couldn't read that photo. Try another.");
      }
      await writeFile(file.filepath, cleaned);

      const info = await stat(file.filepath);
      pending.push({
        fileName: `${randomBytes(16).toString("hex")}.${EXTENSION_BY_KIND[kind]}`,
        mimeType: MIME_BY_KIND[kind],
        byteSize: info.size,
        path: file.filepath,
      });
    }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw uploadError(error);
  }

  return {
    subject: cleanText(fields.subject?.[0]),
    exam: cleanText(fields.exam?.[0]),
    note: cleanText(fields.note?.[0]),
    fileCount: pending.length,
    commit: async () => {
      const stored: StoredPaperImage[] = [];
      for (const file of pending) {
        const finalPath = path.join(dir, file.fileName);
        await rename(file.path, finalPath);
        file.path = finalPath;
        stored.push({
          fileName: file.fileName,
          mimeType: file.mimeType,
          byteSize: file.byteSize,
          path: finalPath,
        });
      }
      await rm(tempDir, { recursive: true, force: true }).catch((e) => {
        logger.warn("[papers] could not remove upload temp dir:", e);
      });
      return stored;
    },
    discard: async () => {
      await Promise.all(
        pending.map((file) => unlink(file.path).catch(() => undefined)),
      );
      await rm(tempDir, { recursive: true, force: true });
    },
  };
};
