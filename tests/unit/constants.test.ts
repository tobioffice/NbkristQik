import { describe, it, expect } from 'vitest';
import { BRANCHES } from '../../src/constants/index';

describe('Constants', () => {
  describe('BRANCHES', () => {
    it('should have correct branch mappings', () => {
      expect(BRANCHES).toBeDefined();
      // BRANCHES uses numeric keys, not string keys
      expect(BRANCHES[5]).toBe('CSE');
    });

    it('should handle all branch codes', () => {
      expect(Object.keys(BRANCHES).length).toBeGreaterThan(0);
    });
  });
});
