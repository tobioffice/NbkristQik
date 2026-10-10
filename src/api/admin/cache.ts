// The panel polls; every request must not become a Turso query (read quota
// + a low-RAM server). Short-TTL in-memory cache sits in front of the
// read-heavy endpoints — staleness of a few seconds is fine here.
const responseCache = new Map<string, { at: number; payload: unknown }>();

export const cached = async <T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
): Promise<T> => {
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.payload as T;
  const value = await produce();
  responseCache.set(key, { at: Date.now(), payload: value });
  if (responseCache.size > 200) {
    const oldest = [...responseCache.entries()].sort(
      (a, b) => a[1].at - b[1].at,
    )[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
  return value;
};
