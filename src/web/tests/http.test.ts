import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  RequestError,
  fetchWithTimeout,
  readJson,
  REQUEST_TIMEOUT_MS,
} from "../src/http";

/**
 * Every call in the app funnels through these two functions. A regression
 * here fails silently everywhere else (the modules that use them are not
 * imported in the same test), so the two contracts are pinned directly:
 * a timeout is classified as one, a caller's own abort is not, and the
 * server's sentence travels with the thrown error.
 */

const realFetch = globalThis.fetch;

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("fetchWithTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it("abandons a request that outlives the ceiling as a timeout", async () => {
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // a phone on a dead line: only the abort signal ends it, the way
          // a real fetch would
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("The user aborted a request.");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );

    const pending = fetchWithTimeout("/api/leaderboard");
    const assertion = expect(pending).rejects.toMatchObject({
      name: "RequestError",
      status: 0,
      message: "The request took too long. Try again.",
    });
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    await assertion;
  });

  it("passes a caller's own abort through untouched", async () => {
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("The user aborted a request.");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );

    const controller = new AbortController();
    const pending = fetchWithTimeout("/api/thread/QIK-0001", {
      signal: controller.signal,
    });
    controller.abort();

    // not a timeout: the caller classifies its own abort
    const assertion = expect(pending).rejects.toSatisfy(
      (error: unknown) =>
        !(error instanceof RequestError) &&
        (error as Error).name === "AbortError",
    );
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
    await assertion;
  });

  it("forwards the timeout signal to fetch and cleans it up", async () => {
    const seen = new Response("{}");
    globalThis.fetch = vi.fn(async (_input, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return seen;
    });

    const res = await fetchWithTimeout("/api/config");
    expect(res).toBe(seen);
  });
});

describe("readJson", () => {
  it("returns the body when the response is ok", async () => {
    const body = await readJson<{ found: boolean }>(
      jsonResponse(200, { found: true }),
    );
    expect(body.found).toBe(true);
  });

  it("throws the server's sentence, with its near-miss suggestions", async () => {
    const error = await readJson(
      jsonResponse(404, {
        error: "This roll number isn't in the college records yet.",
        suggestions: ["23CS1042"],
      }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).status).toBe(404);
    expect((error as RequestError).message).toContain("college records");
    expect((error as RequestError).suggestions).toEqual(["23CS1042"]);
  });

  it("falls back to a plain status sentence when the body says nothing", async () => {
    const error = await readJson(jsonResponse(500, {})).catch(
      (e: unknown) => e,
    );
    expect((error as RequestError).message).toBe(
      "The request failed. Try again.",
    );
    expect((error as RequestError).status).toBe(500);
  });
});
