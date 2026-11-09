import { describe, expect, it } from "vitest";
import {
  HOME_ROUTE,
  hashFor,
  parseRouteHash,
  parseRoutePath,
  takePageLink,
} from "../src/route";

describe("the hash router", () => {
  it("opens the roll form for an empty or unknown address", () => {
    expect(parseRouteHash("")).toEqual(HOME_ROUTE);
    expect(parseRouteHash("#/")).toEqual(HOME_ROUTE);
    expect(parseRouteHash("#/tgWebAppData=abc")).toEqual(HOME_ROUTE);
    expect(parseRouteHash("#/rank")).toEqual(HOME_ROUTE);
    expect(parseRouteHash("#/attendance")).toEqual(HOME_ROUTE);
  });

  it("ignores Telegram's launch data appended after the path", () => {
    expect(
      parseRouteHash("#/library?tgWebAppData=abc&tgWebAppVersion=8.0"),
    ).toEqual({ section: "library", issue: null, mine: false });
    expect(parseRouteHash("#/issues/QIK-0007?tgWebAppData=abc").issue).toBe(
      "QIK-0007",
    );
  });

  it("reads every section", () => {
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
      HOME_ROUTE,
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
    expect(takePageLink("https://x.test/library/?page=profile")).toEqual({
      route: { section: "profile", issue: null, mine: false },
      href: "/library/#/",
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
    expect(takePageLink("https://x.test/library/#/profile")).toBeNull();
  });

  it("lands retired pages on the roll form, not a blank sheet", () => {
    expect(takePageLink("https://x.test/library/?page=rank")?.route).toEqual(
      HOME_ROUTE,
    );
    expect(takePageLink("https://x.test/library/?page=nope")?.route).toEqual(
      HOME_ROUTE,
    );
  });
});

describe("a route path", () => {
  it("ignores extra slashes", () => {
    expect(parseRoutePath("//issues//reports/").mine).toBe(true);
  });
});
