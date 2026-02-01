export const mockStudent = {
  roll_no: '21B81A05E9',
  name: 'Test Student',
  section: 'A',
  branch: '05',
  year: '3-2',
};

export const mockAttendance = {
  rollno: '21B81A05E9',
  year_branch_section: '3_CSE_A',
  percentage: 85.5,
  totalClasses: {
    attended: 450,
    conducted: 526,
  },
  subjects: [
    {
      subject: 'Data Structures',
      attended: 45,
      conducted: 50,
      lastUpdated: '01-02-2026',
    },
    {
      subject: 'Operating Systems',
      attended: 40,
      conducted: 45,
      lastUpdated: '01-02-2026',
    },
  ],
};

export const mockMidmarks = {
  rollno: '21B81A05E9',
  year_branch_section: '3_CSE_A',
  subjects: [
    {
      subject: 'Data Structures',
      M1: 23,
      M2: 25,
      average: 24,
      type: 'Subject',
    },
    {
      subject: 'Operating Systems',
      M1: 22,
      M2: 24,
      average: 23,
      type: 'Subject',
    },
    {
      subject: 'DS Lab',
      M1: 25,
      M2: 0,
      average: 0,
      type: 'Lab',
    },
  ],
};

export const mockAttendanceHTML = `
<html>
<body>
<table>
  <tr><td>Subject</td><td>Attended</td><td>Conducted</td></tr>
  <tr id="21B81A05E9">
    <td>21B81A05E9</td>
    <td>Test Student</td>
    <td>45</td>
    <td>40</td>
    <td class="tdPercent">85.5 (450/526)</td>
  </tr>
</table>
</body>
</html>
`;

export const mockMidmarksHTML = `
<html>
<body>
<table>
  <tr>
    <td><a>Data Structures</a></td>
    <td><a>Operating Systems</a></td>
    <td>DS Lab</td>
  </tr>
  <tr id="21B81A05E9">
    <td>21B81A05E9</td>
    <td>Test Student</td>
    <td>23/25(24)</td>
    <td>22/24(23)</td>
    <td>25</td>
  </tr>
</table>
</body>
</html>
`;
