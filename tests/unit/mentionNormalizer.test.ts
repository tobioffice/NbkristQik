import { describe, it, expect } from "vitest";
import type { Message } from "node-telegram-bot-api";

import { stripOwnMention } from "../../src/bot/mentionNormalizer.js";

const msgWith = (text: string): Message =>
  ({ message_id: 1, text, chat: { id: -100, type: "supergroup" } }) as Message;

describe("stripOwnMention", () => {
  it("rewrites a bare command with our mention to the plain form", () => {
    const m = msgWith("/report@NbkristQik_bot");
    stripOwnMention(m);
    expect(m.text).toBe("/report");
  });

  it("rewrites a command with arguments, keeping the text after it", () => {
    const m = msgWith("/report@nbkristqik_bot my laptop broke");
    stripOwnMention(m);
    expect(m.text).toBe("/report my laptop broke");
  });

  it("matches the mention case-insensitively", () => {
    const m = msgWith("/postopen@NbkristQik_BOT");
    stripOwnMention(m);
    expect(m.text).toBe("/postopen");
  });

  it("leaves commands addressed to another bot alone", () => {
    const m = msgWith("/report@SomeOtherBot do not serve me");
    stripOwnMention(m);
    expect(m.text).toBe("/report@SomeOtherBot do not serve me");
  });

  it("leaves a mid-word suffix alone", () => {
    const m = msgWith("/reportNbkristQik_bot");
    stripOwnMention(m);
    expect(m.text).toBe("/reportNbkristQik_bot");
  });

  it("leaves plain commands and non-command text untouched", () => {
    const bare = msgWith("/report");
    stripOwnMention(bare);
    expect(bare.text).toBe("/report");

    const plain = msgWith("230229735024");
    stripOwnMention(plain);
    expect(plain.text).toBe("230229735024");
  });
});
