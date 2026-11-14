import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, renameSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Dev only: the app's entry is app.html, but Vite's dev server looks for
// index.html at the base path. Rewrite /library/ to the real entry so the
// LAN preview opens on a clean URL instead of /library/app.html.
const devAppEntry: Plugin = {
  name: "dev-app-entry",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [pathname, query] = (req.url ?? "").split("?");
      if (pathname === "/library" || pathname === "/library/") {
        req.url = `/library/app.html${query ? `?${query}` : ""}`;
      }
      next();
    });
  },
};

// The app is served at /library/, so the page itself has to be index.html.
// Vite names the output after the source file, so it is renamed once the
// bundle is written.
const renameToIndex: Plugin = {
  name: "app-index-html",
  closeBundle() {
    const from = path.join(here, "dist-library", "app.html");
    const to = path.join(here, "dist-library", "index.html");
    if (existsSync(from)) renameSync(from, to);
  },
};

// The one app in this package. It is served by our own host at /library/ (so
// the library's session cookie is first-party), and it is the only surface
// that talks to /api/library.
export default defineConfig({
  plugins: [react(), renameToIndex, devAppEntry],
  base: "/library/",
  build: {
    outDir: "dist-library",
    emptyOutDir: true,
    rollupOptions: {
      input: { index: "app.html" },
    },
  },
  server: {
    // local dev: the API runs from the repo root
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
