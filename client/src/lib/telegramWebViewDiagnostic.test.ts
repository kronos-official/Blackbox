import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("Telegram WebView diagnostics", () => {
  it("installs visible global error and timeout diagnostics before the app script", () => {
    expect(html).toContain('window.addEventListener("error"');
    expect(html).toContain('window.addEventListener("unhandledrejection"');
    expect(html).toContain("زمان بارگذاری بیش از حد طول کشید");
  });

  it("marks the root only after the React mount target is confirmed", () => {
    expect(main).toContain('const rootElement = document.getElementById("root")');
    expect(main).toContain('rootElement.dataset.reactMounted = "true"');
  });
});
