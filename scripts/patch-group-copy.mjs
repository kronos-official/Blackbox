import fs from "node:fs";
const path = "client/src/pages/OwnerDashboard.tsx";
let s = fs.readFileSync(path, "utf8");
s = s.replace('import { dashboardHelpCopy } from "@/lib/dashboardHelpI18n";', 'import { dashboardHelpCopy } from "@/lib/dashboardHelpI18n";\nimport { dashboardGroupFormCopy } from "@/lib/dashboardGroupFormI18n";');
s = s.replace('export function Groups({ isBotOwner }: { isBotOwner: boolean }) {\n  const locale = activeDashboardLocale();', 'export function Groups({ isBotOwner }: { isBotOwner: boolean }) {\n  const locale = activeDashboardLocale();\n  const groupCopy = dashboardGroupFormCopy[locale];');
const replacements = new Map([
  ['<Empty text="هنوز گروهی با ربات ثبت نشده است." />', '<Empty text={groupCopy.empty} />'],
  ['aria-label="بستن تنظیمات گروه"', 'aria-label={groupCopy.close}'],
  ['<CardDescription>قالب‌های خوش‌آمد و خداحافظ با متغیرهای فارسی، تاریخ محلی و فرمت‌های تلگرام ارسال می‌شوند.</CardDescription>', '<CardDescription>{groupCopy.description}</CardDescription>'],
  ['<p className="font-bold text-cyan-100">قالب و متغیرها</p><p>فرمت‌ها:', '<p className="font-bold text-cyan-100">{groupCopy.templateTitle}</p><p>{groupCopy.formats} '],
  ['</code>.</p><p className="mt-1">متغیرها:', '</code>.</p><p className="mt-1">{groupCopy.variables} '],
  ['>شما اجازهٔ مشاهدهٔ تنظیمات این گروه را دارید؛ تغییر تنظیمات فقط برای مالک و مدیران گروه فعال است.</p>', '>{groupCopy.readOnly}</p>'],
  ['<Toggle label="پیام خوش‌آمد"', '<Toggle label={groupCopy.welcome}'],
  ['placeholder="پیام خوش‌آمد"', 'placeholder={groupCopy.welcome}'],
  ['<Toggle label="پیام خداحافظی"', '<Toggle label={groupCopy.goodbye}'],
  ['placeholder="پیام خداحافظی"', 'placeholder={groupCopy.goodbye}'],
  ['<Toggle label="ضد اسپم"', '<Toggle label={groupCopy.antiSpam}'],
  ['<Toggle label="ضد رید"', '<Toggle label={groupCopy.antiRaid}'],
  ['label="سقف پیام"', 'label={groupCopy.floodLimit}'],
  ['label="پنجره (ثانیه)"', 'label={groupCopy.floodWindow}'],
  ['label="تکرار مشابه"', 'label={groupCopy.duplicateLimit}'],
  ['label="سقف اخطار"', 'label={groupCopy.warningLimit}'],
  ['placeholder="قوانین گروه"', 'placeholder={groupCopy.rules}'],
  ['} ذخیره تنظیمات</Button>', '} {groupCopy.save}</Button>'],
  ['<Empty text="یک گروه را برای تنظیم انتخاب کنید." />', '<Empty text={groupCopy.empty} />'],
]);
for (const [from, to] of replacements) s = s.replaceAll(from, to);
fs.writeFileSync(path, s);
