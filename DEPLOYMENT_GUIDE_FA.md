# راهنمای اجرای مستقل Kronos Guard

این بسته شامل source کامل کلاینت و سرور، schema و migrationهای Drizzle، تست‌ها، تنظیمات build و فایل‌های لازم پروژه است. برای امنیت، `node_modules`، لاگ‌های محلی، فایل‌های محیطی و مقدار credentialها داخل بسته قرار نگرفته‌اند.

## پیش‌نیازها

Node.js نسخهٔ ۲۰ یا بالاتر، pnpm، یک دیتابیس MySQL یا TiDB، و یک محیط Node.js برای اجرای سرور لازم است.

## نصب

```bash
pnpm install
pnpm check
pnpm test
pnpm build
```

## متغیرهای محیطی

مقادیر زیر را در محیط اجرای خود تنظیم کنید. مقدار واقعی هیچ‌کدام در این بسته وجود ندارد:

- `DATABASE_URL` برای اتصال به MySQL/TiDB
- `JWT_SECRET` برای نشست‌ها
- `VITE_APP_ID` و `OAUTH_SERVER_URL` در صورت استفاده از OAuth Manus
- `OWNER_OPEN_ID` و `OWNER_NAME`
- `BUILT_IN_FORGE_API_URL` و `BUILT_IN_FORGE_API_KEY` برای سرویس‌های داخلی
- `TELEGRAM_BOT_TOKEN` و `TELEGRAM_WEBHOOK_SECRET` برای ربات
- `TELEGRAM_PUBLIC_BASE_URL` برای Webhook عمومی
- `OWNER_TELEGRAM_ID` برای مالک ربات
- `OWNER_SITE_USERNAME` و `OWNER_SITE_PASSWORD` برای ورود پنل مستقل مالک
- متغیرهای بازار و سایر secretهایی که در `server/_core/env.ts` تعریف شده‌اند

## دیتابیس

فایل‌های داخل `drizzle/migrations` را فقط پس از بررسی محیط مقصد اجرا کنید. پیش از migration از دیتابیس نسخهٔ پشتیبان بگیرید. این پروژه داده‌های ربات، کاربران، گروه‌ها، نقش‌ها، تنظیمات، لاگ‌ها و وضعیت Webhook را در دیتابیس نگه می‌دارد.

## اجرا

```bash
pnpm dev
```

برای محیط production ابتدا `pnpm build` و سپس فرمان start تعریف‌شده در `package.json` را اجرا کنید. پورت باید از متغیر محیطی یا قرارداد محیط میزبان خوانده شود و نباید به‌صورت ثابت در کد تنظیم شود.

## نکات امنیتی

مقدار خام Token، API Key، Secret و password را در repository، ZIP، log یا File Manager قرار ندهید. File Manager و Terminal مدیریتی پروژه عمدی به اجرای shell آزاد تبدیل نشده‌اند و فقط قابلیت‌های کنترل‌شده را ارائه می‌کنند.

## اجزای اصلی

- `client/` رابط Mini App و پنل مالک
- `server/telegram/` منطق ربات، Webhook، moderation و نقش‌ها
- `server/ownerSite/` پنل مالک، احراز هویت، File Manager و Terminal
- `server/market/` داده‌های بازار و نمودارها
- `drizzle/schema.ts` مدل دیتابیس
- `drizzle/migrations/` migrationهای دیتابیس
- `server/**/*.test.ts` و `client/**/*.test.*` آزمون‌ها
