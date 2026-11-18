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

  it("uses the Telegram-native Figtree stack", () => {
    expect(html).toContain(
      '--font: "Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;',
    );
    expect(html).not.toContain("Zilla Slab");
    expect(html).not.toContain("Public Sans");
  });

  it("uses the Telegram-native palette and grouped rows", () => {
    for (const token of [
      "--ground: #1a2026",
      "--footer: #111417",
      "--surface: #212a33",
      "--surface-hover: #293440",
      "--surface-active: #2d3a47",
      "--accent: #4cb2ff",
      "--action: #248bda",
      "--danger: #f88277",
    ]) {
      expect(html).toContain(token);
    }
    expect(html).toContain("--radius: 8px");
    expect(html).toContain("max-width: 720px");
    expect(html).toContain("border-spacing: 0 1px");
    expect(html).toContain(
      "a { color: var(--accent); text-decoration: none; }",
    );
    expect(html).not.toContain("box-shadow");
    expect(html).not.toContain("text-transform: uppercase");
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

  it("makes the values live, tabular, right-aligned and described by a table caption", () => {
    expect(
      html.match(/aria-live="polite"/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(6);
    expect(html).toContain("font-variant-numeric: tabular-nums");
    expect(html).toContain("text-align: right");
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
