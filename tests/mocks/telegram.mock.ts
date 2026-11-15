import { vi, type Mock } from "vitest";

/**
 * Narrow shapes for the handful of v2 Telegram calls the unit tests observe.
 * The tests substitute these mocks for the real `bot` module; only the fields
 * the assertions read are modelled.
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

export type SendMessageParams = {
  chat_id: number | string;
  text: string;
  parse_mode?: string;
  reply_markup?: ReplyKeyboard;
  disable_notification?: boolean;
  reply_parameters?: { message_id: number };
};

export type SendMessageArgs = (
  params: SendMessageParams,
) => Promise<{ message_id: number }>;

export type SendMessageMock = Mock<SendMessageArgs>;

/** `bot.api.sendMessage` stand-in whose recorded calls keep their params. */
export const createSendMessageMock = (messageId = 1): SendMessageMock =>
  vi.fn<SendMessageArgs>(async () => ({ message_id: messageId }));

/** The recorded call's params, failing loudly when there is no call. */
export const sentMessage = (
  mock: SendMessageMock,
  index = 0,
): SendMessageParams => {
  const call = mock.mock.calls[index];
  if (!call) {
    throw new Error(`sendMessage was not called ${index + 1} time(s)`);
  }
  return call[0];
};

/** The reply keyboard of a recorded call, failing loudly if none was sent. */
export const replyKeyboard = (params: {
  reply_markup?: ReplyKeyboard;
}): ReplyKeyboard => {
  if (!params.reply_markup) {
    throw new Error("sendMessage was called without reply_markup");
  }
  return params.reply_markup;
};

export type RegisteredHandler = (payload: unknown) => unknown;
export type CommandArgs = (
  command: string,
  handler: RegisteredHandler,
) => unknown;
export type HearsArgs = (
  pattern: RegExp,
  handler: RegisteredHandler,
) => unknown;
export type OnArgs = (event: string, handler: RegisteredHandler) => unknown;

/** `bot.command(name, handler)` stand-in, capturing both arguments. */
export const createCommandMock = (): Mock<CommandArgs> => vi.fn<CommandArgs>();

/** `bot.hears(pattern, handler)` stand-in, capturing both arguments. */
export const createHearsMock = (): Mock<HearsArgs> => vi.fn<HearsArgs>();

/** `bot.on(event, handler)` stand-in, capturing both arguments. */
export const createOnMock = (): Mock<OnArgs> => vi.fn<OnArgs>();

/** The handler registered for the command `command`. */
export const registeredCommandHandler = <T extends RegisteredHandler>(
  mock: Mock<CommandArgs>,
  command: string,
): T => {
  const call = mock.mock.calls.find(([name]) => name === command);
  if (!call) throw new Error(`no handler registered for /${command}`);
  return call[1] as unknown as T;
};

/** The first `hears` handler; the roll regex is the only one in these tests. */
export const firstHearsHandler = <T extends RegisteredHandler>(
  mock: Mock<HearsArgs>,
): T => {
  const call = mock.mock.calls[0];
  if (!call) throw new Error("no hears handler registered");
  return call[1] as unknown as T;
};

/** The handler registered for the bot event `event`. */
export const registeredEventHandler = <T extends RegisteredHandler>(
  mock: Mock<OnArgs>,
  event: string,
): T => {
  const call = mock.mock.calls.find(([name]) => name === event);
  if (!call) throw new Error(`no handler registered for ${event}`);
  return call[1] as unknown as T;
};

/**
 * The slice of a v2 `Context` the handlers read.
 *
 * `reply` is wired to the same `api.sendMessage` the real context uses, so a
 * test can assert one call shape whether the handler replied through `ctx` or
 * through `bot.api`.
 */
export interface TestContext {
  message?: unknown;
  match?: string | RegExpMatchArray;
  callbackQuery?: { id: string };
  reply: (
    text: string,
    options?: Omit<SendMessageParams, "chat_id" | "text">,
  ) => Promise<{ message_id: number }>;
  answerCallbackQuery: (options?: {
    text?: string;
    show_alert?: boolean;
  }) => Promise<unknown>;
}

export const contextFor = ({
  message,
  match,
  callbackQuery,
  api,
}: {
  message?: {
    chat: { id: number | string; type?: string };
    [key: string]: unknown;
  };
  match?: string | RegExpMatchArray;
  callbackQuery?: { id: string };
  api: {
    sendMessage: SendMessageMock;
    answerCallbackQuery?: Mock<
      (params: {
        callback_query_id: string;
        text?: string;
        show_alert?: boolean;
      }) => Promise<unknown>
    >;
  };
}): TestContext => ({
  message,
  match,
  callbackQuery,
  reply: (text, options = {}) => {
    if (!message) {
      return Promise.reject(new Error("the update has no chat"));
    }
    return api.sendMessage({ chat_id: message.chat.id, text, ...options });
  },
  answerCallbackQuery: (options = {}) =>
    api.answerCallbackQuery
      ? api.answerCallbackQuery({
          callback_query_id: callbackQuery?.id ?? "cb",
          ...options,
        })
      : Promise.resolve(true),
});
