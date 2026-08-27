# پوشش فایل اصلی `document.txt`

## وضعیت منبع

فایل اصلی کاربر در `/home/ubuntu/upload/document.txt` قرار دارد و ۴۶۶۱ خط دارد. متن شامل ۶۷ بخش اصلی است و برخلاف `pasted_content.txt` ادامهٔ کامل‌تری دربارهٔ UX، نقش‌ها، فیلترها، tagging، آمار، پرداخت، Help Center، امنیت، storage، performance و استاندارد نهایی دارد. بخش ۶۷ از خط ۴۶۳۰ آغاز می‌شود. این فایل منبع اصلی این محدوده است و `pasted_content.txt` فقط برای مقایسهٔ تاریخی نگه داشته می‌شود.

> الزام حاکم: پروژه باید از نو ساخته نشود؛ معماری، داده، مجوزها، storage، backend، Mini App و قابلیت‌های موجود باید حفظ و فقط با استفاده از سیستم‌های موجود تکمیل شوند.

## نقشهٔ بخش‌های اصلی

| بخش‌های document.txt | دامنه | وضعیت اولیهٔ حسابرسی |
|---|---|---|
| 1–8 | قواعد توسعه، قفل محتوا، وضعیت کاربر، حذف اخطار، داشبورد اعضا، نصب گروه، ارتقا، state-aware moderation | baseline حفظ شده؛ setup/promotion و state-aware moderation در first slice پیاده‌سازی و تست شدند |
| 9–18 | کارت `لینک`، هدف‌گیری reply/mention، حذف دکمهٔ forced membership، copy، پاسخ‌های حرفه‌ای، audit، anti-spam، exemption، warning | `لینک`، حذف دکمهٔ اصلی forced membership، lifecycle و no-op state responses در first slice پیاده‌سازی و تست شدند؛ audit/copy/anti-spam/exemption همچنان نیازمند حسابرسی هستند |
| 19–27 | Mini App، جست‌وجوی کاربر، امنیت مجوز، شمارش اعضا، خطا، performance، rate limit، command UX، feedback | بخشی موجود؛ audit و پوشش شکاف‌های Mini App و محدودیت Bot API همچنان pending است |
| 28–39 | role management، demotion ایمن، profile card، همگام‌سازی state، responsive، consistency، system status، activity feed، confirmation، data safety، testing | نقش‌ها، profile/status، reset و responsive baseline موجود؛ پوشش سند و شکاف‌ها باقی است |
| 40–67 | بازنویسی کامل copy، زبان محصول، naming، terminology، پاسخ‌ها، help center، identity، start، نصب، i18n، قفل‌ها، force join، user panel، آمار، owner/admin/VIP، welcome، filter، tagging، pin، currency، profile photo، cleanup، navigation، activity، payments، group info، security، database، performance و quality | نیازمند تطبیق کامل با قابلیت‌های موجود؛ نباید قابلیت‌های unsupported یا دادهٔ ساختگی اضافه شود |

## Baselineهای حفظ‌شده

قفل‌های محتوایی backend با الگوی delete-first، وضعیت کاربر با fallback عکس، حذف دقیق تعداد اخطار، داشبورد نقش‌های Kronos، hierarchy مجوزها، عضویت اجباری خصوصی با بررسی زنده، marketplace استارز، ظرفیت سه کانال، expiry maintenance، reset محافظت‌شده و signed Mini App identity در baseline موجود هستند و نباید با این محدوده حذف یا دوگانه شوند.

## اولین شکاف‌های اجرایی اولویت‌دار

| اولویت | الزام | اقدام پیشنهادی | آزمون لازم |
|---|---|---|---|
| 1 | حذف دکمهٔ عضویت اجباری از UI اصلی | فقط reply keyboard را تغییر بده؛ enforcement و مسیر backend مالک حفظ شود | persistent keyboard tests و routing tests |
| 2 | پیام نصب/ارتقا | helper متن حرفه‌ای، transition-only، dedupe و permission warning در handler `my_chat_member` | lifecycle production tests |
| 3 | state-aware moderation | وضعیت واقعی قبل از unmute/unwarn/role/lock را بررسی کن و پاسخ صادقانه بده | moderation response tests |
| 4 | `لینک` | کارت گروه با Telegram metadata قابل‌دسترسی و fallback، با authorization و reply | command/parser/handler tests |
| 5 | copy و branding | فقط متن‌های مشخص‌شده را اصلاح کن؛ از حذف معنای فنی یا معرفی رسمی پرهیز شود | i18n/copy regression tests |
| 6 | Mini App gaps | فقط شکاف‌های مستند‌شده را تکمیل کن و از duplicate systems خودداری کن | focused UI/source tests |

## محدودیت‌های پلتفرم

Telegram Bot API ممکن است تاریخ ایجاد گروه، فهرست کامل اعضای گروه، biography کامل برخی chatها، یا برخی جزئیات account را در همهٔ contextها ارائه نکند. در این موارد باید مقدار موجود، `در دسترس نیست` یا fallback امن نشان داده شود؛ هرگز مقدار ساختگی تولید نشود. اعتبارسنجی واقعی Telegram client، تغییر نقش، ارسال پیام عمومی، reset، پرداخت و reconfigure کانال نیازمند اقدام یا تأیید مالک است.

## پوشش و انتشار

پس از هر slice باید تست متمرکز اضافه یا به‌روزرسانی شود، سپس `pnpm check`، `pnpm test` و `pnpm build` اجرا شود. قبل از checkpoint، تمام موارد واقعاً تکمیل‌شده در `todo.md` باید `[x]` باشند. سند نهایی باید برای هر بخش ۱ تا ۶۷ وضعیت `implemented`، `tested`، `limited` یا `pending owner validation` داشته باشد و checkpoint منتشرشده را ارجاع دهد.

## وضعیت فعلی

first slice شامل lifecycle نصب/ارتقای گروه، حذف دکمهٔ اصلی عضویت اجباری با حفظ enforcement backend، پاسخ‌های state-aware و فرمان `لینک` پیاده‌سازی شده است. `pnpm check`، ۱۴۹ آزمون در ۴۵ فایل و `pnpm build` موفق بوده‌اند و نسخهٔ checkpoint `58733edc` منتشر شده است. پوشش کامل `document.txt` هنوز ادعا نمی‌شود؛ auditهای Mini App، copy، anti-spam، exemption، coverage mapping کامل و اعتبارسنجی زنده همچنان pending هستند.


## الحاقیهٔ اعتبارسنجی نهایی — ۱۵ اوت ۲۰۲۶

| شاهد | نتیجه |
|---|---|
| TypeScript check | موفق |
| Vitest | ۱۵۵ آزمون در ۴۶ فایل موفق |
| Production build | موفق؛ فقط هشدار استاندارد اندازهٔ chunk باقی است |
| Mini App panel localization | کلیدهای نوع‌دار برای پنل‌های داخلی در هر ۱۲ زبان و آزمون regression اضافه شد |
| Internal role copy | برچسب‌های کاربرنمای نقش به «مقام ربات»، «مالک ربات» و «مدیر ربات» همگام شد؛ نام برند اصلی حفظ شد |
| Live Telegram group | `-1003795743979` به‌عنوان supergroup شناسایی شد و `@kronosguard_bot` با دسترسی administrator، حذف پیام، محدودسازی عضو، دعوت و ارتقای مدیر تأیید شد |
| Controlled live send/delete | پیام آزمایشی `75226` ارسال و با موفقیت حذف شد؛ هیچ نقش، پرداخت یا تنظیم دائمی تغییر نکرد |
| Real media-lock and forced-join transition | همچنان نیازمند کانال تست معتبر و تعامل حساب کاربری مالک؛ در این مرحله ادعای اجرای زنده نمی‌شود |

این الحاقیه وضعیت فعلی را به‌روز می‌کند و محدودیت‌های باقی‌مانده را عمداً باز نگه می‌دارد؛ دادهٔ ساختگی، پرداخت واقعی یا تغییر مخرب در گروه تولیدی انجام نشده است.
