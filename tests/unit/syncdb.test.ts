import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { buildStudentRow } from "../../src/db/student.model.js";

// axios, Redis and the bot are all mocked: runSyncDb is exercised as the
// network/DB orchestrator without touching the college portal or Telegram.
const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
  redis: {
    scan: vi.fn(async () => ({ cursor: "0", keys: [] as string[] })),
    del: vi.fn(async () => 1),
  },
  axios: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock("../../src/bot/bot.js", () => ({
  bot: {
    onText: vi.fn(),
    sendMessage: vi.fn(),
    editMessageText: vi.fn(),
  },
}));
vi.mock("axios", () => ({ default: mocks.axios }));
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: mocks.getClient,
}));
// one session x one branch x 11 sections keeps the scrape quick while still
// going through the real worker pool
vi.mock("../../src/constants/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/constants/index.js")>();
  return { ...actual, BRANCHES: { "5": "CSE" } };
});

import { turso } from "../../src/db/db.js";
import { runSyncDb } from "../../src/bot/syncdb.js";

const PORTAL_PAGE = `<html><body>
  <select name="acadYear"><option value="2025-26">2025-26</option></select>
  <select name="yearSem"><option value="11">11</option></select>
</body></html>`;

const CLASS_HTML = `<html><body><table>
  <tr id="26KB1A0501">
    <td>1.</td><td class="tdRollNo" id="td26KB1A0501">26KB1A0501</td>
  </tr>
</table></body></html>`;

const NO_CLASS_HTML = `<html><body><p>No students in this section</p></body></html>`;

/** The portal GETs: the year/sem dropdown page and the name lookup. */
const mockPortalGets = () => {
  mocks.axios.get.mockImplementation(async (url: string) => {
    if (url.includes("attendanceTillADate")) return { data: PORTAL_PAGE };
    if (url.includes("getStudentName")) return { data: "Test Student\n" };
    throw new Error(`unexpected GET ${url}`);
  });
};

/** Login succeeds; each section report is rendered by `report(body)`. */
const mockScrape = (report: (body: string) => string) => {
  mocks.axios.post.mockImplementation(async (url: string, body: string) => {
    if (url.includes("attendanceLogin")) return { data: "ok" };
    if (url.includes("attendanceTillTodayReport")) {
      return { data: report(body) };
    }
    throw new Error(`unexpected POST ${url}`);
  });
};

const runError = (): Promise<Error> =>
  runSyncDb({ semType: "1" }).then(
    () => {
      throw new Error("runSyncDb unexpectedly succeeded");
    },
    (e: unknown) => e as Error,
  );

const studentCount = async (): Promise<number> =>
  Number(
    (await turso.execute("SELECT COUNT(*) AS n FROM studentsnew")).rows[0].n,
  );

beforeAll(async () => {
  await turso.execute(`
    CREATE TABLE IF NOT EXISTS studentsnew (
      roll_no TEXT PRIMARY KEY,
      name TEXT,
      section TEXT,
      branch TEXT,
      year TEXT
    )
  `);
});

beforeEach(async () => {
  await turso.execute("DELETE FROM studentsnew");
  mocks.getClient.mockReset();
  mocks.axios.post.mockReset();
  mocks.axios.get.mockReset();
  mocks.redis.scan.mockClear();
  mocks.redis.del.mockClear();
  mockPortalGets();
});

describe("buildStudentRow", () => {
  it("should keep the numeric branch code the lookup path needs", () => {
    const row = buildStudentRow("41", "5", "B", "23kb1a05b1");

    expect(row).toEqual({
      roll_no: "23KB1A05B1",
      name: null,
      section: "B",
      branch: "5",
      year: "41",
    });
  });

  it('should preserve the "-" section used by lateral entries', () => {
    const row = buildStudentRow("21", "2", "-", "26kb5a0219");

    expect(row.section).toBe("-");
    expect(row.branch).toBe("2");
  });
});

describe("runSyncDb fail-closed guard", () => {
  it("aborts before writing or flushing when no students are found", async () => {
    mockScrape(() => NO_CLASS_HTML);

    const err = await runError();

    expect(err.message).toMatch(/no students were found/i);
    expect(err.message).toMatch(/student directory was NOT changed/i);
    expect(err.message).toMatch(/caches were NOT flushed/i);
    expect(await studentCount()).toBe(0);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it("aborts before writing or flushing when a section request fails", async () => {
    mockScrape(() => {
      throw new Error("portal timeout");
    });

    const err = await runError();

    expect(err.message).toMatch(/11 section request\(s\) failed/i);
    expect(err.message).toMatch(/student directory was NOT changed/i);
    expect(await studentCount()).toBe(0);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});

describe("runSyncDb upsert", () => {
  it("writes the whole directory in one batch, then flushes caches", async () => {
    mockScrape((body) =>
      body.includes("section=A") ? CLASS_HTML : NO_CLASS_HTML,
    );
    mocks.getClient.mockResolvedValue(mocks.redis);

    const batchSpy = vi.spyOn(turso, "batch");
    let result;
    try {
      result = await runSyncDb({ semType: "1" });

      // one transaction for the whole directory (assert before mockRestore,
      // which clears the spy's recorded calls)
      expect(batchSpy).toHaveBeenCalledTimes(1);
      expect(batchSpy.mock.calls[0][0]).toHaveLength(1);
      expect(batchSpy.mock.calls[0][1]).toBe("write");
    } finally {
      batchSpy.mockRestore();
    }

    expect(result.students).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.upsertFailed).toBe(0);

    const rows = await turso.execute(
      "SELECT name, section FROM studentsnew WHERE roll_no = '26KB1A0501'",
    );
    expect(rows.rows).toHaveLength(1);
    expect(String(rows.rows[0].name)).toBe("Test Student");
    expect(String(rows.rows[0].section)).toBe("A");

    // caches were flushed only after the successful upsert
    expect(mocks.getClient).toHaveBeenCalled();
    expect(mocks.redis.scan).toHaveBeenCalled();
  });

  it("throws before flushing caches when the batch fails", async () => {
    mockScrape((body) =>
      body.includes("section=A") ? CLASS_HTML : NO_CLASS_HTML,
    );
    mocks.getClient.mockResolvedValue(mocks.redis);

    const batchSpy = vi
      .spyOn(turso, "batch")
      .mockRejectedValueOnce(new Error("disk I/O error"));
    let err: Error;
    try {
      err = await runError();
    } finally {
      batchSpy.mockRestore();
    }

    expect(err!.message).toMatch(/upsert failed/i);
    expect(err!.message).toMatch(/caches were NOT flushed/i);
    expect(await studentCount()).toBe(0);
    expect(mocks.getClient).not.toHaveBeenCalled();
  });
});
