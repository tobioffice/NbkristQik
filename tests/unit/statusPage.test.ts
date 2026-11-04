import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Self-contained static checks for the single-file status page. The page is
// plain HTML + an inline script, so these assertions guard the things that
// are easy to regress without a browser: external font requests, the
// accessible name of every generated bar, and the day-detail interaction.
const html = readFileSync(
  fileURLToPath(new URL("../../src/status/index.html", import.meta.url)),
  "utf8",
);

describe("status page", () => {
  it("does not block rendering on external font requests", () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
  });

  it("keeps the local system font stacks", () => {
    expect(html).toContain(
      '--font-display: "Zilla Slab", "Roboto Slab", Georgia, serif;',
    );
    expect(html).toContain('"Public Sans", system-ui');
  });

  it("gives every generated bar a readable status label", () => {
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="${label}"');
    expect(html).toContain("dayWord(cls)");
    // The label must spell out the status, not rely on the bar colour.
    expect(html).toContain('"operational"');
    expect(html).toContain('"no data"');
  });

  it("offers keyboard and tap access to the day detail", () => {
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('addEventListener("click"');
    expect(html).toContain('addEventListener("keydown"');
    expect(html).toContain('"ArrowLeft"');
    expect(html).toContain('"ArrowRight"');
    expect(html).toContain("day-detail");
  });

  it("keeps the IST calendar and the stale/current distinction", () => {
    expect(html).toContain("Asia/Kolkata");
    expect(html).toContain("c.stale");
    expect(html).toContain('fetch("/api/status")');
  });
});
