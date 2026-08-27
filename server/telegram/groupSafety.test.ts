import { describe, expect, it } from "vitest";
import { appendWindowEvents, calculateRiskScore, classifyLockedContent, DEFAULT_GOODBYE_TEMPLATE, DEFAULT_WELCOME_TEMPLATE, formatLockEnforcementNotice, getRaidModeExpiry, getRaidModeRemaining, getRiskCooldownRemaining, greetingTemplateHelpFa, greetingTemplateInput, isContentLockActorExempt, isExempt, isLinkedChannelAutomaticForward, isRaidModeActive, isRaidWave, matchesFilter, parseGreetingSetting, pruneSafetyWindows, renderTemplate, resolveGreetingTemplate, shouldEnforceGroupLock, shouldEnforceLock } from "./groupSafety";

describe("group safety classification", () => {
  it("classifies the content dimensions controlled by group locks", () => {
    expect(classifyLockedContent({ text: "visit https://example.com @member #topic" })).toEqual(expect.arrayContaining(["text", "link", "mention", "hashtag", "english"]));
    expect(classifyLockedContent({ text: "سلام", photo: {} })).toEqual(expect.arrayContaining(["photo", "persian"]));
    expect(classifyLockedContent({ voice: {}, audio: {}, game: {}, video_note: {} })).toEqual(expect.arrayContaining(["voice", "audio", "game", "video"]));
    expect(classifyLockedContent({ caption: "https://example.com @member", document: { mime_type: "video/mp4", file_name: "loop.mp4" } })).toEqual(expect.arrayContaining(["document", "gif", "link", "mention"]));
    expect(classifyLockedContent({ text: "🙂🙂", reply_to_message: {}, reply_markup: { inline_keyboard: [[]] }, edit_date: 10 })).toEqual(expect.arrayContaining(["emoji", "reply", "inline_button", "edited_message"]));
    expect(classifyLockedContent({ text: "الف".repeat(700) })).toEqual(expect.arrayContaining(["long_message", "persian"]));
    expect(classifyLockedContent({ text: "این یک کسکش است" })).toEqual(expect.arrayContaining(["profanity"]));
  });

  it("covers every supported lock type, including GIF, sticker, captions, and edited messages", () => {
    const fixtures = [
      ["text", { text: "plain" }], ["photo", { photo: {} }], ["video", { video: {} }],
      ["voice", { voice: {} }], ["audio", { audio: {} }], ["sticker", { sticker: {} }],
      ["document", { document: { mime_type: "application/pdf" } }], ["gif", { animation: {} }],
      ["game", { game: {} }], ["forward", { forward_origin: {} }], ["poll", { poll: {} }],
      ["phone", { contact: {} }], ["location", { location: {} }], ["reply", { reply_to_message: {} }],
      ["inline_button", { reply_markup: { inline_keyboard: [[{}]] } }], ["bot", { via_bot: {} }],
      ["edited_message", { edit_date: 1, caption: "edited caption" }], ["command", { text: "/lock" }],
      ["link", { caption: "https://example.com" }], ["mention", { text: "@member" }],
      ["hashtag", { text: "#topic" }], ["english", { text: "hello" }], ["persian", { text: "سلام" }],
      ["long_message", { text: "الف".repeat(700) }], ["emoji", { text: "🙂" }],
      ["profanity", { text: "کسکش" }],
    ] as const;
    for (const [lockType, message] of fixtures) expect(classifyLockedContent(message)).toContain(lockType);
    expect(shouldEnforceLock({ lockType: "all", exemptionRole: "none" }, ["sticker"], "user", false)).toBe(true);
    expect(shouldEnforceLock({ lockType: "gif", exemptionRole: "none" }, classifyLockedContent({ animation: {} }), "user", false)).toBe(true);
  });

  it("preserves only automatic posts from a linked channel while continuing to classify ordinary forwards", () => {
    expect(isLinkedChannelAutomaticForward({ is_automatic_forward: true, sender_chat: { id: -10042, type: "channel" }, forward_origin: {} })).toBe(true);
    expect(isLinkedChannelAutomaticForward({ forward_origin: {} })).toBe(false);
    expect(isLinkedChannelAutomaticForward({ is_automatic_forward: true, sender_chat: { type: "supergroup" } })).toBe(false);
    expect(classifyLockedContent({ forward_origin: {} })).toContain("forward");
  });

  it("supports bounded literal, phrase, and safe regex filtering", () => {
    expect(matchesFilter("spam", "word", "this is spam now")).toBe(true);
    expect(matchesFilter("bad phrase", "phrase", "A bad phrase is here")).toBe(true);
    expect(matchesFilter("^test\\d+$", "regex", "test42")).toBe(true);
    expect(matchesFilter("(a+)+$", "regex", "aaaa")).toBe(false);
  });

  it("applies locks only to non-exempt users and detects flood, duplicates, and raid waves deterministically", () => {
    expect(shouldEnforceLock({ lockType: "link", exemptionRole: "vip" }, ["text", "link"], "user", false)).toBe(true);
    expect(shouldEnforceLock({ lockType: "link", exemptionRole: "vip" }, ["text", "link"], "user", true)).toBe(false);
    expect(isContentLockActorExempt("owner", false)).toBe(true);
    expect(isContentLockActorExempt("global_admin", false)).toBe(true);
    expect(isContentLockActorExempt("group_owner", false)).toBe(true);
    expect(isContentLockActorExempt("group_admin", false)).toBe(true);
    expect(isContentLockActorExempt("moderator", false)).toBe(true);
    expect(isContentLockActorExempt("user", true)).toBe(true);
    expect(isContentLockActorExempt("user", false)).toBe(false);
    expect(shouldEnforceLock({ lockType: "link", exemptionRole: "none" }, ["link"], "group_admin", false)).toBe(false);
    expect(shouldEnforceLock({ lockType: "link", exemptionRole: "none" }, ["link"], "user", true)).toBe(false);
    expect(shouldEnforceLock({ lockType: "link", exemptionRole: "none" }, ["link"], "user", false)).toBe(true);
    expect(isExempt("moderator", "group_admin", false)).toBe(true);
    expect(isExempt("vip", "group_admin", false)).toBe(false);
    expect(isExempt("vip", "group_admin", true)).toBe(true);
    expect(isExempt("admin", "group_admin", false)).toBe(true);
    expect(shouldEnforceGroupLock(true, "owner")).toBe(false);
    expect(shouldEnforceGroupLock(true, "global_admin")).toBe(false);
    expect(shouldEnforceGroupLock(true, "group_owner")).toBe(false);
    expect(shouldEnforceGroupLock(true, "group_admin")).toBe(false);
    expect(shouldEnforceGroupLock(true, "moderator")).toBe(true);
    expect(shouldEnforceGroupLock(true, "user")).toBe(true);
    expect(shouldEnforceGroupLock(false, "user")).toBe(false);
    expect(appendWindowEvents([1_000, 1_500], 1, 1_000, 2_000)).toEqual([1_000, 1_500, 2_000]);
    expect(appendWindowEvents([1_000], 1, 500, 2_000)).toEqual([2_000]);
    expect(isRaidWave(7)).toBe(false);
    expect(isRaidWave(8)).toBe(true);
  });

  it("prunes stale anti-spam state without retaining inactive keys", () => {
    expect(pruneSafetyWindows(Date.now() + 10 * 60_000, 5 * 60_000)).toEqual(expect.objectContaining({ rateKeys: 0, duplicateKeys: 0, joinKeys: 0, cooldownKeys: 0 }));
  });

  it("calculates bounded risk levels and deterministic cooldown recommendations", () => {
    expect(calculateRiskScore({ messageCount: 1, duplicateCount: 0, linkCount: 0, joinVelocity: 0 })).toEqual({ score: 4, level: "low", cooldownSeconds: 0 });
    expect(calculateRiskScore({ messageCount: 8, duplicateCount: 2, linkCount: 1, joinVelocity: 0 })).toEqual({ score: 60, level: "high", cooldownSeconds: 120 });
    expect(calculateRiskScore({ messageCount: 50, duplicateCount: 20, linkCount: 10, joinVelocity: 20, priorModerationSignals: 4 })).toEqual({ score: 100, level: "critical", cooldownSeconds: 300 });
    expect(getRiskCooldownRemaining("unknown-risk-key")).toBe(0);
  });

  it("keeps raid-control activation durable, bounded, and deterministic", () => {
    const now = Date.UTC(2026, 7, 19, 12, 0, 0);
    const expiry = getRaidModeExpiry(now, 900);
    expect(expiry.toISOString()).toBe("2026-08-19T12:15:00.000Z");
    expect(isRaidModeActive(expiry, now)).toBe(true);
    expect(getRaidModeRemaining(expiry, now)).toBe(900);
    expect(getRaidModeRemaining(expiry, now + 899_100)).toBe(1);
    expect(isRaidModeActive(expiry, expiry.getTime())).toBe(false);
    expect(getRaidModeRemaining(expiry, expiry.getTime())).toBe(0);
    expect(isRaidModeActive(null, now)).toBe(false);
  });

  it("creates a clear Persian notice when prohibited content such as a GIF is removed", () => {
    expect(formatLockEnforcementNotice("gif", "delete")).toContain("ارسال گیف در این گروه ممنوع است");
    expect(formatLockEnforcementNotice("gif", "mute")).toContain("دسترسی ارسال پیام نیز موقتاً محدود شد");
  });

  it("parses greeting configuration and renders welcome/goodbye templates safely", () => {
    expect(parseGreetingSetting("welcome on")).toEqual({ field: "welcomeEnabled", value: true });
    expect(parseGreetingSetting("خداحافظ متن بدرود {name} از {group}")).toEqual({ field: "goodbyeMessage", value: "بدرود {name} از {group}" });
    expect(parseGreetingSetting("welcome preview")).toBeUndefined();
    expect(parseGreetingSetting("خداحافظ بازنشانی")).toBeUndefined();
    expect(renderTemplate("خوش آمدی {name} (@{username}) به {group}", { name: "فروزان", username: "forouzan", group: "Kronos" })).toBe("خوش آمدی فروزان (@@forouzan) به Kronos");
    const extended = renderTemplate("{name} [USERID] {chatid} {date} [FIRST_NAME]", { name: "Ada Lovelace", username: "ada", group: "Kronos", telegramUserId: 42, chatId: -1009, now: new Date("2026-08-14T08:30:00Z") });
    expect(extended).toContain("Ada Lovelace");
    expect(extended).toContain("42");
    expect(extended).toContain("-1009");
    expect(extended).toContain("Ada");
    const liveInput = greetingTemplateInput({ id: -1009, title: "Kronos" }, { id: 42, first_name: "Ada", last_name: "Lovelace", username: "ada" });
    expect(renderTemplate("{userid}:{chatid}:{name}", liveInput)).toBe("42:-1009:Ada Lovelace");
  });

  it("uses built-in templates when a greeting template is missing or empty and documents preview/reset commands", () => {
    expect(resolveGreetingTemplate("welcome", null)).toBe(DEFAULT_WELCOME_TEMPLATE);
    expect(resolveGreetingTemplate("goodbye", "   ")).toBe(DEFAULT_GOODBYE_TEMPLATE);
    expect(resolveGreetingTemplate("welcome", "سلام {name}")).toBe("سلام {name}");
    const preview = renderTemplate(resolveGreetingTemplate("welcome", null), { name: "نمونه", group: "گروه نمونه", telegramUserId: 42 });
    expect(preview).toContain("نمونه");
    expect(preview).toContain('tg://user?id=42');
    expect(greetingTemplateHelpFa).toContain("خوشامد پیش‌نمایش");
    expect(greetingTemplateHelpFa).toContain("خداحافظ بازنشانی");
  });

  it("renders documented Persian aliases, Jalali dates, a safe target mention, and Telegram formatting", () => {
    const rendered = renderTemplate("سلام منشن_کاربر به نام_گروه **قوی**\\n> نقل قول\\nتاریخ: اسم_روز، عدد_سال/عدد_ماه/عدد_روز\\nساعت: عدد_ساعت:عدد_دقیقه ایموجی_خودکار", {
      name: "فروزان", group: "Kronos", telegramUserId: 42, locale: "fa", timezone: "Asia/Tehran", now: new Date("2026-08-14T08:30:00Z"),
    });
    expect(rendered).toContain("فروزان");
    expect(rendered).toContain('<a href="tg://user?id=42">فروزان</a>');
    expect(rendered).toContain("<b>قوی</b>");
    expect(rendered).toContain("&gt; نقل قول");
    expect(rendered).toMatch(/[۰-۹]/);
  });

  it("renders independent Jalali and Gregorian dates plus short and complete clocks deterministically", () => {
    const rendered = renderTemplate("{تاریخ_شمسی}|{تاریخ_میلادی}|{ساعت_دقیقه}|{ساعت_دقیقه_ثانیه}", {
      name: "فروزان", group: "Kronos", locale: "fa", timezone: "Asia/Tehran", now: new Date("2026-08-14T08:30:05Z"),
    });
    expect(rendered).toContain("2026");
    expect(rendered).toMatch(/[۰-۹]{2}:[۰-۹]{2}\|[۰-۹]{2}:[۰-۹]{2}:[۰-۹]{2}$/);
    expect(rendered).not.toContain("تاریخ_شمسی");
    expect(rendered).not.toContain("تاریخ_میلادی");
    expect(greetingTemplateHelpFa).toContain("ساعت_دقیقه_ثانیه");
  });
});
