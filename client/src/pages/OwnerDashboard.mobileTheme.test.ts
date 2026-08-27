import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(resolve(__dirname, "OwnerDashboard.tsx"), "utf8");
const mobileMenuSource = readFileSync(resolve(__dirname, "..", "components", "MobileMenuLayer.tsx"), "utf8");
const stylesheet = readFileSync(resolve(__dirname, "..", "index.css"), "utf8");

describe("mobile navigation and Persian Future theme", () => {
  it("keeps the mobile sidebar above its backdrop with explicit open and closed states", () => {
    expect(mobileMenuSource).toContain("kronos-sidebar--open");
    expect(mobileMenuSource).toContain("kronos-sidebar--closed");
    expect(mobileMenuSource).toContain('data-menu-open={open ? "true" : "false"}');
    expect(mobileMenuSource).toContain("kronos-menu-backdrop");
  });

  it("supports Escape to close the mobile menu", () => {
    expect(mobileMenuSource).toContain('event.key === "Escape"');
    expect(mobileMenuSource).toContain('window.addEventListener("keydown", closeOnEscape)');
  });

  it("applies the selected Tehran/Iran Theme 03 to the live Mini App shell", () => {
    expect(dashboardSource).toContain("kronos-theme-tehran");
    expect(stylesheet).toContain("Theme 03 — Tehran / Iran");
    expect(stylesheet).toContain("--tehran-saffron: #e2ad45");
    expect(stylesheet).toContain("clip-path: polygon");
    expect(stylesheet).toContain("background: linear-gradient(145deg, rgb(15 35 70 / .62), rgb(5 15 34 / .8)) !important");
  });

  it("keeps the parent frame unconstrained while the actual scroll container owns the visible viewport", () => {
    const appFrameRule = stylesheet.slice(
      stylesheet.indexOf(".kronos-app-frame {"),
      stylesheet.indexOf(".kronos-app-frame--intro"),
    );
    expect(appFrameRule).not.toContain("height:");
    expect(appFrameRule).not.toContain("overflow: hidden");
    const mainRule = stylesheet.slice(
      stylesheet.indexOf(".kronos-app-frame > main {"),
      stylesheet.indexOf(".kronos-app-frame--ready"),
    );
    expect(mainRule).toContain("height: calc(100dvh - 28px)");
    expect(mainRule).toContain("overflow-y: auto");
  });

  it("keeps fixed sidebar and mobile dock out of the shell flow so they cannot create a viewport-sized spacer", () => {
    expect(stylesheet).not.toContain(".kronos-shell > * { position: relative; z-index: 1; }");
    expect(stylesheet).toContain(".kronos-shell > main { position: relative; z-index: 1; }");
    expect(stylesheet).toContain(".kronos-shell > .kronos-sidebar { position: fixed; z-index: 40; }");
    expect(stylesheet).toContain(".kronos-shell > .kronos-mobile-dock");
    expect(stylesheet).toContain("safe-area-inset-bottom");
  });
});
