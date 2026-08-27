import { beforeEach, describe, expect, it } from "vitest";
import { getTelegramMiniAppUrl, languageSelectorKeyboard, miniAppLaunchKeyboard, numericIdNativeKeyboard, NUMERIC_ID_NATIVE_REQUEST_IDS, PERSISTENT_KEYBOARD_ACTIONS, kronosPersistentKeyboard } from "./persistentKeyboard";

describe("Kronos persistent Telegram keyboard", () => {
  beforeEach(() => {
    delete process.env.TELEGRAM_PUBLIC_BASE_URL;
  });
  it("provides one Persian-first extraction action in a persistent compact layout", () => {
    const markup = kronosPersistentKeyboard();
    const labels = markup.reply_markup.keyboard.flat().map(button => typeof button === "string" ? button : button.text);

    const visibleActions = [PERSISTENT_KEYBOARD_ACTIONS.numericId];
    expect(labels).toEqual(visibleActions);
    expect(markup.reply_markup.resize_keyboard).toBe(true);
    expect(markup.reply_markup.is_persistent).toBe(true);
    expect(markup.reply_markup.input_field_placeholder).toContain("Kronos Guard");
    expect(labels.join(" ")).not.toMatch(/[🟦🟩🔗↗️]/u);
  });

  it("uses Telegram-native request buttons for all four extraction categories", () => {
    const cases = [
      ["user", NUMERIC_ID_NATIVE_REQUEST_IDS.user, "request_users"],
      ["bot", NUMERIC_ID_NATIVE_REQUEST_IDS.bot, "request_users"],
      ["group", NUMERIC_ID_NATIVE_REQUEST_IDS.group, "request_chat"],
      ["channel", NUMERIC_ID_NATIVE_REQUEST_IDS.channel, "request_chat"],
    ] as const;
    for (const [kind, requestId, field] of cases) {
      const keyboard = numericIdNativeKeyboard(kind);
      const button = keyboard.reply_markup.keyboard[0][0];
      expect(button).toMatchObject({ text: expect.stringContaining("Telegram"), [field]: expect.objectContaining({ request_id: requestId }) });
      expect(keyboard.reply_markup.one_time_keyboard).toBe(true);
    }
  });

  it("exposes a direct Mini App Web App button with the published dashboard URL", () => {
    const miniAppUrl = getTelegramMiniAppUrl("https://kronos-guard.manus.space/");
    const keyboard = miniAppLaunchKeyboard(miniAppUrl);
    expect(keyboard.reply_markup.inline_keyboard).toEqual([[{ hide: false, text: "باز کردن Mini App", web_app: { url: "https://kronos-guard.manus.space/dashboard" }, style: "primary" }]]);
  });

  it("refuses missing, non-HTTPS, local, or path-bearing public Mini App origins", () => {
    for (const origin of [undefined, "http://kronos.example", "https://localhost", "https://kronos.example/unsafe"]) {
      expect(getTelegramMiniAppUrl(origin)).toBeNull();
    }
  });

  it("offers every supported language as an individual callback button", () => {
    const keyboard = languageSelectorKeyboard();
    const callbacks = keyboard.reply_markup.inline_keyboard.flat().map(button => button.callback_data);
    expect(callbacks).toEqual(["language:fa", "language:en", "language:ar", "language:tr", "language:ru", "language:es", "language:fr", "language:pt", "language:it", "language:de", "language:pl", "language:vi"]);
  });
});
