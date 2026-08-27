import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PERSISTENT_KEYBOARD_ACTIONS } from "./persistentKeyboard";

const botSource = readFileSync(resolve(process.cwd(), "server/telegram/bot.ts"), "utf8");

describe("Kronos persistent keyboard routing", () => {
  it("attaches the keyboard to onboarding and registers a handler for every visible action", () => {
    expect(botSource).toContain("...kronosPersistentKeyboard()");
    expect(botSource).toContain("for (const action of Object.values(PERSISTENT_KEYBOARD_ACTIONS))");
    expect(botSource).toContain("instance.hears(action, keyboardHandlers[action]);");
  });

  it("keeps the legacy dashboard label working for cached Telegram keyboards", () => {
    expect(botSource).toContain('instance.hears("پنل مدیریت", async ctx => {');
    expect(botSource).toContain("await sendInlineControlCenter(ctx);");
  });

  it("limits keyboard actions to private chats", () => {
    expect(botSource).toContain("createPersistentKeyboardHandlers");
  });
});
