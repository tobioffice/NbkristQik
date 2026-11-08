import { describe, expect, it } from "vitest";
import {
  attendanceRoll,
  startPayload,
} from "../../src/bot/commands/startPayload.js";

describe("a /start deep link", () => {
  it("carries the library payload from the channel button", () => {
    expect(startPayload("/start library")).toBe("library");
  });

  it("keeps other payloads exactly as sent", () => {
    expect(startPayload("/start ref_23CS1042")).toBe("ref_23CS1042");
  });

  it("is empty for a plain start", () => {
    expect(startPayload("/start")).toBeNull();
  });
});

describe("an attendance deep link", () => {
  it("carries the roll from the group link", () => {
    expect(attendanceRoll("att_25KB1A05AR")).toBe("25KB1A05AR");
  });

  it("accepts the prefix in any case", () => {
    expect(attendanceRoll("ATT_25KB1A05AR")).toBe("25KB1A05AR");
  });

  it("is null for every other payload", () => {
    expect(attendanceRoll("library")).toBeNull();
    expect(attendanceRoll("campaign")).toBeNull();
    expect(attendanceRoll(null)).toBeNull();
  });
});
