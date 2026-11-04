/**
 * Unsent words.
 *
 * A report or a reply is often written between two classes, with the phone
 * about to be locked. The draft lives in sessionStorage, not localStorage: it
 * belongs to this sitting, and it must not outlive the mini app the way a
 * saved roll does. Storage can be full or disabled, so every access is
 * best-effort — a draft is never worth breaking the form over.
 */

const PREFIX = "nbk:draft";

/** A report draft belongs to the user who wrote it and the view it is for. */
export const reportDraftKey = (
  userId: string | null | undefined,
  view = "form",
): string => `${PREFIX}:report:${userId ?? "anon"}:${view}`;

/** A reply draft belongs to the issue it will be posted to. */
export const threadDraftKey = (issueId: string): string =>
  `${PREFIX}:thread:${issueId.toUpperCase()}`;

const storage = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

export const readDraft = (key: string): string => {
  try {
    return storage()?.getItem(key) ?? "";
  } catch {
    return "";
  }
};

export const writeDraft = (key: string, value: string): void => {
  const store = storage();
  if (!store) return;
  try {
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {
    // a full or disabled storage must not surface on the form
  }
};

export const clearDraft = (key: string): void => {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
};
