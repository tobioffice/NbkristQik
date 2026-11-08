import { describe, it, expect } from "vitest";
import {
  DOWNLOAD_TOKEN_TTL_MS,
  mintDownloadToken,
  verifyDownloadToken,
} from "../../src/services/library/download.js";

const NOW = 1_800_000_000_000;

describe("a download link's token", () => {
  it("names the reader it was minted for", () => {
    const token = mintDownloadToken("9001", "dbms-u1", NOW);

    expect(token).not.toBeNull();
    expect(verifyDownloadToken(token ?? "", "dbms-u1", NOW)).toBe("9001");
  });

  it("is good for one document only", () => {
    const token = mintDownloadToken("9001", "dbms-u1", NOW) ?? "";

    expect(verifyDownloadToken(token, "dbms-u2", NOW)).toBeNull();
  });

  it("stops working when it expires", () => {
    const token = mintDownloadToken("9001", "dbms-u1", NOW) ?? "";

    expect(
      verifyDownloadToken(token, "dbms-u1", NOW + DOWNLOAD_TOKEN_TTL_MS - 1),
    ).toBe("9001");
    expect(
      verifyDownloadToken(token, "dbms-u1", NOW + DOWNLOAD_TOKEN_TTL_MS + 1),
    ).toBeNull();
  });

  it("refuses a token someone edited", () => {
    const token = mintDownloadToken("9001", "dbms-u1", NOW) ?? "";

    expect(verifyDownloadToken(`${token}x`, "dbms-u1", NOW)).toBeNull();
    expect(
      verifyDownloadToken(
        token.replace(/^./, (c) => (c === "a" ? "b" : "a")),
        "dbms-u1",
        NOW,
      ),
    ).toBeNull();
  });

  it("refuses rubbish and an empty token", () => {
    expect(verifyDownloadToken("", "dbms-u1", NOW)).toBeNull();
    expect(verifyDownloadToken(undefined, "dbms-u1", NOW)).toBeNull();
    expect(verifyDownloadToken("not-a-token", "dbms-u1", NOW)).toBeNull();
    expect(verifyDownloadToken(".", "dbms-u1", NOW)).toBeNull();
  });

  it("gives a different link to another reader", () => {
    const one = mintDownloadToken("9001", "dbms-u1", NOW);
    const two = mintDownloadToken("9002", "dbms-u1", NOW);

    expect(one).not.toBe(two);
  });
});
