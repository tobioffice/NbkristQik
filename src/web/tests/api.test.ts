import { describe, it, expect } from "vitest";
import {
  API_BASE,
  authHeaders,
  buildConfigUrl,
  buildLeaderboardUrl,
  buildMeUrl,
  buildProfileUrl,
  PAGE_SIZE,
} from "../src/api";

describe("buildLeaderboardUrl", () => {
  it("includes pagination, sort, filters, and omits empty search", () => {
    const url = buildLeaderboardUrl(
      2,
      "midmarks",
      { year: "3", branch: "5", section: "A" },
      "",
    );

    expect(url).toContain(`${API_BASE}/api/leaderboard?`);
    expect(url).toContain("page=2");
    expect(url).toContain(`limit=${PAGE_SIZE}`);
    expect(url).toContain("sort=midmarks");
    expect(url).toContain("year=3");
    expect(url).toContain("branch=5");
    expect(url).toContain("section=A");
    expect(url).not.toContain("search=");
  });

  it("appends search when provided", () => {
    const url = buildLeaderboardUrl(
      1,
      "attendance",
      { year: "all", branch: "all", section: "all" },
      "JOHN",
    );

    expect(url).toContain("search=JOHN");
  });

  it("sends the year digit, never the portal yearSem code", () => {
    for (const year of ["1", "2", "3", "4"] as const) {
      const url = buildLeaderboardUrl(
        1,
        "attendance",
        { year, branch: "all", section: "all" },
        "",
      );

      expect(url).toContain(`year=${year}`);
      expect(url).not.toContain(`year=${year}1`);
    }
  });

  it("defaults to the caller's section and omits all dimensions", () => {
    const url = buildLeaderboardUrl(
      1,
      "attendance",
      { year: "all", branch: "all", section: "all" },
      "",
    );

    expect(url).toContain("scope=me");
    expect(url).not.toContain("year=");
    expect(url).not.toContain("branch=");
    expect(url).not.toContain("section=");
  });

  it("sends scope=all with a filter and only the non-all dimensions", () => {
    const url = buildLeaderboardUrl(
      1,
      "attendance",
      { year: "3", branch: "all", section: "A" },
      "",
      "all",
    );

    expect(url).toContain("scope=all");
    expect(url).toContain("year=3");
    expect(url).toContain("section=A");
    expect(url).not.toContain("branch=");
  });

  it("keeps search alongside the chosen scope", () => {
    const url = buildLeaderboardUrl(
      1,
      "midmarks",
      { year: "all", branch: "all", section: "all" },
      "JOHN",
      "me",
    );

    expect(url).toContain("search=JOHN");
    expect(url).toContain("scope=me");
    expect(url).not.toContain("year=");
  });
});

describe("authHeaders", () => {
  it("carries the signed initData in the identity header", () => {
    expect(authHeaders("auth_date=1&hash=abc")).toEqual({
      "X-Telegram-Init-Data": "auth_date=1&hash=abc",
    });
  });

  it("sends no identity header when there is no initData", () => {
    expect(authHeaders(undefined)).toEqual({});
    expect(authHeaders("")).toEqual({});
  });
});

describe("buildMeUrl", () => {
  it("includes userId only for the dev fallback", () => {
    expect(buildMeUrl("42")).toContain("userId=42");
    expect(buildMeUrl("42")).not.toContain("initData=");
  });

  it("leaves the URL bare when a real initData is sent in the header", () => {
    const url = buildMeUrl("42", "auth_date=1&hash=abc");

    expect(url).toBe(`${API_BASE}/api/me`);
    expect(url).not.toContain("userId=");
    expect(url).not.toContain("initData=");
  });
});

describe("buildProfileUrl", () => {
  it("never puts initData in the query string", () => {
    const url = buildProfileUrl({
      initData: "auth_date=1&hash=abc",
      userId: "42",
    });

    expect(url).toBe(`${API_BASE}/api/profile`);
    expect(url).not.toContain("initData=");
    expect(url).not.toContain("userId=");
  });

  it("keeps the dev userId when there is no initData", () => {
    const url = buildProfileUrl({ userId: "42" });

    expect(url).toContain("userId=42");
    expect(url).not.toContain("initData=");
  });
});

describe("buildConfigUrl", () => {
  it("asks with no query when the header carries identity", () => {
    const url = buildConfigUrl({
      initData: "auth_date=1&hash=abc",
      userId: "42",
    });

    expect(url).toBe(`${API_BASE}/api/config`);
    expect(url).not.toContain("initData=");
    expect(url).not.toContain("userId=");
  });

  it("keeps the dev userId only when there is no initData", () => {
    const url = buildConfigUrl({ userId: "42" });

    expect(url).toBe(`${API_BASE}/api/config?userId=42`);
  });
});
