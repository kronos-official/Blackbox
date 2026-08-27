import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("Telegram WebView HTML resilience", () => {
  it("keeps visible static recovery content before React mounts", () => {
    expect(html).toContain('id="root"');
    expect(html).toContain("در حال آماده‌سازی پنل امن تلگرام");
    expect(html).toContain('href="/dashboard"');
  });

  it("does not let the Telegram SDK parser-block the app bootstrap", () => {
    expect(html).toContain('<script defer src="https://telegram.org/js/telegram-web-app.js"></script>');
  });

  it("sets the final dark theme before React mounts to prevent white/black flashing", () => {
    expect(html).toContain('id="kronos-first-paint-theme"');
    expect(html).toContain("html,body,#root{margin:0;min-height:100%;background:#050913");
    expect(html).toContain("color-scheme:dark");
    expect(html).toContain('localStorage.getItem("theme")');
    expect(html).toContain('document.documentElement.classList.toggle("dark", dark)');
    expect(html).toContain('document.documentElement.style.backgroundColor');
  });
});
