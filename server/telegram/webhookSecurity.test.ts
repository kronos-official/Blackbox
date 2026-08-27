import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { registerTelegramRoutes } from "./routes";
import { WEBHOOK_SECRET_HEADER } from "./webhookSecurity";

describe("Telegram webhook secret validation", () => {
  const server = createServer(express());

  afterEach(async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
    }
  });

  it("accepts the securely configured secret and rejects an invalid secret over HTTP", async () => {
    const suppliedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    expect(suppliedSecret, "TELEGRAM_WEBHOOK_SECRET must be securely configured").toBeTruthy();
    expect(suppliedSecret!.length).toBeGreaterThanOrEqual(16);

    const app = express();
    app.use(express.json());
    registerTelegramRoutes(app, {
      initializeBot: async () => undefined,
      dispatchUpdate: async () => ({ duplicate: false }),
    });
    const testServer = createServer(app);
    await new Promise<void>(resolve => testServer.listen(0, "127.0.0.1", resolve));
    const address = testServer.address();
    if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP address");

    try {
      const accepted = await fetch(`http://127.0.0.1:${address.port}/api/telegram/webhook`, {
        method: "POST",
        headers: { [WEBHOOK_SECRET_HEADER]: suppliedSecret!, "Content-Type": "application/json" },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(accepted.status).toBe(200);

      const rejected = await fetch(`http://127.0.0.1:${address.port}/api/telegram/webhook`, {
        method: "POST",
        headers: { [WEBHOOK_SECRET_HEADER]: "not-the-configured-secret", "Content-Type": "application/json" },
        body: JSON.stringify({ update_id: 2 }),
      });
      expect(rejected.status).toBe(401);
    } finally {
      await new Promise<void>((resolve, reject) => testServer.close(error => (error ? reject(error) : resolve())));
    }
  });
});
