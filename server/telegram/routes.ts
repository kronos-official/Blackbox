import type { Express, Request, Response } from "express";
import type { Update } from "telegraf/types";
import { claimTelegramUpdate, dispatchTelegramUpdate, initializeTelegramBot, processClaimedTelegramUpdate } from "./bot";
import { GROUP_LINK_ACCESS_POLICY_REVISION } from "./groupInfo";
import { isVerifiedTelegramWebhook } from "./webhookSecurity";

export type BotRuntimeState = {
  botReady: boolean;
  databaseReady: boolean;
  build: string;
};

export const botRuntimeState: BotRuntimeState = {
  botReady: false,
  databaseReady: Boolean(process.env.DATABASE_URL),
  build: process.env.npm_package_version ?? "development",
};

export type TelegramRouteOptions = {
  dispatchUpdate?: (update: Update) => Promise<{ duplicate: boolean }>;
  initializeBot?: () => Promise<void>;
  claimUpdate?: (update: Update) => Promise<boolean>;
  processClaimedUpdate?: (update: Update) => Promise<void>;
};

/** Public liveness/readiness routes required by the hosting platform. */
export function registerTelegramRoutes(app: Express, options: TelegramRouteOptions = {}) {
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true, service: "kronos-guard", timestamp: new Date().toISOString() });
  });

  app.get("/ready", (_req: Request, res: Response) => {
    const ready = botRuntimeState.databaseReady;
    res.status(ready ? 200 : 503).json({ ok: ready, database: botRuntimeState.databaseReady, bot: botRuntimeState.botReady });
  });

  app.get("/status", (_req: Request, res: Response) => {
    res.status(200).json({
      service: "kronos-guard",
      bot: botRuntimeState.botReady ? "ready" : "initializing",
      database: botRuntimeState.databaseReady ? "ready" : "unavailable",
      build: botRuntimeState.build,
      linkAccessPolicyRevision: GROUP_LINK_ACCESS_POLICY_REVISION,
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    if (!isVerifiedTelegramWebhook(req)) {
      return res.status(401).json({ ok: false, error: "invalid_webhook_secret" });
    }
    if (!req.body || typeof req.body.update_id !== "number") {
      return res.status(400).json({ ok: false, error: "invalid_telegram_update" });
    }
    try {
      const update = req.body as Update;
      if (!options.dispatchUpdate) {
        const claimUpdate = options.claimUpdate ?? claimTelegramUpdate;
        const processUpdate = options.processClaimedUpdate ?? processClaimedTelegramUpdate;
        const claimed = await claimUpdate(update);
        res.status(200).json({ ok: true, duplicate: !claimed });
        if (claimed) {
          const initializeBot = options.initializeBot ?? initializeTelegramBot;
          void Promise.resolve().then(async () => {
            await initializeBot();
            botRuntimeState.botReady = true;
            await processUpdate(update);
          }).catch(error => console.error("[Kronos Guard] Telegram background dispatch failed", error));
        }
        return;
      }
      const initializeBot = options.initializeBot ?? initializeTelegramBot;
      await initializeBot();
      botRuntimeState.botReady = true;
      {
      const handler = options.dispatchUpdate ?? dispatchTelegramUpdate;
      const result = await handler(update);
      return res.status(200).json({ ok: true, duplicate: result.duplicate });
      }
    } catch (error) {
      console.error("[Kronos Guard] Telegram webhook dispatch failed", error);
      return res.status(503).json({ ok: false, error: "telegram_processing_unavailable" });
    }
  });
}
