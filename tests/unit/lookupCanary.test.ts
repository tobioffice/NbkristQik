import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/redis/utils.js", () => ({
  getStudentCached: vi.fn().mockResolvedValue({
    roll_no: "21B81A05E9",
    name: "Canary Student",
    section: "A",
    branch: "5",
    year: "32",
  }),
  StudentNotFoundError: class StudentNotFoundError extends Error {},
}));

vi.mock("../../src/services/redis/getRedisClient.js", () => ({
  getClient: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    setEx: vi.fn(),
    expire: vi.fn(),
  }),
}));

vi.mock("../../src/services/redis/storeAttOrMidToRedis.js", () => ({
  storeAttendanceToRedis: vi.fn().mockResolvedValue(undefined),
  storeMidMarksToRedis: vi.fn().mockResolvedValue(undefined),
  persistAttendanceSection: vi.fn().mockResolvedValue(undefined),
  persistMidmarksSection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/db/fallback/response.model.js", () => ({
  storeResponse: vi.fn(),
  getResponseRecord: vi.fn(),
  buildResponseId: vi.fn(
    (year: string, branch: string, section: string, type: string) =>
      `${year}-${branch}-${section}-${type}`,
  ),
}));

vi.mock("axios", () => {
  class AxiosError extends Error {
    code?: string;
    response?: unknown;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
      this.name = "AxiosError";
    }
  }
  return {
    default: {
      post: vi.fn(),
      get: vi.fn(),
    },
    AxiosError,
  };
});

import { Academic } from "../../src/services/student.utils/Academic.js";
import { getResponseRecord } from "../../src/db/fallback/response.model.js";
import { mockAttendanceHTML } from "../mocks/academic.mock.js";
import axios from "axios";

const SAVED_COPY = "<html><body>saved attendance copy</body></html>";

describe("Academic.getFreshResponse", () => {
  beforeEach(() => {
    vi.mocked(axios.post).mockReset();
    vi.mocked(getResponseRecord).mockResolvedValue({
      content: SAVED_COPY,
      updatedAt: "2026-11-08 00:00:00",
    });
  });

  it("returns the live portal response without reading the fallback", async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: mockAttendanceHTML });
    const academic = new Academic("21B81A05E9");

    await expect(academic.getFreshResponse("att")).resolves.toBe(
      mockAttendanceHTML,
    );

    expect(getResponseRecord).not.toHaveBeenCalled();
  });

  it("throws on a portal failure while getResponse masks it with the saved copy", async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error("portal down"));
    const academic = new Academic("21B81A05E9");

    await expect(academic.getFreshResponse("att")).rejects.toThrow(
      "portal down",
    );
    expect(getResponseRecord).not.toHaveBeenCalled();

    // The old path is exactly why the canary cannot use it: the same failure
    // silently resolves with the section's saved response.
    await expect(academic.getResponse("att")).resolves.toBe(SAVED_COPY);
    expect(getResponseRecord).toHaveBeenCalledTimes(1);
  });
});
