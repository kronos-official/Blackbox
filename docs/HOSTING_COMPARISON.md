# مقایسهٔ Pella و RamNaym Cloud برای Kronos Guard

**تهیه‌کننده:** Manus AI  
**تاریخ بررسی:** ۲۷ اوت ۲۰۲۶

## جمع‌بندی اجرایی

برای اجرای ۲۴/۷ ربات Telegraf، پنل Express، Webhook تلگرام و MySQL، هر دو سرویس از نظر اعلام رسمی با معماری پروژه هم‌خوان هستند. RamNaym Cloud در صفحهٔ رسمی خود به‌صراحت Node.js، Express، Telegram bot، TCP و Managed MySQL را در stackهای پشتیبانی‌شده آورده و مسیر استقرار از GitHub یا ZIP را توضیح می‌دهد.[1] Pella نیز به‌صراحت Express.js و Telegram bot، استقرار از GitHub و File Upload، و uptime اعلامی ۹۹٫۹٪ را معرفی می‌کند.[2] [3]

برای نسخهٔ عملیاتی Kronos Guard، **RamNaym Cloud از نظر شفافیت قابلیت‌های لازم و مسیر رشد انتخاب مناسب‌تری است**؛ علت اصلی این است که پشتیبانی Managed MySQL و Telegram/Telegraf را در همان صفحهٔ stackها مشخص کرده و می‌گوید می‌توان پروژه را ابتدا رایگان راه‌اندازی کرد و سپس به میزبانی دائمی ارتقا داد.[1] Pella برای شروع کم‌هزینه جذاب است، اما پلن رایگان آن فقط ۱۰۰MB RAM و ۰٫۱ CPU اعلام می‌کند؛ این مقدار برای هم‌زمانی پنل، Vite build/runtime، Telegraf، SSE و client دیتابیس ممکن است محدود باشد.[2] در Pella، پلن Small با ۱GB RAM و ۰٫۵ CPU ماهانه ۱٫۲۵ دلار اعلام شده است.[2] RamNaym قیمت ۲۴/۷ را از ۱٫۴۹ یورو در ماه اعلام می‌کند، اما منابع دقیق هر سطح را پیش از checkout نمایش می‌دهد.[1]

> نکتهٔ مهم: «رایگان» در هر دو سرویس نباید به‌عنوان تضمین ۲۴/۷ تلقی شود. برای Webhook تلگرام باید یک URL عمومی HTTPS و فرایند Node.js واقعاً در حال اجرا وجود داشته باشد؛ بنابراین برای محیط تولید، پلن always-on را باید در همان میزبان انتخاب کرد.

## مقایسه

| معیار | Pella | RamNaym Cloud | نتیجه برای Kronos Guard |
| --- | --- | --- | --- |
| Node.js و Express | Express.js و Node.js اعلام شده است.[2] [3] | Node.js و Express به‌صورت رسمی در stackها آمده است.[1] | هر دو سازگارند. |
| Telegram/Telegraf | صفحهٔ اختصاصی میزبانی Telegram bot و اشاره به Node.js دارد.[2] | Telegram bot و Telegraf صریحاً فهرست شده‌اند.[1] | RamNaym شفاف‌تر است. |
| GitHub | GitHub integration و direct upload اعلام شده است.[2] [3] | انتخاب repository و branch در flow رسمی ذکر شده است.[1] | هر دو برای branch `pella-ready` مناسب‌اند. |
| دیتابیس | در صفحات بررسی‌شده Managed MySQL به‌صراحت ذکر نشده است. | Managed MySQL، متغیرهای `MYSQL_*`، پورت 3306 و utf8mb4 ذکر شده است.[1] | برای Drizzle/MySQL، RamNaym مزیت مستند دارد؛ Pella نیازمند تأیید پنل/پشتیبانی است. |
| اجرای ۲۴/۷ | پلن رایگان و premium؛ Telegram bot از ۱٫۲۵ دلار/ماه معرفی شده است.[2] | پلن رایگان برای launch و always-on از ۱٫۴۹ یورو/ماه.[1] | برای production هر دو را روی پلن دائم اجرا کنید. |
| منابع رایگان اعلامی | ۰٫۱ CPU، ۱۰۰MB RAM، ۵GB disk.[2] | قیمت رایگان اعلام شده، اما منابع رایگان در صفحهٔ اصلی عددگذاری نشده است.[1] | Pella رایگان برای تست است، نه انتخاب مطمئن تولید. |
| منابع اقتصادی | Small: ۰٫۵ CPU، ۱GB RAM، ۱٫۲۵ دلار/ماه.[2] | منابع و قیمت نهایی هنگام checkout نمایش داده می‌شود؛ شروع از ۱٫۴۹ یورو/ماه.[1] | قبل از انتخاب، memory و CPU واقعی را کنترل کنید. |
| دامنه/URL | داشبورد و کنترل‌های پروژه اعلام شده، اما جزئیات دامنه در صفحات بررسی‌شده محدود است.[2] | public project URL و مدیریت domain controls اعلام شده است.[1] | برای webhook، URL HTTPS عمومی هر دو لازم است؛ جزئیات custom domain را در داشبورد تأیید کنید. |
| لاگ و مدیریت | Control panel، console، files، addons، backups و settings در صفحهٔ اصلی نمایش داده شده است.[2] | build logs، files، terminal، domains و dashboard اعلام شده است.[1] | برای عیب‌یابی، هر دو مسیر مدیریتی دارند. |
| backup | On-demand backups در صفحهٔ قیمت‌گذاری آمده است.[2] | در صفحهٔ بررسی‌شده سیاست backup مستقل و دقیق ذکر نشده است. | GitHub باید منبع اصلی backup کد باشد؛ backup دیتابیس جدا لازم است. |
| منطقهٔ اجرا | US و EU (آلمان) اعلام شده است؛ free در US و premium امکان EU دارد.[2] | صفحهٔ اصلی منطقهٔ عمومی را در متن استخراج‌شده مشخص نکرده است. | latency به Telegram و منبع دادهٔ بازار را با تست عملی بسنجید. |

## تصمیم فنی و روش استقرار

نسخهٔ خارجی باید **یک process اصلی Node.js** داشته باشد که HTTP server، webhook Telegram، API پنل و تکیه‌گاه SSE را با همان process اجرا کند. در محیط تولید نباید به Manus OAuth، آدرس‌های داخلی Manus، یا متغیرهای secret مخصوص Manus وابسته بماند. `DATABASE_URL` باید از MySQL میزبان گرفته شود و تمام secretها فقط از Environment Variables خوانده شوند.

برای Telegram، مسیر پیشنهادی webhook باید مانند `/api/telegram/webhook` عمومی و HTTPS باشد. پس از بالا آمدن برنامه، webhook با URL نهایی میزبان ثبت شود و پاسخ به updateها بلافاصله ارسال گردد؛ پردازش طولانی بازار و moderation باید در پس‌زمینه ادامه یابد. در صورت استفاده از polling، نباید هم‌زمان webhook فعال باشد.

## انتخاب نهایی

اگر اولویت شما **راه‌اندازی سریع و ارزان با کمترین ابهام دربارهٔ MySQL و Telegraf** است، RamNaym Cloud گزینهٔ پیشنهادی این مرحله است. اگر اولویت شما **کمترین هزینهٔ شروع، داشبورد ساده، و امکان انتخاب منابع بسیار ارزان** است، Pella برای تست و سپس پلن Small مناسب است؛ با این حال باید پشتیبانی MySQL و رفتار free/always-on را قبل از انتقال نهایی عملاً تأیید کرد.

در هر دو حالت، GitHub repository `kronos-official/Blackbox` باید source of truth کد باشد و branch جداگانهٔ `pella-ready` برای استقرار ساخته شود. هیچ `.env` واقعی، token تلگرام، کلید بازار، cookie، dump دیتابیس یا فایل backup شامل secret نباید وارد repository شود.

## References

[1]: https://www.ramnaymcloud.com/ "RamNaym Cloud — Free App & Bot Hosting"

[2]: https://www.pella.app/nodejs-telegram-bot-hosting "Pella — Node.js Telegram Bot Hosting"

[3]: https://www.pella.app/free-express-hosting "Pella — Free Express.js Hosting"
