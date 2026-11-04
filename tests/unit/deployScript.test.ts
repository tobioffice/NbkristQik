import { describe, expect, it } from "vitest";
import { readFileSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scriptPath = path.join(repoRoot, "scripts/deploy.sh");
const script = readFileSync(scriptPath, "utf8");

/**
 * The deploy script is not executed in tests (it needs ssh/systemd), so these
 * are the few invariants a regression once broke: the backup must receive its
 * destination, and a failed sync must not touch the live build.
 */
describe("scripts/deploy.sh safety invariants", () => {
  it("is executable", () => {
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
  });

  it("passes the database destination to the remote backup program", () => {
    expect(script).toContain("backup_dest=");
    expect(script).toContain("DEST=");
    expect(script).toContain("no DEST in the environment");
  });

  it("stages the build before swapping the live dist", () => {
    expect(script).toContain("$DIR/dist.new");
    expect(script).toContain("mv '$DIR/dist.new' '$DIR/dist'");
    // the old live-directory rsync is exactly what made a failed sync visible
    expect(script).not.toContain('rsync -az --delete dist/ "$HOST:$DIR/dist/"');
  });

  it("keeps a rollback copy and smoke-checks the status surfaces", () => {
    expect(script).toContain("dist.old");
    expect(script).toContain("dist.prev");
    expect(script).toContain("/status");
    expect(script).toContain("/library/");
    expect(script).toContain("rollback");
  });

  it("ships the backup, restore and import scripts to the host", () => {
    expect(script).toContain("scripts/backup-db.sh");
    expect(script).toContain("scripts/restore-db.sh");
    expect(script).toContain("scripts/import-turso-snapshot.mjs");
  });
});
