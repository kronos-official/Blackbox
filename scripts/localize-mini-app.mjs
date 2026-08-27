import fs from "node:fs";

const locales = {
  fa: "مینی‌اپ",
  en: "Mini App",
  ar: "التطبيق المصغر",
  tr: "Mini uygulama",
  ru: "мини-приложение",
  es: "miniaplicación",
  fr: "mini-application",
  pt: "miniaplicativo",
  it: "miniapp",
  de: "Mini-App",
  pl: "miniaplikacja",
  vi: "ứng dụng mini",
};

const files = [
  "client/src/lib/dashboardI18n.ts",
  "client/src/lib/dashboardHelpI18n.ts",
];

for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  let activeLocale = null;
  const output = source
    .split("\n")
    .map((line) => {
      const match = line.match(/^\s{2}(fa|en|ar|tr|ru|es|fr|pt|it|de|pl|vi)\s*:/);
      if (match) activeLocale = match[1];
      return activeLocale && locales[activeLocale]
        ? line.replaceAll("Mini App", locales[activeLocale])
        : line;
    })
    .join("\n");
  fs.writeFileSync(file, output);
}

const dashboard = "client/src/pages/OwnerDashboard.tsx";
fs.writeFileSync(
  dashboard,
  fs.readFileSync(dashboard, "utf8").replaceAll("اعتبارسنجی Mini App", "اعتبارسنجی مینی‌اپ"),
);
