import {
  API_BASE,
  authHeaders,
  devIdentityParams,
  type ApiIdentity,
} from "./api";
import { fetchWithTimeout, readJson, UPLOAD_TIMEOUT_MS } from "./http";

/**
 * The question-paper intake.
 *
 * This is a collection endpoint, not a public bank: students submit photos
 * with a subject and exam, and the processing team reads them in the private
 * admin list. The browser never receives an image URL back.
 */

/** Kept in step with `src/services/paperFiles.ts`. */
export const MAX_PAPER_PAGES = 5;
export const MAX_PAPER_FILE_BYTES = 5 * 1024 * 1024;

export interface NewPaperFields {
  subject: string;
  exam: string;
  note: string;
}

export interface PaperReceipt {
  id: number;
  pageCount: number;
}

interface PaperResponse {
  ok: boolean;
  id: number;
  pageCount: number;
}

const withQuery = (path: string, params: URLSearchParams): string => {
  const query = params.toString();
  return query ? `${API_BASE}${path}?${query}` : `${API_BASE}${path}`;
};

/** One paper, up to five photos. The server checks every byte and strips EXIF. */
export const uploadPaper = async (
  identity: ApiIdentity,
  fields: NewPaperFields,
  files: File[],
): Promise<PaperReceipt> => {
  const form = new FormData();
  form.set("subject", fields.subject);
  form.set("exam", fields.exam);
  if (fields.note.trim()) form.set("note", fields.note.trim());
  for (const file of files) form.append("images", file, file.name);

  const res = await fetchWithTimeout(
    withQuery("/api/papers", devIdentityParams(identity)),
    {
      method: "POST",
      headers: authHeaders(identity.initData),
      body: form,
    },
    UPLOAD_TIMEOUT_MS,
  );
  const data = await readJson<PaperResponse>(res);
  return { id: data.id, pageCount: data.pageCount };
};
