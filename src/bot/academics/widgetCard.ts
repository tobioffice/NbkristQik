import type { InlineKeyboardMarkup, Message } from "node-telegram-bot-api";
import { bot } from "../bot.js";
import { ADMIN_ID } from "../../config/environmentals.js";
import {
  WIDGET_HTML,
  widgetStateJson,
  type WidgetState,
} from "../../services/student.utils/widget.js";

type WidgetMode = "off" | "admin" | "all";

/**
 * Who gets the widget card.
 *
 * `off` is the current default because Telegram rejects widgets in
 * production. `admin` is the safe test: the operator sees the card, students
 * keep the text/rich card. `all` turns it on for every private chat. A widget
 * already on screen keeps updating even if the mode changes.
 */
const widgetMode = (): WidgetMode => {
  const raw = process.env.ATTENDANCE_WIDGET?.trim().toLowerCase();
  // Telegram currently rejects widgets in production with
  // INPUT_MEDIA_WIDGET_NOT_ALLOWED; keep the attempt off until the API is
  // available again, then use admin/all for the rollout.
  return raw === "admin" || raw === "all" ? raw : "off";
};

export const widgetEnabledFor = (userId?: number): boolean => {
  const mode = widgetMode();
  if (mode === "all") return true;
  return mode === "admin" && userId === ADMIN_ID;
};

/** True when this message is an HTML widget sent by the bot. */
export const isWidgetMessage = (msg: Message): boolean => Boolean(msg.widget);

/**
 * Show the loading state inside a widget, or send a fresh widget with it.
 * The code is fixed; only the chat state changes.
 */
export const sendLoadingWidget = async ({
  chatId,
  state,
  caption,
  markup,
  replyTo,
}: {
  chatId: number;
  state: WidgetState;
  caption: string;
  markup?: InlineKeyboardMarkup;
  replyTo?: number;
}): Promise<Message> =>
  bot.api.sendWidget({
    chat_id: chatId,
    html: WIDGET_HTML,
    width: 0,
    height: 0,
    chat_data: widgetStateJson(state),
    caption,
    ...(replyTo ? { reply_parameters: { message_id: replyTo } } : {}),
    ...(markup ? { reply_markup: markup } : {}),
  });

/** Change the widget's state; the client redraws from it. */
export const editWidgetState = async (
  chatId: number,
  messageId: number,
  state: WidgetState,
): Promise<void> => {
  await bot.api.editMessageWidgetData({
    chat_id: chatId,
    message_id: messageId,
    chat_data: widgetStateJson(state),
  });
};

/**
 * Update the caption. A best-effort write: the widget is the card, and a
 * caption that cannot be edited must not lose the state update.
 */
export const editWidgetCaption = async (
  chatId: number,
  messageId: number,
  caption: string,
): Promise<void> => {
  await bot.api
    .editMessageCaption({
      chat_id: chatId,
      message_id: messageId,
      caption: caption.slice(0, 1024),
    })
    .catch(() => undefined);
};
