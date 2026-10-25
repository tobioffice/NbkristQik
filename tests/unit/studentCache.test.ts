import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getStudent: vi.fn(),
  findSimilarRolls: vi.fn(),
  getClient: vi.fn(),
}));

vi.mock("../../src/db/student.model.js", () => ({
  getStudent: mocks.getStudent,
  findSimilarRolls: mocks.findSimilarRolls,
}));
vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: mocks.getClient,
}));

const { getStudentCached, StudentNotFoundError } =
  await import("../../src/services/redis/utils.js");

const student = {
  roll_no: "23B91A0512",
  name: "Test Student",
  section: "A",
  branch: "05",
  year: "2",
};

describe("getStudentCached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSimilarRolls.mockResolvedValue([]);
  });

  it("falls back to the database when Redis is down", async () => {
    mocks.getClient.mockRejectedValue(new Error("redis down"));
    mocks.getStudent.mockResolvedValue(student);

    await expect(getStudentCached(student.roll_no)).resolves.toEqual(student);
    expect(mocks.getStudent).toHaveBeenCalledWith(student.roll_no);
  });

  it("still reports a genuinely missing roll when Redis is down", async () => {
    mocks.getClient.mockRejectedValue(new Error("redis down"));
    mocks.getStudent.mockResolvedValue(null);

    await expect(getStudentCached("99XX000000")).rejects.toBeInstanceOf(
      StudentNotFoundError,
    );
  });

  it("serves a cached student without touching the database", async () => {
    mocks.getClient.mockResolvedValue({
      get: vi.fn(async () => JSON.stringify(student)),
      set: vi.fn(),
      expire: vi.fn(),
    });

    await expect(getStudentCached(student.roll_no)).resolves.toEqual(student);
    expect(mocks.getStudent).not.toHaveBeenCalled();
  });

  it("ignores a corrupt cache entry and reads the database", async () => {
    mocks.getClient.mockResolvedValue({
      get: vi.fn(async () => "{not json"),
      set: vi.fn(async () => "OK"),
      expire: vi.fn(async () => 1),
    });
    mocks.getStudent.mockResolvedValue(student);

    await expect(getStudentCached(student.roll_no)).resolves.toEqual(student);
    expect(mocks.getStudent).toHaveBeenCalled();
  });
});
