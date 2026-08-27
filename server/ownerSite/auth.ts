import crypto from "node:crypto";
import type { Request, Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import { parse as parseCookie } from "cookie";
import { getDb } from "../db";
import { ownerSiteCredentials } from "../../drizzle/schema";
import { ENV } from "../_core/env";

export const OWNER_SITE_COOKIE = "kronos_owner_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PASSWORD_SALT = "kronos-guard-owner-password-v1";

function secretKey() { return new TextEncoder().encode(ENV.cookieSecret || "kronos-owner-session-secret"); }
function digest(value: string) { return crypto.scryptSync(value, PASSWORD_SALT, 32); }
function digestHex(value: string) { return digest(value).toString("hex"); }
function safeEqualText(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && crypto.timingSafeEqual(a, b); }

async function configuredCredential() {
  const db = await getDb();
  if (db) {
    const row = (await db.select().from(ownerSiteCredentials).orderBy(desc(ownerSiteCredentials.id)).limit(1))[0];
    if (row) return { username: row.username, passwordHash: row.passwordHash };
  }
  const username = process.env.OWNER_SITE_USERNAME ?? "";
  const password = process.env.OWNER_SITE_PASSWORD ?? "";
  return { username, passwordHash: password ? digestHex(password) : "" };
}

export async function validateOwnerCredentials(username: string, password: string) {
  const expected = await configuredCredential();
  return expected.username.length >= 4 && expected.passwordHash.length > 0 && safeEqualText(username, expected.username) && safeEqualText(digestHex(password), expected.passwordHash);
}

export async function saveOwnerCredentials(username: string, password: string) {
  const db = await getDb();
  if (!db) throw new Error("database_unavailable");
  const existing = (await db.select({ id: ownerSiteCredentials.id }).from(ownerSiteCredentials).orderBy(desc(ownerSiteCredentials.id)).limit(1))[0];
  if (existing) await db.update(ownerSiteCredentials).set({ username, passwordHash: digestHex(password) }).where(eq(ownerSiteCredentials.id, existing.id));
  else await db.insert(ownerSiteCredentials).values({ username, passwordHash: digestHex(password) });
}

export async function createOwnerSession(username: string) {
  return new SignJWT({ scope: "owner-site", username }).setProtectedHeader({ alg: "HS256" }).setSubject("owner-site").setIssuedAt().setExpirationTime(`${SESSION_TTL_SECONDS}s`).sign(secretKey());
}

export async function verifyOwnerSession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"], subject: "owner-site" });
    if (payload.scope !== "owner-site" || typeof payload.username !== "string") return null;
    return { username: payload.username };
  } catch { return null; }
}

export async function getOwnerSiteSession(req: Request) { return verifyOwnerSession(parseCookie(req.headers.cookie ?? "")[OWNER_SITE_COOKIE]); }
export function setOwnerSessionCookie(res: Response, token: string) { res.setHeader("Set-Cookie", `${OWNER_SITE_COOKIE}=${encodeURIComponent(token)}; HttpOnly; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`); }
export function clearOwnerSessionCookie(res: Response) { res.setHeader("Set-Cookie", `${OWNER_SITE_COOKIE}=; HttpOnly; ${process.env.NODE_ENV === "production" ? "Secure; " : ""}SameSite=Lax; Path=/; Max-Age=0`); }

const failedAttempts = new Map<string, { count: number; resetAt: number }>();
export function isLoginRateLimited(ip: string) { const record = failedAttempts.get(ip); return Boolean(record && record.resetAt > Date.now() && record.count >= 8); }
export function recordFailedLogin(ip: string) { const current = failedAttempts.get(ip); const record = current && current.resetAt > Date.now() ? current : { count: 0, resetAt: Date.now() + 15 * 60_000 }; record.count += 1; failedAttempts.set(ip, record); }
export function clearFailedLogins(ip: string) { failedAttempts.delete(ip); }
