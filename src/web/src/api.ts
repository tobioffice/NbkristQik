// Centralized API origin. Dev builds default to same-origin so the vite
// proxy forwards /api to the local backend; prod builds need the real origin.
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "" : "https://checker.tobioffice.dev");

export type SortBy = "attendance" | "midmarks";

export interface StudentStat {
  roll_no: string;
  name: string | null;
  attendance_percentage: number;
  mid_marks_avg: number | null;
  rank: number;
}

export interface LeaderboardFilters {
  year: string;
  branch: string;
  section: string;
}

export interface MyRank {
  attendance: number | null;
  midmarks: number | null;
}

export const buildLeaderboardUrl = (
  page: number,
  sort: SortBy,
  filters: LeaderboardFilters,
  search: string,
): string => {
  const queryParams = new URLSearchParams({
    page: page.toString(),
    limit: "20",
    sort: sort,
    year: filters.year,
    branch: filters.branch,
    section: filters.section,
  });
  if (search) queryParams.set("search", search);
  return `${API_BASE}/api/leaderboard?${queryParams.toString()}`;
};

export const buildMeUrl = (userId: string, initData?: string): string => {
  const params = new URLSearchParams({ userId });
  if (initData) params.set("initData", initData);
  return `${API_BASE}/api/me?${params.toString()}`;
};

export const PAGE_SIZE = 20;

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
  | { found: false; suggestion: string | null }
  | { found: false; error: string };

export interface RegisterRequest {
  initData?: string;
  userId?: string;
  rollNo: string;
  displayName?: string;
}

export const ROLL_REGEX = /^\d{2}[a-zA-Z0-9]{2}[a-zA-Z0-9]{6}$/;

export const buildProfileUrl = (
  identity: { initData?: string; userId?: string },
): string => {
  const params = new URLSearchParams();
  if (identity.initData) params.set("initData", identity.initData);
  else if (identity.userId) params.set("userId", identity.userId);
  return `${API_BASE}/api/profile?${params.toString()}`;
};

export const getProfile = async (
  identity: { initData?: string; userId?: string },
): Promise<ProfileResponse> => {
  const res = await fetch(buildProfileUrl(identity));
  if (!res.ok) throw new Error(`profile request failed: ${res.status}`);
  return (await res.json()) as ProfileResponse;
};

export const registerRoll = async (req: RegisterRequest): Promise<void> => {
  const res = await fetch(`${API_BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    suggestions?: string[];
  };
  if (!res.ok) {
    const err = new Error(body.error ?? `register failed: ${res.status}`);
    (err as Error & { suggestions?: string[] }).suggestions = body.suggestions;
    throw err;
  }
};

// ---------- issue reports ----------

export interface MyReport {
  issueId: string;
  message: string;
  status: "open" | "answered" | "resolved";
  adminReply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

export const submitReport = async (
  identity: { initData?: string; userId?: string },
  message: string,
): Promise<{ issueId: string }> => {
  const body: Record<string, unknown> = { message };
  if (identity.initData) body.initData = identity.initData;
  else if (identity.userId) body.userId = identity.userId;

  const res = await fetch(`${API_BASE}/api/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; issueId?: string; error?: string };
  if (!res.ok || !data.ok || !data.issueId) {
    throw new Error(data.error ?? `report failed: ${res.status}`);
  }
  return { issueId: data.issueId };
};

export const fetchMyReports = async (
  identity: { initData?: string; userId?: string },
): Promise<MyReport[]> => {
  const params = new URLSearchParams();
  if (identity.initData) params.set("initData", identity.initData);
  else if (identity.userId) params.set("userId", identity.userId);
  const res = await fetch(`${API_BASE}/api/myreports?${params.toString()}`);
  if (!res.ok) throw new Error(`myreports failed: ${res.status}`);
  const data = (await res.json()) as { reports: MyReport[] };
  return data.reports ?? [];
};
