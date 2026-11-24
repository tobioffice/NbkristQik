import type { Express, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { ENV } from "../../config/environmentals.js";
import { adminPanelCsp, createAdminPanelDocument } from "../adminPanel.js";
import { createRequireAdmin } from "./auth.js";
import { registerLoginRoutes } from "./login.js";
import { registerOverviewRoute } from "./overview.js";
import { registerUsersRoutes } from "./users.js";
import { registerRecentRoute, registerHealthRoute } from "./feed.js";
import { registerReportsRoutes } from "./reports.js";
import { registerPapersRoutes } from "./papers.js";
import { registerLibraryRoutes } from "./library.js";
import { registerVerifiedRoutes } from "./verified.js";
import { registerLeagueRoutes } from "./league.js";
import { registerModerationRoutes } from "./moderation.js";

/**
 * Admin panel route registry. Disabled (no routes) unless both
 * ADMIN_PANEL_PATH and ADMIN_PANEL_PASSWORD are set.
 *
 * Split into focused modules:
 *  - auth.ts      session/cookie/rate-limit primitives + requireAdmin
 *  - login.ts     POST /login, POST /logout
 *  - cache.ts     short-TTL in-memory response cache
 *  - overview.ts  GET /api/overview
 *  - users.ts     GET /api/users, GET /api/users/:id
 *  - feed.ts      GET /api/recent, GET /api/health
 *  - league.ts    GET /api/league — the week's boards, read-only
 *  - moderation.ts chat regulation settings, words, users and actions
 */
export const registerAdminRoutes = (app: Express): void => {
  const secretPath = process.env.ADMIN_PANEL_PATH?.replace(/^\/+|\/+$/g, "");
  const password = process.env.ADMIN_PANEL_PASSWORD;

  if (!secretPath || !password) {
    logger.info(
      "[admin] ADMIN_PANEL_PATH / ADMIN_PANEL_PASSWORD not set — admin panel disabled",
    );
    return;
  }

  // A short password on a public host is a brute-force invitation. Tests run
  // with ENV=test, so short fixture passwords stay usable there.
  if (ENV === "production" && password.length < 16) {
    // Fail the process, not just the panel: a green service with a silently
    // missing operator console is worse than a loud boot failure.
    throw new Error(
      "[admin] ADMIN_PANEL_PASSWORD is shorter than 16 characters. " +
        "Set a longer password and restart.",
    );
  }

  const base = `/${secretPath}`;
  const requireAdmin = createRequireAdmin(password);

  registerLoginRoutes(app, base, password, requireAdmin);

  // ---- panel shell (UI only — every data endpoint below requires auth) ----
  app.get(base, (_req: Request, res: Response) => {
    // the JS is embedded in this document: never serve a stale copy after a
    // deploy, or the panel talks to endpoints its code doesn't know about
    const { html, nonce } = createAdminPanelDocument();
    res.set({
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": adminPanelCsp(nonce),
    });
    res.type("html").send(html);
  });

  registerOverviewRoute(app, base, requireAdmin);
  registerUsersRoutes(app, base, requireAdmin);
  registerRecentRoute(app, base, requireAdmin);
  registerReportsRoutes(app, base, requireAdmin);
  registerPapersRoutes(app, base, requireAdmin);
  registerHealthRoute(app, base, requireAdmin);
  registerLibraryRoutes(app, base, requireAdmin);
  registerVerifiedRoutes(app, base, requireAdmin);
  registerLeagueRoutes(app, base, requireAdmin);
  registerModerationRoutes(app, base, requireAdmin);

  logger.info(`[admin] panel mounted at ${base}`);
};
