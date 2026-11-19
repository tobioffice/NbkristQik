import {
  getUptimeDailyBuckets,
  getUptimeSummary,
} from "../db/student_stats.model.js";

/**
 * The per-component health payload the public status page and the admin
 * health view both serve. One module so the two surfaces cannot drift:
 * a stale threshold or bucket change tuned for one page used to silently
 * disagree with the other.
 */

/** The cacheable part: summary plus 90-day daily bars per component. */
export interface StatusComponentBase {
  component: string;
  uptimePct: number;
  pings: number;
  lastPing: string;
  lastStatus: string;
  avgLatencyMs: number | null;
  buckets: Awaited<ReturnType<typeof getUptimeDailyBuckets>>;
}

/** The read-time view: the base plus freshness derived at send. */
export interface StatusComponent extends StatusComponentBase {
  lastPingAgeSec: number;
  current: "up" | "down";
  stale: boolean;
}

/**
 * Summary plus 90-day daily buckets for every monitored component. The
 * underlying rows only change on the 5-minute probe, so callers cache the
 * assembled result for five minutes instead of rebuilding per request.
 */
export const computeStatusComponents = async (): Promise<
  StatusComponentBase[]
> => {
  const summary = await getUptimeSummary();
  return Promise.all(
    summary.map(async (s) => ({
      component: s.component,
      uptimePct: s.uptimePct,
      pings: s.pings,
      lastPing: s.lastPing,
      lastStatus: s.lastStatus,
      avgLatencyMs: s.avgLatencyMs,
      buckets: await getUptimeDailyBuckets(s.component, 90),
    })),
  );
};

/** A heartbeat older than this means the monitor stopped reporting. */
export const STALE_AFTER_SEC = 15 * 60;

/**
 * Derives "current"/"stale" at read time. The summary and buckets are
 * cached, but a heartbeat crossing the stale line must not keep showing
 * "Operational" until that cache expires.
 *
 * up = the newest heartbeat said up, and it is recent. A down probe also
 * writes a heartbeat, so age alone would report an outage as "up". `stale`
 * separates "the service is down" from "the monitor stopped reporting".
 */
export const withStatusFreshness = (
  components: StatusComponentBase[],
): StatusComponent[] =>
  components.map((c) => {
    const lastPingAgeSec = Math.floor(
      (Date.now() - new Date(c.lastPing + "Z").getTime()) / 1000,
    );
    const stale = lastPingAgeSec >= STALE_AFTER_SEC;
    const current: "up" | "down" =
      c.lastStatus === "up" && !stale ? "up" : "down";
    return {
      component: c.component,
      uptimePct: c.uptimePct,
      pings: c.pings,
      lastPing: c.lastPing,
      lastStatus: c.lastStatus,
      lastPingAgeSec,
      avgLatencyMs: c.avgLatencyMs,
      current,
      stale,
      buckets: c.buckets,
    };
  });
