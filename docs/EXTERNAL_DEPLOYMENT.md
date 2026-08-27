# راهنمای استقرار خارجی Kronos Guard

## پیش‌نیازها

این پروژه با Node.js، Express، Telegraf، Vite و Drizzle/MySQL اجرا می‌شود. از repository و branch موردنظر در GitHub import کنید، runtime را Node.js انتخاب کنید، و build command را `pnpm build` و start command را `pnpm start` قرار دهید. سرویس باید متغیر `PORT` را از محیط بخواند؛ کد پروژه آن را hardcode نمی‌کند.

## Environment Variables

فایل `config/environment.template` نمونهٔ کامل متغیرها را دارد. مقدارهای واقعی را فقط در Secret/Environment Variables میزبان وارد کنید و فایل پرشدهٔ `.env` را commit نکنید. برای اجرای مستقل خارجی، این متغیرها ضروری‌اند: `DATABASE_URL`، `JWT_SECRET`، `TELEGRAM_BOT_TOKEN`، `TELEGRAM_WEBHOOK_SECRET`، `TELEGRAM_PUBLIC_BASE_URL`، `OWNER_TELEGRAM_ID`، `OWNER_NAME`، `OWNER_SITE_USERNAME` و `OWNER_SITE_PASSWORD`.

`DATABASE_URL` باید به MySQL/TiDB پایدار متصل شود. پس از اولین deploy، migrationهای پوشهٔ `drizzle/` را با روال migration خود میزبان اجرا کنید. در این branch، migration شمارهٔ `0049_nifty_black_knight.sql` جداول تنظیمات سراسری و revision history را ایجاد می‌کند.

متغیرهای `OAUTH_SERVER_URL`، `VITE_OAUTH_PORTAL_URL` و gatewayهای `BUILT_IN_FORGE_*` برای اجرای نسخهٔ مستقل ضروری نیستند، مگر اینکه بخشی از قابلیت‌های Manus را آگاهانه نگه دارید. آن‌ها را بدون مقدار یا مطابق سرویس جایگزین تنظیم کنید؛ هیچ مقدار ساختگی را در production قرار ندهید.

## Telegram Webhook

بعد از آماده‌شدن URL عمومی HTTPS، مقدار `TELEGRAM_PUBLIC_BASE_URL` را بدون slash پایانی تنظیم کنید. سپس یک‌بار endpoint ثبت webhook پروژه را با secret انتخابی پیکربندی کنید. پاسخ webhook باید سریع بماند؛ پردازش moderation و market در background انجام می‌شود. هم‌زمان webhook و polling را فعال نکنید.

## منابع پیشنهادی

پلن رایگان Pella برای smoke test مناسب است، اما منابع اعلامی آن ۰٫۱ CPU و ۱۰۰MB RAM است. برای production، حداقل سطحی با حدود ۱GB RAM را انتخاب کنید. RamNaym Cloud نیز راه‌اندازی رایگان و مسیر ۲۴/۷ از ۱٫۴۹ یورو در ماه اعلام می‌کند؛ برای اجرای دائمی، پلن always-on را انتخاب و منابع واقعی را پیش از checkout بررسی کنید.

## بررسی پس از deploy

سلامت سرویس را با بازکردن URL عمومی، ورود به `/control`، اجرای `pnpm test` در CI، بررسی build logs، و مشاهدهٔ وضعیت webhook در پنل مالک کنترل کنید. ابتدا با یک گروه آزمایشی، دستورهای moderation و بازار را بررسی کنید؛ سپس webhook را به گروه‌های اصلی منتقل کنید. برای backup، کد و migrationها در GitHub نگه‌داری شوند و backup دیتابیس طبق قابلیت خود میزبان جداگانه تهیه شود.
