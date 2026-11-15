import { describe, expect, it } from "vitest";
import { deepLink } from "../../src/bot/commands/startPayload.js";

describe("a card deep link", () => {
  it("carries the roll and the card from the group link", () => {
    expect(deepLink("att_25KB1A05AR")).toEqual({
      signal: "att",
      roll: "25KB1A05AR",
    });
    expect(deepLink("mid_25KB1A05AR")).toEqual({
      signal: "mid",
      roll: "25KB1A05AR",
    });
    expect(deepLink("bunk_25KB1A05AR")).toEqual({
      signal: "bunk",
      roll: "25KB1A05AR",
    });
  });

  it("accepts the prefix in any case", () => {
    expect(deepLink("ATT_25KB1A05AR")).toEqual({
      signal: "att",
      roll: "25KB1A05AR",
    });
  });

  it("is null for every other payload", () => {
    expect(deepLink("library")).toBeNull();
    expect(deepLink("campaign")).toBeNull();
    expect(deepLink("attendance_25KB1A05AR")).toBeNull();
    expect(deepLink(null)).toBeNull();
  });
});
