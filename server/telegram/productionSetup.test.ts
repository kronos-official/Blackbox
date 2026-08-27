import { describe, expect, it } from "vitest";
import { configureTelegramProduction, groupActivationMessage, groupActivationMessageOptions, groupPermissionRequiredMessage, productionTelegramUrls, shouldAnnounceBotMembershipTransition, type TelegramProductionClient } from "./productionSetup";
import { OWNER_TELEGRAM_ID } from "./constants";

describe("production Telegram setup URLs", () => {
  it("derives the webhook and Mini App URLs only from a clean public HTTPS root domain", () => {
    expect(productionTelegramUrls("https://kronos-guard.manus.space/")).toEqual({ baseUrl: "https://kronos-guard.manus.space", webhookUrl: "https://kronos-guard.manus.space/api/telegram/webhook", miniAppUrl: "https://kronos-guard.manus.space/dashboard" });
  });

  it("rejects insecure, local, credential-bearing, and path-bearing input", () => {
    for (const candidate of ["http://kronos.example", "https://localhost", "https://user:pass@kronos.example", "https://kronos.example/unsafe"]) {
      expect(() => productionTelegramUrls(candidate)).toThrow();
    }
  });

  it("enforces owner and secret requirements before making Telegram API calls", async () => {
    const client: TelegramProductionClient = { setWebhook: async () => undefined, setChatMenuButton: async () => undefined, setMyCommands: async () => undefined };
    await expect(configureTelegramProduction({ actorTelegramId: 1, rawDomain: "https://kronos.example", webhookSecret: "a".repeat(32), client })).rejects.toThrow("owner-only");
    await expect(configureTelegramProduction({ actorTelegramId: OWNER_TELEGRAM_ID, rawDomain: undefined, webhookSecret: "a".repeat(32), client })).rejects.toThrow("missing-domain");
    await expect(configureTelegramProduction({ actorTelegramId: OWNER_TELEGRAM_ID, rawDomain: "https://kronos.example", webhookSecret: undefined, client })).rejects.toThrow("missing-webhook-secret");
  });

  it("configures the secure webhook and owner Mini App menu with the derived production URLs", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const client: TelegramProductionClient = { setWebhook: async (...args) => { calls.push({ method: "webhook", args }); }, setChatMenuButton: async (...args) => { calls.push({ method: "menu", args }); }, setMyCommands: async (...args) => { calls.push({ method: "commands", args }); } };
    const urls = await configureTelegramProduction({ actorTelegramId: OWNER_TELEGRAM_ID, rawDomain: "https://kronos-guard.manus.space", webhookSecret: "s".repeat(32), client });
    expect(urls.webhookUrl).toBe("https://kronos-guard.manus.space/api/telegram/webhook");
    expect(calls).toEqual([
      { method: "webhook", args: ["https://kronos-guard.manus.space/api/telegram/webhook", { secret_token: "s".repeat(32), allowed_updates: ["message", "callback_query", "chat_member", "my_chat_member", "pre_checkout_query"] }] },
      { method: "menu", args: [{ menu_button: { type: "web_app", text: "Kronos Guard", web_app: { url: "https://kronos-guard.manus.space/dashboard" } } }] },
      { method: "commands", args: [expect.arrayContaining([expect.objectContaining({ command: "start" }), expect.objectContaining({ command: "help" }), expect.objectContaining({ command: "ban" }), expect.objectContaining({ command: "delete" }), expect.objectContaining({ command: "clear" }), expect.objectContaining({ command: "unmute" }), expect.objectContaining({ command: "tag" })])] },
    ]);
  });

  it("builds a professional permission warning for a newly added non-admin bot", () => {
    const message = groupPermissionRequiredMessage("گروه آزمایشی");
    expect(message).toContain("گروه آزمایشی");
    expect(message).toContain("مدیر");
    expect(message).toContain("ارتقا");
    expect(message).toContain("دسترسی");
  });

  it("builds a concise, formatted activation message with the requested support contact", () => {
    const message = groupActivationMessage("گروه آزمایشی");
    expect(message).toContain("گروه آزمایشی");
    expect(message).toContain("\u200F✦");
    expect(message).toContain("\u2068گروه آزمایشی\u2069");
    expect(message).toContain("𝐾𝑟𝑜𝑛𝑜𝑠 𝐺𝑢𝑎𝑟𝑑");
    expect(message).toContain("𝑀𝑖𝑛𝑖 𝐴𝑝𝑝");
    expect(message).toContain("<b>");
    expect(message).toContain("<i>");
    expect(message).toContain("<blockquote>");
    expect(message).not.toContain("نمونه:");
    expect(message).toContain("همگام‌سازی خودکار مالک و مدیران");
    expect(message).toContain('<a href="https://t.me/kronosteam_official">\u2068𝐾𝑟𝑜𝑛𝑜𝑠 𝑆𝑢𝑝𝑝𝑜𝑟𝑡\u2069</a>');
    expect(message).not.toContain("@kronostam_official");
    expect(message).not.toContain("Kronos مدیریت");
  });

  it("sends the activation message in HTML mode with the automatic-role button", () => {
    expect(groupActivationMessageOptions()).toEqual({
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: [[{ text: "راه‌اندازی خودکار مدیران", callback_data: "group-role-bootstrap" }]] },
    });
  });

  it("announces only meaningful transitions and not repeated status updates", () => {
    expect(shouldAnnounceBotMembershipTransition("left", "member")).toBe("permission");
    expect(shouldAnnounceBotMembershipTransition("member", "administrator")).toBe("activation");
    expect(shouldAnnounceBotMembershipTransition("administrator", "administrator")).toBe(false);
    expect(shouldAnnounceBotMembershipTransition("member", "restricted")).toBe(false);
  });
});
