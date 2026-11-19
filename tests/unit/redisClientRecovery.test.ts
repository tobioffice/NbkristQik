import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The cached Redis client must survive its own death. A socket that *ends*
 * (Redis restarted, the bounded reconnect loop gave up) has to be dropped so
 * the next caller dials a fresh connection — otherwise every command keeps
 * hitting a client that rejects forever, and the process degrades (sessions
 * 401, gates fail open) until someone restarts it by hand.
 */

interface FakeRedisClient {
  connect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  emit: (event: string) => void;
}

const { created, makeFake, setFailConnects } = vi.hoisted(() => {
  const created: FakeRedisClient[] = [];
  let failConnects = 0;

  const makeFake = (): FakeRedisClient => {
    const handlers = new Map<string, Array<() => void>>();
    const client: FakeRedisClient = {
      connect: vi.fn(async () => {
        if (failConnects > 0) {
          failConnects -= 1;
          throw new Error("connect refused");
        }
      }),
      on: vi.fn((event: string, cb: () => void) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
      }),
      emit: (event: string) => {
        for (const cb of handlers.get(event) ?? []) cb();
      },
    };
    created.push(client);
    return client;
  };

  return {
    created,
    makeFake,
    setFailConnects: (n: number) => {
      failConnects = n;
    },
  };
});

vi.mock("redis", () => ({ createClient: vi.fn(makeFake) }));

const importClient = () => import("../../src/services/redis/getRedisClient.js");

describe("redis client recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    created.length = 0;
    setFailConnects(0);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one client across concurrent callers", async () => {
    const { getClient } = await importClient();
    const [a, b] = await Promise.all([getClient(), getClient()]);
    expect(created).toHaveLength(1);
    expect(a).toBe(b);
  });

  it("does not pin a failed connect; the next caller retries", async () => {
    setFailConnects(1);
    const { getClient } = await importClient();
    await expect(getClient()).rejects.toThrow("connect refused");

    // cooldown first, then a fresh dial
    await expect(getClient()).rejects.toThrow("cooldown");
    vi.advanceTimersByTime(30_001);

    await getClient();
    expect(created).toHaveLength(2);
  });

  it("drops the client after the socket ends and reconnects on the next call", async () => {
    const { getClient } = await importClient();
    const first = await getClient();
    expect(created).toHaveLength(1);

    first.emit("end");

    // the cooldown fast-fails the next caller instead of re-paying the
    // full reconnect timeout on every request
    await expect(getClient()).rejects.toThrow("cooldown");
    vi.advanceTimersByTime(30_001);

    const second = await getClient();
    expect(created).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it("a stale end event from a replaced client cannot drop the live one", async () => {
    const { getClient } = await importClient();
    const first = await getClient();
    first.emit("end");
    vi.advanceTimersByTime(30_001);

    const second = await getClient();
    expect(created).toHaveLength(2);

    // the old socket fires again, late: the live client must stay cached
    first.emit("end");
    const again = await getClient();
    expect(again).toBe(second);
    expect(created).toHaveLength(2);
  });
});
