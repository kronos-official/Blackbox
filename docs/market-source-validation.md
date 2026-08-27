# Market source validation

## GRAM/IRT

در ۲۶ اوت ۲۰۲۶، endpoint عمومی `https://apiv2.nobitex.ir/market/stats?dstCurrency=rls` بازار فعال `gram-rls` را با قیمت آخر، bid/ask، حجم و دامنهٔ روزانه برگرداند. این مشاهده فقط برای انتخاب نماد واقعی `GRAM` در adapter بازار ثبت شده است؛ قیمت در کد ذخیره یا hard-code نشده و در هر refresh از دادهٔ عمومی زنده دریافت می‌شود.
