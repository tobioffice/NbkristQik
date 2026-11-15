import { bot } from "../bot.js";
import {
  adminReplyToReport,
  adminCloseReport,
} from "../../services/reportService.js";
import { ADMIN_ID } from "../../config/environmentals.js";
import { trackMessage } from "../../services/tracker.js";
import { logger } from "../../config/logger.js";
import { commandArgs } from "./args.js";

// Admin reply/close for issue reports. The issue id is accepted as
// QIK-0007, QIK-7, or just 7. Replies are recorded on the report and DM'd
// to the reporter automatically.

const splitReply = (args: string): { rawId: string; reply: string } => {
  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(args.trim());
  return { rawId: match?.[1] ?? "", reply: match?.[2]?.trim() ?? "" };
};

bot.command("reply", async (ctx) => {
  const msg = ctx.message;
  if (!msg || msg.from?.id !== ADMIN_ID) return;

  trackMessage(msg, "command:reply");
  const { rawId, reply } = splitReply(commandArgs(ctx));

  if (!reply) {
    await ctx.reply(
      "Usage:\n<code>/reply QIK-0007 your answer to the reporter</code>",
      { parse_mode: "HTML" },
    );
    return;
  }

  try {
    const issueId = await adminReplyToReport(rawId, reply);
    if (!issueId) {
      await ctx.reply(`Couldn't find a report matching ${rawId}.`);
      return;
    }
    await ctx.reply(
      `Sent. It's saved on <code>${issueId}</code> and the reporter has it in DM.`,
      { parse_mode: "HTML" },
    );
  } catch (e) {
    logger.error("[answers] /reply failed:", e);
    await ctx.reply("That didn't send. Try again in a bit.").catch(() => {});
  }
});

bot.command("close", async (ctx) => {
  const msg = ctx.message;
  if (!msg || msg.from?.id !== ADMIN_ID) return;

  trackMessage(msg, "command:close");
  const rawId = commandArgs(ctx);

  if (!rawId) {
    await ctx.reply("Usage: <code>/close QIK-0007</code>", {
      parse_mode: "HTML",
    });
    return;
  }

  try {
    const issueId = await adminCloseReport(rawId);
    if (!issueId) {
      await ctx.reply(`Couldn't find a report matching ${rawId}.`);
      return;
    }
    await ctx.reply(`Closed <code>${issueId}</code>. The reporter knows.`, {
      parse_mode: "HTML",
    });
  } catch (e) {
    logger.error("[answers] /close failed:", e);
    await ctx.reply("That didn't close. Try again in a bit.").catch(() => {});
  }
});
