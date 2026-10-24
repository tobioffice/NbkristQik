import { ADMIN_ID } from "../../config/environmentals.js";

/**
 * Who may open the library.
 *
 * The library ships before the material does. Until it is filled, only the
 * admin can open it, so a half-empty shelf is never shown to students. The
 * bot keeps the command and the menu button to the admin's chat, and the API
 * refuses every other Telegram account even if one reaches the URL.
 *
 * `LIBRARY_ACCESS=all` opens it to every registered student. The flag is
 * read per request, so opening it is an env change and a restart.
 */
export const libraryOpenToAll = (): boolean =>
  (process.env.LIBRARY_ACCESS ?? "admin").trim().toLowerCase() === "all";

/** True for the admin, and for anyone once the library is opened. */
export const canOpenLibrary = (userId: string | number): boolean =>
  libraryOpenToAll() || String(userId) === String(ADMIN_ID);

/**
 * The admin's preview.
 *
 * While the library is closed, the admin sees every live document, not only
 * the subjects of their own year-sem. This is how the shelf gets reviewed
 * before students can open the door.
 */
export const canPreviewEverything = (userId: string | number): boolean =>
  !libraryOpenToAll() && String(userId) === String(ADMIN_ID);
