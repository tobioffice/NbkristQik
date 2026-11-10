import { fetchWithTimeout, readJson } from "./http";

// Centralized API origin. Dev builds default to same-origin so the vite
// proxy forwards /api to the local backend; prod builds need the real origin.
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "" : "https://checker.tobioffice.dev");

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

/** The dev fallback is a bare userId, and only when initData is absent. */
const devIdentityParams = (identity: ApiIdentity): URLSearchParams => {
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
  roll_no: string;
  name: string | null;
  attendance_percentage: number;
  mid_marks_avg: number | null;
  rank: number;
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

export type ProfileResponse =
  | { found: true; registration: Registration; student: StudentInfo }
  // registered roll vanished from the college master table (semester sync)
  | { found: true; stale: true; registration: Registration; student: null }
  // `lastLookup` is a suggestion for the empty form, not the caller's roll
  | {
      found: false;
      lastLookup: string | null;
      suggestion: string | null;
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
): Promise<{ issueId: string }> => {
  const body = { message, ...identityBody(identity) };

  const res = await fetchWithTimeout(`${API_BASE}/api/report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(identity.initData),
    },
    body: JSON.stringify(body),
  });
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

export interface ThreadMessage {
  id: number;
  author: "user" | "admin";
  body: string;
  createdAt: string;
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

/** The reporter's side of the conversation. */
export const sendThreadMessage = async (
  identity: { initData?: string; userId?: string },
  issueId: string,
  message: string,
): Promise<void> => {
  const body = { message, ...identityBody(identity) };

  const res = await fetchWithTimeout(
    `${API_BASE}/api/thread/${encodeURIComponent(issueId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(identity.initData),
      },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `send failed: ${res.status}`);
  }
};
