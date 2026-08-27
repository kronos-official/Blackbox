import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOT_NAME, OWNER_TELEGRAM_ID, resolveOwnerTelegramId } from "./constants";

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Kronos Guard preservation audit", () => {
  it("keeps the bot name and owner access policy stable", () => {
    expect(BOT_NAME).toBe("Kronos Guard");
    expect(resolveOwnerTelegramId("8375579910")).toBe(8375579910);
    expect(OWNER_TELEGRAM_ID).toBe(8375579910);
  });

  it("retains the principal moderation, dashboard, webhook, and scheduled-operation entry points", () => {
    expect(source("server/telegram/bot.ts")).toMatch(/Telegraf|initializeTelegramBot/);
    expect(source("server/telegram/moderation.ts")).toMatch(/antiSpam|antiRaid|warn|mute|ban/i);
    expect(source("server/telegram/routes.ts")).toMatch(/webhook|secret|update/i);
    expect(source("server/telegram/scheduledRoutes.ts")).toMatch(/forced-join|auto-delete|statistics|crypto/i);
    expect(source("server/routers.ts")).toMatch(/dashboard|groups|notifications/i);
  });
});
