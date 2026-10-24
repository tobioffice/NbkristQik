/**
 * The one way this app talks to its API.
 *
 * Every call wants the same two things: the body as JSON, and an error that
 * carries the server's own sentence (and, for a registration, its near-miss
 * suggestions) instead of `request failed: 500`.
 */

/** A failed request, with whatever the server wanted to say about it. */
export class RequestError extends Error {
  readonly status: number;
  /** Roll numbers close to the one that was typed, when the server offers any. */
  suggestions?: string[];

  constructor(message: string, status: number, suggestions?: string[]) {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.suggestions = suggestions;
  }
}

interface ErrorBody {
  error?: string;
  suggestions?: string[];
}

/** Reads a response as JSON, throwing the server's error when it failed. */
export const readJson = async <T>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) {
    throw new RequestError(
      body.error ?? `request failed: ${res.status}`,
      res.status,
      body.suggestions,
    );
  }
  return body;
};
