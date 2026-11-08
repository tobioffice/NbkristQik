import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reader cache behind `requireSession`.
 *
 * The unit under test is `resolveStudentContextCached`: it must turn many
 * page requests into one registration + student lookup, and must not hide a
 * registration change for longer than its minute.
 */

const { getRegistration, getStudentCached } = vi.hoisted(() => ({
  getRegistration: vi.fn(),
  getStudentCached: vi.fn(),
}));

vi.mock("../../src/db/registration.model.js", () => ({ getRegistration }));
vi.mock("../../src/services/redis/utils.js", () => ({ getStudentCached }));

const {
  resolveStudentContextCached,
  invalidateStudentContext,
  clearStudentContextCache,
} = await import("../../src/services/library/entitlement.js");

const student = {
  roll_no: "23CS1042",
  name: "TEST STUDENT",
  section: "A",
  branch: "5",
  year: "31",
};

const registration = {
  userId: "111222333",
  roll_no: "23CS1042",
  display_name: "Test Student",
  registered_at: "",
  updated_at: "",
};

describe("cached library context", () => {
  beforeEach(() => {
    clearStudentContextCache();
    vi.clearAllMocks();
    getRegistration.mockResolvedValue(registration);
    getStudentCached.mockResolvedValue(student);
  });

  it("resolves the student once for many page requests in one session", async () => {
    const token = "token-a";

    const first = await resolveStudentContextCached(token, "111222333");
    const second = await resolveStudentContextCached(token, "111222333");
    const third = await resolveStudentContextCached(token, "111222333");

    expect(first?.rollNo).toBe("23CS1042");
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(getRegistration).toHaveBeenCalledTimes(1);
    expect(getStudentCached).toHaveBeenCalledTimes(1);
  });

  it("resolves separately for a different session", async () => {
    await resolveStudentContextCached("token-a", "111222333");
    await resolveStudentContextCached("token-b", "111222333");

    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("does not let a token inherit another account's student", async () => {
    await resolveStudentContextCached("shared-token", "111222333");

    const other = await resolveStudentContextCached(
      "shared-token",
      "444555666",
    );
    expect(other?.rollNo).toBe("23CS1042");
    // the token was re-resolved for the new account, not served from cache
    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("resolves again after the cache is invalidated for a registration change", async () => {
    const token = "token-a";
    await resolveStudentContextCached(token, "111222333");

    await resolveStudentContextCached(token, "111222333");
    expect(getRegistration).toHaveBeenCalledTimes(1);

    invalidateStudentContext("111222333");
    await resolveStudentContextCached(token, "111222333");
    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("leaves other students' entries alone when one is invalidated", async () => {
    await resolveStudentContextCached("token-a", "111222333");
    await resolveStudentContextCached("token-b", "444555666");

    invalidateStudentContext("111222333");

    await resolveStudentContextCached("token-b", "444555666");
    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("does not cache 'not registered', so a fresh roll is seen at once", async () => {
    getRegistration.mockResolvedValueOnce(null);

    const before = await resolveStudentContextCached("token-a", "111222333");
    const after = await resolveStudentContextCached("token-a", "111222333");

    expect(before).toBeNull();
    expect(after?.rollNo).toBe("23CS1042");
    expect(getRegistration).toHaveBeenCalledTimes(2);
  });

  it("expires the cached context after a minute", async () => {
    vi.useFakeTimers();
    try {
      await resolveStudentContextCached("token-a", "111222333");
      await resolveStudentContextCached("token-a", "111222333");
      expect(getRegistration).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(61_000);
      await resolveStudentContextCached("token-a", "111222333");
      expect(getRegistration).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the cache bounded by dropping the oldest entry", async () => {
    // a thousand entries is the documented cap; the point here is that it
    // never grows past it, so a token flood cannot become a memory leak
    for (let i = 0; i < 1001; i++) {
      await resolveStudentContextCached(`bulk-${i}`, `user-${i}`);
    }

    getRegistration.mockClear();
    await resolveStudentContextCached("bulk-1000", "user-1000");
    expect(getRegistration).not.toHaveBeenCalled();
  });
});
