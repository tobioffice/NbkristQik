import { describe, expect, it } from "vitest";
import {
  compileKeywordList,
  findKeywordHits,
  normalizeToken,
  tokenize,
} from "../../src/services/moderation/matcher.js";

const keywords = compileKeywordList([
  "sex",
  "fuck",
  "chut",
  "chutiya",
  "asshole",
  "sex video",
  "सेक्स",
]);

describe("blocked-word matcher", () => {
  it("finds a plain word in a message", () => {
    expect(findKeywordHits("this is sex", keywords)).toEqual(["sex"]);
  });

  it("ignores case", () => {
    expect(findKeywordHits("THIS IS SEX", keywords)).toEqual(["sex"]);
  });

  it("sees through leetspeak and punctuation", () => {
    expect(findKeywordHits("s3x", keywords)).toEqual(["sex"]);
    expect(findKeywordHits("$ex", keywords)).toEqual(["sex"]);
    expect(findKeywordHits("f.u.c.k", keywords)).toEqual(["fuck"]);
    expect(findKeywordHits("@sshole", keywords)).toEqual(["asshole"]);
  });

  it("collapses stretched letters", () => {
    expect(findKeywordHits("fuuuck", keywords)).toEqual(["fuck"]);
    expect(findKeywordHits("seeeex", keywords)).toEqual(["sex"]);
  });

  it("joins letters spaced out one by one", () => {
    expect(findKeywordHits("s e x", keywords)).toEqual(["sex"]);
    // a stretched spaced run collapses the same way
    expect(findKeywordHits("s e e x", keywords)).toEqual(["sex"]);
    // a two-letter run is not enough to be a word
    expect(findKeywordHits("s e", keywords)).toEqual([]);
  });

  it("does not catch innocent words containing a blocked one", () => {
    // the seed lists exact words, so these stay clean
    expect(findKeywordHits("chutney is nice", keywords)).toEqual([]);
    expect(findKeywordHits("I went to Sussex", keywords)).toEqual([]);
    expect(findKeywordHits("the sexton arrived", keywords)).toEqual([]);
  });

  it("matches a multi-word phrase only when the words are adjacent", () => {
    expect(findKeywordHits("send a sex video", keywords)).toContain(
      "sex video",
    );
    expect(findKeywordHits("sex, video", keywords)).toContain("sex video");
    expect(findKeywordHits("a video about sex", keywords)).not.toContain(
      "sex video",
    );
  });

  it("matches Devanagari words and keeps their combining marks", () => {
    expect(tokenize("चूत")).toEqual(["चूत"]);
    expect(findKeywordHits("यह सेक्स है", keywords)).toEqual(["सेक्स"]);
  });

  it("returns nothing for empty text, empty keyword list or plain prose", () => {
    expect(findKeywordHits("", keywords)).toEqual([]);
    expect(findKeywordHits("good morning everyone", keywords)).toEqual([]);
    expect(findKeywordHits("sex", compileKeywordList([]))).toEqual([]);
  });

  it("normalises a token the way the compiled list does", () => {
    expect(normalizeToken("Fuuuuck")).toBe("fuck");
    expect(normalizeToken("s3x")).toBe("sex");
    expect(normalizeToken("asshole")).toBe("ashole");
  });
});
