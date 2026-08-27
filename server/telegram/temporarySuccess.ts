import type { Context } from "telegraf";
import { getGroupEventNotificationPreferences } from "./groupEventPreferences";
import { findGroupByChatId, recordRecentGroupMessage } from "./repository";

const DEFAULT_TEMPORARY_SUCCESS_DELAY_MS = 5_000;
const MAX_INLINE_WAIT_MS = 60_000;

type TelegramDeleter = Pick<Context["telegram"], "deleteMessage">;

export function telegramMessageId(message: unknown) {
  return message && typeof message === "object" && "message_id" in message && typeof message.message_id === "number"
    ? message.message_id
    : undefined;
}

/**
 * Waits within the active Telegram update, then removes a short-lived success
 * acknowledgement. It deliberately avoids a persistent in-process timer.
 */
export async function deleteTemporaryCommandSuccess(input: {
  telegram: TelegramDeleter;
  chatId?: number;
  messageId?: number;
  groupId?: number;
  delayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  if (!input.chatId || !input.messageId) return false;
  let configuredDelayMs = input.delayMs;
  let groupId = input.groupId;
  if (configuredDelayMs === undefined) {
    try {
      const group = groupId ? { id: groupId } : await findGroupByChatId(input.chatId);
      if (group) {
        groupId = group.id;
        configuredDelayMs = (await getGroupEventNotificationPreferences(group.id)).temporarySuccessDeleteDelaySeconds * 1_000;
      }
    } catch {
      configuredDelayMs = undefined;
    }
  }
  const delayMs = configuredDelayMs ?? DEFAULT_TEMPORARY_SUCCESS_DELAY_MS;
  // Longer delays remain in the durable outbound-message queue. Holding a
  // serverless request open for minutes or hours is intentionally avoided.
  if (delayMs > MAX_INLINE_WAIT_MS) {
    if (!groupId) return false;
    await recordRecentGroupMessage({ groupId, messageId: input.messageId, autoDeleteAt: new Date(Date.now() + delayMs) });
    return true;
  }
  const wait = input.wait ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  await wait(delayMs);
  try {
    await input.telegram.deleteMessage(input.chatId, input.messageId);
    return true;
  } catch {
    return false;
  }
}
