import { nanoid } from "nanoid";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import type { Context } from "telegraf";
import { channelListings, forcedJoinChannels, marketplacePaymentSettings, paymentOrders, paymentReceipts } from "../../drizzle/schema";
import { getDb } from "../db";
import { storagePut } from "../storage";
import { alertOwner } from "../telegram/alerts";
import { isOwnerTelegramId } from "../telegram/authorization";
import { getTelegramBot } from "../telegram/bot";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import { writeAuditLog } from "../telegram/repository";

export const STARS_PER_DAY = 10;
export const MAX_ACTIVE_FORCED_JOIN_CHANNELS = 3;
export type MarketplaceMethod = "telegram_stars" | "card_to_card" | "usdt_manual" | "doge_manual" | "shib_manual" | "dron_manual" | "ltc_manual";
type ManualMethod = Exclude<MarketplaceMethod, "telegram_stars">;
type WalletConfig = Partial<Record<"USDT" | "DOGE" | "SHIB" | "DRON" | "LTC", { address: string; network?: string }>>;

const methodAliases: Record<string, MarketplaceMethod> = {
  stars: "telegram_stars",
  star: "telegram_stars",
  استارز: "telegram_stars",
  card: "card_to_card",
  کارت: "card_to_card",
  usdt: "usdt_manual",
  tether: "usdt_manual",
  تتر: "usdt_manual",
  doge: "doge_manual",
  dogecoin: "doge_manual",
  دوج: "doge_manual",
  shib: "shib_manual",
  shiba: "shib_manual",
  شیبا: "shib_manual",
  dron: "dron_manual",
  ltc: "ltc_manual",
  litecoin: "ltc_manual",
  لایت: "ltc_manual",
};

export class MarketplaceCapacityError extends Error {
  constructor(message = "ظرفیت عضویت اجباری اکنون کامل است. حداکثر سه کانال فعال هم‌زمان پذیرفته می‌شود؛ پس از پایان یکی از دوره‌ها دوباره تلاش کنید.") {
    super(message);
    this.name = "MarketplaceCapacityError";
  }
}

function activeForcedJoinWhere(now: Date) {
  return and(
    eq(forcedJoinChannels.status, "active"),
    inArray(forcedJoinChannels.scope, ["global", "marketplace"]),
    or(isNull(forcedJoinChannels.expiresAt), gt(forcedJoinChannels.expiresAt, now)),
  );
}

export async function getMarketplaceCapacity(now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while checking forced-join capacity");
  const activeChannels = await db
    .select({ id: forcedJoinChannels.id, channelChatId: forcedJoinChannels.channelChatId, title: forcedJoinChannels.title, expiresAt: forcedJoinChannels.expiresAt })
    .from(forcedJoinChannels)
    .where(activeForcedJoinWhere(now));
  return {
    maxActiveChannels: MAX_ACTIVE_FORCED_JOIN_CHANNELS,
    activeChannels: activeChannels.length,
    availableSlots: Math.max(0, MAX_ACTIVE_FORCED_JOIN_CHANNELS - activeChannels.length),
    isFull: activeChannels.length >= MAX_ACTIVE_FORCED_JOIN_CHANNELS,
    channels: activeChannels,
  };
}

async function assertMarketplaceAvailability(channelChatId: number) {
  const capacity = await getMarketplaceCapacity();
  if (capacity.channels.some(channel => channel.channelChatId === channelChatId)) {
    throw new MarketplaceCapacityError("این کانال هم‌اکنون در عضویت اجباری فعال است. تا پایان دورهٔ فعلی، پرداخت جدیدی برای آن لازم نیست.");
  }
  if (capacity.isFull) throw new MarketplaceCapacityError();
  return capacity;
}

function cryptoSymbol(method: ManualMethod): keyof WalletConfig | undefined {
  const symbols: Record<ManualMethod, keyof WalletConfig | undefined> = {
    usdt_manual: "USDT",
    doge_manual: "DOGE",
    shib_manual: "SHIB",
    dron_manual: "DRON",
    ltc_manual: "LTC",
    card_to_card: undefined,
  };
  return symbols[method];
}

export function parseMarketplaceRequest(text: string): { channel: string; days: number; method: MarketplaceMethod } | undefined {
  const tokens = text.trim().replace(/^\/channel\s*/i, "").split(/\s+/);
  if (tokens.length !== 3 || !/^@[A-Za-z0-9_]{5,32}$/.test(tokens[0])) return undefined;
  const days = Number(tokens[1].replace(/[۰-۹]/g, char => String("۰۱۲۳۴۵۶۷۸۹".indexOf(char))));
  const method = methodAliases[tokens[2].toLocaleLowerCase("fa-IR")];
  if (!Number.isInteger(days) || days < 1 || days > 365 || !method) return undefined;
  return { channel: tokens[0], days, method };
}

export function expectedStars(days: number, starsPerDay = STARS_PER_DAY): number {
  return days * starsPerDay;
}

async function getSettings() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable for marketplace settings");
  let settings = (await db.select().from(marketplacePaymentSettings).limit(1))[0];
  if (!settings) {
    await db.insert(marketplacePaymentSettings).values({ starsPerDay: STARS_PER_DAY });
    settings = (await db.select().from(marketplacePaymentSettings).limit(1))[0];
  }
  if (!settings) throw new Error("Marketplace settings could not be initialized");
  return settings;
}

function readWallets(value: unknown): WalletConfig {
  return value && typeof value === "object" ? (value as WalletConfig) : {};
}

async function verifyChannelOwnership(ctx: Context, channelHandle: string) {
  if (!ctx.from) throw new Error("Missing payer identity");
  const channel = await ctx.telegram.getChat(channelHandle);
  if (channel.type !== "channel") throw new Error("The requested target is not a Telegram channel");
  const membership = await ctx.telegram.getChatMember(channel.id, ctx.from.id);
  if (!["creator", "owner", "administrator"].includes(membership.status)) throw new Error("The payer is not an administrator of the requested channel");
  const botIdentity = await ctx.telegram.getMe();
  const botMembership = await ctx.telegram.getChatMember(channel.id, botIdentity.id);
  if (!["creator", "owner", "administrator"].includes(botMembership.status)) throw new Error("The bot is not an administrator of the requested channel");
  const username = "username" in channel ? channel.username ?? null : null;
  return { chatId: channel.id, title: "title" in channel ? channel.title : channelHandle, username };
}

async function createOrder(input: { channelChatId: number; payerTelegramId: number; days: number; method: MarketplaceMethod }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while creating marketplace order");
  await assertMarketplaceAvailability(input.channelChatId);
  const settings = await getSettings();
  const starsPerDay = settings.starsPerDay || STARS_PER_DAY;
  const amountStars = input.method === "telegram_stars" ? input.days * starsPerDay : null;
  const amountMinor = input.method === "card_to_card" && settings.iranRialsPerDay ? input.days * settings.iranRialsPerDay : null;
  const currency = input.method === "telegram_stars" ? "XTR" : input.method === "card_to_card" ? "IRR" : (cryptoSymbol(input.method as ManualMethod) ?? "CRYPTO");
  const listingInsert = await db.insert(channelListings).values({
    channelChatId: input.channelChatId,
    ownerTelegramId: input.payerTelegramId,
    requestedDays: input.days,
    starsPerDay,
    localCurrencyAmount: amountMinor,
    localCurrencyCode: currency,
    status: "pending_payment",
  });
  const listingId = Number(listingInsert[0].insertId);
  const publicId = `KG-${nanoid(14).toUpperCase()}`;
  await db.insert(paymentOrders).values({
    publicId,
    listingId,
    payerTelegramId: input.payerTelegramId,
    method: input.method,
    status: "awaiting_payment",
    amountStars,
    amountMinor,
    currency,
  });
  const order = (await db.select().from(paymentOrders).where(eq(paymentOrders.publicId, publicId)).limit(1))[0];
  if (!order) throw new Error("Payment order could not be created");
  return { order, settings };
}

function cardInstructions(order: typeof paymentOrders.$inferSelect, settings: typeof marketplacePaymentSettings.$inferSelect) {
  if (!order.amountMinor) return "قیمت تومانی هنوز توسط مالک تنظیم نشده است. لطفاً روش استارز را انتخاب کنید یا بعداً تلاش کنید.";
  const tomans = Math.floor(order.amountMinor / 10).toLocaleString("fa-IR");
  return `پرداخت کارت‌به‌کارت برای سفارش ${order.publicId}\n\nمبلغ: ${tomans} تومان\nبه نام: ${settings.cardRecipientName}\nشماره کارت: ${settings.cardNumber}\nبانک: ${settings.cardBank}\n\nپس از پرداخت، تصویر رسید را با کپشن «receipt ${order.publicId}» برای ربات ارسال کنید.`;
}

function cryptoInstructions(order: typeof paymentOrders.$inferSelect, wallets: WalletConfig) {
  const symbol = cryptoSymbol(order.method as ManualMethod);
  const wallet = symbol ? wallets[symbol] : undefined;
  if (!symbol || !wallet?.address) return `کیف پول ${symbol ?? "رمزارز"} هنوز توسط مالک تنظیم نشده است. لطفاً روش دیگری انتخاب کنید.`;
  return `پرداخت ${symbol} برای سفارش ${order.publicId}\n\nآدرس کیف پول: ${wallet.address}${wallet.network ? `\nشبکه: ${wallet.network}` : ""}\n\nپس از پرداخت، تصویر رسید را با کپشن «receipt ${order.publicId}» برای ربات ارسال کنید. پس از تأیید مالک، کانال فعال می‌شود.`;
}

export async function handleMarketplaceOrder(ctx: Context): Promise<void> {
  const message = ctx.message;
  if (!ctx.from || !message || !("text" in message)) return;
  const request = parseMarketplaceRequest(message.text);
  if (!request) {
    await ctx.reply("<b>بازارچهٔ کانال Kronos Guard</b>\n\nفرمت سفارش:\n<code>/channel @ChannelUsername تعداد_روز stars|card|usdt|doge|shib|dron|ltc</code>\n\nنمونه: <code>/channel @MyChannel 7 stars</code>\n\nهزینهٔ Stars بر اساس نرخ روزانهٔ فعلی مالک به‌صورت خودکار محاسبه می‌شود.\n\n<blockquote>هم‌زمان فقط سه کانال فعال در عضویت اجباری پذیرفته می‌شود. اگر ظرفیت کامل باشد، هیچ فاکتور یا پرداخت تازه‌ای ایجاد نخواهد شد.</blockquote>", { parse_mode: "HTML" });
    return;
  }
  try {
    const channel = await verifyChannelOwnership(ctx, request.channel);
    const { order, settings } = await createOrder({ channelChatId: channel.chatId, payerTelegramId: ctx.from.id, days: request.days, method: request.method });
    await writeAuditLog({ category: "marketplace", event: "order_created", actorTelegramId: ctx.from.id, details: { orderId: order.id, publicId: order.publicId, channelChatId: channel.chatId, method: order.method } });
    if (order.method === "telegram_stars") {
      await ctx.replyWithInvoice({
        title: `Kronos Guard — ${request.days} روز فاجوین`,
        description: `ثبت کانال ${channel.title} در فاجوین با نرخ ${settings.starsPerDay} استارز برای هر روز.`,
        payload: `kronos_marketplace:${order.publicId}`,
        provider_token: "",
        currency: "XTR",
        prices: [{ label: `${request.days} روز فاجوین`, amount: order.amountStars ?? expectedStars(request.days, settings.starsPerDay) }],
      });
      return;
    }
    if (order.method === "card_to_card") {
      await ctx.reply(cardInstructions(order, settings));
      return;
    }
    await ctx.reply(cryptoInstructions(order, readWallets(settings.cryptoWallets)));
  } catch (error) {
    console.error("[Kronos Guard] marketplace order failure", error);
    await ctx.reply(error instanceof MarketplaceCapacityError ? error.message : "ثبت سفارش ممکن نشد. مطمئن شوید ربات در کانال شما ادمین است و شما نیز مدیر کانال هستید.");
  }
}

/**
 * Creates a Telegram Stars invoice link for a signed Mini App user. Payment
 * fulfilment remains exclusively in `settleSuccessfulStarsPayment`, which is
 * driven by Telegram's successful-payment update rather than this request.
 */
export async function createStarsInvoiceLinkForDashboard(input: { payerTelegramId: number; channelChatId: number; days: number }) {
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) throw new Error("Requested duration must be between 1 and 365 days");
  const bot = getTelegramBot();
  if (!bot) throw new Error("Telegram bot is unavailable");
  const [channel, payerMembership, botIdentity] = await Promise.all([
    bot.telegram.getChat(input.channelChatId),
    bot.telegram.getChatMember(input.channelChatId, input.payerTelegramId),
    bot.telegram.getMe(),
  ]);
  if (channel.type !== "channel") throw new Error("The requested target is not a Telegram channel");
  if (!["creator", "owner", "administrator"].includes(payerMembership.status)) throw new Error("You must be an administrator of the requested channel");
  const botMembership = await bot.telegram.getChatMember(input.channelChatId, botIdentity.id);
  if (!["creator", "owner", "administrator"].includes(botMembership.status)) throw new Error("Add Kronos Guard as a channel administrator before paying");
  const { order, settings } = await createOrder({ channelChatId: input.channelChatId, payerTelegramId: input.payerTelegramId, days: input.days, method: "telegram_stars" });
  await writeAuditLog({ category: "marketplace", event: "stars_invoice_link_created", actorTelegramId: input.payerTelegramId, details: { orderId: order.id, publicId: order.publicId, channelChatId: input.channelChatId, days: input.days } });
  const title = "title" in channel ? channel.title : String(input.channelChatId);
  const invoiceLink = await bot.telegram.createInvoiceLink({
    title: `Kronos Guard — ${input.days} روز فاجوین`,
    description: `ثبت کانال ${title} در فاجوین با نرخ ${settings.starsPerDay} استارز برای هر روز.`,
    payload: `kronos_marketplace:${order.publicId}`,
    provider_token: "",
    currency: "XTR",
    prices: [{ label: `${input.days} روز فاجوین`, amount: order.amountStars ?? expectedStars(input.days, settings.starsPerDay) }],
  });
  return { invoiceLink, publicId: order.publicId, amountStars: order.amountStars ?? expectedStars(input.days, settings.starsPerDay), starsPerDay: settings.starsPerDay, channel: { chatId: input.channelChatId, title } };
}

/**
 * Creates an owner-directed Stars invoice and sends it directly to the intended payer.
 * The invoice itself never activates a channel: activation remains gated by Telegram's
 * successful-payment update in `settleSuccessfulStarsPayment`.
 */
export async function sendCustomStarsInvoice(input: { ownerTelegramId: number; targetTelegramId: number; channelChatId: number; amountStars: number; days: number; expiresInHours: number }) {
  if (!isOwnerTelegramId(input.ownerTelegramId)) throw new Error("Owner authorization is required");
  if (!Number.isInteger(input.targetTelegramId) || input.targetTelegramId <= 0) throw new Error("Target Telegram user ID is invalid");
  if (!Number.isInteger(input.channelChatId)) throw new Error("Channel ID is invalid");
  if (!Number.isInteger(input.amountStars) || input.amountStars < 1) throw new Error("Stars amount must be a positive whole number");
  if (!Number.isInteger(input.days) || input.days < 1 || input.days > 365) throw new Error("Requested duration must be between 1 and 365 days");
  if (!Number.isInteger(input.expiresInHours) || input.expiresInHours < 1 || input.expiresInHours > 168) throw new Error("Invoice expiry must be between 1 and 168 hours");

  const db = await getDb();
  const bot = getTelegramBot();
  if (!db) throw new Error("Database unavailable while creating custom Stars invoice");
  if (!bot) throw new Error("Telegram bot is unavailable");

  const [channel, targetMembership, botIdentity] = await Promise.all([
    bot.telegram.getChat(input.channelChatId),
    bot.telegram.getChatMember(input.channelChatId, input.targetTelegramId),
    bot.telegram.getMe(),
  ]);
  if (channel.type !== "channel") throw new Error("The requested target is not a Telegram channel");
  if (!["creator", "owner", "administrator"].includes(targetMembership.status)) throw new Error("The invoice recipient must administer the requested channel");
  const botMembership = await bot.telegram.getChatMember(input.channelChatId, botIdentity.id);
  if (!["creator", "owner", "administrator"].includes(botMembership.status)) throw new Error("Add Kronos Guard as a channel administrator before invoicing");

  await assertMarketplaceAvailability(input.channelChatId);
  const starsPerDay = Math.max(1, Math.ceil(input.amountStars / input.days));
  const expiresAt = new Date(Date.now() + input.expiresInHours * 3_600_000);
  const listingInsert = await db.insert(channelListings).values({
    channelChatId: input.channelChatId,
    ownerTelegramId: input.targetTelegramId,
    requestedDays: input.days,
    starsPerDay,
    localCurrencyCode: "XTR",
    status: "pending_payment",
  });
  const listingId = Number(listingInsert[0].insertId);
  const publicId = `KG-${nanoid(14).toUpperCase()}`;
  await db.insert(paymentOrders).values({
    publicId,
    listingId,
    payerTelegramId: input.targetTelegramId,
    method: "telegram_stars",
    status: "awaiting_payment",
    amountStars: input.amountStars,
    currency: "XTR",
    expiresAt,
    providerPayload: {
      type: "owner_custom_stars_invoice",
      createdByTelegramId: input.ownerTelegramId,
      requestedDays: input.days,
      expiresAt: expiresAt.toISOString(),
    },
  });

  const channelTitle = "title" in channel ? channel.title : String(input.channelChatId);
  try {
    await bot.telegram.sendInvoice(input.targetTelegramId, {
      title: "Kronos Guard — Forced-Join access",
      description: `Payment activates ${channelTitle} in forced join for ${input.days} day${input.days === 1 ? "" : "s"}.`,
      payload: `kronos_marketplace:${publicId}`,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `Forced join · ${input.days} day${input.days === 1 ? "" : "s"}`, amount: input.amountStars }],
    });
  } catch (error) {
    await db.update(paymentOrders).set({ status: "cancelled" }).where(and(eq(paymentOrders.publicId, publicId), eq(paymentOrders.status, "awaiting_payment")));
    await db.update(channelListings).set({ status: "cancelled" }).where(and(eq(channelListings.id, listingId), eq(channelListings.status, "pending_payment")));
    await alertOwner(bot.telegram, {
      alertType: "payment_approval",
      severity: "warning",
      title: "ارسال فاکتور سفارشی Stars ناموفق بود",
      body: `فاکتور ${publicId} برای کاربر ${input.targetTelegramId} ارسال نشد و با وضعیت لغوشده ثبت شد. جزئیات: ${error instanceof Error ? error.message : "خطای ناشناخته"}`,
      dedupeKey: `custom-stars-send-failed-${publicId}`,
      relatedEntityType: "payment_order",
      relatedEntityId: listingId,
    });
    throw error;
  }

  await writeAuditLog({
    category: "marketplace",
    event: "owner_custom_stars_invoice_sent",
    actorTelegramId: input.ownerTelegramId,
    subjectTelegramId: input.targetTelegramId,
    details: { publicId, listingId, channelChatId: input.channelChatId, amountStars: input.amountStars, days: input.days, expiresAt: expiresAt.toISOString() },
  });
  return { publicId, amountStars: input.amountStars, targetTelegramId: input.targetTelegramId, channel: { chatId: input.channelChatId, title: channelTitle }, expiresAt };
}

function orderIdFromPayload(payload: string) {
  return payload.startsWith("kronos_marketplace:") ? payload.slice("kronos_marketplace:".length) : undefined;
}

export async function approveStarsPreCheckout(ctx: Context) {
  const query = ctx.preCheckoutQuery;
  if (!query) return;
  const publicId = orderIdFromPayload(query.invoice_payload);
  const db = await getDb();
  if (!db) {
    await ctx.answerPreCheckoutQuery(false, "سامانهٔ پرداخت موقتاً در دسترس نیست؛ لطفاً دوباره تلاش کنید.");
    return;
  }
  const order = publicId ? (await db.select().from(paymentOrders).where(eq(paymentOrders.publicId, publicId)).limit(1))[0] : undefined;
  let errorMessage: string | undefined;
  let valid = Boolean(order && order.method === "telegram_stars" && order.status === "awaiting_payment" && (!order.expiresAt || order.expiresAt > new Date()) && order.amountStars === query.total_amount && query.currency === "XTR");
  if (valid && order) {
    const listing = (await db.select().from(channelListings).where(eq(channelListings.id, order.listingId)).limit(1))[0];
    if (!listing) {
      valid = false;
      errorMessage = "کانال سفارش پیدا نشد.";
    } else {
      try {
        await assertMarketplaceAvailability(listing.channelChatId);
      } catch (error) {
        valid = false;
        errorMessage = error instanceof MarketplaceCapacityError ? error.message : "ظرفیت عضویت اجباری قابل بررسی نیست.";
      }
    }
  }
  await ctx.answerPreCheckoutQuery(valid, valid ? undefined : errorMessage ?? "سفارش پرداخت معتبر نیست یا منقضی شده است.");
  if (!valid && order && (order.providerPayload as { type?: string } | null)?.type === "owner_custom_stars_invoice") {
    const bot = getTelegramBot();
    if (bot) await alertOwner(bot.telegram, { alertType: "payment_approval", severity: "warning", title: "فاکتور سفارشی Stars تکمیل نشد", body: `فاکتور ${order.publicId} برای کاربر ${order.payerTelegramId} از سوی Telegram تأیید نشد یا منقضی شده است.`, dedupeKey: `custom-stars-precheckout-failed-${order.id}`, relatedEntityType: "payment_order", relatedEntityId: order.id });
  }
}

async function activateListing(order: typeof paymentOrders.$inferSelect) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while activating marketplace listing");
  const listing = (await db.select().from(channelListings).where(eq(channelListings.id, order.listingId)).limit(1))[0];
  if (!listing) throw new Error("Marketplace listing not found");
  await assertMarketplaceAvailability(listing.channelChatId);
  const bot = getTelegramBot();
  if (!bot) throw new Error("Bot is unavailable while activating forced-join listing");
  const channel = await bot.telegram.getChat(listing.channelChatId);
  const username = "username" in channel ? channel.username ?? null : null;
  const title = "title" in channel ? channel.title : String(listing.channelChatId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + listing.requestedDays * 86_400_000);
  await db.update(channelListings).set({ status: "active", activatedAt: now, expiresAt }).where(and(eq(channelListings.id, listing.id), eq(channelListings.status, "pending_payment")));
  await db
    .insert(forcedJoinChannels)
    .values({ channelChatId: listing.channelChatId, username, title, scope: "marketplace", status: "active", ownerTelegramId: listing.ownerTelegramId, listingId: listing.id, startsAt: now, expiresAt })
    .onDuplicateKeyUpdate({ set: { username, title, status: "active", startsAt: now, expiresAt, listingId: listing.id } });
  await writeAuditLog({ category: "marketplace", event: "listing_activated", actorTelegramId: order.payerTelegramId, details: { orderId: order.id, listingId: listing.id, expiresAt: expiresAt.toISOString() } });
}

export async function settleSuccessfulStarsPayment(ctx: Context) {
  const message = ctx.message;
  if (!message || !("successful_payment" in message) || !ctx.from) return;
  const payment = message.successful_payment;
  const publicId = orderIdFromPayload(payment.invoice_payload);
  if (!publicId) return;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while settling Stars payment");
  const order = (await db.select().from(paymentOrders).where(eq(paymentOrders.publicId, publicId)).limit(1))[0];
  if (!order || order.payerTelegramId !== ctx.from.id || order.method !== "telegram_stars" || order.status === "paid") return;
  if (order.amountStars !== payment.total_amount || payment.currency !== "XTR") throw new Error("Stars amount mismatch");
  await db.update(paymentOrders).set({ status: "paid", providerReference: payment.telegram_payment_charge_id, providerPayload: { providerPaymentChargeId: payment.provider_payment_charge_id }, paidAt: new Date() }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "awaiting_payment")));
  try {
    await activateListing(order);
    const isCustomOwnerInvoice = (order.providerPayload as { type?: string } | null)?.type === "owner_custom_stars_invoice";
    if (isCustomOwnerInvoice) {
      const bot = getTelegramBot();
      if (bot) await bot.telegram.sendMessage(OWNER_TELEGRAM_ID, `✅ پرداخت فاکتور سفارشی Stars موفق شد.\n\nسفارش: ${order.publicId}\nپرداخت‌کننده: ${ctx.from.id}\nمبلغ: ${payment.total_amount} Stars\nکانال: ${(await db.select({ channelChatId: channelListings.channelChatId }).from(channelListings).where(eq(channelListings.id, order.listingId)).limit(1))[0]?.channelChatId ?? "—"}\n\nکانال به‌صورت خودکار در عضویت اجباری فعال شد.`).catch(error => console.error("[Kronos Guard] custom Stars owner notification failed", error));
    }
    await ctx.reply(isCustomOwnerInvoice ? "✅ پرداخت Stars شما تأیید شد و کانال مرتبط در عضویت اجباری فعال شد." : "✅ پرداخت Stars تأیید شد و کانال شما در عضویت اجباری فعال شد.");
  } catch (error) {
    const listing = (await db?.select().from(channelListings).where(eq(channelListings.id, order.listingId)).limit(1))?.[0];
    if (listing) await db.update(channelListings).set({ status: "paused" }).where(eq(channelListings.id, listing.id));
    await writeAuditLog({ severity: "critical", category: "marketplace", event: "paid_listing_activation_needs_review", actorTelegramId: ctx.from.id, details: { orderId: order.id, publicId: order.publicId, error: error instanceof Error ? error.message : "unknown" } });
    const bot = getTelegramBot();
    if (bot) await alertOwner(bot.telegram, { alertType: "payment_approval", severity: "critical", title: "پرداخت Stars نیازمند بررسی است", body: `سفارش ${order.publicId} پرداخت شده اما به‌دلیل تغییر هم‌زمان ظرفیت یا دسترسی کانال، فعال‌سازی خودکار کامل نشد.`, dedupeKey: `paid-listing-review-${order.id}`, relatedEntityType: "payment_order", relatedEntityId: order.id });
    await ctx.reply("پرداخت شما ثبت شد؛ اما فعال‌سازی به بررسی مالک نیاز دارد. سفارش شما محفوظ است و نتیجه از طریق ربات اعلام می‌شود.");
  }
}

function receiptOrderId(caption: string | undefined) {
  return caption?.match(/^receipt\s+(KG-[A-Z0-9_-]{8,48})$/i)?.[1]?.toUpperCase();
}

export async function submitManualReceipt(ctx: Context) {
  const message = ctx.message as any;
  if (!ctx.from || !message) return;
  const publicId = receiptOrderId(message.caption);
  if (!publicId) return;
  const media = message.photo ? message.photo[message.photo.length - 1] : message.document;
  if (!media?.file_id) return;
  const mimeType = message.document?.mime_type ?? "image/jpeg";
  if (!mimeType.startsWith("image/") && mimeType !== "application/pdf") {
    await ctx.reply("فقط تصویر یا PDF رسید قابل قبول است.");
    return;
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while saving receipt");
  const order = (await db.select().from(paymentOrders).where(eq(paymentOrders.publicId, publicId)).limit(1))[0];
  if (!order || order.payerTelegramId !== ctx.from.id || order.method === "telegram_stars" || !["awaiting_payment", "receipt_submitted"].includes(order.status)) {
    await ctx.reply("این سفارش برای ثبت رسید دستی معتبر نیست.");
    return;
  }
  const file = await ctx.telegram.getFile(media.file_id);
  if (!file.file_path) throw new Error("Telegram did not return a receipt file path");
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram token is unavailable for receipt download");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Receipt download from Telegram failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > 10 * 1024 * 1024) {
    await ctx.reply("حجم رسید نباید بیش از ۱۰ مگابایت باشد.");
    return;
  }
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType.split("/")[1] ?? "jpg";
  const saved = await storagePut(`payment-receipts/${order.id}/receipt.${extension}`, bytes, mimeType);
  await db.insert(paymentReceipts).values({ paymentOrderId: order.id, storageKey: saved.key, mimeType, originalFilename: message.document?.file_name ?? `receipt.${extension}`, byteSize: bytes.byteLength, submittedByTelegramId: ctx.from.id });
  await db.update(paymentOrders).set({ status: "pending_approval" }).where(eq(paymentOrders.id, order.id));
  await writeAuditLog({ category: "marketplace", event: "receipt_submitted", actorTelegramId: ctx.from.id, details: { orderId: order.id, receiptKey: saved.key } });
  const bot = getTelegramBot();
  if (bot) await alertOwner(bot.telegram, { alertType: "payment_approval", severity: "warning", title: "رسید پرداخت جدید", body: `رسید سفارش ${order.publicId} برای تأیید در داشبورد مالک ثبت شد.`, dedupeKey: `payment-receipt-${order.id}`, relatedEntityType: "payment_order", relatedEntityId: order.id });
  await ctx.reply("رسید شما ثبت شد و پس از بررسی مالک، کانال فعال خواهد شد.");
}

export async function reviewManualOrder(ctx: Context, decision: "approve" | "reject") {
  const message = ctx.message;
  if (!ctx.from || !message || !("text" in message)) return;
  if (!isOwnerTelegramId(ctx.from.id)) {
    await ctx.reply("این عملیات فقط برای مالک Kronos Guard مجاز است.");
    return;
  }
  const publicId = message.text.trim().split(/\s+/)[1]?.toUpperCase();
  if (!publicId) {
    await ctx.reply("شناسه سفارش را وارد کنید؛ نمونه: /payapprove KG-XXXX");
    return;
  }
  try {
    const result = await approveManualOrderByOwner(publicId, ctx.from.id, decision);
    await ctx.reply(decision === "approve" ? `✅ سفارش ${result.publicId} تأیید و کانال فعال شد.` : `سفارش ${result.publicId} رد شد.`);
  } catch {
    await ctx.reply("این سفارش در وضعیت آماده بررسی نیست.");
  }
}

/** Shared state transition for Telegram owner commands and the authenticated owner Mini App. */
export async function approveManualOrderByOwner(publicId: string, reviewerTelegramId: number, decision: "approve" | "reject") {
  if (!isOwnerTelegramId(reviewerTelegramId)) throw new Error("Owner authorization is required");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable while reviewing payment");
  const order = (await db.select().from(paymentOrders).where(eq(paymentOrders.publicId, publicId.toUpperCase())).limit(1))[0];
  if (!order || order.method === "telegram_stars" || order.status !== "pending_approval") throw new Error("Order is not pending manual approval");
  const reviewedAt = new Date();
  if (decision === "approve") {
    await activateListing(order);
    await db.update(paymentOrders).set({ status: "paid", reviewedByTelegramId: reviewerTelegramId, reviewedAt, paidAt: reviewedAt }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "pending_approval")));
  } else {
    await db.update(paymentOrders).set({ status: "rejected", reviewedByTelegramId: reviewerTelegramId, reviewedAt }).where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, "pending_approval")));
  }
  await writeAuditLog({ category: "marketplace", event: `manual_payment_${decision}d`, actorTelegramId: reviewerTelegramId, details: { orderId: order.id, publicId: order.publicId } });
  return { publicId: order.publicId, decision };
}
