import { Request, Response, Router } from "express";
import { requireIdentity } from "./resolveUser.js";
import { createPaper } from "../db/paper.model.js";
import {
  MAX_PAPER_EXAM,
  MAX_PAPER_NOTE,
  MAX_PAPER_SUBJECT,
  PaperUploadError,
  readPaperUpload,
  type PendingPaperUpload,
} from "../services/paperFiles.js";
import { logger } from "../config/logger.js";

/**
 * Question-paper collection.
 *
 * This is an intake endpoint, not a public bank: students submit photos of a
 * paper with its subject and exam, and the papers are processed from the
 * private admin list. Reading and removal are therefore admin-only. Every
 * upload must carry signed Telegram initData, so the service has one
 * accountable account per submission without publishing that account.
 */

export const paperRouter = Router();

// POST /api/papers — one paper, up to five photos, signed Telegram identity.
paperRouter.post("/papers", async (req: Request, res: Response) => {
  let upload: PendingPaperUpload | null = null;
  // Answer only after the temporary files are gone: an immediate retry must
  // not race a directory that is still being removed.
  const dropUpload = async () => {
    if (!upload) return;
    const pending = upload;
    upload = null;
    await pending
      .discard()
      .catch((e) => logger.warn("[papers] upload cleanup failed:", e));
  };

  try {
    const resolved = requireIdentity(req, res);
    if (!resolved) return;

    try {
      upload = await readPaperUpload(req);
    } catch (e) {
      if (e instanceof PaperUploadError) {
        res.status(400).json({ ok: false, error: e.message });
        return;
      }
      throw e;
    }

    if (
      upload.subject.length < 2 ||
      upload.subject.length > MAX_PAPER_SUBJECT
    ) {
      await dropUpload();
      res.status(400).json({
        ok: false,
        error: `Add the subject (2 to ${MAX_PAPER_SUBJECT} characters).`,
      });
      return;
    }
    if (upload.exam.length < 2 || upload.exam.length > MAX_PAPER_EXAM) {
      await dropUpload();
      res.status(400).json({
        ok: false,
        error: `Add the exam (2 to ${MAX_PAPER_EXAM} characters).`,
      });
      return;
    }
    if (upload.note.length > MAX_PAPER_NOTE) {
      await dropUpload();
      res.status(400).json({
        ok: false,
        error: `Keep the note under ${MAX_PAPER_NOTE} characters.`,
      });
      return;
    }

    const subject = upload.subject;
    const exam = upload.exam;
    const note = upload.note || null;
    const files = await upload.commit();
    let id: number;
    try {
      id = await createPaper(
        Number(resolved.userId),
        subject,
        exam,
        note,
        files.map((file) => ({
          fileName: file.fileName,
          mimeType: file.mimeType,
          byteSize: file.byteSize,
        })),
      );
    } catch (e) {
      // The rows were never written; the bytes on disk have no owner.
      await dropUpload();
      throw e;
    }
    // the rows now own the files; the finally block must not remove them
    upload = null;

    // A receipt, not a gallery entry: the page has no public read path.
    res.status(201).json({ ok: true, id, pageCount: files.length });
  } catch (e) {
    logger.error("[papers] upload failed:", e);
    res.status(500).json({ ok: false, error: "Internal Server Error" });
  } finally {
    await dropUpload();
  }
});
