import { describe, expect, it } from "vitest";
import {
  formatDuration,
  parseDuration,
  parseModerationCommand,
} from "../../src/services/moderation/commands.js";

describe("moderation reply command parsing", () => {
  it("reads a bare command with no reason", () => {
    expect(parseModerationCommand("/ban")).toEqual({
      name: "ban",
      seconds: null,
      reason: null,
    });
  });

  it("takes the rest of the line as the reason", () => {
    expect(parseModerationCommand("/ban selling papers")).toEqual({
      name: "ban",
      seconds: null,
      reason: "selling papers",
    });
  });

  it("ignores the @botname suffix a group client adds", () => {
    expect(parseModerationCommand("/kick@NbkristQik_bot rude")?.name).toBe(
      "kick",
    );
  });

  it("is case-insensitive", () => {
    expect(parseModerationCommand("/BAN")?.name).toBe("ban");
  });

  it("reads a mute duration and leaves the rest as the reason", () => {
    expect(parseModerationCommand("/mute 2h spam")).toEqual({
      name: "mute",
      seconds: 7200,
      reason: "spam",
    });
    expect(parseModerationCommand("/mute 30")).toEqual({
      name: "mute",
      seconds: 1800,
      reason: null,
    });
  });

  it("treats a non-duration word after /mute as the reason", () => {
    expect(parseModerationCommand("/mute rude")).toEqual({
      name: "mute",
      seconds: null,
      reason: "rude",
    });
  });

  it("ignores commands the layer does not own", () => {
    expect(parseModerationCommand("/report broken")).toBeNull();
    expect(parseModerationCommand("/attendance")).toBeNull();
    expect(parseModerationCommand("please ban him")).toBeNull();
    expect(parseModerationCommand("/banned")).toBeNull();
    expect(parseModerationCommand("")).toBeNull();
  });
});

describe("mute durations", () => {
  it("parses minutes, hours, days and seconds", () => {
    expect(parseDuration("30")).toBe(30 * 60);
    expect(parseDuration("30m")).toBe(30 * 60);
    expect(parseDuration("2h")).toBe(2 * 60 * 60);
    expect(parseDuration("1d")).toBe(24 * 60 * 60);
    expect(parseDuration("90s")).toBe(90);
  });

  it("refuses a length Telegram would treat as permanent", () => {
    expect(parseDuration("30s")).toBeNull();
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });

  it("caps a runaway duration", () => {
    expect(parseDuration("999d")).toBe(30 * 24 * 60 * 60);
  });

  it("prints a duration a human reads", () => {
    expect(formatDuration(45)).toBe("45 seconds");
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(15 * 60)).toBe("15 minutes");
    expect(formatDuration(90 * 60)).toBe("1 hour 30 minutes");
    expect(formatDuration(24 * 60 * 60)).toBe("1 day");
    expect(formatDuration(2 * 24 * 60 * 60)).toBe("2 days");
  });
});
