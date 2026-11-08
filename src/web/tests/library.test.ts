import { describe, expect, it } from "vitest";
import { libraryDocumentPdfUrl } from "../src/libraryApi";
import { addressWithoutPcToken, sessionCredential } from "../src/useLibrary";

describe("the PDF address", () => {
  it("builds the watermarked attachment path for a document", () => {
    expect(libraryDocumentPdfUrl("dbms-u1")).toBe(
      "/api/library/document/dbms-u1/pdf",
    );
  });

  it("keeps a document id inside one path segment", () => {
    expect(libraryDocumentPdfUrl("a b/c?#")).toBe(
      "/api/library/document/a%20b%2Fc%3F%23/pdf",
    );
  });
});

describe("which credential opens the shelf", () => {
  it("presents a computer link instead of a Telegram blob", () => {
    expect(
      sessionCredential({ initData: "signed", pcToken: "one-time" }),
    ).toBe("pcToken");
  });

  it("uses Telegram's signed identity when there is no computer link", () => {
    expect(sessionCredential({ initData: "signed" })).toBe("initData");
  });

  it("uses a computer link when there is no Telegram identity", () => {
    expect(sessionCredential({ pcToken: "one-time" })).toBe("pcToken");
  });

  it("has nothing to spend when neither was given", () => {
    expect(sessionCredential({})).toBeNull();
  });

  it("treats an empty credential as absent, the way the SDK reports it", () => {
    expect(sessionCredential({ initData: "", pcToken: "" })).toBeNull();
  });
});

describe("a spent computer link", () => {
  it("removes only the one-time token", () => {
    expect(
      addressWithoutPcToken(
        "https://x.test/library/?pc=abc&devUser=7#/library",
      ),
    ).toBe("/library/?devUser=7#/library");
  });

  it("leaves the route hash in place when pc was the only parameter", () => {
    expect(addressWithoutPcToken("https://x.test/library/?pc=abc#/rank")).toBe(
      "/library/#/rank",
    );
  });

  it("does nothing to an address that never had a token", () => {
    expect(addressWithoutPcToken("https://x.test/library/?devUser=7#/")).toBe(
      "/library/?devUser=7#/",
    );
  });
});
