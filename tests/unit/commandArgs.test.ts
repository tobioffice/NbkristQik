import { describe, expect, it } from "vitest";
import type { Context } from "node-telegram-bot-api";
import { commandArgs } from "../../src/bot/commands/args.js";

const ctx = (match: Context["match"]): Context => ({ match }) as Context;

describe("commandArgs", () => {
  it("returns the trimmed argument string", () => {
    expect(commandArgs(ctx("  QIK-0007  "))).toBe("QIK-0007");
  });

  it("is empty for a bare command", () => {
    expect(commandArgs(ctx(""))).toBe("");
    expect(commandArgs(ctx(undefined))).toBe("");
  });

  it("is empty for a regex match, which only hears uses", () => {
    expect(
      commandArgs(ctx(["25KB1A05AR"] as unknown as RegExpMatchArray)),
    ).toBe("");
  });
});
