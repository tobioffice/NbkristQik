import type { Express, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import {
  getLibraryReader,
  getLibrarySummary,
  getReaderLibraryDetail,
  listLibraryDocumentStats,
  listLibraryReaders,
  listRecentLibraryReads,
  resolveLibraryToken,
} from "../../db/library.model.js";
import { cached } from "./cache.js";
import type { RequireAdmin } from "./auth.js";

const TOKEN_PATTERN = /^NBK-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

/** Mounts the Library tab's read-only endpoints. */
export const registerLibraryRoutes = (
  app: Express,
  base: string,
  requireAdmin: RequireAdmin,
): void => {
  app.get(
    `${base}/api/library/summary`,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const data = await cached("library:summary", 30_000, getLibrarySummary);
        res.json(data);
      } catch (e) {
        logger.error("[admin] library summary failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.get(
    `${base}/api/library/readers`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const q = String(req.query.q || "")
          .trim()
          .slice(0, 60);
        const sort =
          req.query.sort === "pages" || req.query.sort === "downloads"
            ? req.query.sort
            : "recent";
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit)) || 100, 1),
          200,
        );
        const data = await cached(
          `library:readers:${q}:${sort}:${limit}`,
          20_000,
          () => listLibraryReaders(q, sort, limit),
        );
        res.json(data);
      } catch (e) {
        logger.error("[admin] library readers failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.get(
    `${base}/api/library/documents`,
    requireAdmin,
    async (_req: Request, res: Response) => {
      try {
        const data = await cached(
          "library:documents",
          30_000,
          listLibraryDocumentStats,
        );
        res.json(data);
      } catch (e) {
        logger.error("[admin] library documents failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.get(
    `${base}/api/library/recent`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const limit = Math.min(
          Math.max(parseInt(String(req.query.limit)) || 60, 1),
          200,
        );
        const events = await listRecentLibraryReads(limit);
        res.json({ events });
      } catch (e) {
        logger.error("[admin] library recent failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.get(
    `${base}/api/library/resolve`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const token = String(req.query.token || "")
          .trim()
          .toUpperCase();
        if (!TOKEN_PATTERN.test(token)) {
          res
            .status(400)
            .json({ error: "That does not look like a watermark." });
          return;
        }
        const rows = await resolveLibraryToken(token);
        if (!rows.length) {
          res.status(404).json({ error: "No reads carry that mark." });
          return;
        }
        res.json({ token, reads: rows });
      } catch (e) {
        logger.error("[admin] library resolve failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );

  app.get(
    `${base}/api/library/readers/:userId`,
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const userId = String(req.params.userId);
        if (!/^\d+$/.test(userId)) {
          res.status(400).json({ error: "Bad user id" });
          return;
        }
        const reader = await getLibraryReader(userId);
        if (!reader) {
          res.status(404).json({ error: "No library reads for that user" });
          return;
        }
        const detail = await getReaderLibraryDetail(userId);
        res.json({ reader, ...detail });
      } catch (e) {
        logger.error("[admin] library reader detail failed:", e);
        res.status(500).json({ error: "Internal Server Error" });
      }
    },
  );
};
