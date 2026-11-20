import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

/**
 * The native stamp binary.
 *
 * `native/pdfstamp` draws the watermark; this module is the only place the
 * service talks to it. The binary is built by `scripts/build-pdfstamp.sh`
 * into `bin/pdfstamp` at the repository root, so both `src/` under tsx and
 * `dist/` under node resolve the same path. `PDFSTAMP_BIN` overrides it for
 * tests and for a packager that puts it somewhere else.
 *
 * The hand-off is files, not pipes: the source path goes in, a temporary
 * output path comes back, and Node renames it into the cache. A crash or a
 * timeout therefore leaves a temp file to sweep, never a half-written cache
 * entry, and the whole PDF never enters the Node heap.
 */

const execFileAsync = promisify(execFile);

/** A missing binary is a deploy problem, not a bad document. */
export class PdfStampUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfStampUnavailableError";
  }
}

/** The source could not be read: corrupt, encrypted, or not a PDF. */
export class PdfStampSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfStampSourceError";
  }
}

/** Anything else the binary reported. */
export class PdfStampFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfStampFailedError";
  }
}

/** Repository root from `src/services/library/` or `dist/services/library/`. */
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Absolute path of the binary this process will run. */
export const pdfStampBinary = (): string => {
  const configured = process.env.PDFSTAMP_BIN?.trim();
  return configured
    ? path.resolve(configured)
    : path.join(repositoryRoot, "bin", "pdfstamp");
};

export interface StampPdfInput {
  /** Absolute path of the source PDF. */
  source: string;
  /** Absolute path to write the stamped PDF to. */
  output: string;
  /** The opaque per-reader token printed on every page. */
  token: string;
  /** The subject code, printed in the footer. */
  code: string;
  /** The unit, printed in the footer when present. */
  unit?: string | null;
}

/** `pdfstamp: unreadable: …` on stderr becomes `…`. */
const detailFrom = (stderr: string): string => {
  const trimmed = stderr.trim();
  if (!trimmed) return "";
  return trimmed
    .replace(/^pdfstamp:\s*/, "")
    .replace(/^unreadable:\s*/, "")
    .replace(/\s+/g, " ");
};

interface ExecFailure {
  code?: number | string;
  killed?: boolean;
  signal?: string;
  stderr?: string | Buffer;
  message: string;
}

/**
 * Runs the stamp. Throws a typed error so the caller can keep its existing
 * 500/413/503 mapping without parsing stderr itself.
 */
export const stampPdfFile = async (input: StampPdfInput): Promise<void> => {
  const args = [
    "--in",
    input.source,
    "--out",
    input.output,
    "--token",
    input.token,
    "--code",
    input.code,
  ];
  if (input.unit) args.push("--unit", input.unit);

  try {
    await execFileAsync(pdfStampBinary(), args, {
      // A stamp is milliseconds for a normal document and seconds for a
      // pathological one. A minute is far past any real work and still
      // releases the queue instead of holding a request forever.
      timeout: 60_000,
      maxBuffer: 256 * 1024,
      encoding: "utf8",
    });
  } catch (error) {
    const failure = error as ExecFailure;
    const stderr = failure.stderr?.toString() ?? "";

    if (failure.code === "ENOENT") {
      throw new PdfStampUnavailableError(
        `the pdfstamp binary is not built: run scripts/build-pdfstamp.sh (looked for ${pdfStampBinary()})`,
      );
    }
    if (failure.killed) {
      throw new PdfStampFailedError("the PDF stamp took too long");
    }

    const detail = detailFrom(stderr);
    if (failure.code === 3) {
      throw new PdfStampSourceError(detail || "the PDF could not be read");
    }
    throw new PdfStampFailedError(
      detail || failure.message.replace(/^Command failed:\s*/, ""),
    );
  }
};
