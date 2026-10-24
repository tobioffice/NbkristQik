import { vi, beforeEach } from "vitest";

// Mock environment variables. Every var the app reads must be set (or
// explicitly deleted) here so a developer's real .env can never leak real
// credentials into tests — dotenv only fills vars that are still unset.
process.env.ENV = "test";
process.env.TELEGRAM_BOT_TOKEN = "test_bot_token";
process.env.TELEGRAM_BOT_TOKEN_DEV = "test_bot_token";
process.env.N_USERNAME = "test_user";
process.env.N_PASSWORD = "test_pass";
process.env.ADMIN_ID = "123456789";
// the library suites exercise the app itself, not the admin gate
process.env.LIBRARY_ACCESS = "all";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.TURSO_DATABASE_URL = "file::memory:";
process.env.TURSO_AUTH_TOKEN = "test_token";
// db.ts prefers LOCAL_DB_URL over Turso, so a stray embedded-DB path in a
// developer's .env must be blanked here or tests could touch production.
process.env.LOCAL_DB_URL = "";
process.env.TEST_CHANNEL = "@test_channel";
process.env.PROD_CHANNEL = "@test_channel";
process.env.PORTAL_BASE_URL = "http://127.0.0.1:9";
process.env.PORT = "3001";

// Keep the admin panel disabled in tests unless a suite opts in. Set to
// empty (not delete) because dotenv would re-fill a deleted var from .env.
process.env.ADMIN_PANEL_PATH = "";
process.env.ADMIN_PANEL_PASSWORD = "";

// Global test setup
beforeEach(() => {
  vi.clearAllMocks();
});
