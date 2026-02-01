import { vi } from 'vitest';

// Mock environment variables
process.env.ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test_bot_token';
process.env.N_USERNAME = 'test_user';
process.env.N_PASSWORD = 'test_pass';
process.env.ADMIN_ID = '123456789';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.TURSO_AUTH_TOKEN = 'test_token';

// Global test setup
beforeEach(() => {
  vi.clearAllMocks();
});
