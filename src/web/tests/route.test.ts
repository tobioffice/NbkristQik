import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_ROUTE,
  hashFor,
  parseRouteHash,
  parseRoutePath,
  takePageLink,
} from "../src/route";

describe("the hash router", () => {
  it("opens the first screen for an empty or unknown address", () => {
    expect(parseRouteHash("")).toEqual(ATTENDANCE_ROUTE);
    expect(parseRouteHash("#/")).toEqual(ATTENDANCE_ROUTE);
    expect(parseRouteHash("#/tgWebAppData=abc")).toEqual(ATTENDANCE_ROUTE);
  });

  it("ignores Telegram's launch data appended after the path", () => {
    expect(
      parseRouteHash("#/rank?tgWebAppData=abc&tgWebAppVersion=8.0"),
    ).toEqual({ section: "rank", issue: null, mine: false });
    expect(parseRouteHash("#/issues/QIK-0007?tgWebAppData=abc").issue).toBe(
      "QIK-0007",
    );
  });

  it("reads every section", () => {
    expect(parseRouteHash("#/rank").section).toBe("rank");
    expect(parseRouteHash("#/profile").section).toBe("profile");
    expect(parseRouteHash("#/library").section).toBe("library");
    expect(parseRouteHash("#/issues")).toEqual({
      section: "issues",
      issue: null,
      mine: false,
    });
    expect(parseRouteHash("#/issues/reports")).toEqual({
      section: "issues",
      issue: null,
      mine: true,
    });
    expect(parseRouteHash("#/issues/qik-0007")).toEqual({
      section: "issues",
      issue: "QIK-0007",
      mine: false,
    });
  });

  it("writes the hash a route came from", () => {
    const routes = [
      ATTENDANCE_ROUTE,
      { section: "rank", issue: null, mine: false },
      { section: "library", issue: null, mine: false },
      { section: "issues", issue: null, mine: false },
      { section: "issues", issue: null, mine: true },
      { section: "issues", issue: "QIK-0007", mine: false },
    ] as const;
    for (const route of routes) {
      expect(parseRouteHash(hashFor(route))).toEqual(route);
    }
  });
});

describe("a bot deep link", () => {
  it("folds ?page= into the hash the router reads", () => {
    expect(takePageLink("https://x.test/library/?page=rank")).toEqual({
      route: { section: "rank", issue: null, mine: false },
      href: "/library/#/rank",
    });
  });

  it("keeps the computer-link token, and the page marker is spent", () => {
    expect(
      takePageLink("https://x.test/library/?page=library&pc=abc")?.href,
    ).toBe("/library/?pc=abc#/library");
  });

  it("keeps Telegram's own query parameters", () => {
    expect(
      takePageLink(
        "https://x.test/library/?page=issues/QIK-0007&tgWebAppStartParam=x",
      )?.href,
    ).toBe("/library/?tgWebAppStartParam=x#/issues/QIK-0007");
  });

  it("carries an issue conversation", () => {
    expect(
      takePageLink("https://x.test/library/?page=issues/QIK-0007")?.route,
    ).toEqual({ section: "issues", issue: "QIK-0007", mine: false });
  });

  it("is absent when the button named no page", () => {
    expect(takePageLink("https://x.test/library/")).toBeNull();
    expect(takePageLink("https://x.test/library/#/rank")).toBeNull();
  });

  it("lands unknown pages on the first screen instead of a blank sheet", () => {
    expect(takePageLink("https://x.test/library/?page=nope")?.route).toEqual(
      ATTENDANCE_ROUTE,
    );
  });
});

describe("a route path", () => {
  it("ignores extra slashes", () => {
    expect(parseRoutePath("//issues//reports/").mine).toBe(true);
  });
});
