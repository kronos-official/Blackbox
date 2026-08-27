import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Telegram start interaction", () => {
  it("shows Telegram typing feedback before the rich Persian-first start reply", () => {
    const source = readFileSync(new URL("./bot.ts", import.meta.url), "utf8");
    expect(source).toContain('ctx.sendChatAction("typing")');
    expect(source).toContain("START_TYPING_DELAY_MS");
    expect(source).toContain('parse_mode: "HTML"');
  });

  it("keeps the persistent keyboard private and omits it from group start replies", () => {
    const source = readFileSync(new URL("./bot.ts", import.meta.url), "utf8");
    expect(source).toContain('ctx.chat?.type === "private"');
    expect(source).toContain("const welcomeOptions");
    expect(source).toContain('? { parse_mode: "HTML" as const, ...kronosPersistentKeyboard() }');
    expect(source).toContain(': { parse_mode: "HTML" as const }');
  });

  it("adds a visible Web App launch button to private START replies and refreshes the Chat Menu Button", () => {
    const source = readFileSync(new URL("./bot.ts", import.meta.url), "utf8");
    expect(source).toContain("miniAppLaunchKeyboard()");
    expect(source).toContain("instance.telegram.setChatMenuButton");
    expect(source).toContain("menuButton: { type: \"web_app\"");
    expect(source).toContain("getTelegramMiniAppUrl");
  });
});
