import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import StudentRow from "../src/components/StudentRow";

/**
 * A minimal server-render smoke test for the register row. It does not need a
 * DOM or Testing Library; it proves the component's props and markup survive a
 * render, which is the failure mode a typecheck alone cannot catch.
 */
describe("StudentRow", () => {
  it("renders rank, roll, name, score and the YOU stamp", () => {
    const html = renderToStaticMarkup(
      React.createElement(StudentRow, {
        stat: {
          roll_no: "23KB1A0599",
          name: "Test Student",
          attendance_percentage: 82.4,
          mid_marks_avg: 24.1,
          rank: 7,
        },
        sortBy: "attendance",
        isMe: true,
        isLast: false,
      }),
    );

    expect(html).toContain("23KB1A0599");
    expect(html).toContain("Test Student");
    expect(html).toContain("82.40");
    expect(html).toContain("YOU");
    expect(html).toContain("reg-row--me");
  });

  it("falls back to the roll when an anonymous row has no name", () => {
    const html = renderToStaticMarkup(
      React.createElement(StudentRow, {
        stat: {
          roll_no: "23KB1A0600",
          name: null,
          attendance_percentage: 60,
          mid_marks_avg: null,
          rank: 99,
        },
        sortBy: "attendance",
        isMe: false,
        isLast: true,
      }),
    );

    expect(html).toContain("23KB1A0600");
    expect(html).not.toContain("YOU");
    expect(html).toContain("is-below"); // 60% is under the 75% rule
  });
});
