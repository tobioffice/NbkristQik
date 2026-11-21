import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { deletePaper, listPapersForAdmin } from "../../db/paper.model.js";
import {
  isPaperImageName,
  paperImagesDir,
  removePaperImageFiles,
} from "../../services/paperFiles.js";
import { logger } from "../../config/logger.js";
import type { RequireAdmin } from "./auth.js";

/**
 * Private processing list for the question-paper collection.
 *
 * Students upload from a hidden page and never browse the collection. The
 * operator opens this list to see what arrived, inspect the pages and remove
 * anything that should not be kept. Page images sit behind the admin session
 * too, so a random image URL cannot leak a student's upload.
 */
export const registerPapersRoutes = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  // The processing list loads many pages at once, so the cap is generous; it
  // still keeps an authenticated session from hammering sendFile.
  const paperImageReadLimit = rateLimit({
    windowMs: 60_000,
    limit: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many image requests. Try again in a minute." },
  });

  app.get(
    `${base}/api/papers`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit)) || 200, 1),
          500,
        );
        const rows = await listPapersForAdmin(limit);
        res.json({
          papers: rows.map((paper) => ({
            id: paper.id,
            subject: paper.subject,
            exam: paper.exam,
            note: paper.note,
            createdAt: paper.created_at,
            pageCount: paper.page_count,
            images: paper.image_file_names.map(
              (name) => `${base}/api/paper-images/${encodeURIComponent(name)}`,
            ),
            userId: paper.user_id,
            name: paper.name,
            username: paper.username,
          })),
        });
      } catch (e) {
        logger.error("[admin] papers list failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  // GET {base}/api/paper-images/:name — one stored page, admin session only.
  // The URL is unguessable too, but the cookie is the permission.
  app.get(
    `${base}/api/paper-images/:name`,
    paperImageReadLimit,
    requireAdmin,
    (req: Request, res: Response) => {
      const name = String(req.params.name);
      if (!isPaperImageName(name)) {
        res.setHeader("Cache-Control", "no-store");
        res.status(404).json({ error: "Not Found" });
        return;
      }

      // Random names never change contents, so a private short cache keeps
      // the processing list from re-downloading every page on each refresh.
      res.setHeader("Cache-Control", "private, max-age=300");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Robots-Tag", "noindex");
      res.setHeader("Content-Disposition", "inline");
      // sendFile derives the type from the extension, which came from the
      // magic bytes and the metadata-stripped container on upload.
      res.sendFile(
        name,
        { root: paperImagesDir(), dotfiles: "deny" },
        (error) => {
          if (!error) return;
          if (!res.headersSent) {
            // Do not let a staged image Content-Type leak onto a JSON 404.
            res.removeHeader("Content-Type");
            res.setHeader("Cache-Control", "no-store");
            res.status(404).json({ error: "Not Found" });
          }
        },
      );
    },
  );

  app.delete(
    `${base}/api/papers/:id`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const id = /^\d{1,10}$/.test(String(req.params.id))
          ? Number(req.params.id)
          : 0;
        if (!id) {
          res.status(404).json({ error: "Unknown paper" });
          return;
        }

        const deleted = await deletePaper(id);
        if (!deleted) {
          res.status(404).json({ error: "Unknown paper" });
          return;
        }
        await removePaperImageFiles(deleted.fileNames);
        res.json({ ok: true });
      } catch (e) {
        logger.error("[admin] paper delete failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
