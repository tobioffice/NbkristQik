/**
 * Text helpers shared by every reply and every stamped page.
 *
 * Telegram parses replies as HTML and the library stamps SVG, so both need the
 * same escape before any user-controlled text (a name, a subject, a title)
 * goes into markup. One function, so a new reply cannot invent a fourth
 * spelling of it.
 */

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes a string for HTML or XML text content. */
export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ENTITIES[char]);
