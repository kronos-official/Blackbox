import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

export const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

/**
 * Uses constant-time comparison to prevent information leakage from an attacker
 * probing Telegram's webhook verification header.
 */
export function hasValidWebhookSecret(received: string | undefined, configured = process.env.TELEGRAM_WEBHOOK_SECRET): boolean {
  if (!received || !configured || configured.length < 16) return false;
  const receivedBuffer = Buffer.from(received, "utf8");
  const configuredBuffer = Buffer.from(configured, "utf8");
  if (receivedBuffer.length !== configuredBuffer.length) return false;
  return timingSafeEqual(receivedBuffer, configuredBuffer);
}

export function isVerifiedTelegramWebhook(req: Request): boolean {
  const value = req.header(WEBHOOK_SECRET_HEADER) ?? undefined;
  return hasValidWebhookSecret(value);
}
