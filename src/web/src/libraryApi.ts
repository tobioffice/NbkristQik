import { authHeaders } from "./api";
import { fetchWithTimeout, readJson } from "./http";

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
  kind?: "telegram" | "pc";
  registered: boolean;
  student: LibraryStudent | null;
  error?: string;
}

/** The two ways a browser can prove it may read the shelf. */
export interface LibraryIdentity {
  initData?: string;
  pcToken?: string;
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

/**
 * Who the session cookie already belongs to.
 *
 * A live cookie needs no Redis exchange, so every tab visit starts here. A
 * 401 is the ordinary "no session yet" answer, not a failure.
 */
export const fetchLibraryMe = async (): Promise<SessionResponse | null> => {
  const res = await fetchWithTimeout("/api/library/me");
  if (res.status === 401) return null;
  return readJson<SessionResponse>(res);
};

/**
 * Swaps Telegram's signed initData, or a one-time computer link token, for
 * the session cookie. Only the credential we were given travels.
 */
export const openLibrarySession = async (
  identity: LibraryIdentity,
): Promise<SessionResponse> => {
  // A computer link names its account, so it is presented instead of the
  // Telegram blob; the server deliberately does not fall back from a bad link.
  const credential = identity.pcToken
    ? { pcToken: identity.pcToken }
    : identity.initData
      ? { initData: identity.initData }
      : null;
  if (!credential) {
    throw new Error("No library identity to exchange");
  }

  return readJson<SessionResponse>(
    await fetchWithTimeout("/api/library/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credential),
    }),
  );
};

/** Ends the browser session, including a PC session on a shared machine. */
export const closeLibrarySession = async (): Promise<void> => {
  await fetchWithTimeout("/api/library/session", { method: "DELETE" });
};

export interface DownloadLink {
  ok: boolean;
  /** Short-lived URL that proves this reader may have this document. */
  url: string;
  fileName: string;
  error?: string;
}

/** The endpoint that mints one download link for a document. */
export const documentDownloadPath = (id: string): string =>
  `/api/library/document/${encodeURIComponent(id)}/download`;

/**
 * A download link the Telegram client can fetch on its own.
 *
 * The client's downloader has no cookie jar, so the API mints a URL carrying
 * its own short-lived proof instead of relying on the session cookie.
 */
export const requestDocumentDownload = async (
  id: string,
): Promise<DownloadLink> =>
  readJson<DownloadLink>(
    await fetchWithTimeout(documentDownloadPath(id), { method: "POST" }),
  );

/**
 * The shelf. `all` is the admin's whole-shelf preview; `roll` is exactly what
 * the registered roll would see. Everyone else always gets `roll`.
 */
export const fetchLibrarySubjects = async (
  view: "all" | "roll" = "all",
): Promise<SubjectsResponse> =>
  readJson<SubjectsResponse>(
    await fetchWithTimeout(`/api/library/subjects?view=${view}`),
  );

/** Saves a roll number, the same way the registration page does. */
export const registerLibraryRoll = async (
  initData: string,
  rollNo: string,
): Promise<RegisterResponse> =>
  readJson<RegisterResponse>(
    await fetchWithTimeout("/api/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(initData),
      },
      body: JSON.stringify({ initData, rollNo }),
    }),
  );
