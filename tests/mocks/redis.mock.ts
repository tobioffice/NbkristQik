import { vi } from 'vitest';

export const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  setEx: vi.fn(),
  del: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
};

export const mockGetClient = vi.fn().mockResolvedValue(mockRedisClient);

vi.mock('../../src/services/redis/getRedisClient.js', () => ({
  getClient: mockGetClient,
}));
