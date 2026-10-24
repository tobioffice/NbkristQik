#!/usr/bin/env node
/**
 * Ingests a document into the library.
 *
 *   node dist/tools/ingestLibrary.js \
 *     --file ~/inbox/23CS31T2-u2.pdf \
 *     --code 23CS31T2 --unit II --dept CSE --year-sem 31 --kind material
 *
 * What it does, in order:
 *   1. checks the subject code against the catalogue snapshot, so a document
 *      can never land under a code the students will not see;
 *   2. copies the PDF into data/docs/ (the store of record);
 *   3. renders every page to data/pages/<id>/p001.svg … (poppler's
 *      pdftocairo), one vector page per PDF page;
 *   4. records the document in the registry.
 *
 * The PDF is never served. Students read the rendered pages.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from "fs";
import path from "path";
import { logger } from "../config/logger.js";
import { initDatabase } from "../db/init.js";
import { upsertLibraryDocument } from "../db/library.model.js";
import { getSubjectsFor } from "../services/library/catalog.js";
import { documentPagesDir, libraryDocsDir } from "../services/library/paths.js";
import { hasVectoriser, vectorisePdf } from "../services/library/vector.js";

interface Args {
  file?: string;
  code?: string;
  unit?: string;
  dept?: string;
  yearSem?: string;
  regulation?: string;
  kind: "material" | "assignment";
  title?: string;
}

const parseArgs = (argv: string[]): Args => {
  const args: Args = { kind: "material" };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const value = argv[i + 1];
    switch (key) {
      case "--file":
        args.file = value;
        i++;
        break;
      case "--code":
        args.code = value?.toUpperCase();
        i++;
        break;
      case "--unit":
        args.unit = value;
        i++;
        break;
      case "--dept":
        args.dept = value;
        i++;
        break;
      case "--year-sem":
        args.yearSem = value;
        i++;
        break;
      case "--regulation":
        args.regulation = value?.toUpperCase();
        i++;
        break;
      case "--kind":
        args.kind = value === "assignment" ? "assignment" : "material";
        i++;
        break;
      case "--title":
        args.title = value;
        i++;
        break;
      default:
        break;
    }
  }
  return args;
};

const fail: (message: string) => never = (message) => {
  logger.error(`[ingest] ${message}`);
  process.exit(1);
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.file || !args.code || !args.dept || !args.yearSem) {
    fail(
      "usage: --file <pdf> --code <code> --dept <dept> --year-sem <11..42> [--unit <I..V>] [--kind material|assignment]",
    );
  }
  if (!existsSync(args.file)) fail(`no such file: ${args.file}`);

  const regulation = args.regulation ?? "R23";

  // the code must be a subject the college lists for that year-sem
  const catalogSubjects = getSubjectsFor(args.dept!, regulation, args.yearSem!);
  const inCatalog = catalogSubjects.find((s) => s.code === args.code);
  if (!inCatalog) {
    fail(
      `${args.code} is not in the ${args.dept} ${regulation} year-sem ${args.yearSem} list. Check the code, or refresh the catalogue snapshot.`,
    );
  }

  const unit = args.unit ? args.unit.toUpperCase() : null;
  const id = unit ? `${args.code}-u${unit.toLowerCase()}` : args.code;
  const title = args.title ?? inCatalog.name;

  if (!(await hasVectoriser())) {
    fail(
      "pdftocairo is not installed on this box. Install poppler-utils (sudo apt install -y poppler-utils) and run the ingest again.",
    );
  }

  // the registry tables must exist before a row can be written
  await initDatabase();

  mkdirSync(libraryDocsDir(), { recursive: true });
  const sourcePath = path.join(libraryDocsDir(), `${id}.pdf`);
  copyFileSync(args.file, sourcePath);
  const bytes = statSync(sourcePath).size;

  // one vector page per PDF page: the reader shows the PDF's own pages
  const pages = await vectorisePdf(sourcePath, documentPagesDir(id));

  await upsertLibraryDocument({
    id,
    code: args.code!,
    title,
    dept: args.dept!,
    regulation,
    year_sem: args.yearSem!,
    unit,
    kind: args.kind,
    source_path: sourcePath,
    page_count: pages.pages,
    bytes,
    status: "live",
    version: 1,
  });

  logger.info(
    `[ingest] ${id} is live: ${pages.pages} pages, ${Math.round(bytes / 1024)} KB`,
  );
  logger.info(`[ingest] document id: ${id}`);
};

main().catch((e) => {
  logger.error("[ingest] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
