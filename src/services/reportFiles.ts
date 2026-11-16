/**
 * Screenshots on issue reports.
 *
 * The Mini App sends the report form as multipart/form-data: one `message`
 * field and up to three `screenshots` files. Files are written to a private
 * per-request directory first, checked by their magic bytes (the client's
 * declared MIME is never trusted), then moved under an opaque random name.
 * The database row is the authority: a file with no row, or a row with no
 * file, is a bug.
 *
 * Accepted: PNG, JPEG and WebP, 5 MB each, 3 per message. SVG and HTML are
 * deliberately absent: both are script-bearing documents, not screenshots.
 */
import { randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import formidable from "formidable";
import type { Request } from "express";
import type { NewReportAttachment } from "../db/report.model.js";
import { logger } from "../config/logger.js";

export const MAX_REPORT_FILES = 3;
export const MAX_REPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REPORT_UPLOAD_BYTES =
  MAX_REPORT_FILES * MAX_REPORT_FILE_BYTES + 1024 * 1024;

/** Overridable so tests (and a future data volume) can keep files elsewhere. */
export const reportFilesDir = (): string =>
  process.env.REPORT_FILES_DIR?.trim() ||
  path.resolve(process.cwd(), "data", "reports");

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

type ImageKind = "png" | "jpeg" | "webp";

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
export const isReportAttachmentName = (name: string): boolean =>
  STORED_NAME.test(name);

/** Same-origin URL the Mini App and the admin panel render. */
export const reportAttachmentUrl = (fileName: string): string =>
  `/api/report-attachment/${encodeURIComponent(fileName)}`;

export class ReportUploadError extends Error {}

export interface StoredReportFile extends NewReportAttachment {
  /** Absolute path on this host; temporary until commit moves it. */
  path: string;
}

export interface PendingReportUpload {
  /** The `message` field, trimmed. */
  message: string;
  /** How many screenshots this request carried. */
  fileCount: number;
  /** Move the validated files into the served directory. */
  commit: () => Promise<StoredReportFile[]>;
  /** Remove every byte this request wrote, committed or not. */
  discard: () => Promise<void>;
}

/** A screenshot is identified by its first bytes, never its filename. */
const sniffImage = (head: Buffer): ImageKind | null => {
  if (head.length >= 8 && head.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "png";
  }
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString("ascii") === "RIFF" &&
    head.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
};

const readHead = async (filePath: string): Promise<Buffer> => {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const uploadError = (error: unknown): ReportUploadError => {
  if (error instanceof ReportUploadError) return error;
  const code = (error as { code?: number } | null)?.code;
  if (code === 1015) {
    return new ReportUploadError(
      `Up to ${MAX_REPORT_FILES} screenshots per message.`,
    );
  }
  if (code === 1009 || code === 1016) {
    return new ReportUploadError("Each screenshot must be under 5 MB.");
  }
  if (code === 1008 || code === 1010) {
    return new ReportUploadError("That screenshot was empty. Try another.");
  }
  if (code === 1012 || code === 1013 || code === 1014) {
    return new ReportUploadError("Couldn't read the screenshots. Try again.");
  }
  logger.warn("[report] screenshot upload failed:", error);
  return new ReportUploadError("Couldn't read the screenshots. Try again.");
};

/**
 * Parse and validate one multipart report submission.
 *
 * `textField` is the form field that carries the message body (`message` for
 * the reporter's form, `reply` for the admin panel's composer). Every error
 * path removes the temporary directory before throwing, so a rejected request
 * never leaves a file behind. The caller owns the result: `commit()` on
 * success, `discard()` when the message, gate or database says no after the
 * files were already accepted.
 */
export const readReportUpload = async (
  req: Request,
  textField = "message",
): Promise<PendingReportUpload> => {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REPORT_UPLOAD_BYTES) {
    throw new ReportUploadError(
      `Up to ${MAX_REPORT_FILES} screenshots per message, 5 MB each.`,
    );
  }

  const dir = reportFilesDir();
  await mkdir(dir, { recursive: true });
  const tempDir = await mkdtemp(path.join(dir, ".upload-"));

  const form = formidable({
    uploadDir: tempDir,
    maxFiles: MAX_REPORT_FILES,
    maxFileSize: MAX_REPORT_FILE_BYTES,
    maxTotalFileSize: MAX_REPORT_FILES * MAX_REPORT_FILE_BYTES,
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

  const uploaded = Object.values(files).flatMap((list) => list ?? []);
  const pending: StoredReportFile[] = [];
  try {
    for (const file of uploaded) {
      const info = await stat(file.filepath);
      if (info.size <= 0) {
        throw new ReportUploadError("That screenshot was empty. Try another.");
      }
      if (info.size > MAX_REPORT_FILE_BYTES) {
        throw new ReportUploadError("Each screenshot must be under 5 MB.");
      }

      const kind = sniffImage(await readHead(file.filepath));
      if (!kind) {
        throw new ReportUploadError(
          "Screenshots need to be PNG, JPEG or WebP.",
        );
      }

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
    message: String(fields[textField]?.[0] ?? "").trim(),
    fileCount: pending.length,
    commit: async () => {
      const stored: StoredReportFile[] = [];
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
        logger.warn("[report] could not remove upload temp dir:", e);
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
