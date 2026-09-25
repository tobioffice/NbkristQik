import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/student.utils/Academic.js', () => ({
  Academic: {
    parseAttendanceResponse: vi.fn(),
    parseMidmarksResponse: vi.fn(async (_doc: string, roll: string) => ({
      rollno: roll,
      year_branch_section: '3_CSE_A',
      subjects: [{ subject: 'MATH', M1: 20, M2: 30 }],
    })),
  },
}));

vi.mock('../../src/services/redis/getRedisClient.js', () => ({
  getClient: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    expire: vi.fn().mockResolvedValue(1),
  }),
}));

vi.mock('../../src/services/redis/utils.js', () => ({
  getStudentCached: vi.fn(async (roll: string) => {
    if (roll.includes('BAD')) throw new Error('not in db');
    return {
      roll_no: roll,
      name: 'Test Student',
      section: 'A',
      branch: '5',
      year: '31',
    };
  }),
}));

vi.mock('../../src/db/student_stats.model.js', () => ({
  updateAttendanceStat: vi.fn().mockResolvedValue(undefined),
  updateMidMarkStat: vi.fn().mockResolvedValue(undefined),
}));

import { storeMidMarksToRedis } from '../../src/services/redis/storeAttOrMidToRedis';
import { getClient } from '../../src/services/redis/getRedisClient.js';
import { updateMidMarkStat } from '../../src/db/student_stats.model.js';

const doc = '<html><body><table><tr id="GOOD0001"></tr><tr id="BAD00002"></tr></table></body></html>';

describe('storeMidMarksToRedis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should cache the valid students even when one lookup fails', async () => {
    await storeMidMarksToRedis(doc);

    const client = await getClient();
    expect(vi.mocked(client.set)).toHaveBeenCalledWith(
      'midmarks:GOOD0001',
      expect.any(String),
      { EX: 60 * 60 * 2 },
    );
    expect(vi.mocked(updateMidMarkStat)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(updateMidMarkStat)).toHaveBeenCalledWith('GOOD0001', 25);
  });
});
