import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportThread } from "../src/api";
import { startThreadPoll } from "../src/views/ReportThread";

const thread = (status: ReportThread["status"]): ReportThread => ({
  issueId: "NBK-1",
  status,
  createdAt: "2026-11-08 00:00:00",
  messageCount: 1,
  messages: [],
});

describe("startThreadPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops the clock once a poll reports the thread resolved", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(thread("open"))
      .mockResolvedValue(thread("resolved"));
    const stop = startThreadPoll({ request, onThread: () => {} });

    await vi.advanceTimersByTimeAsync(8000);
    expect(request).toHaveBeenCalledTimes(1);

    // the next poll finds the thread closed
    await vi.advanceTimersByTimeAsync(8000);
    expect(request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(8000 * 4);
    expect(request).toHaveBeenCalledTimes(2);

    stop();
  });

  it("does not tick while the page is hidden", async () => {
    let visible = false;
    const request = vi.fn(async () => thread("open"));
    const stop = startThreadPoll({
      request,
      onThread: () => {},
      isVisible: () => visible,
    });

    await vi.advanceTimersByTimeAsync(8000 * 2);
    expect(request).not.toHaveBeenCalled();

    visible = true;
    await vi.advanceTimersByTimeAsync(8000);
    expect(request).toHaveBeenCalledTimes(1);

    stop();
  });

  it("never starts a second poll while one is in flight", async () => {
    let finish: ((value: ReportThread) => void) | undefined;
    const request = vi.fn(
      () =>
        new Promise<ReportThread>((resolve) => {
          finish = resolve;
        }),
    );
    const stop = startThreadPoll({ request, onThread: () => {} });

    await vi.advanceTimersByTimeAsync(8000);
    expect(request).toHaveBeenCalledTimes(1);

    // two more ticks pass while the first request is still open
    await vi.advanceTimersByTimeAsync(8000 * 2);
    expect(request).toHaveBeenCalledTimes(1);

    finish?.(thread("open"));
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(8000);

    expect(request).toHaveBeenCalledTimes(2);
    stop();
  });

  it("does not poll a thread that was already resolved", async () => {
    const request = vi.fn(async () => thread("resolved"));
    const stop = startThreadPoll({
      request,
      onThread: () => {},
      canPoll: () => false,
    });

    await vi.advanceTimersByTimeAsync(8000 * 3);
    expect(request).not.toHaveBeenCalled();

    stop();
  });

  it("aborts the request in flight when the page goes away", async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn(
      (abort: AbortSignal) =>
        new Promise<ReportThread>(() => {
          signal = abort;
        }),
    );
    const stop = startThreadPoll({ request, onThread: () => {} });

    await vi.advanceTimersByTimeAsync(8000);
    expect(signal?.aborted).toBe(false);

    stop();
    expect(signal?.aborted).toBe(true);
  });
});
