// The library talks to the API on its own origin: the mini app is served by
// the same host as /api, so the session cookie is first-party and rides
// along without any CORS dance.

export interface LibraryStudent {
  rollNo: string;
  name: string | null;
  yearSem: string;
  branch: string;
  dept: string | null;
  regulation: string;
}

export interface LibraryUnit {
  id: string;
  unit: string | null;
  pages: number;
}

export interface LibrarySubject {
  code: string;
  name: string;
  /** True when we hold at least one unit of this subject */
  live: boolean;
  units: LibraryUnit[];
}

export interface SessionResponse {
  ok: boolean;
  registered: boolean;
  student: LibraryStudent | null;
  error?: string;
}

export interface SubjectsResponse {
  ok: boolean;
  registered?: boolean;
  student?: LibraryStudent;
  subjects: LibrarySubject[];
  /** True for the admin: the whole-shelf view can be switched */
  admin?: boolean;
  /** True when the list is the whole shelf, not the roll's semester */
  preview?: boolean;
  error?: string;
}

export interface RegisterResponse {
  ok?: boolean;
  error?: string;
  suggestions?: string[];
  registered?: { roll_no: string; name: string | null };
}

const readBody = async <T,>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: string;
    suggestions?: string[];
  };
  if (!res.ok) {
    const err = new Error(body.error ?? `request failed: ${res.status}`);
    (err as Error & { suggestions?: string[] }).suggestions = body.suggestions;
    throw err;
  }
  return body;
};

/** Swaps Telegram's signed initData for the session cookie. */
export const openLibrarySession = async (
  initData: string,
): Promise<SessionResponse> =>
  readBody<SessionResponse>(
    await fetch("/api/library/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    }),
  );

/**
 * The shelf. `all` is the admin's whole-shelf preview; `roll` is exactly what
 * the registered roll would see. Everyone else always gets `roll`.
 */
export const fetchLibrarySubjects = async (
  view: "all" | "roll" = "all",
): Promise<SubjectsResponse> =>
  readBody<SubjectsResponse>(
    await fetch(`/api/library/subjects?view=${view}`),
  );

/** Saves a roll number, the same way the registration page does. */
export const registerLibraryRoll = async (
  initData: string,
  rollNo: string,
): Promise<RegisterResponse> =>
  readBody<RegisterResponse>(
    await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData, rollNo }),
    }),
  );
