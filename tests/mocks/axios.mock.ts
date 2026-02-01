import { vi } from 'vitest';

export const mockAxios = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  request: vi.fn(),
};

vi.mock('axios', () => ({
  default: mockAxios,
}));
