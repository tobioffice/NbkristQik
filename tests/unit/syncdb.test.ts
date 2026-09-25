import { describe, it, expect } from 'vitest';
import { buildStudentRow } from '../../src/db/student.model';

describe('buildStudentRow', () => {
  it('should keep the numeric branch code the lookup path needs', () => {
    const row = buildStudentRow('41', '5', 'B', '23kb1a05b1');

    expect(row).toEqual({
      roll_no: '23KB1A05B1',
      name: null,
      section: 'B',
      branch: '5',
      year: '41',
    });
  });

  it('should preserve the "-" section used by lateral entries', () => {
    const row = buildStudentRow('21', '2', '-', '26kb5a0219');

    expect(row.section).toBe('-');
    expect(row.branch).toBe('2');
  });
});
