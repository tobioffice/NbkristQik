import { bot } from "../bot.js";
import {
  createAndAnnounce,
  tooSoonToReport,
} from "../../services/reportService.js";
import { trackMessage } from "../../services/tracker.js";
import { appPageUrl, type AppPage } from "../../constants/webapp.js";
import { CHIT_CHAT_ID } from "../../constants/index.js";
import { logger } from "../../config/logger.js";
import { commandArgs } from "./args.js";

// /report lives on the web: easy typing, an issue id, and replies that reach
// the reporter here in Telegram. A bare /report opens the form — plus a
// second button straight into "My reports", where every past issue and its
// conversation is waiting. "/report <message>" still works and files a
// tracked report with an id.

bot.command("report", async (ctx) => {
  const msg = ctx.message;
  const from = msg?.from;
  if (!msg || !from) return;

  const chatId = msg.chat.id;
  const text = commandArgs(ctx);

  if (chatId === CHIT_CHAT_ID) {
    await bot.api
      .deleteMessage({ chat_id: chatId, message_id: msg.message_id })
      .catch(() => {});
    return;
  }

  trackMessage(msg, "command:report", text.slice(0, 100));

  if (!text) {
    // Telegram only allows web_app buttons in private chats
    const isPrivate = msg.chat.type === "private";
    const button = (label: string, page: AppPage, primary = false) => ({
      ...(isPrivate
        ? { text: label, web_app: { url: appPageUrl(page, "web_app") } }
        : { text: label, url: appPageUrl(page, "direct") }),
      ...(primary ? { style: "primary" } : {}),
    });

    await ctx
      .reply(
        `Something broken? Open the form and tell me what happened. You'll get a tracking id like <code>QIK-0012</code> and I'll reply here.`,
        {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [button("🐞 Report an issue", "issues/new", true)],
              [button("🗂 My reports", "issues")],
            ],
          },
        },
      )
      .catch((e: Error) =>
        logger.warn("[report] form message failed:", e?.message ?? e),
      );
    return;
  }

  if (text.length < 10 || text.length > 1000) {
    await ctx.reply(
      "Give me a little more to go on, between 10 and 1000 characters.",
    );
    return;
  }

  if (await tooSoonToReport(from.id)) {
    await ctx.reply("One report at a time. Try again in a minute.");
    return;
  }

  try {
    const { issueId } = await createAndAnnounce({
      userId: from.id,
      username: from.username ?? null,
      firstName: from.first_name ?? null,
      chatType: msg.chat.type as "private" | "group" | "supergroup" | "channel",
      message: text,
    });
    // the service already confirmed in DM; in groups confirm inline too
    if (chatId !== from.id) {
      await ctx.reply(`Got it, I've filed ${issueId}.`);
    }
  } catch (e) {
    logger.error("[report] chat submission failed:", e);
    await ctx
      .reply("I couldn't file that. Try again in a bit.")
      .catch(() => {});
  }
});
