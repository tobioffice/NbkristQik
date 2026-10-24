import { Request, Response, Router } from "express";
import { existsSync } from "fs";
import path from "path";
import { verifyInitData } from "../services/telegramAuth.js";
import {
  canOpenLibrary,
  canPreviewEverything,
} from "../services/library/access.js";
import { trackActivity } from "../services/tracker.js";
import { logger } from "../config/logger.js";
import { ENV } from "../config/environmentals.js";
import {
  createSession,
  dropSession,
  LIBRARY_SESSION_COOKIE,
  LIBRARY_SESSION_TTL_SECONDS,
  readCookie,
  readSession,
} from "../services/library/session.js";
import {
  listAllLiveSubjects,
  listSubjectsForStudent,
  resolveStudentContext,
  type StudentContext,
} from "../services/library/entitlement.js";
import {
  getLibraryDocument,
  recordLibraryRead,
  type LibraryDocument,
} from "../db/library.model.js";
import { documentPagesDir, pageFileName } from "../services/library/paths.js";
import { stampPage, watermarkToken } from "../services/library/watermark.js";
import { getClient } from "../services/redis/getRedisClient.js";
import { redisKeys } from "../services/redis/keys.js";

/**
 * The library API.
 *
 * Two rules hold for every route here:
 *   - the caller must be inside Telegram. A signed initData blob is the only
 *     thing that can open a session, and only the Telegram client can produce
 *     one. Opening the URL in a browser gets nothing.
 *   - the caller must be registered. A session without a roll number sees no
 *     subjects, and the app asks for the roll instead.
 */

export const libraryRouter = Router();

const secureCookie = ENV === "production";

const setSessionCookie = (res: Response, token: string): void => {
  res.cookie(LIBRARY_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    maxAge: LIBRARY_SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
};

const clearSessionCookie = (res: Response): void => {
  res.clearCookie(LIBRARY_SESSION_COOKIE, { path: "/" });
};

interface AuthedSession {
  userId: string;
  token: string;
}

/** Reads the session cookie, or answers 401 and returns null. */
const requireSession = async (
  req: Request,
  res: Response,
): Promise<AuthedSession | null> => {
  const token = readCookie(req.headers.cookie, LIBRARY_SESSION_COOKIE);
  const session = await readSession(token);
  if (!session || !token) {
    res
      .status(401)
      .json({ ok: false, error: "Open the library from Telegram" });
    return null;
  }
  // a session made before the library was closed must not outlive the close
  if (!canOpenLibrary(session.userId)) {
    res.status(403).json({ ok: false, error: "The library is not open yet." });
    return null;
  }
  return { userId: session.userId, token };
};

// POST /api/library/session — swap Telegram's signed initData for a cookie
libraryRouter.post("/session", async (req: Request, res: Response) => {
  try {
    const initData =
      typeof req.body?.initData === "string" ? req.body.initData : "";
    const user = verifyInitData(initData);
    if (!user) {
      res.status(401).json({
        ok: false,
        error: "This page only works inside the NbkristQik bot.",
      });
      return;
    }

    // the library is the admin's until the shelf is filled
    if (!canOpenLibrary(user.id)) {
      res
        .status(403)
        .json({ ok: false, error: "The library is not open yet." });
      return;
    }

    const token = await createSession(String(user.id));
    setSessionCookie(res, token);

    const ctx = await resolveStudentContext(String(user.id));
    trackActivity({
      userId: user.id,
      chatType: "unknown",
      action: "library_open",
    });

    res.json({
      ok: true,
      registered: Boolean(ctx),
      student: ctx
        ? {
            rollNo: ctx.rollNo,
            name: ctx.name,
            yearSem: ctx.yearSem,
            branch: ctx.branch,
            dept: ctx.dept,
            regulation: ctx.regulation,
          }
        : null,
    });
  } catch (e) {
    logger.error("[library] session exchange failed:", e);
    res.status(500).json({ ok: false, error: "Could not start a session" });
  }
});

// DELETE /api/library/session — the student leaves
libraryRouter.delete("/session", async (req: Request, res: Response) => {
  const token = readCookie(req.headers.cookie, LIBRARY_SESSION_COOKIE);
  if (token) await dropSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/library/me — who the session belongs to
libraryRouter.get("/me", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = await resolveStudentContext(auth.userId);
  res.json({
    ok: true,
    registered: Boolean(ctx),
    student: ctx
      ? {
          rollNo: ctx.rollNo,
          name: ctx.name,
          yearSem: ctx.yearSem,
          branch: ctx.branch,
          dept: ctx.dept,
          regulation: ctx.regulation,
        }
      : null,
  });
});

// GET /api/library/subjects — the student's subjects for the running semester
libraryRouter.get("/subjects", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = await resolveStudentContext(auth.userId);
  if (!ctx) {
    res.status(403).json({
      ok: false,
      registered: false,
      error: "Save your roll number first.",
    });
    return;
  }

  // the admin's preview shows the whole shelf, not just their own semester;
  // ?view=roll answers with exactly what the registered roll would see
  const admin = canPreviewEverything(auth.userId);
  const preview = admin && req.query.view !== "roll";
  const subjects = preview
    ? await listAllLiveSubjects()
    : await listSubjectsForStudent(ctx);
  res.json({
    ok: true,
    admin,
    preview,
    student: {
      rollNo: ctx.rollNo,
      name: ctx.name,
      yearSem: ctx.yearSem,
      dept: ctx.dept,
      regulation: ctx.regulation,
    },
    subjects,
  });
});

/**
 * May this student read this document?
 *
 * The shelf is our own material, so the rule is the document's own semester:
 * the reader's department, regulation and year-sem must match the document's.
 * A document id alone gets nothing.
 */
const mayRead = (ctx: StudentContext, doc: LibraryDocument): boolean => {
  // the admin previews any live document while the library is theirs
  if (canPreviewEverything(ctx.userId)) return true;
  if (!ctx.dept) return false;
  return (
    doc.dept === ctx.dept &&
    doc.regulation === ctx.regulation &&
    doc.year_sem === ctx.yearSem
  );
};

// GET /api/library/document/:id — what is in a document, and may I read it
libraryRouter.get("/document/:id", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = await resolveStudentContext(auth.userId);
  if (!ctx) {
    res.status(403).json({ ok: false, error: "Save your roll number first." });
    return;
  }

  const doc = await getLibraryDocument(String(req.params.id));
  if (!doc || doc.status !== "live") {
    res.status(404).json({ ok: false, error: "That document is not here." });
    return;
  }
  if (!mayRead(ctx, doc)) {
    res.status(403).json({ ok: false, error: "That subject is not yours." });
    return;
  }

  res.json({
    ok: true,
    document: {
      id: doc.id,
      code: doc.code,
      title: doc.title,
      unit: doc.unit,
      pages: doc.page_count,
      version: doc.version,
    },
  });
});

/**
 * Counts pages per student over a short window, so a bulk pull
 * stands out. Best effort: if Redis is down the reading still works.
 */
const countRecentPages = async (userId: string): Promise<number> => {
  try {
    const client = await getClient();
    const key = redisKeys.libraryReads(userId);
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, 300);
    return count;
  } catch {
    return 0;
  }
};

// GET /api/library/page/:id/:page — one page, stamped with the reader's id
libraryRouter.get("/page/:id/:page", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = await resolveStudentContext(auth.userId);
  if (!ctx) {
    res.status(403).json({ ok: false, error: "Save your roll number first." });
    return;
  }

  const doc = await getLibraryDocument(String(req.params.id));
  if (!doc || doc.status !== "live") {
    res.status(404).json({ ok: false, error: "That document is not here." });
    return;
  }
  if (!mayRead(ctx, doc)) {
    res.status(403).json({ ok: false, error: "That subject is not yours." });
    return;
  }

  const page = Number(req.params.page);
  if (!Number.isInteger(page) || page < 1 || page > doc.page_count) {
    res.status(400).json({ ok: false, error: "No such page." });
    return;
  }

  const file = path.join(documentPagesDir(doc.id), pageFileName(page));
  if (!existsSync(file)) {
    res.status(404).json({ ok: false, error: "No such page." });
    return;
  }

  // The page carries an opaque token, not the reader's id or roll number:
  // the student sees a code they cannot read, and we resolve it server side
  // if the page ever turns up somewhere it should not.
  const token = watermarkToken(ctx.userId);
  const stamped = await stampPage(file, {
    token,
    label: `${doc.title}${doc.unit ? ` · Unit ${doc.unit}` : ""} · p${page}`,
  });

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.send(stamped);

  void recordLibraryRead(auth.userId, doc.id, page, token).catch((e) =>
    logger.warn("[library] could not record a read:", e),
  );

  const recent = await countRecentPages(auth.userId);
  if (recent > 300) {
    logger.warn(
      `[library] user ${auth.userId} pulled ${recent} pages in five minutes`,
    );
  }
});
