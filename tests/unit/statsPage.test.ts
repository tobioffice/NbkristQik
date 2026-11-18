import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Self-contained static checks for the public stats page. Like the status
// page, it is one HTML file with an inline script, so these assertions guard
// the contract that matters without a browser: no external assets, the six
// aggregate fields, accessible/live values, and the published links.
const html = readFileSync(
  fileURLToPath(new URL("../../src/status/stats.html", import.meta.url)),
  "utf8",
);

const metricIds = [
  "stat-registered-users",
  "stat-dau",
  "stat-wau",
  "stat-mau",
  "stat-commands-7d",
  "stat-uptime-90d",
];

describe("stats page", () => {
  it("does not load external fonts, styles or scripts", () => {
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/@import/);
  });

  it("keeps the local paper-register font stacks", () => {
    expect(html).toContain(
      '--font-display: "Zilla Slab", "Roboto Slab", Georgia, serif;',
    );
    expect(html).toContain('"Public Sans", system-ui');
  });

  it("loads all six aggregates from the stats API", () => {
    expect(html).toContain('fetch("/api/stats")');
    for (const field of [
      "registered_users",
      "dau",
      "wau",
      "mau",
      "commands_7d",
      "uptime_90d",
    ]) {
      expect(html).toContain(field);
    }
    expect(html).toContain("data.registered_users");
    expect(html).toContain("data.commands_7d");
    expect(html).toContain("data.uptime_90d");
  });

  it("publishes the privacy sentence", () => {
    expect(html).toContain(
      "Only aggregates are published. No usernames, user IDs or per-student rows leave the database.",
    );
  });

  it("makes the values live, tabular and described by a table caption", () => {
    expect(
      html.match(/aria-live="polite"/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(6);
    expect(html).toContain("font-variant-numeric: tabular-nums");
    expect(html).toContain('Intl.NumberFormat("en-IN")');
    expect(html).toContain("<caption>");
  });

  it("links the JSON, system status, history and method source", () => {
    expect(html).toContain('href="/api/stats"');
    expect(html).toContain('href="/status"');
    expect(html).toContain(
      "https://github.com/tobioffice/NbkristQik/blob/main/stats/history.csv",
    );
    expect(html).toContain(
      "https://github.com/tobioffice/NbkristQik/blob/main/src/api/publicStats.ts",
    );
  });

  it("shows em dashes instead of hardcoded user counts", () => {
    for (const id of metricIds) {
      const cell = html.match(
        new RegExp(`<td[^>]*id="${id}"[^>]*>([^<]*)</td>`),
      );
      expect(cell, `${id} should be a table value`).not.toBeNull();
      expect(cell?.[1].trim()).toBe("&mdash;");
    }
    expect(html).not.toMatch(/id="stat-registered-users"[^>]*>\s*\d/);
    expect(html).not.toMatch(/id="stat-dau"[^>]*>\s*\d/);
  });

  it("renders loading, error and noscript states with IST times", () => {
    expect(html).toContain("Loading figures...");
    expect(html).toContain('id="error"');
    expect(html).toContain("<noscript>");
    expect(html).toContain("Asia/Kolkata");
    expect(html).toContain("data.generated_at");
    expect(html).toContain("data.method");
    expect(html).toContain("Aggregates");
    expect(html).toContain("Live");
  });
});
