import { vi, type Mock } from "vitest";

/**
 * Narrow shapes for the handful of Telegram Bot API calls the unit tests
 * observe. The tests substitute these mocks for the real `bot` module, so
 * only the fields the assertions read are modelled; a real `sendMessage`
 * accepts more options than this.
 */

export type InlineKeyboardButton = {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
};

export type ReplyKeyboard = {
  inline_keyboard: InlineKeyboardButton[][];
};

export type SendMessageOptions = {
  parse_mode?: string;
  reply_markup?: ReplyKeyboard;
  disable_notification?: boolean;
};

export type SendMessageArgs = (
  chatId: number | string,
  text: string,
  options: SendMessageOptions,
) => Promise<{ message_id: number }>;

export type SendMessageMock = Mock<SendMessageArgs>;

/** `bot.sendMessage` stand-in whose recorded calls keep their argument types. */
export const createSendMessageMock = (messageId = 1): SendMessageMock =>
  vi.fn<SendMessageArgs>(async () => ({ message_id: messageId }));

/** The recorded call's arguments, with the third options argument present. */
export const sentMessage = (
  mock: SendMessageMock,
  index = 0,
): [number | string, string, SendMessageOptions] => {
  const call = mock.mock.calls[index];
  if (!call) {
    throw new Error(`sendMessage was not called ${index + 1} time(s)`);
  }
  return call;
};

/** The reply keyboard of a recorded call, failing loudly if none was sent. */
export const replyKeyboard = (options: SendMessageOptions): ReplyKeyboard => {
  if (!options.reply_markup) {
    throw new Error("sendMessage was called without reply_markup");
  }
  return options.reply_markup;
};

export type RegisteredHandler = (payload: unknown) => unknown;
export type OnTextArgs = (
  pattern: RegExp,
  handler: RegisteredHandler,
) => unknown;
export type OnArgs = (event: string, handler: RegisteredHandler) => unknown;
export type OnTextMock = Mock<OnTextArgs>;
export type OnMock = Mock<OnArgs>;

/** `bot.onText(pattern, handler)` stand-in, capturing both arguments. */
export const createOnTextMock = (): OnTextMock => vi.fn<OnTextArgs>();

/** `bot.on(event, handler)` stand-in, capturing both arguments. */
export const createOnMock = (): OnMock => vi.fn<OnArgs>();

/** The handler registered for the text pattern that matches `command`. */
export const registeredTextHandler = <T extends RegisteredHandler>(
  mock: OnTextMock,
  command: string,
): T => {
  const call = mock.mock.calls.find(([pattern]) => pattern.test(command));
  if (!call) throw new Error(`no handler registered for ${command}`);
  // The mock records the shared (payload: unknown) => unknown shape; each
  // test knows the concrete bot payload it invokes the handler with.
  return call[1] as unknown as T;
};

/** The handler registered for the bot event `event`. */
export const registeredEventHandler = <T extends RegisteredHandler>(
  mock: OnMock,
  event: string,
): T => {
  const call = mock.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no handler registered for ${event}`);
  // Same boundary as registeredTextHandler: the test supplies the concrete
  // callback-query payload type it invokes the handler with.
  return call[1] as unknown as T;
};
