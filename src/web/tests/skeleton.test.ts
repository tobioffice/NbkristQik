import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkeletonRows } from "../src/components/FeedbackStates";

/**
 * Every screen's loading shape is this one grouped component. These pin the
 * inset group, the default six rows and the row count screens ask for.
 */

const render = (rows?: number): string =>
  renderToStaticMarkup(React.createElement(SkeletonRows, { rows }));

describe("SkeletonRows", () => {
  it("is one inset group of six rows by default", () => {
    const html = render();

    expect(html).toContain('class="tg-skeleton"');
    expect(html.match(/skeleton-row/g)).toHaveLength(6);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("sk--rank");
    expect(html).toContain("sk--score");
  });

  it("matches a short screen with a row count", () => {
    expect(render(2).match(/skeleton-row/g)).toHaveLength(2);
    expect(render(3).match(/skeleton-row/g)).toHaveLength(3);
  });
});
