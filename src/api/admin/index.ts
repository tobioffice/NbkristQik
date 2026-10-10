import type { Express, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { adminPanelHtml } from "../adminPanel.js";
import { createRequireAdmin } from "./auth.js";
import { registerLoginRoutes } from "./login.js";
import { registerOverviewRoute } from "./overview.js";
import { registerUsersRoutes } from "./users.js";
import { registerRecentRoute, registerHealthRoute } from "./feed.js";
import { registerReportsRoutes } from "./reports.js";

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
  const base = `/${secretPath}`;
  const requireAdmin = createRequireAdmin(password);

  registerLoginRoutes(app, base, password, requireAdmin);

  // ---- panel shell (UI only — every data endpoint below requires auth) ----
  app.get(base, (_req: Request, res: Response) => {
    res.type("html").send(adminPanelHtml());
  });

  registerOverviewRoute(app, base, requireAdmin);
  registerUsersRoutes(app, base, requireAdmin);
  registerRecentRoute(app, base, requireAdmin);
  registerReportsRoutes(app, base, requireAdmin);
  registerHealthRoute(app, base, requireAdmin);

  logger.info(`[admin] panel mounted at ${base}`);
};
