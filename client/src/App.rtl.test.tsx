import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Mini App RTL shell", () => {
  it("declares Persian and RTL direction at the application boundary", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).toContain('dir="rtl"');
    expect(source).toContain('lang="fa"');
    expect(source).toContain("text-right");
  });

  it("routes both primary entry points to the same Persian dashboard", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).toContain('<Route path={"/"} component={OwnerDashboard} />');
    expect(source).toContain('<Route path={"/dashboard"} component={OwnerDashboard} />');
  });

  it("keeps essential RTL accessibility affordances in the dashboard and global style layer", () => {
    const dashboard = readFileSync(new URL("./pages/OwnerDashboard.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("./index.css", import.meta.url), "utf8");
    expect(dashboard).toContain("داشبورد");
    expect(dashboard).toContain("aria-");
    expect(styles).toContain(":focus-visible");
    expect(styles).toContain("prefers-reduced-motion");
    expect(styles).toContain("text-right");
  });
});
