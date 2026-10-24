import { describe, expect, it } from "vitest";
import { startPayload } from "../../src/bot/commands/startPayload.js";

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
