import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, renameSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));

// The library is served at /library/, so the page itself has to be
// index.html. Vite names the output after the source file, so it is renamed
// once the bundle is written.
const renameToIndex = {
  name: "library-index-html",
  closeBundle() {
    const from = path.join(here, "dist-library", "library.html");
    const to = path.join(here, "dist-library", "index.html");
    if (existsSync(from)) renameSync(from, to);
  },
};

// The library mini app is built separately from the leaderboard/register
// pages: it is served by our own host (so the session cookie is first-party)
// and it is the only page that talks to /api/library.
export default defineConfig({
  plugins: [react(), renameToIndex],
  base: "/library/",
  build: {
    outDir: "dist-library",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // the key decides the output name: dist-library/index.html
        index: "library.html",
      },
    },
  },
  server: {
    // local dev: the API runs from the repo root
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
