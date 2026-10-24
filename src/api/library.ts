import { Router, type Request, type Response } from "express";
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
  mayReadDocument,
  resolveStudentContext,
  studentView,
  type StudentContext,
} from "../services/library/entitlement.js";
import {
  getLibraryDocument,
  type LibraryDocument,
} from "../db/library.model.js";
import { documentPagesDir, pageFileName } from "../services/library/paths.js";
import { stampPage, watermarkToken } from "../services/library/watermark.js";
import { notePageRead, watchForBurst } from "../services/library/reads.js";

/**
 * The library API.
 *
 * Two rules hold for every route here:
 *   - the caller must be inside Telegram. A signed initData blob is the only
 *     thing that can open a session, and only the Telegram client can produce
 *     one. Opening the URL in a browser gets nothing.
 *   - the caller must be registered. A session without a roll number sees no
 *     subjects, and the app asks for the roll instead.
 *
 * Both are checked by the two helpers below, so no route can forget one.
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

/** Answers with an error status and returns null, for the guards below. */
const refuse = (res: Response, status: number, error: string): null => {
  res.status(status).json({ ok: false, error });
  return null;
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
    refuse(res, 401, "Open the library from Telegram");
    return null;
  }
  // a session made before the library was closed must not outlive the close
  if (!canOpenLibrary(session.userId)) {
    refuse(res, 403, "The library is not open yet.");
    return null;
  }
  return { userId: session.userId, token };
};

/** Resolves the reader, or answers 403 and returns null. */
const requireStudent = async (
  res: Response,
  userId: string,
): Promise<StudentContext | null> => {
  const ctx = await resolveStudentContext(userId);
  if (!ctx) {
    res.status(403).json({
      ok: false,
      registered: false,
      error: "Save your roll number first.",
    });
    return null;
  }
  return ctx;
};

/**
 * Loads the document this student asked for, or answers and returns null.
 *
 * A document that is missing, not live, or not of the reader's own semester
 * is refused here, so the page route cannot serve a page the reader may not
 * open.
 */
const requireReadableDocument = async (
  res: Response,
  ctx: StudentContext,
  id: string,
): Promise<LibraryDocument | null> => {
  const doc = await getLibraryDocument(String(id));
  if (!doc || doc.status !== "live") {
    refuse(res, 404, "That document is not here.");
    return null;
  }
  if (!mayReadDocument(ctx, doc)) {
    refuse(res, 403, "That subject is not yours.");
    return null;
  }
  return doc;
};

// POST /api/library/session — swap Telegram's signed initData for a cookie
libraryRouter.post("/session", async (req: Request, res: Response) => {
  try {
    const initData =
      typeof req.body?.initData === "string" ? req.body.initData : "";
    const user = verifyInitData(initData);
    if (!user) {
      refuse(res, 401, "This page only works inside the NbkristQik bot.");
      return;
    }

    // the library is the admin's until the shelf is filled
    if (!canOpenLibrary(user.id)) {
      refuse(res, 403, "The library is not open yet.");
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
      student: ctx ? studentView(ctx) : null,
    });
  } catch (e) {
    logger.error("[library] session exchange failed:", e);
    refuse(res, 500, "Could not start a session");
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
    student: ctx ? studentView(ctx) : null,
  });
});

// GET /api/library/subjects — the student's subjects for the running semester
libraryRouter.get("/subjects", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = await requireStudent(res, auth.userId);
  if (!ctx) return;

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
    student: studentView(ctx),
    subjects,
  });
});

// GET /api/library/document/:id — what is in a document, and may I read it
libraryRouter.get("/document/:id", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = await requireStudent(res, auth.userId);
  if (!ctx) return;

  const doc = await requireReadableDocument(res, ctx, req.params.id);
  if (!doc) return;

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

// GET /api/library/page/:id/:page — one page, stamped with the reader's id
libraryRouter.get("/page/:id/:page", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = await requireStudent(res, auth.userId);
  if (!ctx) return;

  const doc = await requireReadableDocument(res, ctx, req.params.id);
  if (!doc) return;

  const page = Number(req.params.page);
  if (!Number.isInteger(page) || page < 1 || page > doc.page_count) {
    refuse(res, 400, "No such page.");
    return;
  }

  const file = path.join(documentPagesDir(doc.id), pageFileName(page));
  if (!existsSync(file)) {
    refuse(res, 404, "No such page.");
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

  notePageRead(auth.userId, doc.id, page, token);
  await watchForBurst(auth.userId);
});
