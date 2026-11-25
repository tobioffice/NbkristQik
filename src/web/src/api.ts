import { fetchWithTimeout, readJson, UPLOAD_TIMEOUT_MS } from "./http";
import { telegramWebApp } from "./telegram";

// Centralized API origin. The app is served same-origin by the API host
// (dev: the vite proxy forwards /api; prod: /library/ and /api share the
// origin), so same-origin is the correct default for every documented
// deployment — including a self-hosted one built from this repo. A
// deployment that splits the two origins sets VITE_API_URL at build time.
export const API_BASE = import.meta.env.VITE_API_URL || "";

/** Who is calling: signed Telegram initData, with a dev userId fallback. */
export interface ApiIdentity {
  initData?: string;
  userId?: string;
}

/**
 * Telegram's signed initData travels in a header, never in the URL. The
 * server verifies it the same way a query parameter would be verified, and a
 * URL can end up in logs, browser history and Referer headers.
 */
export const authHeaders = (initData?: string): Record<string, string> =>
  initData ? { "X-Telegram-Init-Data": initData } : {};

/**
 * Tell the bot the current chat palette once per app open (and on a theme
 * change). The bot bakes the attendance bar strip in this background colour.
 * Best-effort: a failed sync leaves the dark default in place.
 */
export const syncTheme = async (): Promise<void> => {
  const app = telegramWebApp();
  const bgColor = app?.themeParams?.bg_color;
  if (!app?.initData || !bgColor) return;

  await fetchWithTimeout(`${API_BASE}/api/theme`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(app.initData),
    },
    body: JSON.stringify({
      bgColor,
      colorScheme: app.colorScheme,
    }),
  }).catch(() => undefined);
};

/** The dev fallback is a bare userId, and only when initData is absent. */
export const devIdentityParams = (identity: ApiIdentity): URLSearchParams => {
  const params = new URLSearchParams();
  if (!identity.initData && identity.userId) {
    params.set("userId", identity.userId);
  }
  return params;
};

/** The same fallback, for JSON bodies. */
const devIdentityBody = (identity: ApiIdentity): Record<string, unknown> =>
  !identity.initData && identity.userId ? { userId: identity.userId } : {};

/**
 * POST identity. The header is the preferred signal; the signed blob also
 * rides in the body while the server-side resolvers finish moving to the
 * header, so an older deployment still accepts the call. No userId is ever
 * added when a real initData is present.
 */
const identityBody = (identity: ApiIdentity): Record<string, unknown> =>
  identity.initData
    ? { initData: identity.initData }
    : devIdentityBody(identity);

const withQuery = (path: string, params: URLSearchParams): string => {
  const query = params.toString();
  return query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
};

export type SortBy = "attendance" | "midmarks";

export interface StudentStat {
  /** Null when the owner hid the row: rank and score still count. */
  roll_no: string | null;
  name: string | null;
  attendance_percentage: number;
  mid_marks_avg: number | null;
  rank: number;
  /** The owner hid their identity; the row itself still ranks. */
  hidden?: boolean;
}

/**
 * The portal stores `yearSem` (11..42), but the register filters on the year
 * digit only; semester 2 (12, 22, ...) must answer to the same year.
 */
export type YearFilter = "all" | "1" | "2" | "3" | "4";

export interface LeaderboardFilters {
  year: YearFilter;
  branch: string;
  section: string;
}

/**
 * Which slice the register shows. `me` asks the server to resolve the
 * caller's saved registration to a year/branch/section; `all` is a
 * deliberate whole-register view. Explicit filters override both.
 */
export type LeaderboardScope = "me" | "all";

/** The section context the server actually applied to the page. */
export interface LeaderboardScopeInfo {
  year: string | null;
  branch: string | null;
  section: string | null;
}

/**
 * `ranked` is the number of students with a figure in this view; `known` is
 * the (possibly stale) directory count for the same filters. It is a partial
 * register, never the whole college.
 */
export interface LeaderboardCoverage {
  ranked: number;
  known: number;
}

/** The newest and oldest write behind the figures on page 1. */
export interface LeaderboardFreshness {
  newest: string | null;
  oldest: string | null;
}

export interface MyRank {
  attendance: RankInfo | null;
  midmarks: RankInfo | null;
}

/** Global position plus the figure printed for it. */
export interface RankInfo {
  rank: number;
  total: number;
  value: number | null;
}

/**
 * The caller's two ranks inside their own section, from the same scan as the
 * global ones. `year` is the leaderboard's year digit ("3"), not the portal's
 * year-semester code ("31").
 */
export interface SectionRank {
  year: string;
  branch: string;
  section: string;
  attendance: RankInfo | null;
  midmarks: RankInfo | null;
}

/** Which board a shared figure belongs to. */
export type RankScope = "section" | "all";

/** A prepared message the Mini App can hand to the native share sheet. */
export interface RankShare {
  id: string;
  expiresAt: number;
}

/** A card the phone drew, now with a public URL Telegram can fetch. */
export interface RankCard {
  id: string;
  url: string;
}

/**
 * Store a rank card for the caller, ready to share. The student's own
 * Telegram client is the only sender; the server never posts it anywhere.
 */
export const requestRankShare = async (
  identity: ApiIdentity & {
    sort: SortBy;
    scope?: RankScope;
    cardId?: string | null;
  },
): Promise<RankShare> => {
  const res = await fetchWithTimeout(
    withQuery("/api/rank/share", devIdentityParams(identity)),
    {
      method: "POST",
      headers: {
        ...authHeaders(identity.initData),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...identityBody(identity),
        sort: identity.sort,
        scope: identity.scope ?? "all",
        ...(identity.cardId ? { cardId: identity.cardId } : {}),
      }),
    },
  );
  return readJson<RankShare>(res);
};

/** Upload the phone's 1080×1920 JPEG; returns the URL Telegram will fetch. */
export const uploadRankCard = async (
  identity: ApiIdentity & { blob: Blob },
): Promise<RankCard> => {
  const res = await fetchWithTimeout(
    withQuery("/api/rank/card", devIdentityParams(identity)),
    {
      method: "POST",
      headers: {
        ...authHeaders(identity.initData),
        "Content-Type": "image/jpeg",
      },
      body: identity.blob,
    },
    UPLOAD_TIMEOUT_MS,
  );
  return readJson<RankCard>(res);
};

/** Ask the bot to send the card to the caller's own chat, to save to Photos. */
export const sendRankCard = async (
  identity: ApiIdentity & { cardId: string },
): Promise<void> => {
  const res = await fetchWithTimeout(
    withQuery("/api/rank/card/send", devIdentityParams(identity)),
    {
      method: "POST",
      headers: {
        ...authHeaders(identity.initData),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...identityBody(identity),
        cardId: identity.cardId,
      }),
    },
  );
  await readJson(res);
};

/** What page 1 adds to the envelope: sync freshness and live filter options. */
export interface LeaderboardMeta {
  updated_at: string | null;
  facets: { sections: string[] } | null;
  scope: LeaderboardScopeInfo | null;
  coverage: LeaderboardCoverage | null;
  freshness: LeaderboardFreshness | null;
}

/**
 * The leaderboard URL. `scope` decides what an unfiltered page means:
 * `me` lets the server resolve the caller's own section, `all` is the whole
 * register. Dimensions set to `all` are omitted entirely — sending
 * `year=all` would be an explicit filter and would suppress `scope=me`.
 */
export const buildLeaderboardUrl = (
  page: number,
  sort: SortBy,
  filters: LeaderboardFilters,
  search: string,
  scope: LeaderboardScope = "me",
): string => {
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: "20",
    sort: sort,
    scope,
  });
  if (filters.year !== "all") queryParams.set("year", filters.year);
  if (filters.branch !== "all") queryParams.set("branch", filters.branch);
  if (filters.section !== "all") queryParams.set("section", filters.section);
  if (search) queryParams.set("search", search);
  return `${API_BASE}/api/leaderboard?${queryParams.toString()}`;
};

/**
 * `/api/me` reads identity from the header. `userId` is kept here only as the
 * dev fallback, so a real initData call leaves the URL completely bare.
 */
export const buildMeUrl = (userId: string, initData?: string): string => {
  const params = new URLSearchParams();
  if (!initData && userId) params.set("userId", userId);
  return withQuery("/api/me", params);
};

export interface MeResponse {
  found: boolean;
  roll_no?: string;
  attendance?: RankInfo | null;
  midmarks?: RankInfo | null;
  /** The same two figures inside the caller's own section. */
  section?: SectionRank | null;
  /**
   * The last roll this account looked up. It is a suggestion for an
   * unregistered user, never their identity.
   */
  lastLookup?: string | null;
  /** A found caller is always a saved registration. */
  source?: "registered";
}

/** The verified caller, after `/api/me` has been mapped to a screen state. */
export interface MeState {
  status: "ready" | "no-roll";
  roll: string | null;
  ranks: MyRank | null;
  /** The caller's own section and section ranks, when the server knows it. */
  section: SectionRank | null;
  source: "registered" | null;
  /** Kept apart from `roll` so a friend's lookup is never read as identity. */
  lastLookup: string | null;
}

const rankInfo = (raw: unknown): RankInfo | null => {
  if (!raw || typeof raw !== "object") return null;
  const info = raw as Partial<RankInfo>;
  if (typeof info.rank !== "number") return null;
  return {
    rank: info.rank,
    total: typeof info.total === "number" ? info.total : 0,
    value: typeof info.value === "number" ? info.value : null,
  };
};

const sectionRank = (raw: unknown): SectionRank | null => {
  if (!raw || typeof raw !== "object") return null;
  const section = raw as Partial<SectionRank>;
  if (
    typeof section.year !== "string" ||
    typeof section.branch !== "string" ||
    typeof section.section !== "string"
  ) {
    return null;
  }
  return {
    year: section.year,
    branch: section.branch,
    section: section.section,
    attendance: rankInfo(section.attendance),
    midmarks: rankInfo(section.midmarks),
  };
};

/**
 * `/api/me` is the registration, nothing else. `lastLookup` is returned as a
 * separate suggestion and is deliberately not allowed to fill `roll`.
 */
export const mapMe = (me: MeResponse): MeState => {
  if (!me.found || !me.roll_no) {
    return {
      status: "no-roll",
      roll: null,
      ranks: null,
      section: null,
      source: null,
      lastLookup: me.lastLookup ?? null,
    };
  }

  return {
    status: "ready",
    roll: me.roll_no,
    ranks: {
      attendance: rankInfo(me.attendance),
      midmarks: rankInfo(me.midmarks),
    },
    section: sectionRank(me.section),
    source: "registered",
    lastLookup: null,
  };
};

/** The caller's roll and global ranks, resolved through their identity. */
export const getMe = async (identity: ApiIdentity): Promise<MeResponse> => {
  const res = await fetchWithTimeout(
    buildMeUrl(identity.userId ?? "", identity.initData),
    { headers: authHeaders(identity.initData) },
  );
  return readJson<MeResponse>(res);
};

/** Forget the last roll this account looked up; the registration is untouched. */
export const deleteLastLookup = async (
  identity: ApiIdentity,
): Promise<void> => {
  const res = await fetchWithTimeout(
    withQuery("/api/me/last-lookup", devIdentityParams(identity)),
    {
      method: "DELETE",
      headers: authHeaders(identity.initData),
    },
  );
  await readJson(res);
};

export const PAGE_SIZE = 20;

// ---------- app config ----------

/** What the shell may show this caller: the shelf is admin-first for now. */
export interface AppConfig {
  libraryOpen: boolean;
  admin: boolean;
}

/**
 * `/api/config` is identity-aware: a valid header may open the library tab
 * (the admin always has it); an anonymous caller is told it is shut. The dev
 * userId fallback rides in the query, never a real initData blob.
 */
export const buildConfigUrl = (identity: ApiIdentity): string =>
  withQuery("/api/config", devIdentityParams(identity));

export const fetchAppConfig = async (
  identity: ApiIdentity,
): Promise<AppConfig> => {
  const res = await fetchWithTimeout(buildConfigUrl(identity), {
    headers: authHeaders(identity.initData),
  });
  if (!res.ok) throw new Error(`config request failed: ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as Partial<AppConfig>;
  return {
    libraryOpen: data.libraryOpen === true,
    admin: data.admin === true,
  };
};

// ---------- profile / registration ----------

export interface Registration {
  roll_no: string;
  display_name: string | null;
  registered_at: string;
  updated_at: string;
}

export interface StudentInfo {
  roll_no: string;
  name: string | null;
  section: string;
  branch: string;
  year: string;
}

/** One finished daily run, as the profile's run history prints it. */
export interface GameRun {
  id: number;
  /** IST day the run belongs to, `YYYY-MM-DD`. */
  dayKey: string;
  score: number;
  points: number;
  correct: number;
  total: number;
  streak: number;
  finishedAt: string | null;
}

export type ProfileResponse =
  | {
      found: true;
      registration: Registration;
      student: StudentInfo;
      runs?: GameRun[];
    }
  // registered roll vanished from the college master table (semester sync)
  | {
      found: true;
      stale: true;
      registration: Registration;
      student: null;
      runs?: GameRun[];
    }
  // `lastLookup` is a suggestion for the empty form, not the caller's roll
  | {
      found: false;
      lastLookup: string | null;
      suggestion: string | null;
      runs?: GameRun[];
    }
  | { found: false; error: string };

export interface RegisterRequest {
  initData?: string;
  userId?: string;
  rollNo: string;
  displayName?: string;
}

export const ROLL_REGEX = /^\d{2}[a-zA-Z0-9]{2}[a-zA-Z0-9]{6}$/;

export const buildProfileUrl = (identity: {
  initData?: string;
  userId?: string;
}): string => withQuery("/api/profile", devIdentityParams(identity));

export const getProfile = async (identity: {
  initData?: string;
  userId?: string;
}): Promise<ProfileResponse> => {
  const res = await fetchWithTimeout(buildProfileUrl(identity), {
    headers: authHeaders(identity.initData),
  });
  if (!res.ok) throw new Error(`profile request failed: ${res.status}`);
  return (await res.json()) as ProfileResponse;
};

export const registerRoll = async (req: RegisterRequest): Promise<void> => {
  const { initData, userId, rollNo, displayName } = req;
  const body: Record<string, unknown> = { rollNo, displayName };
  if (initData) body.initData = initData;
  else if (userId) body.userId = userId;

  const res = await fetchWithTimeout(`${API_BASE}/api/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(initData),
    },
    body: JSON.stringify(body),
  });
  // the body is only wanted for the error it may carry
  await readJson(res);
};

// ---------- the home league banner ----------

/** Where the caller's run stands today, as the banner reads it. */
export interface LiveRun {
  state: "open" | "playing" | "done";
  questions: number;
  /** The question to resume, 1-based, while a run is active. */
  question?: number;
  /** Season points a finished run earned. */
  points?: number;
}

export interface GameLive {
  success: true;
  weekLabel: string;
  me: null | {
    registered: boolean;
    run: LiveRun | null;
  };
}

export const buildGameLiveUrl = (identity: ApiIdentity): string =>
  withQuery("/api/games/live", devIdentityParams(identity));

/** The week's label and the caller's run today, for the home banner. */
export const getGameLive = async (
  identity: ApiIdentity,
  signal?: AbortSignal,
): Promise<GameLive> => {
  const res = await fetchWithTimeout(buildGameLiveUrl(identity), {
    headers: authHeaders(identity.initData),
    signal,
  });
  return readJson<GameLive>(res);
};

// ---------- the caller's run history ----------

/** One question of a finished run, with the answer given. */
export interface GameRunQuestion {
  index: number;
  prompt: string;
  options: string[];
  correctIndex: number | null;
  chosenIndex: number | null;
  correct: boolean | null;
  /** Time from the question appearing to the tap, in milliseconds. */
  ms: number | null;
  points: number | null;
}

/** A finished daily run with every question, for the runs page. */
export interface GameRunDetail extends GameRun {
  durationMs: number | null;
  questions: GameRunQuestion[];
}

export interface GameRunsResponse {
  success: true;
  runs: GameRunDetail[];
}

export const buildGameRunsUrl = (identity: ApiIdentity): string =>
  withQuery("/api/games/runs", devIdentityParams(identity));

/** The signed-in caller's finished runs, newest first, with their questions. */
export const getGameRuns = async (
  identity: ApiIdentity,
  signal?: AbortSignal,
): Promise<GameRunsResponse> => {
  const res = await fetchWithTimeout(buildGameRunsUrl(identity), {
    headers: authHeaders(identity.initData),
    signal,
  });
  return readJson<GameRunsResponse>(res);
};

// ---------- the daily run ----------

/** The current question as the play screen shows it. */
export interface FiveQuestion {
  /** 0-based; the screen prints index + 1. */
  index: number;
  total: number;
  prompt: string;
  options: string[];
  /** How long this question is worth points, from the moment it was shown. */
  limitMs: number;
}

/** The numbers a finished run shows. */
export interface FiveResult {
  correct: number;
  total: number;
  score: number;
  points: number;
  streak: number;
  rank: number;
  players: number;
  section: { label: string; rank: number; total: number } | null;
}

export type FiveStartResponse =
  | { success: true; state: "needs-roll" }
  | { success: true; state: "not-ready" }
  | {
      success: true;
      state: "done";
      alreadyPlayed: boolean;
      result: FiveResult;
    }
  | {
      success: true;
      state: "playing";
      attemptId: number;
      score: number;
      question: FiveQuestion;
    };

export type FiveFeedback = {
  correct: boolean;
  timedOut: boolean;
  /** Points this answer earned. */
  earned: number;
};

export type FiveAnswerResponse =
  | {
      success: true;
      state: "playing";
      attemptId: number;
      score: number;
      question: FiveQuestion;
      /** How the previous answer landed; the bot's toast, in the page line. */
      feedback: FiveFeedback;
    }
  | {
      success: true;
      state: "done";
      alreadyPlayed: boolean;
      result: FiveResult;
    };

const postGame = async <T>(
  path: string,
  identity: ApiIdentity,
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> => {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(identity.initData),
    },
    body: JSON.stringify({ ...identityBody(identity), ...body }),
    signal,
  });
  return readJson<T>(res);
};

/** Start or resume today's run, and get the question on screen. */
export const startDailyRun = (
  identity: ApiIdentity,
  signal?: AbortSignal,
): Promise<FiveStartResponse> =>
  postGame<FiveStartResponse>("/api/games/five/start", identity, {}, signal);

/**
 * Answer the question at `index` (0-based). A 409 means the run moved on
 * somewhere else; read the current question again instead of retrying.
 */
export const answerDailyRun = (
  identity: ApiIdentity,
  attemptId: number,
  index: number,
  option: number,
  signal?: AbortSignal,
): Promise<FiveAnswerResponse> =>
  postGame<FiveAnswerResponse>(
    "/api/games/five/answer",
    identity,
    { attemptId, index, option },
    signal,
  );

// ---------- college-email verification ----------

export interface VerificationState {
  verified: boolean;
  roll: string | null;
  email: string | null;
  /** At least one switch is on. */
  blocked: boolean;
  hideLeaderboard: boolean;
  blockLookups: boolean;
  blockRegistration: boolean;
}

export interface VerificationOptions {
  hideLeaderboard: boolean;
  blockLookups: boolean;
  blockRegistration: boolean;
}

const verificationRequest = async (
  path: string,
  identity: ApiIdentity,
  init: RequestInit = {},
): Promise<VerificationState> => {
  const res = await fetchWithTimeout(
    withQuery(path, devIdentityParams(identity)),
    {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(identity.initData),
        ...init.headers,
      },
    },
  );
  return readJson<VerificationState>(res);
};

export const getVerification = (
  identity: ApiIdentity,
): Promise<VerificationState> =>
  verificationRequest("/api/verification", identity);

export const startVerification = async (
  identity: ApiIdentity,
  rollNo: string,
): Promise<{ email: string; expiresInSeconds: number }> => {
  const res = await fetchWithTimeout(`${API_BASE}/api/verification/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(identity.initData),
    },
    body: JSON.stringify({ rollNo, ...identityBody(identity) }),
  });
  return readJson<{ email: string; expiresInSeconds: number }>(res);
};

export const confirmVerification = async (
  identity: ApiIdentity,
  rollNo: string,
  code: string,
): Promise<VerificationState> => {
  const res = await fetchWithTimeout(`${API_BASE}/api/verification/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(identity.initData),
    },
    body: JSON.stringify({ rollNo, code, ...identityBody(identity) }),
  });
  return readJson<VerificationState>(res);
};

export const setVerificationOptions = async (
  identity: ApiIdentity,
  options: VerificationOptions,
): Promise<VerificationState> => {
  const res = await fetchWithTimeout(`${API_BASE}/api/verification/options`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(identity.initData),
    },
    body: JSON.stringify({ ...options, ...identityBody(identity) }),
  });
  return readJson<VerificationState>(res);
};

// ---------- issue reports ----------

export interface MyReport {
  issueId: string;
  message: string;
  status: "open" | "answered" | "resolved";
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
  /** thread roll-up: total messages, who spoke last, how many the caller has not seen */
  messageCount: number;
  lastAuthor: "user" | "admin";
  lastMessageAt: string;
  unread: number;
}

export const submitReport = async (
  identity: { initData?: string; userId?: string },
  message: string,
  files: File[] = [],
): Promise<{ issueId: string }> => {
  const url = withQuery("/api/report", devIdentityParams(identity));
  const headers: Record<string, string> = {
    ...authHeaders(identity.initData),
  };
  let body: BodyInit;
  if (files.length > 0) {
    const form = new FormData();
    form.set("message", message);
    for (const file of files) form.append("screenshots", file, file.name);
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ message, ...identityBody(identity) });
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body,
    },
    files.length > 0 ? UPLOAD_TIMEOUT_MS : undefined,
  );
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    issueId?: string;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.issueId) {
    throw new Error(data.error ?? `report failed: ${res.status}`);
  }
  return { issueId: data.issueId };
};

export const fetchMyReports = async (identity: {
  initData?: string;
  userId?: string;
}): Promise<MyReport[]> => {
  const params = devIdentityParams(identity);
  const res = await fetchWithTimeout(withQuery("/api/myreports", params), {
    headers: authHeaders(identity.initData),
  });
  if (!res.ok) throw new Error(`myreports failed: ${res.status}`);
  const data = (await res.json()) as { reports: MyReport[] };
  return data.reports ?? [];
};

export interface ReportAttachment {
  /** Same-origin URL of the stored screenshot. */
  url: string;
  mimeType: string;
  byteSize: number;
}

export interface ThreadMessage {
  id: number;
  author: "user" | "admin";
  body: string;
  createdAt: string;
  /** Screenshots sent with this message; empty for admin replies. */
  attachments: ReportAttachment[];
}

export interface ReportThread {
  issueId: string;
  status: "open" | "answered" | "resolved";
  createdAt: string;
  messageCount: number;
  messages: ThreadMessage[];
}

/**
 * Warm conversations. A thread fetched once renders instantly the next time
 * it is opened, instead of waiting on the network again.
 */
const threadCache = new Map<string, ReportThread>();

/** Synchronous cache read for optimistic rendering before the fetch lands. */
export const peekThread = (issueId: string): ReportThread | undefined =>
  threadCache.get(issueId);

/** Put a thread (or an optimistic sketch of one) into the warm cache. */
export const cacheThread = (thread: ReportThread): void => {
  threadCache.set(thread.issueId, thread);
};

/** One conversation, oldest message first. Opening it marks it read. */
export const fetchThread = async (
  identity: { initData?: string; userId?: string },
  issueId: string,
  signal?: AbortSignal,
): Promise<ReportThread> => {
  const params = devIdentityParams(identity);
  const res = await fetchWithTimeout(
    withQuery(`/api/thread/${encodeURIComponent(issueId)}`, params),
    { headers: authHeaders(identity.initData), signal },
  );
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    thread?: ReportThread;
    error?: string;
  };
  if (!res.ok || !data.ok || !data.thread) {
    throw new Error(data.error ?? `thread failed: ${res.status}`);
  }
  cacheThread(data.thread);
  return data.thread;
};

/** The reporter's side of the conversation. Text, screenshots, or both. */
export const sendThreadMessage = async (
  identity: { initData?: string; userId?: string },
  issueId: string,
  message: string,
  files: File[] = [],
): Promise<void> => {
  const url = withQuery(
    `/api/thread/${encodeURIComponent(issueId)}`,
    devIdentityParams(identity),
  );
  const headers: Record<string, string> = {
    ...authHeaders(identity.initData),
  };
  let body: BodyInit;
  if (files.length > 0) {
    const form = new FormData();
    form.set("message", message);
    for (const file of files) form.append("screenshots", file, file.name);
    body = form;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ message, ...identityBody(identity) });
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers,
      body,
    },
    files.length > 0 ? UPLOAD_TIMEOUT_MS : undefined,
  );
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `send failed: ${res.status}`);
  }
};
