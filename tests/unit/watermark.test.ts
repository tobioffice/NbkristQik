import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import {
  stampPage,
  watermarkToken,
} from "../../src/services/library/watermark.js";

describe("the watermark token", () => {
  it("looks like a code, not an identity", () => {
    expect(watermarkToken("123456789")).toMatch(
      /^NBK-[0-9A-F]{4}-[0-9A-F]{4}$/,
    );
  });

  it("is the same for the same reader", () => {
    expect(watermarkToken("123456789")).toBe(watermarkToken("123456789"));
  });

  it("is different for every reader", () => {
    expect(watermarkToken("123456789")).not.toBe(watermarkToken("987654321"));
  });

  it("does not carry the reader's id or roll number", () => {
    const token = watermarkToken("123456789");
    expect(token).not.toContain("123456789");
    expect(token).not.toContain("23CS1042");
  });
});

describe("stamping a page", () => {
  const dir = path.join(os.tmpdir(), `nbq-svg-test-${process.pid}`);
  const file = path.join(dir, "p001.svg");

  const makePage = (): void => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      file,
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<svg xmlns="http://www.w3.org/2000/svg" width="594.95996pt" height="841.91998pt" viewBox="0 0 594.95996 841.91998">' +
        '<rect x="0" y="0" width="10" height="10"/>' +
        "</svg>",
    );
  };

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keeps the page and draws the reader's mark into it", async () => {
    makePage();
    const out = await stampPage(file, {
      token: watermarkToken("123456789"),
      label: "Database Management Systems · Unit I · p7",
    });

    expect(out.startsWith('<?xml version="1.0"')).toBe(true);
    expect(out.trimEnd().endsWith("</svg>")).toBe(true);
    expect(out).toContain('<rect x="0" y="0" width="10" height="10"/>');
    expect(out).toContain(watermarkToken("123456789"));
    expect(out).toContain("Database Management Systems · Unit I · p7");
    expect(out).toContain("<text");
  });

  it("repeats the token down the page, not once", async () => {
    makePage();
    const out = await stampPage(file, { token: "NBK-1234-ABCD" });
    const count = out.split("NBK-1234-ABCD").length - 1;
    expect(count).toBeGreaterThanOrEqual(4); // three diagonals + footer
  });

  it("escapes the label, so it cannot break the page", async () => {
    makePage();
    const out = await stampPage(file, {
      token: "NBK-1234-ABCD",
      label: 'a <b> & "c"',
    });
    expect(out).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
    expect(out).not.toContain("a <b>");
  });

  it("refuses a page that is not there", async () => {
    rmSync(dir, { recursive: true, force: true });
    await expect(stampPage(file, { token: "NBK-0000-0000" })).rejects.toThrow(
      "no such page",
    );
  });

  it("refuses a file that is not an svg", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "not a page");
    await expect(stampPage(file, { token: "NBK-0000-0000" })).rejects.toThrow(
      "page is not an svg",
    );
  });
});
