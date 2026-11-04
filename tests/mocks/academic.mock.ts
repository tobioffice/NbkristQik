export const mockStudent = {
  roll_no: "21B81A05E9",
  name: "Test Student",
  section: "A",
  branch: "05",
  year: "3-2",
};

export const mockAttendance = {
  rollno: "21B81A05E9",
  year_branch_section: "3_CSE_A",
  percentage: 85.5,
  totalClasses: {
    attended: 450,
    conducted: 526,
  },
  subjects: [
    {
      subject: "Data Structures",
      attended: 45,
      conducted: 50,
      lastUpdated: "01-02-2026",
    },
    {
      subject: "Operating Systems",
      attended: 40,
      conducted: 45,
      lastUpdated: "01-02-2026",
    },
  ],
};

export const mockMidmarks = {
  rollno: "21B81A05E9",
  year_branch_section: "3_CSE_A",
  subjects: [
    {
      subject: "Data Structures",
      M1: 23,
      M2: 25,
      average: 24,
      type: "Subject",
    },
    {
      subject: "Operating Systems",
      M1: 22,
      M2: 24,
      average: 23,
      type: "Subject",
    },
    {
      subject: "DS Lab",
      M1: 25,
      M2: 0,
      average: 0,
      type: "Lab",
    },
  ],
};

// The parser reads fixed rows: row 1 = subject names, row 2 = last-updated,
// row 3 = conducted counts, then the student row selected by id. A fixture
// with only a header and a student row makes every subject test vacuous
// (conducted.length === 0), so this fixture carries the full shape.
export const mockAttendanceHTML = `
<html>
<body>
<table>
  <tr><td>Student</td><td>Report</td></tr>
  <tr>
    <td>Data Structures</td>
    <td>Operating Systems</td>
  </tr>
  <tr>
    <td>Last updated</td>
    <td>01-02-2026</td>
    <td>01-02-2026</td>
  </tr>
  <tr>
    <td>%AGE</td>
    <td>50</td>
    <td>45</td>
  </tr>
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

// `$("tr").eq(1)` is the subject row; the student row is selected by id.
// The first row is a report banner, matching the real page's layout.
export const mockMidmarksHTML = `
<html>
<body>
<table>
  <tr><td>Student</td><td>Report</td></tr>
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
