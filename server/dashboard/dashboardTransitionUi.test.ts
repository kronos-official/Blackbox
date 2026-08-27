import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  new URL("../../client/src/pages/OwnerDashboard.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../../client/src/index.css", import.meta.url),
  "utf8",
);

describe("Mini App loading-to-content transition", () => {
  it("stages the authenticated handoff and supplies accessible reduced-motion styling", () => {
    expect(dashboardSource).toContain("setIsLeaving(true)");
    expect(dashboardSource).toContain("window.setTimeout(() => onReady({ ...authenticatedProfile, forcedJoinStatus: status }), 260)");
    expect(dashboardSource).toContain("kronos-gate--leaving");
    expect(dashboardSource).toContain("kronos-app-frame--intro");
    expect(dashboardSource).toContain("kronos-app-frame--ready");

    expect(styles).toContain(".kronos-gate--leaving .kronos-gate__card");
    expect(styles).toContain("@keyframes kronos-dashboard-enter");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain(".kronos-app-frame--ready");
    expect(styles).toContain("transition: opacity 560ms");
  });
});
