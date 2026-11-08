import { describe, it, expect } from "vitest";
import { endNoteMessage } from "../src/components/FeedbackStates";

describe("endNoteMessage", () => {
  it("claims completeness only when ranked covers the known directory", () => {
    expect(endNoteMessage(true, { ranked: 412, known: 412 })).toBe(
      "That’s everyone in this view",
    );
  });

  it("says how far the partial register has filled", () => {
    expect(endNoteMessage(true, { ranked: 412, known: 1240 })).toBe(
      "412 ranked so far. The register fills as students check.",
    );
  });

  it("never calls an empty directory complete", () => {
    expect(endNoteMessage(false, { ranked: 412, known: 0 })).toBe(
      "412 ranked so far. The register fills as students check.",
    );
  });

  it("has no denominator for a search", () => {
    expect(endNoteMessage(true, null)).toBe("That’s everyone in this view");
  });
});
