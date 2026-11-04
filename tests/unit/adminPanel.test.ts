import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import {
  adminPanelCsp,
  createAdminPanelDocument,
} from "../../src/api/adminPanel.js";

const nonceFrom = (html: string): string | undefined =>
  /<script nonce="([a-f0-9]+)">/.exec(html)?.[1];

describe("the admin panel document", () => {
  it("puts a fresh nonce on both inline tags", () => {
    const first = createAdminPanelDocument();
    const second = createAdminPanelDocument();

    expect(first.nonce).toMatch(/^[a-f0-9]{32}$/);
    expect(first.html).toContain(`<style nonce="${first.nonce}">`);
    expect(first.html).toContain(`<script nonce="${first.nonce}">`);
    expect(second.nonce).not.toBe(first.nonce);
    expect(nonceFrom(first.html)).toBe(first.nonce);
  });

  it("builds a CSP that authorises exactly that nonce", () => {
    const { nonce } = createAdminPanelDocument();
    const csp = adminPanelCsp(nonce);

    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    );
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    // style attributes keep working; script-src must not carry unsafe-inline
    expect(csp).not.toContain("script-src 'unsafe-inline'");
  });
});

describe("the production admin password gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    process.env.ADMIN_PANEL_PATH = "";
    process.env.ADMIN_PANEL_PASSWORD = "";
  });

  const mountInProduction = async (password: string): Promise<string[]> => {
    vi.resetModules();
    vi.doMock("../../src/config/environmentals.js", () => ({
      ENV: "production",
    }));

    process.env.ADMIN_PANEL_PATH = "prod-panel";
    process.env.ADMIN_PANEL_PASSWORD = password;

    const { registerAdminRoutes } =
      await import("../../src/api/admin/index.js");

    const routes: string[] = [];
    const fakeApp = {
      get: (route: string) => routes.push(`GET ${route}`),
      post: (route: string) => routes.push(`POST ${route}`),
    } as unknown as Express;

    registerAdminRoutes(fakeApp);
    return routes;
  };

  it("refuses to mount the panel with a password shorter than 16 chars", async () => {
    // Fail the boot, not just the panel: a silently missing operator console
    // must not look like a healthy deploy.
    await expect(mountInProduction("short-password")).rejects.toThrow(
      /16 characters/,
    );
  });

  it("mounts the panel with a long password", async () => {
    const routes = await mountInProduction("a-long-enough-password");
    expect(routes).toContain("GET /prod-panel");
    expect(routes).toContain("POST /prod-panel/login");
  });
});
