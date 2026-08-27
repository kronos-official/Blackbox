import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(resolve(process.cwd(), "client/src/pages/OwnerDashboard.tsx"), "utf8");
const routerSource = readFileSync(resolve(process.cwd(), "server/dashboard/router.ts"), "utf8");

describe("marketplace Stars-only settings", () => {
  it("keeps the owner settings form focused on Telegram Stars pricing", () => {
    const settingsStart = dashboardSource.indexOf("function Settings() {");
    const settingsEnd = dashboardSource.indexOf("function ConnectedGroups()", settingsStart);
    const settingsSource = dashboardSource.slice(settingsStart, settingsEnd);

    expect(settingsSource).toContain("STARS SETTINGS");
    expect(settingsSource).toContain("تنظیمات Stars");
    expect(settingsSource).toContain("starsPerDay");
    expect(settingsSource).toContain("starsMarketRate");
    expect(dashboardSource).toContain("نرخ واقعی مرجع Stars");
    expect(dashboardSource).toContain("ماشین‌حساب تبدیل Stars");
    expect(dashboardSource).toContain("stars-reference-calculator");
    expect(dashboardSource).not.toContain("نمودار کندلی نرخ مرجع");
    expect(settingsSource).not.toContain("cryptoWallets");
    expect(settingsSource).not.toContain("form.wallets");
    expect(settingsSource).not.toContain("walletAddress");
    expect(settingsSource).not.toContain("cardRecipientName");
    expect(settingsSource).not.toContain("cardNumber");
    expect(settingsSource).not.toContain("iranRialsPerDay");
  });

  it("accepts only the Stars rate in the settings mutation", () => {
    const saveSettingsStart = routerSource.indexOf("saveSettings: ownerProcedure");
    const saveSettingsEnd = routerSource.indexOf("payments: ownerProcedure", saveSettingsStart);
    const saveSettingsSource = routerSource.slice(saveSettingsStart, saveSettingsEnd);

    expect(saveSettingsSource).toContain("starsPerDay");
    expect(saveSettingsSource).not.toContain("cryptoWallets");
    expect(saveSettingsSource).not.toContain("cardRecipientName");
    expect(saveSettingsSource).not.toContain("walletSchema");
  });

  it("keeps the reference-rate endpoint owner-only and separate from persisted settings", () => {
    const marketRateStart = routerSource.indexOf("starsMarketRate: ownerProcedure");
    const marketRateEnd = routerSource.indexOf("payments: ownerProcedure", marketRateStart);
    const marketRateSource = routerSource.slice(marketRateStart, marketRateEnd);

    expect(marketRateSource).toContain("getStarsReferenceMarketData");
    expect(marketRateSource).toContain("return null");
  });
});
