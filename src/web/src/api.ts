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
