import { describe, it, expect } from "vitest";
import {
  buildLeaderboardUrl,
  buildMeUrl,
  PAGE_SIZE,
  API_BASE,
} from "../src/api";

describe("buildLeaderboardUrl", () => {
  it("includes pagination, sort, filters, and omits empty search", () => {
    const url = buildLeaderboardUrl(
      2,
      "midmarks",
      { year: "31", branch: "5", section: "A" },
      "",
    );

    expect(url).toContain(`${API_BASE}/api/leaderboard?`);
    expect(url).toContain("page=2");
    expect(url).toContain(`limit=${PAGE_SIZE}`);
    expect(url).toContain("sort=midmarks");
    expect(url).toContain("year=31");
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
});

describe("buildMeUrl", () => {
  it("includes userId and omits absent initData", () => {
    expect(buildMeUrl("42")).toContain("userId=42");
    expect(buildMeUrl("42")).not.toContain("initData=");
  });

  it("includes initData when provided", () => {
    expect(buildMeUrl("42", "a=b&hash=c")).toContain("initData=");
  });
});
