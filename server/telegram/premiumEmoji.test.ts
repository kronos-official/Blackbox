import { describe, expect, it } from "vitest";
import { enrichTelegramApiPayloadWithPremiumEmoji, KRONOS_PREMIUM_EMOJI, normalizeBotNumerals, renderPremiumEmoji, renderTelegramVisibleEmoji } from "./premiumEmoji";

describe("premiumEmoji", () => {
  it("renders curated semantic Emoji as Telegram HTML custom-emoji entities", () => {
    const rendered = renderPremiumEmoji("✅ عملیات انجام شد ⚠️ بررسی کنید");
    expect(rendered).toContain(`<tg-emoji emoji-id="${KRONOS_PREMIUM_EMOJI.success.id}">✅</tg-emoji>`);
    expect(rendered).toContain(`<tg-emoji emoji-id="${KRONOS_PREMIUM_EMOJI.warning.id}">⚠️</tg-emoji>`);
  });

  it("keeps safe message text visible as Unicode by default", () => {
    expect(enrichTelegramApiPayloadWithPremiumEmoji("sendMessage", { text: "🔒 گروه ایمن است" })).toEqual({
      text: "🔒 گروه ایمن است",
    });
    expect(renderTelegramVisibleEmoji("✅ عملیات انجام شد")).toBe("✅ عملیات انجام شد");
  });

  it("does not force HTML parsing onto Markdown, unescaped markup, or keyboard labels", () => {
    const markdown = { text: "✅ **تأیید**", parse_mode: "MarkdownV2" };
    const rawMarkup = { text: "✅ <raw>" };
    const keyboard = { reply_markup: { inline_keyboard: [[{ text: "✅ تأیید", callback_data: "confirm" }]] } };
    expect(enrichTelegramApiPayloadWithPremiumEmoji("sendMessage", markdown)).toBe(markdown);
    expect(enrichTelegramApiPayloadWithPremiumEmoji("sendMessage", rawMarkup)).toStrictEqual(rawMarkup);
    expect(enrichTelegramApiPayloadWithPremiumEmoji("answerCallbackQuery", keyboard)).toBe(keyboard);
  });

  it("adds a restrained visible Unicode brand marker to safe text that has no semantic Emoji yet", () => {
    expect(enrichTelegramApiPayloadWithPremiumEmoji("sendMessage", { text: "راهنما آماده است" })).toEqual({
      text: "✨ راهنما آماده است",
    });
  });

  it("normalizes Persian and Arabic-Indic digits to English without changing Persian copy", () => {
    expect(normalizeBotNumerals("کاربر ۱۲۳ در ساعت ٠٩:۴۵"))
      .toBe("کاربر 123 در ساعت 09:45");
    expect(enrichTelegramApiPayloadWithPremiumEmoji("sendMessage", { text: "اخطار فعال: ۳" }))
      .toEqual({
        text: "✨ اخطار فعال: 3",
      });
  });
});
