import { describe, it, expect } from "vitest";
import {
  rememberGroupPrompt,
  takeGroupPrompts,
} from "../../src/bot/academics/groupPrompt.js";

const HOUR = 60 * 60 * 1000;

describe("group prompt bookkeeping", () => {
  it("hands the prompt back once, to the student who asked", () => {
    rememberGroupPrompt(880001, "25KB1A05AR", { chatId: -1001, messageId: 77 });

    expect(takeGroupPrompts(880001, "25KB1A05AR")).toEqual([
      { chatId: -1001, messageId: 77 },
    ]);
    // a second open of the same link finds nothing left to delete
    expect(takeGroupPrompts(880001, "25KB1A05AR")).toEqual([]);
  });

  it("matches the roll regardless of case or padding", () => {
    rememberGroupPrompt(880002, " 25kb1a05ar ", {
      chatId: -1002,
      messageId: 12,
    });

    expect(takeGroupPrompts(880002, "25KB1A05AR")).toHaveLength(1);
  });

  it("never hands one student's prompt to another", () => {
    rememberGroupPrompt(880003, "25KB1A05AR", { chatId: -1003, messageId: 3 });

    expect(takeGroupPrompts(880004, "25KB1A05AR")).toEqual([]);
    expect(takeGroupPrompts(880003, "25KB1A05AA")).toEqual([]);
    // the wrong lookups above must not have consumed the real one
    expect(takeGroupPrompts(880003, "25KB1A05AR")).toHaveLength(1);
  });

  it("keeps every repeat of one roll until the deep link clears them", () => {
    rememberGroupPrompt(880005, "25KB1A05AR", { chatId: -1005, messageId: 51 });
    rememberGroupPrompt(880005, "25KB1A05AR", { chatId: -1005, messageId: 52 });

    expect(takeGroupPrompts(880005, "25KB1A05AR")).toEqual([
      { chatId: -1005, messageId: 51 },
      { chatId: -1005, messageId: 52 },
    ]);
  });

  it("bounds a student who keeps retrying the same roll", () => {
    for (let i = 0; i < 15; i += 1) {
      rememberGroupPrompt(880006, "25KB1A05AR", {
        chatId: -1006,
        messageId: i,
      });
    }

    const prompts = takeGroupPrompts(880006, "25KB1A05AR");
    expect(prompts).toHaveLength(10);
    // the newest prompts survive; the oldest are the ones dropped
    expect(prompts.at(-1)).toEqual({ chatId: -1006, messageId: 14 });
  });

  it("forgets prompts past Telegram's 48-hour delete window", () => {
    const now = 1_000_000_000_000;
    rememberGroupPrompt(
      880007,
      "25KB1A05AR",
      { chatId: -1007, messageId: 7 },
      now,
    );

    expect(takeGroupPrompts(880007, "25KB1A05AR", now + 49 * HOUR)).toEqual([]);
  });
});
