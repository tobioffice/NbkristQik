import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { builtinModules } from "module";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Runtime imports must be production dependencies.
 *
 * The 20 November deploy resolved the lockfile after moving `pdf-lib` to
 * devDependencies, and `pnpm install --prod` then pruned `axios`,
 * `express-rate-limit` and `nodemailer`. All three are imported at startup,
 * so the service crash-looped and the rollback restored a build that needed
 * the same missing packages.
 *
 * `src/web` is excluded because it has its own package.json. Type-only
 * imports are ignored: they are erased by the compiler. Node builtins are
 * ignored too.
 */

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sourceRoot = path.join(repositoryRoot, "src");
const webRoot = path.join(sourceRoot, "web");

const sourceFiles: string[] = [];
const walk = (directory: string): void => {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue;
    const full = path.join(directory, entry);
    if (full === webRoot) continue;
    if (statSync(full).isDirectory()) walk(full);
    else if (full.endsWith(".ts")) sourceFiles.push(full);
  }
};
walk(sourceRoot);

const packageJson = JSON.parse(
  readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as { dependencies?: Record<string, string> };
const dependencies = new Set(Object.keys(packageJson.dependencies ?? {}));
const builtins = new Set(builtinModules);

const isExternal = (specifier: string): boolean => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return false;
  if (specifier.startsWith("node:") || specifier.startsWith("#")) return false;
  return !builtins.has(specifier.split("/")[0]);
};

const packageOf = (specifier: string): string =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

describe("production dependency declarations", () => {
  it("lists every runtime import in dependencies", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles) {
      const text = readFileSync(file, "utf8");
      const relative = path.relative(repositoryRoot, file);
      const lineAt = (index: number): number =>
        text.slice(0, index).split("\n").length;

      const add = (specifier: string, index: number): void => {
        if (!isExternal(specifier)) return;
        const name = packageOf(specifier);
        if (!dependencies.has(name)) {
          offenders.push(`${relative}:${lineAt(index)} imports ${name}`);
        }
      };

      // `import ... from "pkg"` and `export ... from "pkg"`, skipping the
      // type-only forms. `[^;]*?` keeps the match inside one statement for
      // this codebase's semicolon style.
      for (const match of text.matchAll(
        /^\s*(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s+["']([^"']+)["']/gm,
      )) {
        if (!match[1]) add(match[2], match.index ?? 0);
      }

      // Side-effect import: `import "pkg";`
      for (const match of text.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
        add(match[1], match.index ?? 0);
      }

      // Dynamic import: `await import("pkg")`
      for (const match of text.matchAll(
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
      )) {
        add(match[1], match.index ?? 0);
      }
    }

    expect(offenders).toEqual([]);
  });
});
