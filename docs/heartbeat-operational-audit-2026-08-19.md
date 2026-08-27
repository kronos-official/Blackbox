# ممیزی عملیاتی Heartbeat — 2026-08-19

## محدوده

این یادداشت، وضعیت read-only زمان‌بندهای platform-managed پروژه را در تاریخ 2026-08-19 ثبت می‌کند. هدف آن صرفاً حفظ شواهد برای بررسی roadmap است؛ هیچ jobی ایجاد، ویرایش، pause یا حذف نشده است.

## jobهای فعال

| نام | مسیر callback | برنامهٔ UTC | وضعیت |
| --- | --- | --- | --- |
| `kronos:statistics:57900001` | `/api/scheduled/statistics-report` | `0 30 17 * * *` | فعال |
| `kronos:statistics:13080002` | `/api/scheduled/statistics-report` | `0 30 17 * * *` | فعال |
| `kronos-forced-join-expiry` | `/api/scheduled/forced-join-reconcile` | `0 */15 * * * *` | فعال |

## شواهد callback نگهداری

سه اجرای اخیر `kronos-forced-join-expiry` همگی با HTTP `200`، یک تلاش، و زمان اجرای حدود `1.2–1.9s` پایان یافته‌اند. پاسخ‌ها نشان می‌دهند callback به‌شکل موفق reconcile عضویت اجباریِ منقضی، محدودیت‌های موقت، انقضای حالت ضدحمله، و پاکسازی نگهداری را فراخوانی کرده است؛ در این اجراها آیتم منقضی برای تغییر وجود نداشته است.

## بررسی ایمنی کد

هر دو callback در `server/telegram/scheduledRoutes.ts` با `sdk.authenticateRequest` از اجرای cron-only و داشتن `taskUid` اطمینان می‌گیرند. callback نگهداری، job را با ترکیب `scheduleKey` و `scheduleCronTaskUid` از دادهٔ پایدار می‌یابد، job ناشناخته یا غیرفعال را با پاسخ 2xx و بدون عملیات رد می‌کند، و عملیات reconciliation را به‌صورت موازی اجرا می‌کند. callback گزارش آمار نیز task UID احراز‌شده را به delivery idempotent منتقل می‌کند.

## نتیجهٔ ممیزی

طبق شواهد ثبت‌شده، عملیات زمان‌بندی فعال از platform-managed Heartbeat استفاده می‌کند؛ به timer درون‌پردازشی متکی نیست، callbackها زیر `/api/scheduled/` هستند، و مسیر نگهداری آخرین اجراهای سالم دارد. اجرای نخست jobهای آمار در برنامهٔ روزانهٔ خود باقی می‌ماند و باید پس از زمان اجرای طبیعی با همان ledger تحویل idempotent بررسی شود.
