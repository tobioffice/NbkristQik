import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Academic, AcademicError, ServerDownError, BlockedReportError, NoDataFoundError } from '../../src/services/student.utils/Academic';
import { mockStudent, mockAttendance, mockMidmarks, mockAttendanceHTML, mockMidmarksHTML } from '../mocks/academic.mock';

// Mock dependencies
vi.mock('../../src/services/redis/utils.js', () => ({
  getStudentCached: vi.fn().mockResolvedValue(mockStudent),
}));

vi.mock('../../src/services/redis/getRedisClient.js', () => ({
  getClient: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    setEx: vi.fn(),
  }),
}));

vi.mock('../../src/services/redis/storeAttOrMidToRedis.js', () => ({
  storeAttendanceToRedis: vi.fn(),
  storeMidMarksToRedis: vi.fn(),
}));

vi.mock('../../src/db/fallback/response.model.js', () => ({
  storeResponse: vi.fn(),
  getResponse: vi.fn().mockResolvedValue(null),
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

import axios from 'axios';

describe('Academic Module', () => {
  let academic: Academic;
  const rollNumber = '21B81A05E9';

  beforeEach(() => {
    academic = new Academic(rollNumber);
    vi.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should normalize roll number to uppercase', () => {
      const lowercaseAcademic = new Academic('21b81a05e9');
      expect(lowercaseAcademic.rollnumber).toBe('21B81A05E9');
    });

    it('should trim whitespace from roll number', () => {
      const spacedAcademic = new Academic('  21B81A05E9  ');
      expect(spacedAcademic.rollnumber).toBe('21B81A05E9');
    });
  });

  describe('Error Classes', () => {
    it('should create AcademicError with code', () => {
      const error = new AcademicError('Test error', 'TEST_CODE');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('AcademicError');
    });

    it('should create ServerDownError', () => {
      const error = new ServerDownError();
      expect(error.message).toContain('College server');
      expect(error.code).toBe('SERVER_DOWN');
    });

    it('should create BlockedReportError', () => {
      const error = new BlockedReportError();
      expect(error.message).toContain('blocked');
      expect(error.code).toBe('REPORT_BLOCKED');
    });

    it('should create NoDataFoundError', () => {
      const error = new NoDataFoundError('attendance');
      expect(error.message).toContain('attendance');
      expect(error.code).toBe('NO_DATA');
    });
  });

  describe('getResponse', () => {
    it('should fetch attendance successfully', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockAttendanceHTML,
      });

      const response = await academic.getResponse('att');
      expect(response).toContain('21B81A05E9');
      expect(axios.post).toHaveBeenCalled();
    });

    it('should fetch midmarks successfully', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockMidmarksHTML,
      });

      const response = await academic.getResponse('mid');
      expect(response).toContain('21B81A05E9');
      expect(axios.post).toHaveBeenCalled();
    });

    it('should throw BlockedReportError when report is blocked', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: 'Blocked by Admin',
      });

      await expect(academic.getResponse('att')).rejects.toThrow(BlockedReportError);
    });

    it('should renew session when login page is returned', async () => {
      vi.mocked(axios.post)
        .mockResolvedValueOnce({
          data: "<tr><td>User Name</td><td>:</td><td><input type=textbox name='username' id='username'",
        })
        .mockResolvedValueOnce({
          data: mockAttendanceHTML,
        });

      const response = await academic.getResponse('att');
      expect(response).toContain('21B81A05E9');
      expect(axios.post).toHaveBeenCalledTimes(3); // Login + 2 data requests
    });

    it('should throw ServerDownError on network failure with no cache', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('Network error'));

      await expect(academic.getResponse('att')).rejects.toThrow(ServerDownError);
    });
  });

  describe('parseAttendanceResponse', () => {
    it('should parse attendance HTML correctly', async () => {
      const result = await Academic.parseAttendanceResponse(mockAttendanceHTML, rollNumber);

      expect(result.rollno).toBe('21B81A05E9');
      expect(result.percentage).toBe(85.5);
      expect(result.totalClasses.attended).toBe(450);
      expect(result.totalClasses.conducted).toBe(526);
      expect(result.subjects).toHaveLength(0); // Mock HTML is minimal
    });

    it('should throw NoDataFoundError when student not found', async () => {
      const emptyHTML = '<html><body><table></table></body></html>';

      await expect(
        Academic.parseAttendanceResponse(emptyHTML, rollNumber)
      ).rejects.toThrow(NoDataFoundError);
    });
  });

  describe('parseMidmarksResponse', () => {
    it('should parse midmarks HTML correctly', async () => {
      const result = await Academic.parseMidmarksResponse(mockMidmarksHTML, rollNumber);

      expect(result.rollno).toBe('21B81A05E9');
      expect(result.year_branch_section).toBe('3_CSE_A');
      expect(result.subjects).toBeDefined();
    });

    it('should throw NoDataFoundError when student not found', async () => {
      const emptyHTML = '<html><body><table></table></body></html>';

      await expect(
        Academic.parseMidmarksResponse(emptyHTML, rollNumber)
      ).rejects.toThrow(NoDataFoundError);
    });
  });

  describe('getAttendanceJSON', () => {
    it('should return cached attendance if available', async () => {
      const { getClient } = await import('../../src/services/redis/getRedisClient.js');
      const mockClient = await getClient();
      vi.mocked(mockClient.get).mockResolvedValue(JSON.stringify(mockAttendance));

      const result = await academic.getAttendanceJSON();

      expect(result).toEqual(mockAttendance);
      expect(mockClient.get).toHaveBeenCalledWith('attendance:21B81A05E9');
    });

    it('should fetch fresh data when cache misses', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockAttendanceHTML,
      });

      const result = await academic.getAttendanceJSON();

      expect(result).toBeDefined();
      expect(result.rollno).toBe('21B81A05E9');
    });
  });

  describe('getMidmarksJSON', () => {
    it('should return cached midmarks if available', async () => {
      const { getClient } = await import('../../src/services/redis/getRedisClient.js');
      const mockClient = await getClient();
      vi.mocked(mockClient.get).mockResolvedValue(JSON.stringify(mockMidmarks));

      const result = await academic.getMidmarksJSON();

      expect(result).toEqual(mockMidmarks);
      expect(mockClient.get).toHaveBeenCalledWith('midmarks:21B81A05E9');
    });

    it('should fetch fresh data when cache misses', async () => {
      vi.mocked(axios.post).mockResolvedValue({
        data: mockMidmarksHTML,
      });

      const result = await academic.getMidmarksJSON();

      expect(result).toBeDefined();
      expect(result.rollno).toBe('21B81A05E9');
    });
  });

  describe('isSessionValid', () => {
    it('should return false when no session cookie exists', async () => {
      const result = await academic.isSessionValid();
      expect(result).toBe(false);
    });

    it('should return true when session is valid', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'function selectHour(obj)',
      });

      // Force session renewal to set cookie
      await academic.renewSession();

      const result = await academic.isSessionValid();
      expect(result).toBe(true);
    });

    it('should return false when session is invalid', async () => {
      vi.mocked(axios.get).mockResolvedValue({
        data: 'Login page',
      });

      const result = await academic.isSessionValid();
      expect(result).toBe(false);
    });
  });

  describe('renewSession', () => {
    it('should generate new session token', async () => {
      vi.mocked(axios.post).mockResolvedValue({ data: 'success' });

      await academic.renewSession();

      expect(axios.post).toHaveBeenCalled();
      const callArgs = vi.mocked(axios.post).mock.calls[0];
      expect(callArgs[2]?.headers?.Cookie).toMatch(/PHPSESSID=ggpmgfj8dssskkp2q2h6db/);
    });

    it('should throw InvalidCredentialsError on failure', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('Auth failed'));

      await expect(academic.renewSession()).rejects.toThrow('Invalid credentials');
    });
  });
});
