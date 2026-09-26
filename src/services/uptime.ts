/**
 * Uptime heartbeat — pings internal API every 5 minutes, records to Turso.
 * Powers the /status page (90-day bars like OpenAI's status page).
 * Self-healing: interval keeps running even if a probe fails.
 */
import axios from "axios";
import { recordHeartbeat, initUptimeTable } from "../db/student_stats.model.js";
import { PORT } from "../config/environmentals.js";
import { logger } from "../config/logger.js";

const PROBE_URL = `http://127.0.0.1:${PORT}/health`;
const COMPONENT = "api";
const INTERVAL_MS = 5 * 60 * 1000;
const RETENTION_DAYS = 95;

let inited = false;

const probe = async () => {
  const start = Date.now();
  let status: "up" | "down" = "down";
  let latency: number | null = null;

  try {
    await axios.get(PROBE_URL, { timeout: 8000 });
    status = "up";
    latency = Date.now() - start;
  } catch {
    status = "down";
  }

  try {
    await recordHeartbeat(COMPONENT, status, latency);
  } catch (e) {
    logger.warn("[uptime] heartbeat write failed:", e);
  }

  logger.debug(`[uptime] ${COMPONENT}: ${status} (${latency ?? "timeout"}ms)`);
};

const prune = async () => {
  try {
    const { turso } = await import("../db/db.js");
    // RETENTION_DAYS is a module constant (not user input), so interpolating
    // the integer into the datetime() modifier is safe
    await turso.execute(
      `DELETE FROM uptime_log WHERE created_at < datetime('now', '-${RETENTION_DAYS} days')`,
    );
  } catch (e) {
    logger.warn("[uptime] prune failed:", e);
  }
};

export const startUptimeMonitor = async () => {
  if (inited) return;
  inited = true;

  try {
    await initUptimeTable();
  } catch (e) {
    logger.warn("[uptime] table init failed:", e);
  }

  // initial probe after short delay (let API server bind first)
  setTimeout(probe, 15 * 1000);
  setInterval(probe, INTERVAL_MS);
  // prune once a day
  setInterval(prune, 24 * 60 * 60 * 1000);

  logger.info("[uptime] monitor started (5min interval, 90d retention)");
};
