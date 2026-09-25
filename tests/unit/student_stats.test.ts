import { describe, it, expect, beforeAll } from 'vitest';
import { turso } from '../../src/db/db';
import {
  getLeaderboard,
  initLeaderboardIndexes,
} from '../../src/db/student_stats.model';

beforeAll(async () => {
  await turso.execute(`CREATE TABLE student_stats (
    roll_no TEXT PRIMARY KEY,
    attendance_percentage REAL,
    mid_marks_avg REAL,
    last_updated TEXT
  )`);
  await turso.execute(`CREATE TABLE studentsnew (
    roll_no TEXT PRIMARY KEY,
    name TEXT,
    section TEXT,
    branch TEXT,
    year TEXT
  )`);

  const students = [
    ['AAA00001', 'Alice', 'A', '5', '31', 90.0, 28.0],
    ['AAA00002', 'Bob', 'A', '5', '31', 90.0, 27.0],
    ['AAA00003', 'Cara', 'B', '5', '31', 85.5, 29.0],
  ] as const;

  for (const [roll, name, section, branch, year, att, mid] of students) {
    await turso.execute({
      sql: 'INSERT INTO studentsnew VALUES (?, ?, ?, ?, ?)',
      args: [roll, name, section, branch, year],
    });
    await turso.execute({
      sql: 'INSERT INTO student_stats VALUES (?, ?, ?, ?)',
      args: [roll, att, mid, new Date().toISOString()],
    });
  }
});

describe('getLeaderboard', () => {
  it('should share ranks across ties and report the filtered total', async () => {
    const { rows, total } = await getLeaderboard('attendance', 10, 0, {});

    expect(total).toBe(3);
    expect(rows.map((r: any) => r.rank)).toEqual([1, 1, 3]);
  });

  it('should apply section filters to rows and total', async () => {
    const { rows, total } = await getLeaderboard('attendance', 10, 0, {
      section: 'B',
    });

    expect(total).toBe(1);
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).roll_no).toBe('AAA00003');
  });
});

describe('initLeaderboardIndexes', () => {
  it('should create the filter index', async () => {
    await initLeaderboardIndexes();

    const result = await turso.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_studentsnew_filters'",
    );
    expect(result.rows).toHaveLength(1);
  });
});
