import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

/**
 * Exercises the two standalone stats scripts: record-stats.mjs against a
 * loopback mock of the public stats endpoint, render-stats-chart.mjs against
 * throwaway CSV files. Neither script is imported, so this also checks the
 * CLI wiring the scheduled workflow depends on.
 */

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const recordScript = path.join(repoRoot, "scripts/record-stats.mjs");
const chartScript = path.join(repoRoot, "scripts/render-stats-chart.mjs");
const HEADER = "date,registered_users,dau,wau,mau,commands_7d";

const payload = {
  generated_at: "2026-11-18T23:30:00+05:30",
  registered_users: 3540,
  dau: 1200,
  wau: 3000,
  mau: 3490,
  commands_7d: 61000,
  uptime_90d: "99.97%",
  method: "sqlite",
};

/**
 * The mock listens in a worker thread: spawnSync blocks this thread, so an
 * in-process HTTP server could never answer the child. Each request reads the
 * latest body and status from the temp files the test writes first.
 */
const MOCK_SERVER = `
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { parentPort, workerData } from "node:worker_threads";

const server = createServer((_request, response) => {
  let status = 200;
  let body = "{}";
  try {
    status = Number(readFileSync(workerData.statusPath, "utf8"));
  } catch {}
  try {
    body = readFileSync(workerData.bodyPath, "utf8");
  } catch {}
  response.writeHead(status, { "content-type": "application/json" });
  response.end(body);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  parentPort?.postMessage({ port: address && address.port });
});
`;

let worker: Worker | undefined;
let statsUrl = "";
let dir = "";
let bodyPath = "";
let statusPath = "";

const writeMock = (body: unknown = payload, status = 200) => {
  writeFileSync(bodyPath, JSON.stringify(body), "utf8");
  writeFileSync(statusPath, String(status), "utf8");
};

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "qik-stats-"));
  bodyPath = path.join(dir, "response.json");
  statusPath = path.join(dir, "response.status");
  writeMock(payload);

  const serverPath = path.join(dir, "mock-server.mjs");
  writeFileSync(serverPath, MOCK_SERVER, "utf8");

  worker = new Worker(serverPath, {
    workerData: { bodyPath, statusPath },
  });
  const port = await new Promise<number>((resolve, reject) => {
    worker?.once("message", (message: { port: number }) =>
      resolve(message.port),
    );
    worker?.once("error", reject);
  });
  statsUrl = `http://127.0.0.1:${port}/api/stats`;
});

beforeEach(() => {
  writeMock();
});

afterAll(async () => {
  await worker?.terminate();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

const runRecord = (file: string) => {
  const result = spawnSync(
    process.execPath,
    [recordScript, "--url", statsUrl, "--file", file],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const runChart = (file: string, out: string) => {
  const result = spawnSync(
    process.execPath,
    [chartScript, "--file", file, "--out", out],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

const historyPath = (name = "history.csv") => path.join(dir, name);
const chartPath = (name = "history.svg") => path.join(dir, name);

describe("record-stats.mjs", () => {
  it("appends a new day, keeps the header and sorts by date", () => {
    const file = historyPath();
    writeFileSync(
      file,
      `${HEADER}\n2026-11-17,3534,1131,2967,3485,60571\n`,
      "utf8",
    );

    const result = runRecord(file);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "2026-11-18 registered_users=3540 dau=1200 wau=3000 mau=3490 commands_7d=61000",
    );
    expect(result.stderr).toBe("");

    const text = readFileSync(file, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.trimEnd().split("\n");
    expect(lines).toEqual([
      HEADER,
      "2026-11-17,3534,1131,2967,3485,60571",
      "2026-11-18,3540,1200,3000,3490,61000",
    ]);
  });

  it("replaces the same date instead of duplicating it and is idempotent", () => {
    const file = historyPath();
    writeFileSync(
      file,
      `${HEADER}\n2026-11-18,3500,1100,2900,3400,60000\n2026-11-19,3550,1250,3020,3500,62000\n`,
      "utf8",
    );
    writeMock({
      ...payload,
      registered_users: 3540,
      dau: 1200,
      mau: 3490,
    });

    const first = runRecord(file);
    expect(first.status).toBe(0);

    const text = readFileSync(file, "utf8");
    const lines = text.trimEnd().split("\n");
    expect(lines).toEqual([
      HEADER,
      "2026-11-18,3540,1200,3000,3490,61000",
      "2026-11-19,3550,1250,3020,3500,62000",
    ]);

    const second = runRecord(file);
    expect(second.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(text);
  });

  it("preserves a header-only file and adds the first row", () => {
    const file = historyPath("fresh.csv");
    writeFileSync(file, `${HEADER}\n`, "utf8");

    const result = runRecord(file);

    expect(result.status).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      `${HEADER}\n2026-11-18,3540,1200,3000,3490,61000\n`,
    );
  });

  it("refuses invalid payloads without touching the history", () => {
    const cases = [
      { generated_at: "not a timestamp" },
      { registered_users: -1 },
      { dau: 12.5 },
      { mau: "3490" },
      { uptime_90d: 99.9 },
      { method: null },
    ];

    for (const [index, patch] of cases.entries()) {
      writeMock({ ...payload, ...patch });
      const file = historyPath(`invalid-${index}.csv`);
      const original = `${HEADER}\n2026-11-17,3534,1131,2967,3485,60571\n`;
      writeFileSync(file, original, "utf8");

      const result = runRecord(file);

      expect(result.status, JSON.stringify(patch)).not.toBe(0);
      expect(result.stderr).toContain("bad payload");
      expect(readFileSync(file, "utf8")).toBe(original);
    }
  });

  it("exits nonzero when the endpoint is not ok", () => {
    writeMock(payload, 503);
    const file = historyPath("unavailable.csv");
    writeFileSync(file, `${HEADER}\n`, "utf8");

    const result = runRecord(file);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("HTTP 503");
    expect(readFileSync(file, "utf8")).toBe(`${HEADER}\n`);
  });
});

describe("render-stats-chart.mjs", () => {
  it("renders four series, a legend and date labels as a standalone SVG", () => {
    const file = historyPath("chart.csv");
    writeFileSync(
      file,
      `${HEADER}
2026-11-14,3485,1604,3033,3484,66899
2026-11-15,3505,1049,3066,3469,70254
2026-11-16,3522,1257,3018,3479,65398
2026-11-17,3534,1131,2967,3485,60571
`,
      "utf8",
    );
    const out = chartPath();

    const result = runChart(file, out);

    expect(result.status).toBe(0);
    expect(existsSync(out)).toBe(true);
    const svg = readFileSync(out, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 960 420"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-labelledby="chart-title chart-desc"');
    expect(svg).toContain("NbkristQik usage");
    expect(svg).toContain("Daily snapshots · aggregates only");
    expect(svg.match(/class="series"/g) ?? []).toHaveLength(4);
    for (const [key, color] of [
      ["registered_users", "#ffffff"],
      ["dau", "#4cb2ff"],
      ["wau", "#7ed176"],
      ["mau", "#8794a1"],
    ] as const) {
      expect(svg).toMatch(
        new RegExp(
          `<path class="series" data-series="${key}"[^>]*stroke="${color}"`,
        ),
      );
    }
    expect(svg).toContain(">registered users<");
    expect(svg).toContain(">daily active<");
    expect(svg).toContain(">weekly active<");
    expect(svg).toContain(">monthly active<");

    // Telegram-native palette: dark ground, surface panel, subtle white grid.
    expect(svg).toContain("#1a2026");
    expect(svg).toContain("#212a33");
    expect(svg).toContain("#ffffff");
    expect(svg).toContain("#4cb2ff");
    expect(svg).toContain("#7ed176");
    expect(svg).toContain("#8794a1");
    expect(svg).toContain('stroke="#ffffff" stroke-opacity="0.1"');
    expect(svg).toContain(
      '"Figtree", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    );
    for (const retired of [
      "#e7dcc3",
      "#3f6457",
      "#a62f22",
      "#8a6a12",
      "#f88277",
      "#ff9953",
      "Zilla Slab",
      "Public Sans",
    ]) {
      expect(svg).not.toContain(retired);
    }

    expect(svg).toContain("14 Nov 2026");
    expect(svg).toContain("16 Nov 2026");
    expect(svg).toContain("17 Nov 2026");

    // self-contained: no webfonts or external assets
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("<link");
    expect(svg).not.toContain("fonts.googleapis");
    expect(svg).not.toContain("href=");
  });

  it("renders a single row without failing", () => {
    const file = historyPath("single.csv");
    writeFileSync(
      file,
      `${HEADER}\n2026-11-17,3534,1131,2967,3485,60571\n`,
      "utf8",
    );
    const out = chartPath("single.svg");

    const result = runChart(file, out);

    expect(result.status).toBe(0);
    const svg = readFileSync(out, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("NbkristQik usage");
    expect(svg.match(/class="series"/g) ?? []).toHaveLength(4);
    expect(svg.match(/class="series-point"/g) ?? []).toHaveLength(4);
    expect(svg).toContain("17 Nov 2026");
  });

  it("refuses a CSV with no data rows", () => {
    const file = historyPath("empty.csv");
    writeFileSync(file, `${HEADER}\n`, "utf8");
    const out = chartPath("empty.svg");

    const result = runChart(file, out);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("no data rows");
    expect(existsSync(out)).toBe(false);
  });
});
