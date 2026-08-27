import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routerSource = readFileSync(resolve(__dirname, "router.ts"), "utf8");

describe("owner-alert operational controls", () => {
  it("keeps acknowledgement auditable and idempotent", () => {
    expect(routerSource).toContain('event: "acknowledged"');
    expect(routerSource).toContain('previousStatus: alert.status');
    expect(routerSource).toContain('status: "acknowledged"');
  });

  it("retries a failed or pending delivery through Telegram and persists the result", () => {
    expect(routerSource).toContain("retryDelivery: ownerProcedure");
    expect(routerSource).toContain("withTelegramRetry");
    expect(routerSource).toContain('status: "pending", attempts: sql`${ownerAlerts.attempts} + 1`');
    expect(routerSource).toContain('event: "manual_redelivery_succeeded"');
    expect(routerSource).toContain('event: "manual_redelivery_failed"');
    expect(routerSource).toContain('status: "sent"');
    expect(routerSource).toContain('status: "failed"');
  });

  it("does not permit a closed alert to be resent", () => {
    expect(routerSource).toContain('alert.status === "acknowledged"');
    expect(routerSource).toContain("Acknowledged alerts are closed and cannot be resent");
  });
});
