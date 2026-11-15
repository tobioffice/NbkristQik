import { describe, it, expect } from "vitest";
import {
  APP_WEBAPP_URL,
  appDirectLink,
  LEADERBOARD_WEBAPP_URL,
  LIBRARY_WEBAPP_URL,
  REGISTER_WEBAPP_URL,
  REPORT_LIST_WEBAPP_URL,
  REPORT_WEBAPP_URL,
  reportThreadUrl,
  startParamFor,
} from "../../src/constants/webapp.js";

/**
 * Telegram replaces a Mini App's fragment with its own launch data, so a
 * button that names its section in the hash lands on the first screen. Every
 * bot link must name its section in the query instead.
 */
describe("bot links to the app", () => {
  it("puts the section in the query, never the fragment", () => {
    const links = [
      REGISTER_WEBAPP_URL,
      LEADERBOARD_WEBAPP_URL,
      LIBRARY_WEBAPP_URL,
      REPORT_WEBAPP_URL,
      REPORT_LIST_WEBAPP_URL,
      reportThreadUrl("QIK-0007"),
    ];
    for (const link of links) {
      expect(link).not.toContain("#");
      expect(link).toContain("?page=");
    }
  });

  it("names each surface", () => {
    expect(REGISTER_WEBAPP_URL).toBe(`${APP_WEBAPP_URL}?page=profile`);
    expect(LEADERBOARD_WEBAPP_URL).toBe(`${APP_WEBAPP_URL}?page=rank`);
    expect(LIBRARY_WEBAPP_URL).toBe(`${APP_WEBAPP_URL}?page=library`);
    expect(REPORT_WEBAPP_URL).toBe(`${APP_WEBAPP_URL}?page=issues/new`);
    expect(REPORT_LIST_WEBAPP_URL).toBe(`${APP_WEBAPP_URL}?page=issues`);
    expect(reportThreadUrl("QIK-0007")).toBe(
      `${APP_WEBAPP_URL}?page=issues/QIK-0007`,
    );
  });
});

/**
 * A group has no `web_app` buttons. The same section is a direct link that
 * opens the Main Mini App in the chat, with a `startapp` value Telegram can
 * carry: letters, digits, underscores and hyphens.
 */
describe("a group's direct link", () => {
  it("opens the Mini App in the current chat", () => {
    expect(appDirectLink("rank")).toBe(
      "https://t.me/NbkristQik_bot?startapp=rank",
    );
    expect(appDirectLink("profile")).toBe(
      "https://t.me/NbkristQik_bot?startapp=profile",
    );
  });

  it("turns a route's slashes into underscores", () => {
    expect(startParamFor("issues/new")).toBe("issues_new");
    expect(startParamFor("issues/QIK-0007")).toBe("issues_QIK-0007");
    expect(appDirectLink("issues/new")).toBe(
      "https://t.me/NbkristQik_bot?startapp=issues_new",
    );
  });
});
