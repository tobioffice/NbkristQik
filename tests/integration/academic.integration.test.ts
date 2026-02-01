import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcademicTG } from '../../src/services/student.utils/AcademicTG';
import { Academic } from '../../src/services/student.utils/Academic';
import { mockAttendance, mockMidmarks } from '../mocks/academic.mock';

// Mock external dependencies
vi.mock('axios');
vi.mock('../../src/services/redis/getRedisClient.js', () => ({
  getClient: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    expire: vi.fn().mockResolvedValue(1),
  }),
}));
vi.mock('../../src/services/redis/utils.js', () => ({
  getStudentCached: vi.fn().mockResolvedValue({
    roll_no: '21B81A05E9',
    name: 'Test Student',
    section: 'A',
    branch: '5',
    year: '32',
  }),
}));
vi.mock('../../src/db/fallback/response.model.js', () => ({
  storeResponse: vi.fn().mockResolvedValue(undefined),
  getResponse: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../src/services/redis/storeAttOrMidToRedis.js', () => ({
  storeAttendanceToRedis: vi.fn().mockResolvedValue(undefined),
  storeMidMarksToRedis: vi.fn().mockResolvedValue(undefined),
}));

describe('Academic Integration Tests', () => {
  const rollNumber = '21B81A05E9';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AcademicTG Formatting', () => {
    it('should format attendance message when data is mocked', async () => {
      const academicTG = new AcademicTG(rollNumber);
      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(mockAttendance);

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('21B81A05E9');
      expect(message).toContain('3_CSE_A');
      expect(message).toBeTruthy();
    });

    it('should format midmarks message when data is mocked', async () => {
      const academicTG = new AcademicTG(rollNumber);
      vi.spyOn(academicTG, 'getMidmarksJSON').mockResolvedValue(mockMidmarks);

      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain('21B81A05E9');
      expect(message).toContain('📊 Mid Marks Report');
      expect(message).toBeTruthy();
    });
  });

  describe('Error Handling Flow', () => {
    it('should return error message when getAttendanceJSON fails', async () => {
      const academicTG = new AcademicTG(rollNumber);
      vi.spyOn(academicTG, 'getAttendanceJSON').mockRejectedValue(new Error('Network error'));

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('Error');
      expect(message).toContain('Unable to fetch attendance');
    });

    it('should return error message when getMidmarksJSON fails', async () => {
      const academicTG = new AcademicTG(rollNumber);
      vi.spyOn(academicTG, 'getMidmarksJSON').mockRejectedValue(new Error('Network error'));

      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain('Error');
      expect(message).toContain('Unable to fetch midmarks');
    });
  });

  describe('Academic Class', () => {
    it('should create Academic instance with normalized roll number', () => {
      const academic = new Academic('21b81a05e9');

      expect(academic.rollnumber).toBe('21B81A05E9');
    });

    it('should trim whitespace from roll number', () => {
      const academic = new Academic('  21B81A05E9  ');

      expect(academic.rollnumber).toBe('21B81A05E9');
    });
  });
});
