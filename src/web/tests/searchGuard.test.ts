import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SearchBar from "../src/components/SearchBar";
import { EmptyState, ErrorState } from "../src/components/FeedbackStates";
import { searchQuery } from "../src/useLeaderboard";

/**
 * A one-character search must never reach the API. The hook also normalises
 * it, so a caller cannot skip the guard by accident.
 */
describe("searchQuery", () => {
  it("treats one character as no query", () => {
    expect(searchQuery("a")).toBe("");
    expect(searchQuery(" a ")).toBe("");
  });

  it("keeps a real query, trimmed", () => {
    expect(searchQuery("ab")).toBe("ab");
    expect(searchQuery("  JOHN  ")).toBe("JOHN");
    expect(searchQuery("")).toBe("");
  });
});

/**
 * The field says what the hook does, and the empty/error copy must not
 * promise a search the caller cannot run.
 */
describe("SearchBar", () => {
  it("asks for a second character instead of searching on one", () => {
    const html = renderToStaticMarkup(
      React.createElement(SearchBar, {
        value: "a",
        onChange: () => {},
        identified: false,
      }),
    );

    expect(html).toContain("Type at least 2 characters.");
    expect(html).toContain('aria-describedby="search-min-hint"');
  });

  it("drops the hint once a real search can run", () => {
    const html = renderToStaticMarkup(
      React.createElement(SearchBar, {
        value: "ab",
        onChange: () => {},
        identified: false,
      }),
    );

    expect(html).not.toContain("Type at least 2 characters.");
    expect(html).not.toContain("search-min-hint");
  });
});

describe("EmptyState", () => {
  const render = (identified: boolean) =>
    renderToStaticMarkup(
      React.createElement(EmptyState, {
        search: "JOHN",
        sortBy: "attendance",
        filtered: false,
        identified,
        onClearFilters: () => {},
      }),
    );

  it("promises only roll search to an anonymous caller", () => {
    const html = render(false);

    expect(html).toContain("Try a roll number");
    expect(html).not.toContain("part of a name");
  });

  it("keeps name search in the copy for an identified caller", () => {
    expect(render(true)).toContain("Try a roll number or part of a name");
  });
});

describe("ErrorState", () => {
  it("shows the server's sentence instead of a fetch failure", () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, {
        onRetry: () => {},
        message: "search must be at least 2 characters",
      }),
    );

    expect(html).toContain("search must be at least 2 characters");
    expect(html).not.toContain("couldn’t be fetched just now");
  });

  it("keeps the generic copy when the server said nothing", () => {
    const html = renderToStaticMarkup(
      React.createElement(ErrorState, { onRetry: () => {} }),
    );

    expect(html).toContain("The register didn’t open");
    expect(html).toContain("It couldn’t be fetched just now.");
  });
});
