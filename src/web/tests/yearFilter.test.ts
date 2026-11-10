import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import FilterBar from "../src/components/FilterBar";

/**
 * `studentsnew.year` stores the portal's `yearSem` codes (11..42), but the
 * server filters on the first digit. The control must therefore send 1..4.
 */
describe("FilterBar year", () => {
  const html = renderToStaticMarkup(
    React.createElement(FilterBar, {
      filters: { year: "all", branch: "all", section: "all" },
      sections: null,
      onChange: () => {},
    }),
  );
  // the branch select legitimately carries codes like 11 (CIVIL), so the
  // assertions must look at the year control only
  const yearSelect =
    html.match(/<select aria-label="Filter by year"[\s\S]*?<\/select>/)?.[0] ??
    "";

  it("offers the year digit, not the semester code", () => {
    for (const year of ["1", "2", "3", "4"]) {
      expect(yearSelect).toContain(`value="${year}"`);
    }
    expect(yearSelect).not.toContain('value="11"');
    expect(yearSelect).not.toContain('value="21"');
    expect(yearSelect).not.toContain('value="31"');
    expect(yearSelect).not.toContain('value="41"');
  });

  it("keeps All Years as the default", () => {
    expect(html).toContain('value="all"');
    expect(html).toContain("All Years");
    expect(html).toContain("1st Year");
    expect(html).toContain("4th Year");
  });
});
