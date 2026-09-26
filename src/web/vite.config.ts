import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    // local dev: proxy API calls to the backend started from the repo root
    // (pnpm dev) so no CORS/env juggling is needed; VITE_API_URL still wins
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
