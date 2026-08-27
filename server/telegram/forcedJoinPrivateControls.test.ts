import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync as readDashboardSource } from "node:fs";
import { isForcedJoinChannelRequiredNow, joinKeyboard, isBotPrivateForcedJoinEligible } from "./forcedJoin";
import { advanceStagedBotPrivateForcedJoinDraft, createStagedBotPrivateForcedJoinDraft, finalizedBotPrivateForcedJoinDraft, formatBotPrivateForcedJoinList, normalizeForcedJoinChannelChatId, stagedForcedJoinConfirmationText } from "./forcedJoinManager";

describe("bot-private forced-join controls", () => {
  it("enforces membership only in a private user conversation, never in groups or for the sole owner", () => {
    expect(isBotPrivateForcedJoinEligible({ chat: { type: "private" }, from: { id: 123, is_bot: false } } as any)).toBe(true);
    expect(isBotPrivateForcedJoinEligible({ chat: { type: "group" }, from: { id: 123, is_bot: false } } as any)).toBe(false);
    expect(isBotPrivateForcedJoinEligible({ chat: { type: "private" }, from: { id: 8375579910, is_bot: false } } as any)).toBe(false);
  });

  it("puts each missing channel on its own inline row and retains verification below", () => {
    const markup = joinKeyboard([
      { id: 1, title: "Channel One", buttonLabel: "اخبار", inviteUrl: "https://t.me/news" },
      { id: 2, title: "Channel Two", buttonLabel: "پشتیبانی", inviteUrl: "https://t.me/support" },
    ] as any, "fa", 123) as any;
    const rows = markup.reply_markup.inline_keyboard;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveLength(1);
    expect(rows[1]).toHaveLength(1);
    expect(rows[0][0].text).toBe("اخبار");
    expect(rows[1][0].text).toBe("پشتیبانی");
    expect(rows[2]).toHaveLength(1);
    expect(rows[2][0].callback_data).toBe("forced_join:verify:123");
  });

  it("collects each owner channel field one step at a time before confirmation", () => {
    const first = createStagedBotPrivateForcedJoinDraft(100);
    expect(advanceStagedBotPrivateForcedJoinDraft(first, "wrong")).toMatchObject({ ok: false });

    const second = advanceStagedBotPrivateForcedJoinDraft(first, "-1001234567890");
    expect(second).toMatchObject({ ok: true, draft: { step: "inviteUrl", channelChatId: -1001234567890 } });
    if (!second.ok) throw new Error("Expected invite-link stage");

    const third = advanceStagedBotPrivateForcedJoinDraft(second.draft, "https://t.me/news");
    if (!third.ok) throw new Error("Expected label stage");
    const fourth = advanceStagedBotPrivateForcedJoinDraft(third.draft, "اخبار روزانه");
    if (!fourth.ok) throw new Error("Expected duration stage");
    const confirmation = advanceStagedBotPrivateForcedJoinDraft(fourth.draft, "30");

    expect(confirmation).toMatchObject({ ok: true, complete: true, draft: { step: "confirm", durationDays: 30 } });
    if (!confirmation.ok) throw new Error("Expected confirmation stage");
    const draft = finalizedBotPrivateForcedJoinDraft(confirmation.draft);
    expect(draft).toEqual({ channelChatId: -1001234567890, inviteUrl: "https://t.me/news", buttonLabel: "اخبار روزانه", durationDays: 30 });
    expect(stagedForcedJoinConfirmationText(draft!)).toContain("مدت الزام: 30 روز");
  });

  it("normalizes a pasted channel ID missing only the minus sign and rejects other positive IDs", () => {
    expect(normalizeForcedJoinChannelChatId("100435583822")).toBe(-100435583822);
    expect(normalizeForcedJoinChannelChatId("-100435583822")).toBe(-100435583822);
    expect(normalizeForcedJoinChannelChatId("435583822")).toBeNull();
  });

  it("renders status and expiry information for the owner list", () => {
    expect(formatBotPrivateForcedJoinList([{ id: 4, title: "News", buttonLabel: "اخبار", channelChatId: -1004, status: "active", expiresAt: null }] as any)).toContain("پایان: دائمی");
  });

  it("ignores expired owner-managed channels immediately, before the next maintenance cycle", () => {
    const now = new Date("2026-08-14T10:00:00Z");
    expect(isForcedJoinChannelRequiredNow({ status: "active", expiresAt: new Date("2026-08-14T09:59:59Z") } as any, now)).toBe(false);
    expect(isForcedJoinChannelRequiredNow({ status: "active", expiresAt: new Date("2026-08-14T10:00:01Z") } as any, now)).toBe(true);
    expect(isForcedJoinChannelRequiredNow({ status: "active", expiresAt: null } as any, now)).toBe(true);
  });

  it("keeps the Mini App behind a localized membership gate with a retry path", () => {
    const dashboardSource = readDashboardSource(resolve(process.cwd(), "client/src/pages/OwnerDashboard.tsx"), "utf8");
    const i18nSource = readDashboardSource(resolve(process.cwd(), "client/src/lib/dashboardI18n.ts"), "utf8");
    expect(dashboardSource).toContain("dashboardJoinRequiredCopy");
    expect(dashboardSource).toContain("profileQuery.data?.forcedJoinStatus");
    expect(dashboardSource).toContain("profileQuery.refetch()");
    expect(dashboardSource).toContain("lockedStatus?.locked");
    for (const locale of ["fa", "en", "ar", "tr", "ru", "es", "fr", "pt", "it", "de", "pl", "vi"]) {
      expect(i18nSource).toContain(`${locale}: { title:`);
    }
  });

  it("clears the blocking join controls when verification succeeds", () => {
    const botSource = readFileSync(resolve(process.cwd(), "server/telegram/bot.ts"), "utf8");
    const forcedJoinSource = readFileSync(resolve(process.cwd(), "server/telegram/forcedJoin.ts"), "utf8");
    expect(botSource).toContain('instance.action(/^forced_join:verify(?::(\\d+))?$/');
    expect(botSource).toContain('ctx.editMessageText(successText, { reply_markup: { inline_keyboard: [] } })');
    expect(botSource).toContain('await ctx.reply(successText, kronosPersistentKeyboard())');
    expect(forcedJoinSource).toContain("/^forced_join:verify(?::\\d+)?$/.test(ctx.callbackQuery.data)");
    expect(forcedJoinSource).toContain('{ parse_mode: "HTML", ...joinKeyboard(missing, locale, ctx.from.id) }');
  });

  it("keeps forced-join destination capacity unbounded and exposes actionable save errors", () => {
    const dashboardSource = readFileSync(resolve(process.cwd(), "server/dashboard/router.ts"), "utf8");
    const destinationVerifierSource = readFileSync(resolve(process.cwd(), "server/telegram/forcedJoinDestination.ts"), "utf8");
    const forcedJoinSection = dashboardSource.slice(dashboardSource.indexOf("forcedJoin: router({"), dashboardSource.indexOf("members: router({"));
    expect(forcedJoinSection).toContain("destinationReference: z.string().trim().min(3).max(1024)");
    expect(forcedJoinSection).toContain("resolveForcedJoinDestinationReference");
    expect(forcedJoinSection).toContain("این مقصد پیش‌تر برای همین محدوده ثبت شده است.");
    expect(destinationVerifierSource).toContain("این مقصد در تلگرام پیدا نشد");
    expect(destinationVerifierSource).toContain("لینک‌های دعوت خصوصی قابل تبدیل خودکار نیستند");
    expect(forcedJoinSection).not.toContain("maxActiveChannels: 3");
  });
});
