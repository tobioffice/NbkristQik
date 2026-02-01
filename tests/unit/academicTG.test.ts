import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcademicTG } from '../../src/services/student.utils/AcademicTG';
import { mockAttendance, mockMidmarks } from '../mocks/academic.mock';

describe('AcademicTG Module', () => {
  let academicTG: AcademicTG;
  const rollNumber = '21B81A05E9';

  beforeEach(() => {
    academicTG = new AcademicTG(rollNumber);
    vi.clearAllMocks();
  });

  describe('getAttendanceMessage', () => {
    it('should format attendance message with proper structure', async () => {
      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(mockAttendance);

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('21B81A05E9');
      expect(message).toContain('3_CSE_A');
      expect(message).toContain('85.5%');
      expect(message).toContain('450/526');
      expect(message).toContain('<pre>');
      expect(message).toContain('</pre>');
    });

    it('should include progress bar in message', async () => {
      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(mockAttendance);

      const message = await academicTG.getAttendanceMessage();

      expect(message).toMatch(/[🟩🟨🟥⬜]/);
    });

    it('should format subjects correctly', async () => {
      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(mockAttendance);

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('Data Structures');
      expect(message).toContain('Operating Systems');
      expect(message).toContain('45/50');
      expect(message).toContain('40/45');
    });

    it('should return error message on failure', async () => {
      vi.spyOn(academicTG, 'getAttendanceJSON').mockRejectedValue(
        new Error('Server down')
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('Error');
      expect(message).toContain('Unable to fetch attendance');
    });

    it('should handle AcademicError specially', async () => {
      const { AcademicError } = await import('../../src/services/student.utils/Academic');
      vi.spyOn(academicTG, 'getAttendanceJSON').mockRejectedValue(
        new AcademicError('Custom error', 'TEST')
      );

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('Custom error');
    });
  });

  describe('getMidmarksMessage', () => {
    it('should format midmarks message with proper structure', async () => {
      vi.spyOn(academicTG, 'getMidmarksJSON').mockResolvedValue(mockMidmarks);

      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain('📊 Mid Marks Report');
      expect(message).toContain('21B81A05E9');
      expect(message).toContain('3_CSE_A');
      expect(message).toContain('<pre>');
      expect(message).toContain('</pre>');
    });

    it('should format subjects with marks correctly', async () => {
      vi.spyOn(academicTG, 'getMidmarksJSON').mockResolvedValue(mockMidmarks);

      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain('Data Structures');
      expect(message).toContain('Operating Systems');
      expect(message).toContain('Subject');
      expect(message).toContain('Lab');
    });

    it('should display M1, M2, and average correctly', async () => {
      vi.spyOn(academicTG, 'getMidmarksJSON').mockResolvedValue(mockMidmarks);

      const message = await academicTG.getMidmarksMessage();

      // Check for marks (they'll be in the pre block)
      expect(message).toContain('23');
      expect(message).toContain('25');
      expect(message).toContain('24');
    });

    it('should return error message on failure', async () => {
      vi.spyOn(academicTG, 'getMidmarksJSON').mockRejectedValue(
        new Error('Server down')
      );

      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain('Error');
      expect(message).toContain('Unable to fetch midmarks');
    });
  });

  describe('Message Formatting Helpers', () => {
    it('should generate correct progress bar for high percentage', () => {
      // Test through actual message generation
      const highAttendance = { ...mockAttendance, percentage: 85 };
      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(highAttendance);

      academicTG.getAttendanceMessage().then(message => {
        expect(message).toContain('🟩');
      });
    });

    it('should generate correct progress bar for medium percentage', () => {
      const mediumAttendance = { ...mockAttendance, percentage: 60 };
      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(mediumAttendance);

      academicTG.getAttendanceMessage().then(message => {
        expect(message).toContain('🟨');
      });
    });

    it('should generate correct progress bar for low percentage', () => {
      const lowAttendance = { ...mockAttendance, percentage: 40 };
      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(lowAttendance);

      academicTG.getAttendanceMessage().then(message => {
        expect(message).toContain('🟥');
      });
    });

    it('should truncate long subject names', async () => {
      const longNameAttendance = {
        ...mockAttendance,
        subjects: [
          {
            subject: 'Very Long Subject Name That Needs Truncation',
            attended: 45,
            conducted: 50,
            lastUpdated: '01-02-2026',
          },
        ],
      };

      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(longNameAttendance);

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('..');
    });

    it('should format dates correctly', async () => {
      const dateAttendance = {
        ...mockAttendance,
        subjects: [
          {
            subject: 'Test Subject',
            attended: 45,
            conducted: 50,
            lastUpdated: '01-02-2026',
          },
        ],
      };

      vi.spyOn(academicTG, 'getAttendanceJSON').mockResolvedValue(dateAttendance);

      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('01-02');
    });
  });
});
