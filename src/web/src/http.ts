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

/** How long any API request may take before it is abandoned. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** An upload moves real bytes: three screenshots need longer than a JSON read. */
export const UPLOAD_TIMEOUT_MS = 60_000;

/**
 * The one fetch the app uses.
 *
 * A phone on a weak line can sit on a request for minutes; the screen then
 * waits on a spinner that will never resolve. Every call gets the same 15s
 * ceiling (uploads ask for the longer one), and an abort from the caller (a
 * superseded issue thread, for example) still passes through untouched.
 */
export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> => {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const external = init.signal;
  const forwardAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    // a caller's own abort is not a timeout: let the caller classify it
    if (timedOut && !external?.aborted) {
      throw new RequestError("The request took too long. Try again.", 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", forwardAbort);
  }
};

/** Reads a response as JSON, throwing the server's error when it failed. */
export const readJson = async <T>(res: Response): Promise<T> => {
  const body = (await res.json().catch(() => ({}))) as T & ErrorBody;
  if (!res.ok) {
    throw new RequestError(
      body.error ?? "The request failed. Try again.",
      res.status,
      body.suggestions,
    );
  }
  return body;
};
