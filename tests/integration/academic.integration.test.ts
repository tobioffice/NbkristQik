import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Academic } from '../../src/services/student.utils/Academic';
import { AcademicTG } from '../../src/services/student.utils/AcademicTG';
import axios from 'axios';

describe('Academic Integration Tests', () => {
  const rollNumber = '21B81A05E9';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Full Attendance Flow', () => {
    it('should complete full attendance fetch and format flow', async () => {
      // Mock all dependencies
      const mockHTML = `
        <html><body>
          <table>
            <tr><td>Subject</td></tr>
            <tr><td><a>Math</a></td><td><a>Physics</a></td></tr>
            <tr><td>Last Updated</td><td>01-02-2026</td><td>01-02-2026</td></tr>
            <tr id="21B81A05E9">
              <td>21B81A05E9</td>
              <td>Test</td>
              <td>45</td>
              <td>40</td>
              <td class="tdPercent">85.5 (450/526)</td>
            </tr>
            <tr><td>Total</td><td>50</td><td>45</td></tr>
          </table>
        </body></html>
      `;

      vi.mocked(axios.post).mockResolvedValue({ data: mockHTML });

      const academicTG = new AcademicTG(rollNumber);
      const message = await academicTG.getAttendanceMessage();

      expect(message).toContain('21B81A05E9');
      expect(message).toBeTruthy();
      expect(axios.post).toHaveBeenCalled();
    });
  });

  describe('Full Midmarks Flow', () => {
    it('should complete full midmarks fetch and format flow', async () => {
      const mockHTML = `
        <html><body>
          <table>
            <tr>
              <td><a>Data Structures</a></td>
              <td><a>Operating Systems</a></td>
              <td>DS Lab</td>
            </tr>
            <tr id="21B81A05E9">
              <td>21B81A05E9</td>
              <td>Test</td>
              <td>23/25(24)</td>
              <td>22/24(23)</td>
              <td>25</td>
            </tr>
          </table>
        </body></html>
      `;

      vi.mocked(axios.post).mockResolvedValue({ data: mockHTML });

      const academicTG = new AcademicTG(rollNumber);
      const message = await academicTG.getMidmarksMessage();

      expect(message).toContain('21B81A05E9');
      expect(message).toBeTruthy();
      expect(axios.post).toHaveBeenCalled();
    });
  });

  describe('Error Recovery Flow', () => {
    it('should use fallback when server fails', async () => {
      const { getResponse } = await import('../../src/db/fallback/response.model.js');
      
      // First call fails
      vi.mocked(axios.post).mockRejectedValue(new Error('Network error'));
      
      // Mock fallback
      vi.mocked(getResponse).mockResolvedValue(`
        <html><body>
          <table>
            <tr id="21B81A05E9">
              <td>21B81A05E9</td>
              <td class="tdPercent">85.5 (450/526)</td>
            </tr>
          </table>
        </body></html>
      `);

      const academic = new Academic(rollNumber);
      const response = await academic.getResponse('att');

      expect(response).toBeTruthy();
      expect(getResponse).toHaveBeenCalled();
    });
  });

  describe('Session Management Flow', () => {
    it('should handle session expiry and renewal', async () => {
      // First request returns login page
      vi.mocked(axios.post)
        .mockResolvedValueOnce({
          data: "<input type=textbox name='username' id='username'",
        })
        // Login succeeds
        .mockResolvedValueOnce({ data: 'success' })
        // Second request succeeds
        .mockResolvedValueOnce({
          data: `<tr id="21B81A05E9"><td class="tdPercent">85 (100/120)</td></tr>`,
        });

      const academic = new Academic(rollNumber);
      const response = await academic.getResponse('att');

      expect(response).toBeTruthy();
      expect(axios.post).toHaveBeenCalledTimes(3);
    });
  });

  describe('Caching Flow', () => {
    it('should use Redis cache when available', async () => {
      const { getClient } = await import('../../src/services/redis/getRedisClient.js');
      const mockClient = await getClient();

      const cachedData = {
        rollno: '21B81A05E9',
        year_branch_section: '3_CSE_A',
        percentage: 85,
        totalClasses: { attended: 100, conducted: 120 },
        subjects: [],
      };

      vi.mocked(mockClient.get).mockResolvedValue(JSON.stringify(cachedData));

      const academic = new Academic(rollNumber);
      const result = await academic.getAttendanceJSON();

      expect(result).toEqual(cachedData);
      expect(mockClient.get).toHaveBeenCalledWith('attendance:21B81A05E9');
      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});
