/**
 * Central Redis key namespace. Every key the app reads or writes is built
 * here so prefixes are greppable and can't drift between modules.
 */
export const redisKeys = {
  /** Parsed student record: student:{ROLL} */
  student: (roll: string) => `student:${roll}`,
  /** Parsed attendance JSON: attendance:{ROLL} */
  attendance: (roll: string) => `attendance:${roll}`,
  /** Parsed midmarks JSON: midmarks:{ROLL} */
  midmarks: (roll: string) => `midmarks:${roll}`,
  /** Channel membership cache: isMember:{userId} */
  isMember: (userId: number | string) => `isMember:${userId}`,
  /** Leaderboard API response cache: lb:{sort}:{page}:{limit}:{...filters} */
  leaderboard: (key: string) => `lb:${key}`,
  /** Daily check-in gate: dailyUnlocked:{userId} */
  dailyUnlocked: (userId: number | string) => `dailyUnlocked:${userId}`,
  /** Pinned check-in post message id */
  checkinPostMsgId: "checkin:post:msgId",
  /** Per-user tracker profile upsert throttle (SET NX) */
  trackProfile: (userId: number | string) => `track:p:${userId}`,
  /** Semester type for /syncdb ("1" | "2") */
  syncSemType: "sync:semType",
  /** Broadcast audience set */
  broadcastUsers: "qik:users",
  /** Per-user report submission throttle (SET NX, 60 s) */
  reportGate: (userId: number | string) => `report:gate:${userId}`,
} as const;

/** SCAN patterns for the caches flushed after /syncdb */
export const cacheFlushPatterns = [
  "student:*",
  "attendance:*",
  "midmarks:*",
  "lb:*",
] as const;
