import { describe, it, expect } from 'vitest';
import { app } from '../../src/api/server';

describe('trust proxy', () => {
  it('should trust the single nginx hop for real client IPs', () => {
    expect(app.get('trust proxy')).toBe(1);
  });
});
