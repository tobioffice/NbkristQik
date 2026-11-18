import { describe, expect, it, vi } from "vitest";
import { logger } from "../../src/config/logger.js";

// The test environment sets ENV=test. Debug output is the only level that can
// carry roll numbers and portal request data, so it must stay off here; the
// public deploy log runs the same suite.
describe("logger", () => {
  it("keeps debug payloads out of test and CI output", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logger.debug("[Academic] Fetching att for 00TEST0000", {
        branch: "5",
        section: "A",
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps info logs available for debugging", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logger.info("[test] deploy diagnostic");
      expect(spy).toHaveBeenCalledWith("[test] deploy diagnostic");
    } finally {
      spy.mockRestore();
    }
  });
});
