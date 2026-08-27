import crypto from "node:crypto";
import type { Express, Request } from "express";
import { clearFailedLogins, clearOwnerSessionCookie, createOwnerSession, getOwnerSiteSession, isLoginRateLimited, recordFailedLogin, saveOwnerCredentials, setOwnerSessionCookie, validateOwnerCredentials } from "./auth";
import { getTelegramBot } from "../telegram/bot";
import { writeAuditLog } from "../telegram/repository";

function clientIp(req: Request) { return String(req.ip || req.socket.remoteAddress || "unknown"); }
const recoveryCodes = new Map<string, { hash: string; expiresAt: number }>();
function codeHash(code: string) { return crypto.createHash("sha256").update(code).digest("hex"); }

export function registerOwnerAuthRoutes(app: Express) {
  app.post("/api/owner-auth/login", async (req, res) => {
    const ip = clientIp(req);
    if (isLoginRateLimited(ip)) return res.status(429).json({ error: "too_many_attempts", message: "تلاش‌های ورود بیش از حد مجاز است. ۱۵ دقیقه بعد دوباره تلاش کنید." });
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!(await validateOwnerCredentials(username, password))) {
      recordFailedLogin(ip);
      return res.status(401).json({ error: "invalid_credentials", message: "نام کاربری یا گذرواژه نادرست است." });
    }
    clearFailedLogins(ip);
    setOwnerSessionCookie(res, await createOwnerSession(username));
    return res.json({ success: true, username });
  });

  app.get("/api/owner-auth/session", async (req, res) => {
    const session = await getOwnerSiteSession(req);
    if (!session) return res.status(401).json({ authenticated: false });
    return res.json({ authenticated: true, username: session.username });
  });

  app.post("/api/owner-auth/logout", (_req, res) => { clearOwnerSessionCookie(res); return res.json({ success: true }); });

  app.post("/api/owner-auth/recovery/start", async (_req, res) => {
    const ownerTelegramId = Number(process.env.OWNER_TELEGRAM_ID || 0);
    const bot = getTelegramBot();
    if (!ownerTelegramId || !bot) return res.status(503).json({ error: "telegram_unavailable", message: "تأیید تلگرام مالک موقتاً در دسترس نیست." });
    const code = String(crypto.randomInt(100000, 1000000));
    recoveryCodes.set("owner", { hash: codeHash(code), expiresAt: Date.now() + 10 * 60_000 });
    try {
      await bot.telegram.sendMessage(ownerTelegramId, `کد بازیابی پنل مالک Kronos Guard: ${code}\nاین کد ۱۰ دقیقه اعتبار دارد و آن را با هیچ‌کس به اشتراک نگذارید.`);
      await writeAuditLog({ category: "owner_site", event: "recovery_code_sent", details: { channel: "telegram_owner" } });
      return res.json({ success: true, message: "کد بازیابی به اکانت تلگرامی مالک ارسال شد." });
    } catch (error) {
      recoveryCodes.delete("owner");
      return res.status(503).json({ error: "telegram_delivery_failed", message: error instanceof Error ? error.message : "ارسال کد ناموفق بود." });
    }
  });

  app.post("/api/owner-auth/recovery/verify", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const recovery = recoveryCodes.get("owner");
    if (!recovery || recovery.expiresAt < Date.now() || !safeCodeEqual(codeHash(code), recovery.hash)) return res.status(401).json({ error: "invalid_recovery_code", message: "کد بازیابی نادرست یا منقضی شده است." });
    if (username.length < 4 || password.length < 12) return res.status(400).json({ error: "weak_credentials", message: "نام کاربری باید حداقل ۴ و گذرواژه حداقل ۱۲ کاراکتر باشد." });
    await saveOwnerCredentials(username, password);
    recoveryCodes.delete("owner");
    await writeAuditLog({ category: "owner_site", event: "credentials_recovered", details: { usernameChanged: true } });
    setOwnerSessionCookie(res, await createOwnerSession(username));
    return res.json({ success: true, username });
  });
}

function safeCodeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && crypto.timingSafeEqual(a, b); }
