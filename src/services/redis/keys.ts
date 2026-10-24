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
  /** Per-user tracker profile upsert throttle (SET NX) */
  trackProfile: (userId: number | string) => `track:p:${userId}`,
  /** Semester type for /syncdb ("1" | "2") */
  syncSemType: "sync:semType",
  /** Broadcast audience set */
  broadcastUsers: "qik:users",
  /** Per-user report submission throttle (SET NX, 60 s) */
  reportGate: (userId: number | string) => `report:gate:${userId}`,
  /** Per-user report thread reply throttle (SET NX, 3 s) */
  reportThreadGate: (userId: number | string) => `report:thread:${userId}`,
  /** Pinned channel check-in post id: checkin:post:msgId */
  checkinPostMsgId: "checkin:post:msgId",
  /** Per-user daily "I'm not a robot" unlock (TTL to next IST midnight) */
  dailyUnlocked: (userId: number | string) => `dailyUnlocked:${userId}`,
  /** Library web app session: lib:sess:{token} */
  librarySession: (token: string) => `lib:sess:${token}`,
  /** Pages pulled by one student in the last five minutes: lib:reads:{userId} */
  libraryReads: (userId: number | string) => `lib:reads:${userId}`,
} as const;
/** SCAN patterns for the caches flushed after /syncdb */
export const cacheFlushPatterns = [
  "student:*",
  "attendance:*",
  "midmarks:*",
  "lb:*",
] as const;
