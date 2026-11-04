import { describe, expect, it } from "vitest";
import { panelJs } from "../../src/api/admin/panel.js.js";
import { panelCss } from "../../src/api/admin/panel.css.js";

/**
 * Syntax guard for the admin panel's embedded assets. The panel ships one
 * large JS template string inside a TS module, so neither `tsc` nor ESLint
 * parses the script itself; this compiles it once to catch a broken edit
 * before it is inlined into the served document.
 */
describe("admin panel embedded assets", () => {
  it("compiles the embedded panel script", () => {
    expect(panelJs.length).toBeGreaterThan(0);
    expect(() => new Function(panelJs)).not.toThrow();
  });

  it("leaves no template interpolation in the panel script", () => {
    // the outer template literal must stay plain JS, not `${...}` fragments
    expect(panelJs).not.toContain("${");
  });

  it("ships a non-empty stylesheet with no template interpolation", () => {
    expect(panelCss.trim().length).toBeGreaterThan(0);
    expect(panelCss).not.toContain("${");
  });
});
