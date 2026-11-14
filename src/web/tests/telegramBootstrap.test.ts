import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapTelegram } from "../src/telegram";

/**
 * The SDK's chrome calls are best-effort. These tests pin the two things the
 * page depends on: the calls happen when a client is there, and a missing or
 * awkward client can never throw into the first render.
 */

const fakeApp = () => ({
  setHeaderColor: vi.fn(),
  setBackgroundColor: vi.fn(),
  ready: vi.fn(),
  expand: vi.fn(),
  disableVerticalSwipes: vi.fn(),
});

const stubWindow = (app?: ReturnType<typeof fakeApp>) => {
  vi.stubGlobal("window", app ? { Telegram: { WebApp: app } } : {});
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bootstrapTelegram", () => {
  it("does nothing (and does not throw) outside a browser", () => {
    expect(() => bootstrapTelegram()).not.toThrow();
  });

  it("paints the native header and ground, then asks for the full height", () => {
    const app = fakeApp();
    stubWindow(app);

    bootstrapTelegram();

    expect(app.setHeaderColor).toHaveBeenCalledWith("#212a33");
    expect(app.setBackgroundColor).toHaveBeenCalledWith("#1a2026");
    expect(app.ready).toHaveBeenCalledTimes(1);
    expect(app.expand).toHaveBeenCalledTimes(1);
    expect(app.disableVerticalSwipes).toHaveBeenCalledTimes(1);
  });

  it("asks a phone client for the whole screen", () => {
    const requestFullscreen = vi.fn();
    const app = {
      ...fakeApp(),
      platform: "android",
      isFullscreen: false,
      requestFullscreen,
    };
    stubWindow(app);

    bootstrapTelegram();

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(app.ready).toHaveBeenCalled();
  });

  it("leaves a desktop client in its expanded window", () => {
    const requestFullscreen = vi.fn();
    const app = {
      ...fakeApp(),
      platform: "tdesktop",
      requestFullscreen,
    };
    stubWindow(app);

    bootstrapTelegram();

    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("keeps going when a client rejects one of the calls", () => {
    const app = {
      ...fakeApp(),
      setHeaderColor: vi.fn(() => {
        throw new Error("this client has no header colour");
      }),
    };
    stubWindow(app);

    expect(() => bootstrapTelegram()).not.toThrow();
    expect(app.setBackgroundColor).toHaveBeenCalled();
    expect(app.ready).toHaveBeenCalled();
    expect(app.expand).toHaveBeenCalled();
  });

  it("tries again after parsing when the deferred SDK is not there yet", () => {
    const listeners: Array<() => void> = [];
    vi.stubGlobal("document", {
      readyState: "loading",
      addEventListener: vi.fn((_name: string, handler: () => void) => {
        listeners.push(handler);
      }),
      removeEventListener: vi.fn(),
    });
    stubWindow();

    bootstrapTelegram();
    expect(listeners).toHaveLength(1);

    // the deferred script has run by the time parsing ends
    const app = fakeApp();
    stubWindow(app);
    listeners[0]!();

    expect(app.setHeaderColor).toHaveBeenCalledWith("#212a33");
    expect(app.ready).toHaveBeenCalled();
  });
});
