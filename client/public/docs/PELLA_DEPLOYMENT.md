# راهنمای استقرار در pella.app

این پروژه به‌صورت یک process واحد Node.js اجرا می‌شود و Express، webhook تلگرام، API پنل و رابط Mini App را هم‌زمان ارائه می‌کند.

## تنظیمات پروژه در pella.app

ریپازیتوری `kronos-official/Blackbox` و شاخه `main` را import کنید. نوع پروژه را Node.js انتخاب کنید. برای نصب و ساخت، از فرمان `pnpm install --frozen-lockfile && pnpm build` و برای اجرا از `pnpm start` استفاده کنید. فایل `Procfile` نیز فرمان اجرای production را به‌صورت `pnpm start` مشخص می‌کند.

برنامه مقدار `PORT` را از محیط pella.app می‌خواند و روی `0.0.0.0` bind می‌شود. برای بررسی سلامت سرویس می‌توانید مسیر `/healthz` را باز کنید؛ این مسیر به credential تلگرام یا پایگاه‌داده نیاز ندارد.

## متغیرهای محیطی

مقدارهای واقعی را فقط در بخش Environment Variables pella.app وارد کنید و هرگز فایل `.env` پرشده را commit نکنید. فهرست کامل نام متغیرها در `config/environment.template` و شرح آن‌ها در `docs/ENVIRONMENT.md` قرار دارد. برای قابلیت کامل ربات، حداقل `DATABASE_URL`، `JWT_SECRET`، `TELEGRAM_BOT_TOKEN`، `TELEGRAM_WEBHOOK_SECRET`، `TELEGRAM_PUBLIC_BASE_URL`، `OWNER_TELEGRAM_ID`، `OWNER_NAME`، `OWNER_SITE_USERNAME` و `OWNER_SITE_PASSWORD` لازم است.

`TELEGRAM_PUBLIC_BASE_URL` باید URL عمومی HTTPS پروژه، بدون slash انتهایی، باشد. `DATABASE_URL` باید به MySQL یا TiDB پایدار اشاره کند. secretها و tokenها نباید در GitHub، لاگ build یا کد منبع قرار بگیرند.

## Webhook تلگرام

پس از اولین deploy و مشخص‌شدن دامنه عمومی، webhook را روی مسیر زیر ثبت کنید:

```text
https://<pella-domain>/api/telegram/webhook
```

هنگام ثبت webhook، مقدار `TELEGRAM_WEBHOOK_SECRET` را به‌عنوان `secret_token` ارسال کنید. هم‌زمان polling و webhook را فعال نکنید؛ این نسخه برای دریافت updateهای production از webhook استفاده می‌کند.

## محدودیت پلن رایگان

طبق صفحات عمومی pella.app، پلن رایگان منابع محدودی دارد. این برنامه علاوه بر runtime تلگرام، server-side API، پنل و Mini App را نیز اجرا می‌کند؛ بنابراین پیش از استفاده ۲۴/۷، مصرف RAM و پایداری process را در console پنل بررسی کنید و در صورت نیاز پلن دارای منابع بیشتر انتخاب کنید.
