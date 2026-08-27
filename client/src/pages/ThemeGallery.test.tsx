import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThemeGallery from "./ThemeGallery";

describe("ThemeGallery", () => {
  it("renders all four selectable theme directions and a dashboard return path", () => {
    const markup = renderToStaticMarkup(<ThemeGallery />);

    expect(markup).toContain("نئون سنتینل");
    expect(markup).toContain("عملیات ترمینال");
    expect(markup).toContain("آیندهٔ ایرانی");
    expect(markup).toContain("سیگنال ادیتوریال");
    expect(markup).toContain("/dashboard");
    expect(markup).toContain("kronos-theme-01-neon-sentinel");
    expect(markup).toContain("kronos-theme-02-terminal-ops");
    expect(markup).toContain("kronos-theme-03-persian-future");
    expect(markup).toContain("kronos-theme-04-editorial-signal");
  });
});
