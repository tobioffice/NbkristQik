import { describe, it, expect } from "vitest";
import {
  APP_WEBAPP_URL,
  LIBRARY_WEBAPP_URL,
  REGISTER_WEBAPP_URL,
  REPORT_LIST_WEBAPP_URL,
  REPORT_WEBAPP_URL,
  reportThreadUrl,
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
    expect(LIBRARY_WEBAPP_URL).toBe(`${APP_WEBAPP_URL}?page=library`);
    expect(REPORT_WEBAPP_URL).toBe(`${APP_WEBAPP_URL}?page=issues`);
    expect(REPORT_LIST_WEBAPP_URL).toBe(
      `${APP_WEBAPP_URL}?page=issues/reports`,
    );
    expect(reportThreadUrl("QIK-0007")).toBe(
      `${APP_WEBAPP_URL}?page=issues/QIK-0007`,
    );
  });
});
