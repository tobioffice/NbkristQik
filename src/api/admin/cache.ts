// The panel polls; every request must not become a Turso query (read quota
// + a low-RAM server). Short-TTL in-memory cache sits in front of the
// read-heavy endpoints — staleness of a few seconds is fine here.
const responseCache = new Map<string, { at: number; payload: unknown }>();

// In-flight dedupe: the panel polls /api/recent every 10s against a 5s TTL,
// so a slow round can let overlapping pollers stack identical queries. The
// producing promise is cached too — the second caller awaits the first
// caller's round trip instead of starting its own.
const inflight = new Map<string, Promise<unknown>>();

/** Drop every cached payload whose key starts with `prefix`. */
export const invalidate = (prefix: string): void => {
  for (const key of [...responseCache.keys()]) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
};

export const cached = async <T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> => {
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.payload as T;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const value = produce()
    .then((payload) => {
      responseCache.set(key, { at: Date.now(), payload });
      if (responseCache.size > 200) {
        const oldest = [...responseCache.entries()].sort(
          (a, b) => a[1].at - b[1].at,
        )[0];
        if (oldest) responseCache.delete(oldest[0]);
      }
      return payload;
    })
    .finally(() => {
      // a rejected produce must not poison the next caller: failures are
      // never cached, only successes are
      inflight.delete(key);
    });

  inflight.set(key, value);
  return value;
};
