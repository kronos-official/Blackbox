import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(new URL("./router.ts", import.meta.url), "utf8");
const notificationsSource = readFileSync(new URL("../notifications.ts", import.meta.url), "utf8");

describe("global private notification delivery API", () => {
  it("persists the signed Telegram user's delivery choice through an audited dashboard contract", () => {
    expect(notificationsSource).toContain("export async function getUserPrivateDelivery");
    expect(notificationsSource).toContain("export async function setUserPrivateDelivery");
    expect(routerSource).toContain("getPrivateDelivery: dashboardProcedure.query");
    expect(routerSource).toContain("setPrivateDelivery: dashboardProcedure.input");
    expect(routerSource).toContain('event: "notification_private_delivery_updated"');
  });
});
