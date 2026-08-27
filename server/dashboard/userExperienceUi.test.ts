import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseModerationCommand } from "../telegram/commandParser";

describe("user status reply and dashboard experience", () => {
  it("treats a replied وضعیت کاربر command as a target without a mention or ID", () => {
    expect(parseModerationCommand("وضعیت کاربر", true)).toMatchObject({
      action: "status",
      target: { kind: "reply" },
    });
  });

  it("keeps the dashboard content scrollable while the sidebar and bottom controls stay fixed", () => {
    const ownerDashboard = readFileSync(new URL("../../client/src/pages/OwnerDashboard.tsx", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../../client/src/index.css", import.meta.url), "utf8");
    expect(ownerDashboard).toContain('className="h-screen min-h-0 overflow-y-auto lg:mr-72"');
    expect(ownerDashboard).toContain("kronos-panel-loading");
    expect(ownerDashboard).toContain("<MobileMenuLayer open={menuOpen}");
    expect(ownerDashboard).toContain("onClose={() => setMenuOpen(false)}");
    expect(styles).toContain(".kronos-panel-loading");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
