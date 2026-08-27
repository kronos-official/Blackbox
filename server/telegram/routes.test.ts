import express from "express";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { GROUP_LINK_ACCESS_POLICY_REVISION } from "./groupInfo";
import { registerTelegramRoutes } from "./routes";

const SECRET = "test-webhook-secret-123456";

async function withServer(run: (baseUrl: string) => Promise<void>, options: Parameters<typeof registerTelegramRoutes>[1]) {
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  const app = express();
  app.use(express.json());
  registerTelegramRoutes(app, options);
  const server: Server = await new Promise(resolve => {
    const instance = createServer(app);
    instance.listen(0, () => resolve(instance));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not expose a port");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
}

afterEach(() => {
  delete process.env.TELEGRAM_WEBHOOK_SECRET;
});

describe("Telegram webhook initialization gate", () => {
  it("exposes the non-sensitive deployed link-access policy revision", async () => {
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/status`);
      expect(response.status).toBe(200);
      const payload = await response.json() as { linkAccessPolicyRevision?: string };
      expect(payload.linkAccessPolicyRevision).toBe(GROUP_LINK_ACCESS_POLICY_REVISION);
    }, {});
  });

  it("initializes the bot before dispatching the first update", async () => {
    const events: string[] = [];
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/telegram/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": SECRET,
        },
        body: JSON.stringify({ update_id: 701, message: { text: "/start" } }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, duplicate: false });
    }, {
      initializeBot: async () => {
        events.push("initialized");
      },
      dispatchUpdate: async () => {
        events.push("dispatched");
        return { duplicate: false };
      },
    });
    expect(events).toEqual(["initialized", "dispatched"]);
  });

  it("acknowledges a production-style update before slow initialization and background dispatch", async () => {
    const events: string[] = [];
    await withServer(async baseUrl => {
      const startedAt = Date.now();
      const response = await fetch(`${baseUrl}/api/telegram/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SECRET },
        body: JSON.stringify({ update_id: 705, message: { text: "/start" } }),
      });
      expect(response.status).toBe(200);
      expect(Date.now() - startedAt).toBeLessThan(100);
      expect(await response.json()).toEqual({ ok: true, duplicate: false });
      await new Promise(resolve => setTimeout(resolve, 35));
    }, {
      claimUpdate: async () => { events.push("claimed"); return true; },
      initializeBot: async () => { await new Promise(resolve => setTimeout(resolve, 20)); events.push("initialized"); },
      processClaimedUpdate: async () => { events.push("dispatched"); },
    });
    expect(events).toEqual(["claimed", "initialized", "dispatched"]);
  });

  it("returns unavailable and does not dispatch when initialization fails", async () => {
    let dispatched = false;
    await withServer(async baseUrl => {
      const response = await fetch(`${baseUrl}/api/telegram/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": SECRET,
        },
        body: JSON.stringify({ update_id: 702, message: { text: "/start" } }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, error: "telegram_processing_unavailable" });
    }, {
      initializeBot: async () => {
        throw new Error("initialization unavailable");
      },
      dispatchUpdate: async () => {
        dispatched = true;
        return { duplicate: false };
      },
    });
    expect(dispatched).toBe(false);
  });

  it("retries initialization after a transient boot failure", async () => {
    let initializationAttempts = 0;
    let dispatched = 0;
    await withServer(async baseUrl => {
      const request = (update_id: number) => fetch(`${baseUrl}/api/telegram/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": SECRET,
        },
        body: JSON.stringify({ update_id, message: { text: "/start" } }),
      });
      const first = await request(703);
      expect(first.status).toBe(503);
      const second = await request(704);
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ ok: true, duplicate: false });
    }, {
      initializeBot: async () => {
        initializationAttempts += 1;
        if (initializationAttempts === 1) throw new Error("transient initialization failure");
      },
      dispatchUpdate: async () => {
        dispatched += 1;
        return { duplicate: false };
      },
    });
    expect(initializationAttempts).toBe(2);
    expect(dispatched).toBe(1);
  });
});
