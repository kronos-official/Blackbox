import React from "react";
import { ArrowRight, CheckCircle2, Palette } from "lucide-react";

const themes = [
  {
    id: 1,
    name: "Neon Sentinel",
    fa: "نئون سنتینل",
    description: "امنیت سایبری تیره با فیروزه‌ای و بنفش؛ تکامل‌یافتهٔ حال‌وهوای فعلی.",
    image: "/manus-storage/kronos-theme-01-neon-sentinel_52f91e36.png",
  },
  {
    id: 2,
    name: "Terminal Ops",
    fa: "عملیات ترمینال",
    description: "کنترل‌سنتر مشکی با سبز فسفری، متادیتای مونو و حس عملیات زنده.",
    image: "/manus-storage/kronos-theme-02-terminal-ops_c4d50a65.png",
  },
  {
    id: 3,
    name: "Persian Future",
    fa: "آیندهٔ ایرانی",
    description: "سرمه‌ای، فیروزه‌ای و طلایی با هندسهٔ مینیمال ایرانی-آینده‌گرا.",
    image: "/manus-storage/kronos-theme-03-persian-future_3655dc27.png",
  },
  {
    id: 4,
    name: "Editorial Signal",
    fa: "سیگنال ادیتوریال",
    description: "روشن، جسور و مینیمال با آبی کبالت و نارنجی؛ متفاوت از فضای سایبری.",
    image: "/manus-storage/kronos-theme-04-editorial-signal_72705948.png",
  },
] as const;

export default function ThemeGallery() {
  return (
    <main className="min-h-screen bg-[#070a11] px-4 py-8 text-slate-100 sm:px-8 lg:px-12">
      <section className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col gap-5 border-b border-cyan-300/20 pb-7 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-emerald-300">
              <span>[</span><Palette className="h-4 w-4" /><span>KRONOS / THEME SELECT</span><span>]</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl">انتخاب ظاهر جدید Kronos Guard</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              هیچ قابلیت یا تنظیمات ربات تغییر نمی‌کند. یک تم را فقط برای جهت بصری انتخاب کنید؛ پیاده‌سازی نهایی پس از تأیید شما انجام می‌شود.
            </p>
          </div>
          <a href="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-100 transition hover:border-cyan-300 hover:text-cyan-200">
            بازگشت به داشبورد <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {themes.map(theme => (
            <article key={theme.id} className="group overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-950 shadow-2xl shadow-black/30 transition duration-200 hover:-translate-y-1 hover:border-cyan-300/70">
              <div className="relative aspect-video overflow-hidden bg-slate-900">
                <img src={theme.image} alt={`پیش‌نمایش تم ${theme.fa}`} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025]" />
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950 to-transparent" />
                <span className="absolute left-4 top-4 rounded-full border border-white/25 bg-black/65 px-3 py-1 font-mono text-xs font-bold text-white">۰{theme.id}</span>
              </div>
              <div className="p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black text-white">{theme.fa}</h2>
                    <p dir="ltr" className="mt-1 font-mono text-xs tracking-wider text-cyan-300">{theme.name}</p>
                  </div>
                  <CheckCircle2 className="mt-1 h-5 w-5 text-slate-500 transition group-hover:text-emerald-300" />
                </div>
                <p className="mt-4 min-h-12 text-sm leading-6 text-slate-300">{theme.description}</p>
                <div className="mt-5 border-t border-slate-800 pt-4 text-xs font-bold text-cyan-200">برای انتخاب، در گفتگو بنویسید: «تم {theme.id}»</div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
