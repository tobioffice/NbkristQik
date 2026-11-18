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
  it("does not block rendering on external assets", () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/@import/);
  });

  it("uses the Telegram-native Figtree stack", () => {
    expect(html).toContain(
      '--font: "Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;',
    );
    expect(html).not.toContain("Zilla Slab");
    expect(html).not.toContain("Public Sans");
  });

  it("uses the Telegram-native palette", () => {
    for (const token of [
      "--ground: #1a2026",
      "--footer: #111417",
      "--surface: #212a33",
      "--surface-hover: #293440",
      "--surface-active: #2d3a47",
      "--accent: #4cb2ff",
      "--action: #248bda",
      "--good: #7ed176",
      "--warning: #ff9953",
      "--danger: #f88277",
    ]) {
      expect(html).toContain(token);
    }
    expect(html).toContain("--radius: 8px");
    expect(html).toContain("max-width: 720px");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain("env(safe-area-inset-top)");
    expect(html).toContain("env(safe-area-inset-bottom)");
    expect(html).toContain("gap: 1px");
    expect(html).not.toContain("box-shadow");
    expect(html).not.toContain("text-transform: uppercase");
  });

  it("renders the day bars with the status tokens", () => {
    expect(html).toContain(
      ".bar { flex: 1; min-width: 1px; background: var(--surface-active); position: relative; }",
    );
    expect(html).toContain(".bar.up { background: var(--good); }");
    expect(html).toContain(".bar.degraded { background: var(--warning); }");
    expect(html).toContain(".bar.down { background: var(--danger); }");
    expect(html).toContain(
      'const stateColor = isUp ? "#7ed176" : c.stale ? "#ff9953" : "#f88277";',
    );
    expect(html).toContain(
      'const statusWord = c.stale ? "No data" : isUp ? "Operational" : "Down";',
    );
  });

  it("does not fall back to the retired paper register", () => {
    for (const retired of [
      "#e7dcc3",
      "#efe5cd",
      "#f6efdd",
      "#3f6457",
      "#33544a",
      "#a62f22",
      "#8a6a12",
    ]) {
      expect(html).not.toContain(retired);
    }
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
    expect(html).toContain("anyFreshDown");
    expect(html).toContain('fetch("/api/status")');
  });

  it("labels the synthetic lookup component as Answers", () => {
    expect(html).toContain('COMPONENT_LABELS = { lookup: "Answers" }');
    expect(html).toContain("COMPONENT_LABELS[c.component]");
  });
});
