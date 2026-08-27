# اجرای کامل Kronos Guard در RamNaym Cloud

این branch شامل کل کد برنامه، رابط Mini App، پنل `/control`، سرور Express، ربات Telegraf، migrationهای Drizzle، تست‌ها، اسکریپت‌ها و lockfile است. فایل‌های credential واقعی، `.env`، metadata داخلی پروژه و لاگ‌های محلی عمداً در repository قرار نگرفته‌اند.

## تنظیم Project

در RamNaym، repository `kronos-official/Blackbox` و branch `pella-ready` را import کنید. نوع پروژه را **Node.js** انتخاب کنید. Runtime باید Node.js نسخهٔ ۲۰ یا جدیدتر باشد. مقدار Build Command برابر `pnpm install --frozen-lockfile && pnpm build` و مقدار Start Command برابر `pnpm start` باشد. اگر پلتفرم خودش dependency installation را انجام می‌دهد، Build Command فقط `pnpm build` باشد.

برنامه از متغیر `PORT` استفاده می‌کند و نیازی به hardcodeکردن پورت ندارد. public URL پروژه باید HTTPS باشد تا Telegram بتواند webhook و Mini App را بدون خطای امنیتی فراخوانی کند.

## Environment Variables

مقادیر واقعی را فقط در بخش Environment Variables/Secrets وارد کنید. فایل `config/environment.template` نام متغیرها را ارائه می‌کند و برای commitکردن مقدار واقعی طراحی نشده است.

| متغیر | وضعیت | کاربرد |
| --- | --- | --- |
| `DATABASE_URL` | الزامی | اتصال MySQL/TiDB پایدار برای Drizzle |
| `JWT_SECRET` | الزامی | امضای نشست‌ها و cookieها |
| `TELEGRAM_BOT_TOKEN` | الزامی | توکن Bot API |
| `TELEGRAM_WEBHOOK_SECRET` | الزامی | secret مسیر webhook |
| `TELEGRAM_PUBLIC_BASE_URL` | الزامی | URL HTTPS نهایی پروژه، بدون slash پایانی |
| `OWNER_TELEGRAM_ID` | الزامی | شناسهٔ عددی مالک ربات |
| `OWNER_NAME` | الزامی | نام مالک برای اعلان‌ها و پنل |
| `OWNER_SITE_USERNAME` | الزامی | username ورود به `/control` |
| `OWNER_SITE_PASSWORD` | الزامی | password ورود به `/control` |
| `MARKET_DATA_API_KEY` و `MARKET_DATA_API_SECRET` | وابسته به provider | credential منبع دادهٔ بازار در صورت استفاده |
| `VITE_APP_TITLE` | اختیاری | عنوان سایت و Mini App |

هر متغیر Manus مانند OAuth یا Built-in Forge فقط برای قابلیت‌هایی لازم است که عمداً به Manus وابسته نگه داشته شوند؛ برای اجرای مستقل bot و پنل، مقدار ساختگی وارد نکنید.

## Database Migration

پس از ایجاد MySQL و تنظیم `DATABASE_URL`، migrationهای پوشهٔ `drizzle/` را اجرا کنید. فرمان استاندارد این پروژه `pnpm db:migrate` است و برای تولید migration جدید `pnpm db:generate` استفاده می‌شود. migration شمارهٔ `0049_nifty_black_knight.sql` جداول `globalBotSettings`، `globalBotTexts` و `ownerConfigRevisions` را ایجاد می‌کند. این جداول برای Control Center ضروری هستند.

## Webhook Telegram

بعد از اولین start، URL عمومی HTTPS را در `TELEGRAM_PUBLIC_BASE_URL` قرار دهید و webhook را با route پروژه ثبت کنید. فقط یک روش دریافت update را فعال نگه دارید؛ اگر webhook فعال است، polling را هم‌زمان اجرا نکنید. پس از ثبت، از بخش Webhook در Control Center وضعیت URL، دریافت update و خطاهای ۲۴ ساعت اخیر را بررسی کنید.

## ترتیب تست عملی

ابتدا صفحهٔ اصلی و `/control` را باز کنید. سپس با credential مالک وارد شوید، از بخش Terminal یک probe ساده اجرا کنید، وضعیت Webhook را بررسی کنید و در ادامه Mini App را با URL عمومی HTTPS باز کنید. در یک گروه آزمایشی، ابتدا start bot، سپس ارتقای bot به administrator، عملیات moderation و در پایان market commands را امتحان کنید. پس از موفقیت این مراحل، webhook را برای استفادهٔ اصلی فعال نگه دارید.

## نکتهٔ پایداری

پلن رایگان برای نصب و smoke test مناسب است، اما اجرای ۲۴/۷ ربات باید روی پلن always-on قرار گیرد. برای رباتی که webhook، SSE لاگ، پنل مالک و اتصال بازار را هم‌زمان اجرا می‌کند، محدودیت RAM پلن را قبل از تأیید نهایی بررسی کنید. Backup کد در GitHub است؛ backup دیتابیس را جداگانه در قابلیت backup خود RamNaym فعال کنید.
