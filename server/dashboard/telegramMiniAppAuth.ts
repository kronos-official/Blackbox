import { createHmac, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { ENV } from "../_core/env";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";

const SESSION_AUDIENCE = "kronos-dashboard";
const MAX_INIT_DATA_AGE_SECONDS = 15 * 60;

function signingKey() {
  if (!ENV.cookieSecret) throw new Error("Dashboard signing key is not configured");
  return new TextEncoder().encode(ENV.cookieSecret);
}

function botToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram bot token is not configured");
  return token;
}

export type VerifiedTelegramDashboardUser = { telegramUserId: number; firstName?: string; username?: string; photoUrl?: string };

/** Validates Telegram's signed Web App initData and freshness for the current Telegram identity. */
export function verifyTelegramMiniAppInitData(initData: string, now = Date.now()): VerifiedTelegramDashboardUser {
  const params = new URLSearchParams(initData);
  const providedHash = params.get("hash");
  const rawUser = params.get("user");
  const authDate = Number(params.get("auth_date"));
  if (!providedHash || !rawUser || !Number.isSafeInteger(authDate) || Math.abs(Math.floor(now / 1000) - authDate) > MAX_INIT_DATA_AGE_SECONDS) {
    throw new Error("Telegram Mini App authorization data is missing or expired");
  }
  params.delete("hash");
  const dataCheckString = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken()).digest();
  const calculatedHash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const expected = Buffer.from(calculatedHash, "hex");
  const actual = Buffer.from(providedHash, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Telegram Mini App signature is invalid");
  const parsed = JSON.parse(rawUser) as { id?: number; first_name?: string; username?: string; photo_url?: string };
  if (typeof parsed.id !== "number" || !Number.isSafeInteger(parsed.id)) throw new Error("Telegram Mini App user identity is invalid");
  return { telegramUserId: parsed.id, firstName: parsed.first_name, username: parsed.username, photoUrl: parsed.photo_url };
}

export async function issueDashboardSession(user: VerifiedTelegramDashboardUser) {
  return new SignJWT({ telegramUserId: user.telegramUserId, firstName: user.firstName ?? null, username: user.username ?? null, photoUrl: user.photoUrl ?? null })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(signingKey());
}

export async function verifyDashboardSession(token: string) {
  const { payload } = await jwtVerify(token, signingKey(), { audience: SESSION_AUDIENCE });
  if (typeof payload.telegramUserId !== "number" || !Number.isSafeInteger(payload.telegramUserId)) throw new Error("Dashboard session subject is invalid");
  return { telegramUserId: payload.telegramUserId, firstName: typeof payload.firstName === "string" ? payload.firstName : undefined, username: typeof payload.username === "string" ? payload.username : undefined, photoUrl: typeof payload.photoUrl === "string" ? payload.photoUrl : undefined };
}

/** Backward-compatible exports retained for existing callers and migration-safe test fixtures. */
export const issueOwnerDashboardSession = issueDashboardSession;
export const verifyOwnerDashboardSession = verifyDashboardSession;
