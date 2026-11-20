#!/usr/bin/env node
/**
 * Checks the production install before a deploy touches the server.
 *
 * The Vitest suite runs with devDependencies, so it cannot notice a package
 * that is imported at runtime but missing from the `--prod` tree. That is
 * exactly how the 20 November deploy crashed the service: `axios`,
 * `express-rate-limit` and `nodemailer` were devDependencies, and
 * `pnpm install --prod` removed them.
 *
 * This script copies the manifest, lockfile, `dist/` and the native stamp to
 * a throwaway directory, installs exactly what the server will install, then
 * resolves every bare import in the compiled output and runs the stamp.
 *
 * Run it after `pnpm build` and `scripts/build-pdfstamp.sh`.
 */
import { execFileSync } from "child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "fs";
import { builtinModules, createRequire } from "module";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "nbq-prod-check-"));
const errors = [];

const builtins = new Set(builtinModules);
const isExternal = (specifier) => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("node:") || specifier.startsWith("#")) return false;
  return !builtins.has(specifier.split("/")[0]);
};

const packageOf = (specifier) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

/** The imports a compiled module can ask Node to resolve. */
const specifiersIn = (source) => {
  const found = new Set();
  const patterns = [
    /^\s*(?:import|export)\s+(?:type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']/gm,
    /^\s*import\s+["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return found;
};

try {
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
    const source = path.join(repoRoot, file);
    if (!existsSync(source)) {
      errors.push(`missing ${file}`);
      continue;
    }
    cpSync(source, path.join(tempRoot, file));
  }

  const dist = path.join(repoRoot, "dist");
  if (!existsSync(dist)) {
    errors.push("dist/ is missing: run pnpm build first");
  } else {
    cpSync(dist, path.join(tempRoot, "dist"), { recursive: true });
  }

  const bin = path.join(repoRoot, "bin");
  if (!existsSync(path.join(bin, "pdfstamp"))) {
    errors.push("bin/pdfstamp is missing: run scripts/build-pdfstamp.sh first");
  } else {
    mkdirSync(path.join(tempRoot, "bin"), { recursive: true });
    cpSync(path.join(bin, "pdfstamp"), path.join(tempRoot, "bin", "pdfstamp"));
  }

  if (errors.length === 0) {
    console.log("==> installing the production dependencies");
    execFileSync("pnpm", ["install", "--prod", "--frozen-lockfile"], {
      cwd: tempRoot,
      stdio: "inherit",
    });

    const requireFrom = createRequire(path.join(tempRoot, "package.json"));
    const compiled = [];
    const walk = (directory) => {
      for (const entry of readdirSync(directory)) {
        const full = path.join(directory, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".js")) compiled.push(full);
      }
    };
    walk(path.join(tempRoot, "dist"));

    for (const file of compiled) {
      const relative = path.relative(tempRoot, file);
      for (const specifier of specifiersIn(readFileSync(file, "utf8"))) {
        if (!isExternal(specifier)) continue;
        try {
          requireFrom.resolve(specifier);
        } catch {
          errors.push(`${relative}: cannot resolve ${packageOf(specifier)}`);
        }
      }
    }

    try {
      execFileSync(path.join(tempRoot, "bin", "pdfstamp"), ["--version"], {
        stdio: "pipe",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`bin/pdfstamp does not run: ${message}`);
    }

    if (errors.length === 0) {
      console.log(
        `ok: ${compiled.length} compiled files, every import resolves, pdfstamp runs`,
      );
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  errors.push(message);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (errors.length > 0) {
  console.error("\nProduction install check failed:");
  for (const error of [...new Set(errors)]) console.error(`  - ${error}`);
  console.error(
    "\nA package imported by dist/ is missing from the --prod install.",
  );
  console.error("Move it to dependencies, or fix the manifest and lockfile.\n");
  process.exitCode = 1;
}
