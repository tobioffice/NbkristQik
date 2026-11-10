import { describe, it, expect } from "vitest";
import { mapMe, type MeResponse } from "../src/api";

describe("mapMe", () => {
  it("reads a registration as the caller's identity", () => {
    const me: MeResponse = {
      found: true,
      source: "registered",
      roll_no: "23CS1042",
      attendance: { rank: 12, total: 940, value: 82.4 },
      midmarks: { rank: 31, total: 800, value: 18.5 },
    };

    expect(mapMe(me)).toEqual({
      status: "ready",
      roll: "23CS1042",
      ranks: {
        attendance: { rank: 12, total: 940, value: 82.4 },
        midmarks: { rank: 31, total: 800, value: 18.5 },
      },
      source: "registered",
      lastLookup: null,
    });
  });

  it("keeps a past lookup out of the identity", () => {
    const me: MyResponseWithLookup = {
      found: true,
      source: "registered",
      roll_no: "23CS1042",
      lastLookup: "23CS9999",
    };

    expect(mapMe(me).roll).toBe("23CS1042");
    expect(mapMe(me).lastLookup).toBeNull();
  });

  it("returns an unregistered caller as no-roll, not as that lookup", () => {
    expect(mapMe({ found: false, lastLookup: "22CS0001" })).toEqual({
      status: "no-roll",
      roll: null,
      ranks: null,
      source: null,
      lastLookup: "22CS0001",
    });
  });

  it("has no suggestion when the account never looked one up", () => {
    expect(mapMe({ found: false, lastLookup: null })).toEqual({
      status: "no-roll",
      roll: null,
      ranks: null,
      source: null,
      lastLookup: null,
    });
  });

  it("keeps unranked measures null instead of inventing a rank", () => {
    const mapped = mapMe({
      found: true,
      source: "registered",
      roll_no: "23CS1042",
      attendance: null,
      midmarks: null,
    });

    expect(mapped.status).toBe("ready");
    expect(mapped.ranks).toEqual({ attendance: null, midmarks: null });
  });

  it("ignores malformed rank objects", () => {
    const mapped = mapMe({
      found: true,
      source: "registered",
      roll_no: "23CS1042",
      attendance: { rank: "12" } as never,
      midmarks: { rank: 4 } as never,
    });

    expect(mapped.ranks).toEqual({
      attendance: null,
      midmarks: { rank: 4, total: 0, value: null },
    });
  });

  it("treats a found response without a roll as no-roll", () => {
    expect(mapMe({ found: true }).status).toBe("no-roll");
    expect(mapMe({ found: true }).roll).toBeNull();
  });
});

/** The server's registered payload may still echo a lookup; it must not win. */
type MyResponseWithLookup = MeResponse & { lastLookup?: string | null };
