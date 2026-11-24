import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  readRows: vi.fn<() => Promise<Map<string, string>>>(),
  writeRows: vi.fn<(values: Record<string, string>) => Promise<void>>(),
}));

vi.mock("../../src/db/chatModeration.model.js", () => ({
  MODERATION_SETTING_DEFAULTS: {
    enabled: "1",
    auto_delete: "1",
    auto_mute: "1",
    mute_seconds: "900",
    notice_in_chat: "1",
    notify_user: "1",
  },
  readModerationSettingRows: h.readRows,
  writeModerationSettingRows: h.writeRows,
}));

const {
  clampMuteSeconds,
  getModerationSettings,
  invalidateModerationSettings,
  saveModerationSettings,
  settingsFromRows,
} = await import("../../src/services/moderation/settings.js");

beforeEach(() => {
  vi.clearAllMocks();
  invalidateModerationSettings();
  h.readRows.mockResolvedValue(new Map());
  h.writeRows.mockResolvedValue(undefined);
});

describe("moderation settings", () => {
  it("uses the defaults when the table has no rows", () => {
    expect(settingsFromRows(new Map())).toEqual({
      enabled: true,
      autoDelete: true,
      autoMute: true,
      muteSeconds: 900,
      noticeInChat: true,
      notifyUser: true,
    });
  });

  it("reads stored values over the defaults", () => {
    const settings = settingsFromRows(
      new Map([
        ["enabled", "0"],
        ["auto_delete", "false"],
        ["auto_mute", "true"],
        ["mute_seconds", "3600"],
        ["notice_in_chat", "0"],
        ["notify_user", "0"],
      ]),
    );
    expect(settings).toEqual({
      enabled: false,
      autoDelete: false,
      autoMute: true,
      muteSeconds: 3600,
      noticeInChat: false,
      notifyUser: false,
    });
  });

  it("clamps a hand-edited mute length instead of trusting it", () => {
    expect(clampMuteSeconds(5)).toBe(60);
    expect(clampMuteSeconds(999_999_999)).toBe(30 * 24 * 60 * 60);
    expect(clampMuteSeconds("nonsense")).toBe(900);
    expect(settingsFromRows(new Map([["mute_seconds", "0"]])).muteSeconds).toBe(
      60,
    );
  });

  it("caches the read for the bot's per-message path", async () => {
    h.readRows.mockResolvedValue(new Map([["enabled", "0"]]));

    const first = await getModerationSettings();
    const second = await getModerationSettings();

    expect(first.enabled).toBe(false);
    expect(second).toBe(first);
    expect(h.readRows).toHaveBeenCalledTimes(1);

    // force is how a write from another process could be picked up
    expect((await getModerationSettings(true)).enabled).toBe(false);
    expect(h.readRows).toHaveBeenCalledTimes(2);
  });

  it("writes only the keys that changed, then caches the result", async () => {
    const saved = await saveModerationSettings({
      autoMute: false,
      muteSeconds: 5,
    });

    expect(h.writeRows).toHaveBeenCalledTimes(1);
    expect(h.writeRows.mock.calls[0]?.[0]).toEqual({
      auto_mute: "0",
      mute_seconds: "60",
    });
    expect(saved.autoMute).toBe(false);
    expect(saved.muteSeconds).toBe(60);

    // the cache now serves the new value without a second read
    expect((await getModerationSettings()).autoMute).toBe(false);
    expect(h.readRows).toHaveBeenCalledTimes(1);
  });

  it("does not write when nothing changed", async () => {
    await saveModerationSettings({});
    expect(h.writeRows).not.toHaveBeenCalled();
  });
});
