import type { Context } from "node-telegram-bot-api";

/**
 * The argument string of a `bot.command` update.
 *
 * v2 types `ctx.match` for every route as `string | RegExpMatchArray`; a
 * command always sets the string form, and a bare command sets "". The
 * accessor keeps the cast in one place instead of each command handler.
 */
export const commandArgs = (ctx: Context): string =>
  typeof ctx.match === "string" ? ctx.match.trim() : "";
