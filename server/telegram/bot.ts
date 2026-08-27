import { Telegraf, type Context } from "telegraf";
import type { Telegram } from "telegraf";
import type { Update } from "telegraf/types";
import { alertOwner } from "./alerts";
import { isOwnerTelegramId, resolveAccessLevel } from "./authorization";
import { BOT_NAME, OWNER_TELEGRAM_ID } from "./constants";
import { applyChatMemberForcedJoinLock, enforceNewGroupMemberForcedJoin, ensureForcedJoinAccess } from "./forcedJoin";
import { advanceStagedBotPrivateForcedJoinDraft, createStagedBotPrivateForcedJoinDraft, finalizedBotPrivateForcedJoinDraft, FORCED_JOIN_MANAGER_CALLBACKS, forcedJoinAddPrompt, forcedJoinManagerKeyboard, forcedJoinManagerMenuText, forcedJoinRemovalKeyboard, formatBotPrivateForcedJoinList, listBotPrivateForcedJoinChannels, removeBotPrivateForcedJoinChannel, saveBotPrivateForcedJoinChannel, stagedForcedJoinConfirmationKeyboard, stagedForcedJoinConfirmationText, type StagedBotPrivateForcedJoinDraft } from "./forcedJoinManager";
import { forcedJoinDestinationErrorMessage, resolveForcedJoinDestinationReference } from "./forcedJoinDestination";
import { handleCleanupCommand, handleCleanupConfirmation } from "./cleanup";
import { handleGroupLockCommand, handleLockCommand, handleLockStatusCommand } from "./locks";
import { handleModerationCommand, handleUserPanelLastUpdatedCallback, handleUserPanelRefreshCallback } from "./moderation";
import { enrichTelegramApiPayloadWithPremiumEmoji } from "./premiumEmoji";
import { consumePrivateLinkTransfer, handleGroupLinkCommand, handleGroupLinkModeCallback, handleGroupStatusCommand, isAnonymousGroupAdministratorLinkMessage } from "./groupInfo";
import { handleGroupJoinOrLeave, handleGroupMessageSafety } from "./groupSafety";
import { handleRoleCleanupConfirmation, handleRoleListCleanupCallback, handleRoleListPageCallback, handleRoleManagementCommand, handleRoleManagementConfirmation } from "./roleManagement";
import { handleAdministratorTitleCommand } from "./administratorTitles";
import { handleStatisticsCallback, handleStatisticsCommand } from "./statistics";
import { handleTagCallback, handleTagCommand, handleTagConfirmation, handleTagDraftInput } from "./groupTagging";
import { configureTelegramProduction, groupActivationKeyboard, groupActivationMessage, groupActivationMessageOptions, groupPermissionRequiredMessage, shouldAnnounceBotMembershipTransition, type TelegramProductionClient } from "./productionSetup";
import { normalizeLocale, translate } from "./i18n";
import { createPersistentKeyboardHandlers, getTelegramMiniAppUrl, kronosPersistentKeyboard, languageSelectorKeyboard, miniAppLaunchKeyboard, PERSISTENT_KEYBOARD_ACTIONS, QUICK_HELP_MESSAGE } from "./persistentKeyboard";
import { handleInlineControlCenterCallback, sendInlineControlCenter } from "./inlineControlCenter";
import { beginNumericIdConversion, beginNumericIdConversionForKind, handleKnownNumericIdAction, handleNativeNumericIdSelection, handleNumericIdAction, handleNumericIdConfirmation, handleNumericIdText } from "./numericIdConversion";
import { approveStarsPreCheckout, handleMarketplaceOrder, reviewManualOrder, settleSuccessfulStarsPayment, submitManualReceipt } from "../payments/marketplace";
import { findGroupByChatId, finishWebhookEvent, getPreferredLocale, recordGroupMemberFlow, recordGroupUserActivity, recordKnownGroupMember, recordRecentGroupMessage, recordTelegramUser, registerTelegramGroup, setPreferredLocale, setTelegramGroupStatus, startWebhookEvent, writeAuditLog } from "./repository";
import { withTelegramRetry } from "./retry";
import { groupCommandAvailabilityReply, isGroupSetupAccessLevelAllowed, isGroupSetupCommand, isLikelyManagedGroupCommand, shouldRejectMissingGroupActor, shouldRejectUnavailableManagedGroupCommand, UNKNOWN_GROUP_ACTOR_REPLY } from "./groupCommandGuard";
import { recordGroupAuditEvent } from "./policyAudit";
import { buildBotHandlerErrorDetails, classifyBotHandlerError } from "./botError";
import { notifyGroupEvent } from "./groupEventNotifier";
import { getGroupEventNotificationPreferences } from "./groupEventPreferences";
import { handleAutoDeleteDelayCommand } from "./autoDeleteSettings";
import { handleMarketCommand, handleMarketPriceCallback } from "./marketCommands";
import { bootstrapTelegramGroupAuthorities, canBootstrapTelegramGroupRoles, groupRoleBootstrapProgressMessage } from "./groupRoleBootstrap";
import { scheduleGroupActivationMessageAutoDelete } from "./activationMessageCleanup";

let bot: Telegraf<Context> | undefined;
let bootPromise: Promise<void> | undefined;
const START_TYPING_DELAY_MS = 360;

function groupEventIdentity(user?: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean }) {
  if (!user) return undefined;
  return {
    telegramUserId: user.id,
    displayName: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || String(user.id),
    username: user.username,
    isBot: user.is_bot,
  };
}

function groupEventKey(ctx: Context, groupId: number, change: string, subjectTelegramId?: number) {
  const message = ctx.message as { message_id?: number } | undefined;
  return `telegram-group-event:${groupId}:${change}:${message?.message_id ?? ctx.update.update_id}:${subjectTelegramId ?? "none"}`;
}

function isTelegramAdministratorStatus(status: string) {
  return status === "administrator" || status === "creator";
}

function isMutedTelegramMember(member: { status: string; can_send_messages?: boolean }) {
  return member.status === "restricted" && member.can_send_messages === false;
}

function messageActivityMedia(message: Record<string, unknown>) {
  const sticker = message.sticker as { is_animated?: boolean } | undefined;
  return {
    photos: "photo" in message ? 1 : 0,
    videos: "video" in message ? 1 : 0,
    videoNotes: "video_note" in message ? 1 : 0,
    animations: "animation" in message ? 1 : 0,
    documents: "document" in message ? 1 : 0,
    audios: "audio" in message ? 1 : 0,
    stickers: "sticker" in message ? 1 : 0,
    animatedStickers: sticker?.is_animated ? 1 : 0,
    voices: "voice" in message ? 1 : 0,
    forwardedMessages: "forward_origin" in message || "forward_from" in message || "forward_from_chat" in message ? 1 : 0,
  };
}

function outboundTelegramChatId(payload?: Record<string, unknown>) {
  const value = payload?.chat_id;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function outboundTelegramMessageIds(method: string, result: unknown) {
  if (!/^(send|forward|copy)/i.test(method)) return [];
  const entries = Array.isArray(result) ? result : [result];
  return entries.flatMap(entry => {
    if (!entry || typeof entry !== "object" || !("message_id" in entry)) return [];
    const messageId = (entry as { message_id?: unknown }).message_id;
    return typeof messageId === "number" && Number.isSafeInteger(messageId) ? [messageId] : [];
  });
}

/** Records every bot-authored group message returned by Telegram so cleanup can target it and automatic expiry can use its group's configured delay. */
export async function recordOutboundGroupMessages(input: {
  method: string;
  payload?: Record<string, unknown>;
  result: unknown;
  findGroupByChatId: typeof findGroupByChatId;
  recordRecentGroupMessage: typeof recordRecentGroupMessage;
  getGroupEventNotificationPreferences?: typeof import("./groupEventPreferences").getGroupEventNotificationPreferences;
}) {
  const chatId = outboundTelegramChatId(input.payload);
  const messageIds = outboundTelegramMessageIds(input.method, input.result);
  if (!chatId || !messageIds.length) return;
  const group = await input.findGroupByChatId(chatId);
  if (!group) return;
  const preferences = await (input.getGroupEventNotificationPreferences?.(group.id) ?? getGroupEventNotificationPreferences(group.id));
  const autoDeleteAt = new Date(Date.now() + preferences.botMessageAutoDeleteDelaySeconds * 1_000);
  await Promise.all(messageIds.map(messageId => input.recordRecentGroupMessage({ groupId: group.id, messageId, autoDeleteAt })));
}

/** Receipt media is also group content; never consume the update before safety middleware sees it. */
export async function passMediaThroughReceipt<T>(ctx: T, next: () => unknown | Promise<unknown>, receiptHandler: (ctx: T) => unknown | Promise<unknown>) {
  await receiptHandler(ctx);
  return next();
}

export function getTelegramBot() {
  return bot;
}

async function notifyAffectedTelegramUser(telegram: Telegram, telegramUserId: number | undefined, chatId: number, status: string) {
  if (!telegramUserId || telegramUserId === 0) return;
  try {
    await withTelegramRetry(() => telegram.sendMessage(telegramUserId, `⚠️ دسترسی ربات به گروه «${chatId}» قطع شد. وضعیت ربات اکنون «${status}» است. برای ادامهٔ استفاده، ربات را دوباره به‌عنوان مدیر گروه اضافه کنید و مجوزهای لازم را فعال کنید.`));
    await writeAuditLog({ category: "bot_membership", event: "permission_notice_private_sent", details: { chatId, status, telegramUserId } });
  } catch (error) {
    await writeAuditLog({ severity: "warning", category: "bot_membership", event: "permission_notice_private_failed", details: { chatId, status, telegramUserId, error: error instanceof Error ? error.message : String(error) } });
  }
}

function hasConfiguredToken() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.includes(":"));
}

/** Initializes handlers but never starts long polling; all production updates arrive through the protected webhook. */
export async function initializeTelegramBot(): Promise<void> {
  if (bootPromise) return bootPromise;
  const initialization = (async () => {
    if (!hasConfiguredToken()) {
      throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    }

    const instance = new Telegraf<Context>(process.env.TELEGRAM_BOT_TOKEN!);
    const originalCallApi = instance.telegram.callApi.bind(instance.telegram);
    instance.telegram.callApi = (async (method: string, payload?: Record<string, unknown>, options?: unknown) => {
      const result = await originalCallApi(method as never, enrichTelegramApiPayloadWithPremiumEmoji(method, payload) as never, options as never);
      await recordOutboundGroupMessages({
        method,
        payload,
        result,
        findGroupByChatId,
        recordRecentGroupMessage,
      }).catch(error => console.warn("[Kronos Guard] could not record an outbound group message", error));
      return result;
    }) as typeof instance.telegram.callApi;
    const pendingForcedJoinDrafts = new Map<number, StagedBotPrivateForcedJoinDraft>();
    instance.catch(async (error, ctx) => {
      const details = buildBotHandlerErrorDetails(error, {
        updateId: ctx.update.update_id,
        updateType: ctx.updateType,
        chatId: ctx.chat?.id,
        actorTelegramId: ctx.from?.id,
      });
      const kind = classifyBotHandlerError(error);
      console.error("[Kronos Guard] bot handler error", details);
      await writeAuditLog({
        severity: kind === "expected_telegram_edge_case" ? "warning" : "critical",
        category: "bot",
        event: kind === "expected_telegram_edge_case" ? "telegram_edge_case" : kind === "transient_telegram_error" ? "telegram_transient_error" : "handler_error",
        actorTelegramId: ctx.from?.id,
        details,
      });
      if (kind === "unexpected_handler_error") {
        await alertOwner(instance.telegram, {
          alertType: "webhook_problem",
          severity: "critical",
          title: "خطای پردازش آپدیت تلگرام",
          body: `یک آپدیت تلگرام با خطا مواجه شد. نوع خطا: ${details.message}`,
          dedupeKey: `bot-handler-${new Date().toISOString().slice(0, 13)}`,
        });
      }
    });

    instance.use(async (ctx, next) => {
      if (ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup") && ctx.from && ctx.message && "message_id" in ctx.message) {
        const serviceMessage = "new_chat_members" in ctx.message;
        const addedMembers = serviceMessage ? ctx.message.new_chat_members.length : 0;
        const activityGroup = await findGroupByChatId(ctx.chat.id);
        if (activityGroup) {
          void Promise.all([
            recordGroupUserActivity({
              groupId: activityGroup.id,
              telegramUserId: ctx.from.id,
              messages: serviceMessage ? 0 : 1,
              addedMembers,
              ...messageActivityMedia(ctx.message as unknown as Record<string, unknown>),
            }),
            recordRecentGroupMessage({ groupId: activityGroup.id, messageId: ctx.message.message_id, senderTelegramId: ctx.from.id }),
          ]).catch(error => console.warn("[Kronos Guard] activity telemetry failed", error));
        }
      }
      if (ctx.from) {
        // Any private interaction proves the user has opened the bot, including clients
        // that did not preserve the original /start update in webhook delivery.
        void recordTelegramUser(ctx.from, ctx.chat?.type === "private" ? { startedBot: true } : undefined)
          .catch(error => console.warn("[Kronos Guard] user telemetry failed", error));
      }
      if (ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
        void registerTelegramGroup(ctx.chat)
          .then(group => group && ctx.from ? recordKnownGroupMember({ groupId: group.id, telegramUserId: ctx.from.id }) : undefined)
          .catch(error => console.warn("[Kronos Guard] group telemetry failed", error));
      }
      return next();
    });

    instance.use(async (ctx, next) => {
      const callbackQuery = "callbackQuery" in ctx.update ? ctx.callbackQuery : undefined;
      const callbackData = callbackQuery && "data" in callbackQuery ? callbackQuery.data : undefined;
      if (callbackData && ctx.from && ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) {
        const callbackGroup = await findGroupByChatId(ctx.chat.id);
        if (callbackGroup) {
          void recordGroupAuditEvent({
            groupId: callbackGroup.id,
            actorTelegramId: ctx.from.id,
            action: "callback.dispatch.received",
            outcome: "allowed",
            details: { callback: callbackData.slice(0, 96) },
          });
        }
      }
      const targetedVerification = callbackData?.match(/^forced_join:verify:(\d+)$/);
      if (targetedVerification && ctx.from) {
        const targetTelegramUserId = Number(targetedVerification[1]);
        if (ctx.from.id !== targetTelegramUserId && !isOwnerTelegramId(ctx.from.id)) {
          await ctx.answerCbQuery();
          return;
        }
      }
      if (!(await ensureForcedJoinAccess(ctx))) return;
      return next();
    });

    instance.action(/^forced_join:verify(?::(\d+))?$/, async ctx => {
      const targetTelegramUserId = Number(ctx.match[1] ?? ctx.from?.id ?? 0);
      // The preceding guard re-checks membership and reaches this callback only after verification succeeds.
      const locale = await getPreferredLocale(ctx.from?.id ?? 0);
      if (ctx.from && ctx.from.id !== targetTelegramUserId && isOwnerTelegramId(ctx.from.id)) {
        await ctx.answerCbQuery();
        return;
      }
      await ctx.answerCbQuery(translate(locale, "membershipVerified"));
      const successText = `✅ ${translate(locale, "membershipVerified")}`;
      try {
        // Replace the blocked prompt and remove its join buttons in one Telegram edit.
        await ctx.editMessageText(successText, { reply_markup: { inline_keyboard: [] } });
      } catch (error) {
        // A user may have deleted or otherwise made the previous prompt uneditable.
        // Membership is still verified; never leave their private chat without the success state.
        console.warn("[Kronos Guard] could not replace forced-join prompt after successful verification", error);
        await ctx.reply(successText, kronosPersistentKeyboard());
      }
    });

    instance.start(async ctx => {
      if (ctx.chat?.type === "private" && ctx.from) await recordTelegramUser(ctx.from, { startedBot: true });
      const privateLinkPayload = typeof ctx.startPayload === "string" ? consumePrivateLinkTransfer(ctx.startPayload) : null;
      if (privateLinkPayload && ctx.chat?.type === "private") {
        await withTelegramRetry(() => ctx.reply(privateLinkPayload, { parse_mode: "HTML" as const, ...kronosPersistentKeyboard() }));
        return;
      }
      const nativePayload = typeof ctx.startPayload === "string" ? ctx.startPayload.match(/^numeric_native_(channel|group|user|bot)$/) : null;
      if (nativePayload) {
        await beginNumericIdConversionForKind(ctx, nativePayload[1] as "channel" | "group" | "user" | "bot");
        return;
      }
      const locale = await getPreferredLocale(ctx.from?.id ?? 0);
      await withTelegramRetry(() => ctx.sendChatAction("typing"));
      await new Promise(resolve => setTimeout(resolve, START_TYPING_DELAY_MS));
      const welcomeOptions = ctx.chat?.type === "private"
        ? { parse_mode: "HTML" as const, ...kronosPersistentKeyboard() }
        : { parse_mode: "HTML" as const };
      await withTelegramRetry(() => ctx.reply(translate(locale, "welcome"), welcomeOptions));
      if (ctx.chat?.type === "private") {
        await withTelegramRetry(() => ctx.reply("برای مدیریت گروه‌ها، تیکت‌ها و ابزارهای حرفه‌ای Kronos Guard، Mini App را باز کنید.", miniAppLaunchKeyboard()));
      }
    });

    instance.command("help", async ctx => {
      await ctx.reply(QUICK_HELP_MESSAGE, kronosPersistentKeyboard());
    });

    const keyboardHandlers = createPersistentKeyboardHandlers({
      getLocale: getPreferredLocale,
      languagePrompt: locale => translate(locale, "languageSelector"),
      languageSelector: languageSelectorKeyboard,
      keyboard: kronosPersistentKeyboard,
      beginNumericIdConversion,
    });
    for (const action of Object.values(PERSISTENT_KEYBOARD_ACTIONS)) {
      if (action === PERSISTENT_KEYBOARD_ACTIONS.forcedJoin || action === PERSISTENT_KEYBOARD_ACTIONS.dashboard) continue;
      instance.hears(action, keyboardHandlers[action]);
    }
    instance.hears(PERSISTENT_KEYBOARD_ACTIONS.dashboard, async ctx => {
      if (ctx.chat?.type !== "private") return;
      await sendInlineControlCenter(ctx);
    });

    // Telegram may keep an older persistent keyboard after a label update. Keep the
    // previous dashboard label routed to the current handler so cached clients do not
    // appear unresponsive while they receive the refreshed keyboard.
    instance.hears("پنل مدیریت", async ctx => {
      if (ctx.chat?.type !== "private") return;
      await sendInlineControlCenter(ctx);
    });

    instance.hears(PERSISTENT_KEYBOARD_ACTIONS.forcedJoin, async ctx => {
      if (ctx.chat?.type !== "private") return;
      if (!isOwnerTelegramId(ctx.from?.id)) {
        await ctx.reply("مدیریت عضویت اجباری فقط برای مالک Kronos Guard فعال است. اگر کانال اجباری وجود داشته باشد، عضویت شما هنگام استفاده از ربات به‌صورت زنده بررسی می‌شود.", kronosPersistentKeyboard());
        return;
      }
      await ctx.reply(forcedJoinManagerMenuText(), forcedJoinManagerKeyboard());
    });

    instance.action(FORCED_JOIN_MANAGER_CALLBACKS.open, async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id) || ctx.chat?.type !== "private") return;
      await ctx.answerCbQuery();
      await ctx.editMessageText(forcedJoinManagerMenuText(), forcedJoinManagerKeyboard());
    });

    instance.action(FORCED_JOIN_MANAGER_CALLBACKS.add, async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id) || ctx.chat?.type !== "private" || !ctx.from) return;
      pendingForcedJoinDrafts.set(ctx.from.id, createStagedBotPrivateForcedJoinDraft());
      await ctx.answerCbQuery("شناسهٔ کانال را ارسال کنید");
      await ctx.editMessageText(forcedJoinAddPrompt());
    });

    instance.action(FORCED_JOIN_MANAGER_CALLBACKS.cancel, async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id) || ctx.chat?.type !== "private" || !ctx.from) return;
      pendingForcedJoinDrafts.delete(ctx.from.id);
      await ctx.answerCbQuery("فرم لغو شد");
      await ctx.editMessageText("افزودن کانال لغو شد.", forcedJoinManagerKeyboard());
    });

    instance.action(FORCED_JOIN_MANAGER_CALLBACKS.confirm, async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id) || ctx.chat?.type !== "private" || !ctx.from) return;
      const stagedDraft = pendingForcedJoinDrafts.get(ctx.from.id);
      const draft = stagedDraft && stagedDraft.expiresAt >= Date.now() ? finalizedBotPrivateForcedJoinDraft(stagedDraft) : null;
      if (!draft) {
        pendingForcedJoinDrafts.delete(ctx.from.id);
        await ctx.answerCbQuery("فرم منقضی شده است", { show_alert: true });
        await ctx.editMessageText("فرم افزودن کانال منقضی یا ناقص است. دوباره از «افزودن کانال» شروع کنید.", forcedJoinManagerKeyboard());
        return;
      }
      try {
        const chat = await ctx.telegram.getChat(draft.channelChatId);
        if (chat.type !== "channel") throw new Error("target is not a channel");
        const botIdentity = await ctx.telegram.getMe();
        const botMembership = await ctx.telegram.getChatMember(draft.channelChatId, botIdentity.id);
        if (!["creator", "owner", "administrator"].includes(botMembership.status)) throw new Error("bot is not a channel administrator");
        const channelTitle = "title" in chat ? chat.title : undefined;
        const saved = await saveBotPrivateForcedJoinChannel(draft, ctx.from.id, channelTitle);
        pendingForcedJoinDrafts.delete(ctx.from.id);
        const expiry = saved.expiresAt ? saved.expiresAt.toLocaleDateString("fa-IR") : "دائمی";
        await ctx.answerCbQuery("کانال ذخیره شد");
        await ctx.editMessageText(`کانال «${draft.buttonLabel}» ${saved.created ? "اضافه" : "به‌روزرسانی"} شد. پایان الزام عضویت: ${expiry}`, forcedJoinManagerKeyboard());
      } catch (error) {
        console.warn("[Kronos Guard] forced-join private channel verification failed", error);
        await ctx.answerCbQuery("کانال قابل بررسی نیست", { show_alert: true });
      }
    });

    instance.action(FORCED_JOIN_MANAGER_CALLBACKS.list, async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id) || ctx.chat?.type !== "private") return;
      const channels = await listBotPrivateForcedJoinChannels();
      await ctx.answerCbQuery();
      await ctx.editMessageText(formatBotPrivateForcedJoinList(channels), forcedJoinRemovalKeyboard(channels));
    });

    instance.action(new RegExp(`^${FORCED_JOIN_MANAGER_CALLBACKS.removePrefix}(\\d+)$`), async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id) || ctx.chat?.type !== "private" || !ctx.from) return;
      const channelId = Number(ctx.match[1]);
      const result = await removeBotPrivateForcedJoinChannel(channelId, ctx.from.id);
      const channels = await listBotPrivateForcedJoinChannels();
      await ctx.answerCbQuery(result.removed ? "کانال حذف شد" : "کانال پیدا نشد");
      await ctx.editMessageText(formatBotPrivateForcedJoinList(channels), forcedJoinRemovalKeyboard(channels));
    });

    instance.action(FORCED_JOIN_MANAGER_CALLBACKS.close, async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id) || ctx.chat?.type !== "private") return;
      await ctx.answerCbQuery();
      await ctx.editMessageText("مدیریت عضویت اجباری بسته شد. برای بازگشت، از دکمهٔ «عضویت اجباری» استفاده کنید.");
    });

    instance.command("language", async ctx => {
      const raw = (ctx.message && "text" in ctx.message) ? ctx.message.text.split(/\s+/)[1] : undefined;
      if (!raw) {
        const locale = await getPreferredLocale(ctx.from?.id ?? 0);
        await ctx.reply(translate(locale, "languageSelector"), languageSelectorKeyboard());
        return;
      }
      const locale = normalizeLocale(raw);
      if (locale !== raw.toLocaleLowerCase("en-US").split(/[-_]/)[0]) {
        await ctx.reply(translate("fa", "languageSelector"), languageSelectorKeyboard());
        return;
      }
      if (ctx.from) await setPreferredLocale(ctx.from.id, locale);
      await ctx.reply(`✅ ${translate(locale, "languageUpdated")}`, kronosPersistentKeyboard());
    });

    instance.on("message", async (ctx, next) => {
      if (await handleNativeNumericIdSelection(ctx)) return;
      return next();
    });

    instance.action(/^cc:/, async ctx => { await handleInlineControlCenterCallback(ctx as never); });
    instance.action("user-panel-last-updated", async ctx => { await handleUserPanelLastUpdatedCallback(ctx as never); });
    instance.action(/^user-panel-refresh:/, async ctx => { await handleUserPanelRefreshCallback(ctx as never); });
    instance.action(/^numeric-id:/, async ctx => { await handleNumericIdAction(ctx); });
    instance.action(/^numeric-known:/, async ctx => { await handleKnownNumericIdAction(ctx); });
    instance.action(/^numeric-confirm:/, async ctx => { await handleNumericIdConfirmation(ctx); });
    instance.action(/^language:([a-z]{2})$/, async ctx => {
      const requested = ctx.match[1];
      const locale = normalizeLocale(requested);
      if (locale !== requested) {
        await ctx.answerCbQuery(translate("fa", "languageHelp"), { show_alert: true });
        return;
      }
      if (ctx.from) await setPreferredLocale(ctx.from.id, locale);
      await ctx.answerCbQuery(translate(locale, "languageUpdated"));
      await ctx.editMessageText(`✅ ${translate(locale, "languageUpdated")}`, languageSelectorKeyboard());
    });

    instance.action(/^group-link:/, async ctx => { await handleGroupLinkModeCallback(ctx as never); });

    instance.action(/^tag-confirm:/, async ctx => {
      await handleTagConfirmation(ctx as never);
    });
    instance.action(/^tag:/, async ctx => {
      await handleTagCallback(ctx as never);
    });
    instance.action(/^stats:/, async ctx => {
      await handleStatisticsCallback(ctx as never);
    });
    instance.action(/^market-price:([a-z0-9]{1,32})$/, async ctx => {
      await handleMarketPriceCallback(ctx as never);
    });
    instance.action(/^role-confirm:/, async ctx => {
      await handleRoleManagementConfirmation(ctx as never);
    });
    instance.action(/^role-cleanup-confirm:/, async ctx => {
      await handleRoleCleanupConfirmation(ctx as never);
    });
    instance.action(/^role-list-cleanup:/, async ctx => {
      await handleRoleListCleanupCallback(ctx as never);
    });
    instance.action(/^role-list-page:/, async ctx => {
      await handleRoleListPageCallback(ctx as never);
    });
    instance.action(/^cleanup-confirm:/, async ctx => {
      await handleCleanupConfirmation(ctx as never);
    });
    instance.action("group-role-bootstrap", async ctx => {
      if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") || !ctx.from) return;
      const actor = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id).catch(() => undefined);
      if (!actor || !canBootstrapTelegramGroupRoles(actor.status)) { await ctx.answerCbQuery("این عملیات فقط برای مدیران گروه است.", { show_alert: true }); return; }
      const group = await findGroupByChatId(ctx.chat.id);
      if (!group) { await ctx.answerCbQuery("گروه هنوز آماده نیست. دوباره تلاش کنید.", { show_alert: true }); return; }
      const administrators = await ctx.telegram.getChatAdministrators(ctx.chat.id).catch(() => undefined);
      if (!administrators) { await ctx.answerCbQuery("دریافت فهرست مدیران Telegram ناموفق بود؛ دوباره تلاش کنید.", { show_alert: true }); return; }
      await ctx.answerCbQuery("همگام‌سازی نقش‌ها شروع شد.");
      const chatTitle = "title" in ctx.chat ? ctx.chat.title : "این گروه";
      try {
        const result = await bootstrapTelegramGroupAuthorities({
          groupId: group.id,
          administrators,
          grantedByTelegramId: ctx.from.id,
          restoreSuspensions: true,
          onProgress: async progress => {
            await ctx.editMessageText(groupRoleBootstrapProgressMessage(progress), { parse_mode: "HTML", reply_markup: groupActivationKeyboard() }).catch(() => undefined);
          },
        });
        await writeAuditLog({ category: "role", event: "telegram_administrators_bootstrapped", groupId: group.id, actorTelegramId: ctx.from.id, details: result });
        await ctx.editMessageText(groupActivationMessage(chatTitle), { ...groupActivationMessageOptions(), reply_markup: { inline_keyboard: [] } }).catch(() => undefined);
      } catch (error) {
        await ctx.editMessageText(groupActivationMessage(chatTitle), groupActivationMessageOptions()).catch(() => undefined);
        await ctx.answerCbQuery("همگام‌سازی کامل نشد؛ دوباره تلاش کنید.", { show_alert: true });
        throw error;
      }
    });

    instance.command("owner", async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id)) {
        await ctx.reply("این بخش فقط برای مالک Kronos Guard در دسترس است.");
        return;
      }
      await ctx.reply("دسترسی مالک تأیید شد. تنظیمات سراسری از داشبورد مالک مدیریت می‌شود.");
    });

    instance.command("setup", async ctx => {
      if (!isOwnerTelegramId(ctx.from?.id)) {
        await ctx.reply("این عملیات فقط برای مالک Kronos Guard مجاز است.");
        return;
      }
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
      const rawDomain = text.split(/\s+/)[1];
      try {
        const urls = await configureTelegramProduction({ actorTelegramId: ctx.from?.id, rawDomain, webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET, client: ctx.telegram as unknown as TelegramProductionClient });
        await ctx.reply(`✅ وبهوک و دکمه مینی‌اپ مالک تنظیم شد.\n${urls.miniAppUrl}`);
      } catch (error) {
        console.error("[Kronos Guard] production setup failed", error);
        await ctx.reply(rawDomain ? "تنظیم تولید ناموفق بود. یک دامنه عمومی HTTPS معتبر وارد کنید و وضعیت استقرار را بررسی کنید." : "بعد از انتشار، دامنه HTTPS را بفرستید: /setup https://your-domain.example");
      }
    });

    instance.command("channel", async ctx => {
      await handleMarketplaceOrder(ctx);
    });

    instance.command("payapprove", async ctx => {
      await reviewManualOrder(ctx, "approve");
    });

    instance.command("payreject", async ctx => {
      await reviewManualOrder(ctx, "reject");
    });

    instance.on("pre_checkout_query", async ctx => {
      await approveStarsPreCheckout(ctx);
    });

    instance.on("successful_payment", async ctx => {
      await settleSuccessfulStarsPayment(ctx);
    });

    instance.on("photo", async (ctx, next) => passMediaThroughReceipt(ctx, next, submitManualReceipt));

    instance.on("document", async (ctx, next) => passMediaThroughReceipt(ctx, next, submitManualReceipt));

    instance.on("text", async (ctx, next) => {
      const stagedDraft = ctx.from ? pendingForcedJoinDrafts.get(ctx.from.id) : undefined;
      if (ctx.chat.type === "private" && ctx.from && isOwnerTelegramId(ctx.from.id) && stagedDraft) {
        if (stagedDraft.expiresAt < Date.now()) {
          pendingForcedJoinDrafts.delete(ctx.from.id);
          await ctx.reply("مهلت افزودن کانال تمام شد. دوباره از دکمهٔ «عضویت اجباری» و سپس «افزودن کانال» استفاده کنید.");
          return;
        }
        if (ctx.message.text.trim().toLocaleLowerCase("fa-IR") === "لغو" || ctx.message.text.trim().toLocaleLowerCase("en-US") === "cancel") {
          pendingForcedJoinDrafts.delete(ctx.from.id);
          await ctx.reply("افزودن کانال لغو شد.", forcedJoinManagerKeyboard());
          return;
        }
        let draftInput = ctx.message.text;
        if (stagedDraft.step === "channelChatId") {
          try {
            const destination = await resolveForcedJoinDestinationReference(ctx.telegram, ctx.message.text);
            draftInput = String(destination.channelChatId);
          } catch (error) {
            await ctx.reply(`⛔ ${forcedJoinDestinationErrorMessage(error)}\n\n${forcedJoinAddPrompt()}`);
            return;
          }
        }
        const progressed = advanceStagedBotPrivateForcedJoinDraft(stagedDraft, draftInput);
        if (!progressed.ok) {
          await ctx.reply(`⛔ ${progressed.error}\n\n${stagedDraft.step === "confirm" ? "از دکمه‌های تأیید یا لغو استفاده کنید." : forcedJoinAddPrompt()}`);
          return;
        }
        pendingForcedJoinDrafts.set(ctx.from.id, progressed.draft);
        if (progressed.complete) {
          const draft = finalizedBotPrivateForcedJoinDraft(progressed.draft);
          if (draft) await ctx.reply(stagedForcedJoinConfirmationText(draft), stagedForcedJoinConfirmationKeyboard());
          return;
        }
        await ctx.reply(progressed.prompt);
        return;
      }
      if (ctx.chat.type === "private" && await handleNumericIdText(ctx)) return;
      if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") {
        if (await handleGroupMessageSafety(ctx)) return;
        if (isGroupSetupCommand(ctx.message.text)) {
          const group = await registerTelegramGroup(ctx.chat);
          if (!group) {
            await ctx.reply("راه‌اندازی گروه انجام نشد؛ اتصال دیتابیس را بررسی کنید.");
            return;
          }
          if (!ctx.from) {
            await ctx.reply(UNKNOWN_GROUP_ACTOR_REPLY);
            return;
          }
          const access = await resolveAccessLevel({ groupId: group.id, groupChatId: ctx.chat.id, telegramUserId: ctx.from.id }, ctx.telegram);
          if (!isGroupSetupAccessLevelAllowed(access)) {
            await ctx.reply("⛔ راه‌اندازی گروه فقط برای مدیران مجاز گروه یا مقام‌های مدیریتی Kronos Guard فعال است.");
            return;
          }
          await setTelegramGroupStatus(ctx.chat.id, "active");
          await ctx.reply("✅ گروه با موفقیت راه‌اندازی شد. تنظیمات پیش‌فرض فعال است و مدیران می‌توانند مدیریت را ادامه دهند.");
          return;
        }
      }
      if (shouldRejectMissingGroupActor({ chatType: ctx.chat.type, actorId: ctx.from?.id, text: ctx.message.text }) && !isAnonymousGroupAdministratorLinkMessage(ctx)) {
        await ctx.reply(UNKNOWN_GROUP_ACTOR_REPLY);
        return;
      }
      if (isLikelyManagedGroupCommand(ctx.message.text) && ctx.from) {
        const dispatchGroup = await findGroupByChatId(ctx.chat.id);
        if (dispatchGroup) {
          if (shouldRejectUnavailableManagedGroupCommand({ groupStatus: dispatchGroup.status, text: ctx.message.text })) {
            void recordGroupAuditEvent({
              groupId: dispatchGroup.id,
              actorTelegramId: ctx.from.id,
              action: "command.dispatch.rejected_unavailable_group",
              outcome: "denied",
              details: { command: ctx.message.text.trim().slice(0, 96), groupStatus: dispatchGroup.status },
            });
            await ctx.reply(groupCommandAvailabilityReply(dispatchGroup.status));
            return;
          }
          void recordGroupAuditEvent({
            groupId: dispatchGroup.id,
            actorTelegramId: ctx.from.id,
            action: "command.dispatch.received",
            outcome: "allowed",
            details: { command: ctx.message.text.trim().slice(0, 96) },
          });
        }
      }
      if (await handleTagDraftInput(ctx as never)) return;
      if (await handleTagCommand(ctx as never)) return;
      if (await handleStatisticsCommand(ctx as never)) return;
      if (await handleGroupStatusCommand(ctx)) return;
      if (await handleGroupLinkCommand(ctx)) return;
      if (await handleLockStatusCommand(ctx)) return;
      if (await handleAdministratorTitleCommand(ctx)) return;
      if (await handleRoleManagementCommand(ctx)) return;
      if (await handleCleanupCommand(ctx)) return;
      if (await handleAutoDeleteDelayCommand(ctx)) return;
      if (await handleMarketCommand(ctx)) return;
      if (await handleGroupLockCommand(ctx)) return;
      if (await handleLockCommand(ctx)) return;
      if (await handleModerationCommand(ctx)) return;
      return next();
    });

    instance.on(["photo", "video", "video_note", "voice", "audio", "sticker", "document", "animation", "game", "poll", "contact", "location", "venue", "dice"], async (ctx, next) => {
      if (await handleGroupMessageSafety(ctx)) return;
      return next();
    });

    instance.on("edited_message", async (ctx, next) => {
      if (await handleGroupMessageSafety(ctx)) return;
      return next();
    });

    instance.on("new_chat_members", async ctx => {
      const group = await findGroupByChatId(ctx.chat.id);
      if (group) {
        const humanMembers = ctx.message.new_chat_members.filter(member => !member.is_bot);
        await recordGroupMemberFlow({ groupId: group.id, joined: humanMembers.length, manuallyAdded: humanMembers.filter(member => member.id !== ctx.from?.id).length });
        for (const member of ctx.message.new_chat_members) {
          await recordTelegramUser(member);
          await recordKnownGroupMember({ groupId: group.id, telegramUserId: member.id, status: "active" });
          if (!member.is_bot) {
            const manuallyAdded = Boolean(ctx.from && ctx.from.id !== member.id);
            await notifyGroupEvent({
              groupId: group.id,
              eventType: manuallyAdded ? "member.added" : "member.joined",
              actor: groupEventIdentity(ctx.from),
              subject: groupEventIdentity(member),
              details: { summary: manuallyAdded ? "عضو توسط یک مدیر یا عضو دیگر به گروه افزوده شد." : "عضو با ورود مستقیم به گروه اضافه شد." },
              eventKey: groupEventKey(ctx, group.id, manuallyAdded ? "member.added" : "member.joined", member.id),
              telegram: instance.telegram,
            });
          }
        }
      }
      await handleGroupJoinOrLeave(ctx);
      for (const member of ctx.message.new_chat_members) {
        await enforceNewGroupMemberForcedJoin(ctx, member);
      }
    });

    instance.on("left_chat_member", async ctx => {
      const group = await findGroupByChatId(ctx.chat.id);
      if (group) {
        if (!ctx.message.left_chat_member.is_bot) await recordGroupMemberFlow({ groupId: group.id, left: 1 });
        await recordKnownGroupMember({ groupId: group.id, telegramUserId: ctx.message.left_chat_member.id, status: "left" });
        if (!ctx.message.left_chat_member.is_bot) {
          await notifyGroupEvent({
            groupId: group.id,
            eventType: "member.left",
            actor: groupEventIdentity(ctx.from ?? ctx.message.left_chat_member),
            subject: groupEventIdentity(ctx.message.left_chat_member),
            details: { summary: "عضو از گروه خارج شد." },
            eventKey: groupEventKey(ctx, group.id, "member.left", ctx.message.left_chat_member.id),
            telegram: instance.telegram,
          });
        }
      }
      await handleGroupJoinOrLeave(ctx);
    });

    instance.on("pinned_message", async ctx => {
      const group = await findGroupByChatId(ctx.chat.id);
      if (!group) return;
      const pinned = ctx.message.pinned_message as {
        message_id?: number;
        text?: string;
        caption?: string;
        from?: { id: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
      };
      const preview = pinned.text?.trim().slice(0, 160) || pinned.caption?.trim().slice(0, 160) || "پیام رسانه‌ای یا غیرمتنی";
      await notifyGroupEvent({
        groupId: group.id,
        eventType: "message.pinned",
        actor: groupEventIdentity(ctx.from),
        subject: groupEventIdentity(pinned.from),
        details: { summary: preview || "پیام بدون متن" },
        eventKey: groupEventKey(ctx, group.id, "message.pinned", pinned.message_id),
        telegram: instance.telegram,
      });
    });

    instance.on("new_chat_title", async ctx => {
      const group = await findGroupByChatId(ctx.chat.id);
      if (!group) return;
      await notifyGroupEvent({
        groupId: group.id,
        eventType: "group.title_changed",
        actor: groupEventIdentity(ctx.from),
        details: { previousValue: group.title, nextValue: ctx.message.new_chat_title },
        eventKey: groupEventKey(ctx, group.id, "group.title_changed"),
        telegram: instance.telegram,
      });
    });

    instance.on("new_chat_photo", async ctx => {
      const group = await findGroupByChatId(ctx.chat.id);
      if (!group) return;
      await notifyGroupEvent({
        groupId: group.id,
        eventType: "group.photo_changed",
        actor: groupEventIdentity(ctx.from),
        details: { summary: "تصویر نمایهٔ گروه جایگزین شد." },
        eventKey: groupEventKey(ctx, group.id, "group.photo_changed"),
        telegram: instance.telegram,
      });
    });

    instance.on("delete_chat_photo", async ctx => {
      const group = await findGroupByChatId(ctx.chat.id);
      if (!group) return;
      await notifyGroupEvent({
        groupId: group.id,
        eventType: "group.photo_deleted",
        actor: groupEventIdentity(ctx.from),
        details: { summary: "تصویر نمایهٔ گروه حذف شد." },
        eventKey: groupEventKey(ctx, group.id, "group.photo_deleted"),
        telegram: instance.telegram,
      });
    });

    instance.on("my_chat_member", async ctx => {
      const update = ctx.myChatMember;
      const newStatus = update.new_chat_member.status;
      if ((update.chat.type === "group" || update.chat.type === "supergroup") && ["administrator", "creator"].includes(newStatus)) {
        // Bind dashboard visibility to the Telegram user who performed the bot installation.
        // Do not overwrite an existing owner when Telegram emits later membership updates.
        await registerTelegramGroup(update.chat, update.from?.id);
      }
      const previousStatus = update.old_chat_member.status;
      const announcement = shouldAnnounceBotMembershipTransition(previousStatus, newStatus);
      await writeAuditLog({
        severity: ["left", "kicked"].includes(newStatus) ? "warning" : "info",
        category: "bot_membership",
        event: `status_${newStatus}`,
        details: { chatId: update.chat.id, chatType: update.chat.type },
      });
      if (["left", "kicked"].includes(newStatus)) {
        await setTelegramGroupStatus(update.chat.id, "removed");
        await notifyAffectedTelegramUser(instance.telegram, update.from?.id, update.chat.id, newStatus);
        await alertOwner(instance.telegram, {
          alertType: "bot_permission_lost",
          severity: "critical",
          title: "ربات دسترسی گروه را از دست داد",
          body: `Kronos Guard در گفت‌وگو با شناسه ${update.chat.id} حذف یا محدود شد.`,
          dedupeKey: `bot-permission-${update.chat.id}-${newStatus}`,
        });
      } else if (["member", "restricted"].includes(newStatus)) {
        await setTelegramGroupStatus(update.chat.id, "permission_lost");
        await notifyAffectedTelegramUser(instance.telegram, update.from?.id, update.chat.id, newStatus);
        await alertOwner(instance.telegram, {
          alertType: "bot_permission_lost",
          severity: "critical",
          title: "ربات مجوز مدیریتی گروه را از دست داد",
          body: `Kronos Guard در گفت‌وگو با شناسه ${update.chat.id} دیگر مدیر نیست یا محدود شده است. پیش از اجرای فرمان‌های مدیریتی، دسترسی ربات را بازیابی و «راه‌اندازی» را ارسال کنید.`,
          dedupeKey: `bot-permission-${update.chat.id}-${newStatus}`,
        });
      } else if (["administrator", "creator"].includes(newStatus)) {
        await setTelegramGroupStatus(update.chat.id, "active");
      }

      const membershipGroup = (update.chat.type === "group" || update.chat.type === "supergroup")
        ? await findGroupByChatId(update.chat.id)
        : undefined;
      if (membershipGroup && previousStatus !== newStatus) {
        await notifyGroupEvent({
          groupId: membershipGroup.id,
          eventType: "system.bot_membership",
          actor: groupEventIdentity(update.from),
          subject: groupEventIdentity(update.new_chat_member.user),
          details: { previousValue: previousStatus, nextValue: newStatus, summary: "سطح دسترسی Kronos Guard در گروه تغییر کرد." },
          eventKey: `telegram-group-event:${membershipGroup.id}:bot-membership:${ctx.update.update_id}:${newStatus}`,
          telegram: instance.telegram,
        });
      }

      if (announcement && (update.chat.type === "group" || update.chat.type === "supergroup")) {
        const chatTitle = "title" in update.chat ? update.chat.title : "این گروه";
        const text = announcement === "activation" ? groupActivationMessage(chatTitle) : groupPermissionRequiredMessage(chatTitle);
        try {
          const sentMessage = await instance.telegram.sendMessage(update.chat.id, text, announcement === "activation" ? groupActivationMessageOptions() : undefined);
          if (announcement === "activation" && membershipGroup) {
            await scheduleGroupActivationMessageAutoDelete({ groupId: membershipGroup.id, messageId: sentMessage.message_id, persist: recordRecentGroupMessage });
          }
          await writeAuditLog({ category: "bot_membership", event: announcement === "activation" ? "activation_notice_sent" : "permission_notice_sent", details: { chatId: update.chat.id, status: newStatus } });
        } catch (error) {
          await writeAuditLog({ severity: "warning", category: "bot_membership", event: "lifecycle_notice_failed", details: { chatId: update.chat.id, status: newStatus, error: error instanceof Error ? error.message : String(error) } });
        }
      }
    });

    instance.on("chat_member", async ctx => {
      const group = await findGroupByChatId(ctx.chat.id);
      const member = ctx.chatMember.new_chat_member;
      if (group) {
        const previous = ctx.chatMember.old_chat_member;
        const joinedWithInviteLink = ["left", "kicked"].includes(previous.status) && ["member", "restricted", "administrator", "creator"].includes(member.status) && Boolean(ctx.chatMember.invite_link);
        const expelled = member.status === "kicked" && previous.status !== "kicked";
        const muted = member.status === "restricted" && previous.status !== "restricted" && "can_send_messages" in member && member.can_send_messages === false;
        if (joinedWithInviteLink || expelled || muted) await recordGroupMemberFlow({ groupId: group.id, joinedViaInviteLink: joinedWithInviteLink ? 1 : 0, expelled: expelled ? 1 : 0, muted: muted ? 1 : 0 });
        await recordTelegramUser(member.user);
        const telegramRole = member.status === "creator" ? "owner" : member.status === "administrator" ? "administrator" : member.status === "restricted" ? "restricted" : "member";
        const status = member.status === "left" ? "left" : member.status === "kicked" ? "kicked" : "active";
        await recordKnownGroupMember({ groupId: group.id, telegramUserId: member.user.id, status, telegramRole });
        const actor = groupEventIdentity(ctx.from);
        const subject = groupEventIdentity(member.user);
        // Commands and protective actions initiated by this bot already emit their
        // canonical notification at the successful action site. Telegram mirrors
        // those changes as chat_member updates, so do not fan out a second card.
        const changedByKronos = Boolean(ctx.from?.id && ctx.botInfo?.id && ctx.from.id === ctx.botInfo.id);
        const oldAdmin = isTelegramAdministratorStatus(previous.status);
        const newAdmin = isTelegramAdministratorStatus(member.status);
        const oldMuted = isMutedTelegramMember(previous);
        const newMuted = isMutedTelegramMember(member);
        const eventKey = `telegram-group-event:${group.id}:member-status:${ctx.update.update_id}:${member.user.id}`;
        if (!changedByKronos) {
          if (!oldAdmin && newAdmin) {
            await notifyGroupEvent({ groupId: group.id, eventType: "role.promoted", actor, subject, details: { previousValue: previous.status, nextValue: member.status }, eventKey, telegram: instance.telegram });
          } else if (oldAdmin && !newAdmin && ["member", "restricted"].includes(member.status)) {
            await notifyGroupEvent({ groupId: group.id, eventType: "role.demoted", actor, subject, details: { previousValue: previous.status, nextValue: member.status }, eventKey, telegram: instance.telegram });
          } else if (!oldMuted && newMuted) {
            await notifyGroupEvent({ groupId: group.id, eventType: "moderation.mute", actor, subject, details: { summary: "سطح ارسال پیام عضو توسط Telegram محدود شد." }, eventKey, telegram: instance.telegram });
          } else if (oldMuted && !newMuted && ["member", "administrator", "creator"].includes(member.status)) {
            await notifyGroupEvent({ groupId: group.id, eventType: "moderation.unmute", actor, subject, details: { summary: "محدودیت ارسال پیام عضو برداشته شد." }, eventKey, telegram: instance.telegram });
          } else if (member.status === "kicked" && previous.status !== "kicked") {
            await notifyGroupEvent({ groupId: group.id, eventType: "moderation.ban", actor, subject, details: { summary: "عضو از سوی Telegram از گروه حذف یا مسدود شد." }, eventKey, telegram: instance.telegram });
          } else if (previous.status === "kicked" && member.status !== "kicked") {
            await notifyGroupEvent({ groupId: group.id, eventType: "moderation.unban", actor, subject, details: { summary: "محدودیت ورود عضو در Telegram برداشته شد." }, eventKey, telegram: instance.telegram });
          } else if (oldAdmin && newAdmin && "custom_title" in previous && "custom_title" in member && previous.custom_title !== member.custom_title) {
            await notifyGroupEvent({ groupId: group.id, eventType: "role.title_changed", actor, subject, details: { previousValue: previous.custom_title ?? "بدون عنوان", nextValue: member.custom_title ?? "بدون عنوان" }, eventKey, telegram: instance.telegram });
          }
        }
      }
      await applyChatMemberForcedJoinLock(ctx);
    });

    const me = await withTelegramRetry(() => instance.telegram.getMe());
    if (!me.can_join_groups) console.warn("[Kronos Guard] the bot is currently restricted from joining groups");
    const miniAppUrl = getTelegramMiniAppUrl();
    try {
      if (!miniAppUrl) throw new Error("TELEGRAM_PUBLIC_BASE_URL is not configured as a valid public HTTPS URL");
      await withTelegramRetry(() => instance.telegram.setChatMenuButton({
        menuButton: { type: "web_app", text: "Kronos Guard", web_app: { url: miniAppUrl } },
      }));
    } catch (error) {
      // A transient menu API failure must not prevent webhook handling; /start still exposes a Web App button.
      console.warn("[Kronos Guard] could not refresh Telegram Chat Menu Button", error);
    }
    bot = instance;
    await writeAuditLog({ category: "bot", event: "initialized", details: { botId: me.id, username: me.username ?? null, ownerTelegramId: OWNER_TELEGRAM_ID } });
  })();
  bootPromise = initialization.catch(error => {
    // A transient Telegram/API or database failure must not poison all future webhooks.
    // Clear the singleton so the next update can retry initialization safely.
    bootPromise = undefined;
    bot = undefined;
    throw error;
  });
  return bootPromise;
}

export async function claimTelegramUpdate(update: Update): Promise<boolean> {
  return startWebhookEvent(update.update_id, Object.keys(update).find(key => key !== "update_id") ?? "unknown");
}

export async function processClaimedTelegramUpdate(update: Update): Promise<void> {
  if (!bot) throw new Error("Telegram bot is not initialized");
  const updateId = update.update_id;
  try {
    await bot.handleUpdate(update);
    await finishWebhookEvent(updateId, "processed");
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown webhook dispatch error";
    const kind = classifyBotHandlerError(error);
    await finishWebhookEvent(updateId, "failed", message);
    if (kind === "unexpected_handler_error") {
      await alertOwner(bot.telegram, {
        alertType: "webhook_problem",
        severity: "critical",
        title: "پردازش وب‌هوک ناموفق بود",
        body: "Kronos Guard نتوانست یک آپدیت تلگرام را پردازش کند. لاگ حسابرسی را بررسی کنید.",
        dedupeKey: `webhook-dispatch-${new Date().toISOString().slice(0, 13)}`,
      });
    } else {
      await writeAuditLog({
        severity: "warning",
        category: "webhook",
        event: kind === "transient_telegram_error" ? "transient_dispatch_failure" : "telegram_edge_dispatch_failure",
        details: { updateId, kind, message },
      });
    }
    throw error;
  }
}

export async function dispatchTelegramUpdate(update: Update): Promise<{ duplicate: boolean }> {
  if (!(await claimTelegramUpdate(update))) return { duplicate: true };
  await processClaimedTelegramUpdate(update);
  return { duplicate: false };
}
