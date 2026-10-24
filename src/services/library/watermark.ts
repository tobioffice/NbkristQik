import crypto from "crypto";
import { readFile } from "fs/promises";
import { LIBRARY_WATERMARK_SECRET } from "../../config/environmentals.js";
import { escapeHtml } from "../text.js";

/**
 * The watermark.
 *
 * Every page a student reads carries a mark that ties it to one Telegram
 * account. It is drawn into the page before it is sent, so a screenshot,
 * a photo of the screen or a copy pulled out of the network all point at one
 * person.
 *
 * The mark is a token, not the identity: "NBK-7F3A-2C19" says nothing to the
 * student about what is being tracked, and the token is what we resolve
 * server side when a page turns up somewhere it should not. The reader's
 * Telegram id and roll number never appear on the page.
 *
 * The mark is faint on purpose: a student should barely notice it while
 * reading, and a machine should still find it in a photograph.
 */

const INK = "30, 42, 56";

/** How faint the diagonal repeat is: a deterrent, not the identifier. */
const REPEAT_OPACITY = 0.05;
/**
 * The footer line carries the token, and it has to survive a screenshot:
 * at this opacity a machine still reads it out of the pixels, while a person
 * reading the page barely notices it.
 */
const FOOTER_OPACITY = 0.42;

export interface WatermarkIdentity {
  /** The opaque per-reader token printed on the page */
  token: string;
  /** What the page is, for a shared screenshot: "DBMS · Unit I · p7" */
  label?: string;
}

/**
 * The token for one reader.
 *
 * Derived from the Telegram user id and a server secret, so it is stable for
 * that reader, different for every reader, and not reversible by anyone who
 * only has the page. The admin resolves it with
 * `node dist/tools/resolveWatermark.js <token>`.
 */
export const watermarkToken = (userId: string): string => {
  const digest = crypto
    .createHmac("sha256", LIBRARY_WATERMARK_SECRET)
    .update(`nbk-library:${userId}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return `NBK-${digest.slice(0, 4)}-${digest.slice(4, 8)}`;
};

/**
 * The overlay: the token set diagonally down the page, and a footer line.
 *
 * The page SVG is measured in points (A4 is about 595 × 842), and the
 * ratios below keep the mark the same weight on the page as it had when
 * pages were 140 dpi rasters.
 */
const buildOverlay = (
  width: number,
  height: number,
  identity: WatermarkIdentity,
): string => {
  const fontSize = Math.max(8, Math.round(width / 36));
  const step = Math.round(height / 3.2);
  const angle = -28;

  const rows: string[] = [];
  for (let i = 0; i < 3; i++) {
    const y = step * (i + 0.8);
    rows.push(
      `<text x="${Math.round(-height * 0.12)}" y="${y}" ` +
        `transform="rotate(${angle})" ` +
        `font-family="Public Sans, Helvetica, Arial, sans-serif" ` +
        `font-size="${fontSize}" font-weight="700" ` +
        `fill="rgba(${INK}, ${REPEAT_OPACITY})">${escapeHtml(identity.token)}</text>`,
    );
  }

  const footer = identity.label
    ? `${escapeHtml(identity.token)} · ${escapeHtml(identity.label)}`
    : escapeHtml(identity.token);

  return `<text x="${Math.round(width * 0.03)}" y="${height - Math.round(height * 0.02)}"
        font-family="Public Sans, Helvetica, Arial, sans-serif"
        font-size="${Math.max(7, Math.round(width / 52))}" font-weight="700"
        fill="rgba(${INK}, ${FOOTER_OPACITY})">${footer}</text>
  ${rows.join("\n  ")}`;
};

/**
 * Stamps one page. Returns the SVG to send.
 *
 * The base page is read from disk and stamped fresh per reader, so one
 * vector page serves every student and no clean copy ever leaves the box.
 */
export const stampPage = async (
  pagePath: string,
  identity: WatermarkIdentity,
): Promise<string> => {
  let page: string;
  try {
    page = await readFile(pagePath, "utf8");
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") {
      throw new Error("no such page");
    }
    throw e;
  }

  // the root svg carries the page size in points
  const width = Number(/<svg[^>]*\bwidth="([\d.]+)pt"/.exec(page)?.[1]) || 595;
  const height =
    Number(/<svg[^>]*\bheight="([\d.]+)pt"/.exec(page)?.[1]) || 842;

  const close = page.lastIndexOf("</svg>");
  if (close < 0) {
    // a page that cannot be stamped must not be served unstamped
    throw new Error("page is not an svg");
  }

  return `${page.slice(0, close)}${buildOverlay(width, height, identity)}${page.slice(close)}`;
};
