import { execFile } from "child_process";
import { promisify } from "util";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import path from "path";
import { logger } from "../../config/logger.js";
import { pageFileName } from "./paths.js";

/**
 * Turns a PDF into page SVGs.
 *
 * The PDF never leaves the server, so this is the only place a page becomes
 * something a browser can show. Poppler's pdftocairo does the rendering: one
 * SVG per page, with every glyph drawn as a vector path. The page is the
 * PDF's own page — same layout, same breaks, same figures — and it stays
 * sharp at any zoom, with no font needed on the reader's phone.
 *
 * The watermark is drawn into the page later, as vector elements, with
 * plain string work: no raster compositing, no native image library, and
 * none of the memory those bring. That is the whole reason pages are SVG
 * rather than JPEG: on a 1 GB box, stamping raster pages with libvips was
 * what pushed the machine into swap and took the bot down with it.
 *
 * Poppler is a system package (apt install poppler-utils). The ingest tool
 * says so plainly when it is missing.
 */

const run = promisify(execFile);

export interface VectoriseResult {
  pages: number;
  bytes: number;
  dir: string;
}

/** Is poppler installed? */
export const hasVectoriser = async (): Promise<boolean> => {
  try {
    await run("pdftocairo", ["-v"]);
    return true;
  } catch {
    return false;
  }
};

/**
 * How many pages the PDF has. pdfinfo ships in the same poppler package,
 * and the page count bounds the render loop below.
 */
const countPdfPages = async (pdfPath: string): Promise<number> => {
  const { stdout } = await run("pdfinfo", [pdfPath], { maxBuffer: 1 << 20 });
  const line = stdout.split("\n").find((l) => l.startsWith("Pages:"));
  const pages = Number(line?.replace(/^Pages:\s*/, "")) || 0;
  if (!pages) throw new Error("the PDF reports no pages");
  return pages;
};

/**
 * Renders every page of a PDF into `outDir` as p001.svg, p002.svg, …
 *
 * poppler's SVG backend writes every page into one multi-page document
 * unless asked for a single page, so the loop runs pdftocairo once per
 * page. The pages are rendered into a scratch folder first and moved into
 * place only when the whole run succeeded, so a failed run never leaves
 * half a document behind for the reader to stumble into.
 */
export const vectorisePdf = async (
  pdfPath: string,
  outDir: string,
): Promise<VectoriseResult> => {
  if (!existsSync(pdfPath)) {
    throw new Error(`no such PDF: ${pdfPath}`);
  }

  const pages = await countPdfPages(pdfPath);

  const scratch = path.join(
    path.dirname(outDir),
    `.scratch-${path.basename(outDir)}`,
  );
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });

  try {
    for (let page = 1; page <= pages; page++) {
      await run("pdftocairo", [
        "-svg",
        "-f",
        String(page),
        "-l",
        String(page),
        pdfPath,
        path.join(scratch, pageFileName(page)),
      ]);
    }
  } catch (e) {
    rmSync(scratch, { recursive: true, force: true });
    const message = e instanceof Error ? e.message : String(e);
    if (/ENOENT/.test(message)) {
      throw new Error(
        "pdftocairo is not installed on this box. Install poppler-utils (sudo apt install -y poppler-utils) and run the ingest again.",
      );
    }
    throw e;
  }

  const rendered = readdirSync(scratch)
    .filter((f) => f.endsWith(".svg"))
    .sort((a, b) => {
      const na = Number(a.replace(/^\D+/, "")) || 0;
      const nb = Number(b.replace(/^\D+/, "")) || 0;
      return na - nb;
    });

  if (rendered.length === 0) {
    rmSync(scratch, { recursive: true, force: true });
    throw new Error("the PDF rendered no pages");
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  let bytes = 0;
  rendered.forEach((file, index) => {
    const from = path.join(scratch, file);
    const to = path.join(outDir, pageFileName(index + 1));
    renameSync(from, to);
    bytes += statSync(to).size;
  });

  rmSync(scratch, { recursive: true, force: true });
  logger.info(
    `[library] vectorised ${rendered.length} pages into ${outDir} (${Math.round(bytes / 1024)} KB)`,
  );

  return { pages: rendered.length, bytes, dir: outDir };
};
