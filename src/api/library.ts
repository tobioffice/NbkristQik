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
  consumePcLoginToken,
  createSession,
  dropSession,
  LIBRARY_PC_SESSION_TTL_SECONDS,
  LIBRARY_SESSION_COOKIE,
  LIBRARY_SESSION_TTL_SECONDS,
  readCookie,
  readSession,
  type LibrarySessionKind,
} from "../services/library/session.js";
import {
  listAllLiveSubjects,
  listSubjectsForStudent,
  mayReadDocument,
  resolveStudentContextCached,
  studentView,
  type StudentContext,
} from "../services/library/entitlement.js";
import {
  getLibraryDocument,
  type LibraryDocument,
} from "../db/library.model.js";
import { documentPagesDir, pageFileName } from "../services/library/paths.js";
import { stampPage, watermarkToken } from "../services/library/watermark.js";
import {
  ensureWatermarkedPdf,
  PdfBusyError,
  PdfTooLargeError,
} from "../services/library/pdf.js";
import {
  noteDownload,
  notePageRead,
  watchForBurst,
} from "../services/library/reads.js";

/**
 * The library API.
 *
 * Two rules hold for every route here:
 *   - the caller must have a session: signed Telegram initData, or a single-use
 *     PC link minted in the bot's private chat. A public browser URL opens
 *     nothing.
 *   - the caller must be registered. A session without a roll number sees no
 *     subjects, and the app asks for the roll instead.
 *
 * Both are checked by the two helpers below, so no route can forget one.
 *
 * TODO(P3-06): `src/api/profile.ts` is the registration writer and should call
 * `invalidateStudentContext(userId)` (exported by services/library/entitlement)
 * after a successful upsert, so a changed roll reaches the library on the next
 * request instead of the next one-minute window. That file is outside this
 * change; until it is wired, the TTL is the worst case.
 */

export const libraryRouter = Router();

// Every library JSON response is per-reader. The page/PDF routes override the
// cache policy with their own short private cache; the default is no-store.
libraryRouter.use((_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.vary("Cookie");
  next();
});

const secureCookie = ENV === "production";

const setSessionCookie = (
  res: Response,
  token: string,
  ttlSeconds = LIBRARY_SESSION_TTL_SECONDS,
): void => {
  res.cookie(LIBRARY_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: "strict",
    maxAge: ttlSeconds * 1000,
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
  kind: LibrarySessionKind;
  /** The reader, resolved once per session per minute; null = unregistered. */
  ctx: StudentContext | null;
}

/**
 * Reads the session cookie, or answers 401 and returns null.
 *
 * The Redis session is still read on every request: that is how a logout or
 * a closed library takes effect at once. The student behind it is cached for
 * a minute, because it can only change when the registration changes.
 */
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

  const ctx = await resolveStudentContextCached(token, session.userId);
  return {
    userId: session.userId,
    token,
    kind: session.kind ?? "telegram",
    ctx,
  };
};

/** Resolves the reader, or answers 403 and returns null. */
const requireStudent = (
  res: Response,
  ctx: StudentContext | null,
): StudentContext | null => {
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
 * The document row, cached for a minute by id.
 *
 * This is an index row, not the page bytes: the file is still read and
 * stamped for every delivery. A minute keeps a takedown prompt enough to
 * notice, and the live check below still runs against the cached row. A
 * missing row is never cached, so a document that goes live is not refused
 * for the rest of the minute.
 */
const DOCUMENT_TTL_MS = 60_000;
const DOCUMENT_CACHE_LIMIT = 500;

const documentCache = new Map<
  string,
  { doc: LibraryDocument; expiresAt: number }
>();

const getDocumentCached = async (
  id: string,
): Promise<LibraryDocument | null> => {
  const hit = documentCache.get(id);
  if (hit && hit.expiresAt > Date.now()) return hit.doc;
  if (hit) documentCache.delete(id);

  const doc = await getLibraryDocument(String(id));
  if (!doc) return null;

  if (documentCache.size >= DOCUMENT_CACHE_LIMIT) {
    const oldest = documentCache.keys().next();
    if (!oldest.done) documentCache.delete(oldest.value);
  }
  documentCache.set(id, { doc, expiresAt: Date.now() + DOCUMENT_TTL_MS });
  return doc;
};

/**
 * Loads the document this student asked for, or answers and returns null.
 *
 * A document that is missing, not live, or not of the reader's own semester
 * is refused here, so the page route cannot serve a page the reader may not
 * open. Entitlement is checked per request, even when the reader and the
 * document row both came from a cache.
 */
const requireReadableDocument = async (
  res: Response,
  ctx: StudentContext,
  id: string,
): Promise<LibraryDocument | null> => {
  const doc = await getDocumentCached(String(id));
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

// POST /api/library/session — swap Telegram's signed initData (or a one-shot
// PC token minted by the bot) for a cookie
libraryRouter.post("/session", async (req: Request, res: Response) => {
  try {
    // A link the bot minted for a PC browser. It is presented *instead of*
    // initData: if it is bad, fail here rather than falling back to a blob
    // that may belong to a different account. A non-string/empty value is a
    // bad link, not "no link".
    const hasPcToken = Object.prototype.hasOwnProperty.call(
      req.body ?? {},
      "pcToken",
    );
    const pcToken =
      typeof req.body?.pcToken === "string" ? req.body.pcToken.trim() : "";

    let userId: string;
    let kind: LibrarySessionKind = "telegram";
    let ttlSeconds = LIBRARY_SESSION_TTL_SECONDS;

    if (hasPcToken) {
      if (!pcToken) {
        refuse(
          res,
          401,
          "This computer link has expired. Ask the bot for a new one.",
        );
        return;
      }
      const consumed = await consumePcLoginToken(pcToken);
      if (!consumed) {
        refuse(
          res,
          401,
          "This computer link has expired. Ask the bot for a new one.",
        );
        return;
      }
      userId = consumed;
      kind = "pc";
      // A shared computer gets a shorter session than a personal Telegram
      // client, and the library UI offers a sign-out.
      ttlSeconds = LIBRARY_PC_SESSION_TTL_SECONDS;
    } else {
      const initData =
        typeof req.body?.initData === "string" ? req.body.initData : "";
      const user = verifyInitData(initData);
      if (!user) {
        refuse(res, 401, "This page only works inside the NbkristQik bot.");
        return;
      }
      userId = String(user.id);
    }

    // the library is the admin's until the shelf is filled
    if (!canOpenLibrary(userId)) {
      refuse(res, 403, "The library is not open yet.");
      return;
    }

    // Tab visits re-POST here. Keep the session the cookie already carries
    // when it still belongs to this account and this session kind: a new
    // token on every mount left a trail of live keys nothing would read
    // again. A PC exchange always mints its own short session.
    const existingToken = readCookie(
      req.headers.cookie,
      LIBRARY_SESSION_COOKIE,
    );
    const existing = await readSession(existingToken);
    const token =
      kind === "telegram" &&
      existingToken &&
      existing?.userId === userId &&
      (existing.kind ?? "telegram") === "telegram"
        ? existingToken
        : await createSession(userId, { kind, ttlSeconds });

    setSessionCookie(res, token, ttlSeconds);

    const ctx = await resolveStudentContextCached(token, userId);
    trackActivity({
      userId: Number(userId),
      chatType: "unknown",
      action: "library_open",
    });

    res.json({
      ok: true,
      kind,
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

  res.json({
    ok: true,
    kind: auth.kind,
    registered: Boolean(auth.ctx),
    student: auth.ctx ? studentView(auth.ctx) : null,
  });
});

// GET /api/library/subjects — the student's subjects for the running semester
libraryRouter.get("/subjects", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = requireStudent(res, auth.ctx);
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

/** A download name the browser and the filesystem both accept. */
const downloadFileName = (doc: LibraryDocument): string => {
  const stem =
    `NbkristQik-${doc.code}${doc.unit ? `-u${doc.unit}` : ""}`.replace(
      /[^A-Za-z0-9_-]/g,
      "_",
    );
  return `${stem}.pdf`;
};

// GET /api/library/document/:id/pdf — the whole document, stamped for this
// reader. Registered before `/document/:id` so the two can never be confused.
libraryRouter.get("/document/:id/pdf", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = requireStudent(res, auth.ctx);
  if (!ctx) return;

  const doc = await requireReadableDocument(res, ctx, req.params.id);
  if (!doc) return;

  // Same rule as a page: no server secret means no trustworthy mark, and an
  // unstamped copy must never leave the box.
  let token: string;
  try {
    token = watermarkToken(auth.userId);
  } catch (e) {
    logger.error(
      "[library] watermark unavailable:",
      e instanceof Error ? e.message : e,
    );
    refuse(res, 503, "Library pages are temporarily unavailable.");
    return;
  }

  let file: string;
  try {
    file = await ensureWatermarkedPdf(doc, token);
  } catch (e) {
    if (e instanceof PdfBusyError) {
      res.setHeader("Retry-After", "10");
      refuse(
        res,
        503,
        "The library is preparing a lot of downloads. Try again in a moment.",
      );
      return;
    }
    if (e instanceof PdfTooLargeError) {
      refuse(res, 413, e.message);
      return;
    }
    logger.error(
      "[library] could not prepare a download:",
      e instanceof Error ? e.message : e,
    );
    refuse(res, 500, "Could not prepare this document.");
    return;
  }

  res.download(
    file,
    downloadFileName(doc),
    {
      headers: {
        "Content-Type": "application/pdf",
        // The bytes are the reader's own copy, so only a private cache may
        // keep them. `Vary: Cookie` keeps two accounts on one browser apart.
        "Cache-Control": "private, max-age=3600",
        Vary: "Cookie",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
      },
    },
    (error) => {
      if (!error) return;
      logger.warn("[library] download failed:", error.message);
      if (!res.headersSent) refuse(res, 500, "Could not send this document.");
    },
  );

  // one audit row per reader, document and hour, carrying the same token as
  // the pages; the file is already on its way
  noteDownload(auth.userId, doc.id, token);
  // A download delivers the whole unit at once, so count its pages in the
  // same five-minute burst window as page views. The audit row is deduped;
  // this counter is not.
  void watchForBurst(auth.userId, Math.max(1, doc.page_count));
});

// GET /api/library/document/:id — what is in a document, and may I read it
libraryRouter.get("/document/:id", async (req: Request, res: Response) => {
  const auth = await requireSession(req, res);
  if (!auth) return;

  const ctx = requireStudent(res, auth.ctx);
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

  const ctx = requireStudent(res, auth.ctx);
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
  let token: string;
  try {
    token = watermarkToken(ctx.userId);
  } catch (e) {
    // no server secret means no trustworthy mark: serving an unstamped page
    // would be worse than a short outage, and a 503 says "try later" clearly
    logger.error(
      "[library] watermark unavailable:",
      e instanceof Error ? e.message : e,
    );
    refuse(res, 503, "Library pages are temporarily unavailable.");
    return;
  }
  const stamped = await stampPage(file, {
    token,
    label: `${doc.title}${doc.unit ? ` · Unit ${doc.unit}` : ""} · p${page}`,
  });

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  // The mark is per reader, so the bytes may live in that reader's private
  // browser cache: a shared cache can never store them, and a copy taken from
  // the cache still carries the mark that names them. `Vary: Cookie` keeps two
  // accounts on one browser from sharing an entry. The trade-off is on the
  // audit side: a re-view inside five minutes may never reach us, so the
  // library_reads row is the first delivery in each hour (see reads.ts).
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Vary", "Cookie");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.send(stamped);

  notePageRead(auth.userId, doc.id, page, token);
  // the burst counter must not keep the response open: it is telemetry, not
  // part of serving the page
  void watchForBurst(auth.userId);
});
