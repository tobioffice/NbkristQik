import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

// /library is mounted at import time, so point it at a fixture directory
// before the server module is loaded.
const temp = mkdtempSync(path.join(os.tmpdir(), "nbq-static-"));
const libraryDir = path.join(temp, "library");
mkdirSync(path.join(libraryDir, "assets"), { recursive: true });
writeFileSync(
  path.join(libraryDir, "index.html"),
  "<!doctype html><html><body>library</body></html>",
);
writeFileSync(
  path.join(libraryDir, "assets", "app-abc123.js"),
  "console.log('ok')",
);
process.env.LIBRARY_WEB_DIR = libraryDir;

const statusFile = path.join(temp, "status", "index.html");
mkdirSync(path.dirname(statusFile), { recursive: true });
writeFileSync(statusFile, "<!doctype html><html><body>status</body></html>");
const missingStatusFile = path.join(temp, "status", "missing.html");

const { app } = await import("../../src/api/server.js");

afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
  delete process.env.STATUS_PAGE_PATH;
});

describe("GET /status", () => {
  it("serves the status page uncached", async () => {
    process.env.STATUS_PAGE_PATH = statusFile;

    const res = await request(app).get("/status");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.text).toContain("status");
  });

  it("answers a clean 404 when the deployed page is missing", async () => {
    process.env.STATUS_PAGE_PATH = missingStatusFile;

    const res = await request(app).get("/status");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
  });
});

describe("the /library static mount", () => {
  it("revalidates the HTML entry so a deploy is picked up", async () => {
    const res = await request(app).get("/library/");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.text).toContain("library");
  });

  it("keeps the explicit index.html revalidating too", async () => {
    const res = await request(app).get("/library/index.html");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("caches hashed assets as immutable", async () => {
    const res = await request(app).get("/library/assets/app-abc123.js");

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
  });
});
