import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUP_SCOPED_RESET_STATE_HOLDERS } from "../../client/src/lib/dashboardSession";

const dashboardSource = readFileSync(
  new URL("../../client/src/pages/OwnerDashboard.tsx", import.meta.url),
  "utf8",
);

describe("Mini App database reset integration", () => {
  it("documents every group-scoped state holder and wires its panel to the shared protected reset signal", () => {
    expect(GROUP_SCOPED_RESET_STATE_HOLDERS).toEqual({
      Groups: ["selected group", "settings form draft"],
      Members: ["selected group", "administrator refresh summary", "departed-members filter", "direct role-management form draft"],
      Moderation: ["selected group"],
      ForcedJoin: ["forced-join channel draft, including groupId"],
    });

    for (const component of Object.keys(GROUP_SCOPED_RESET_STATE_HOLDERS)) {
      const section = dashboardSource.split(`function ${component}`)[1]?.split("function ")[0] ?? "";
      expect(section).toContain("useDashboardReset(");
    }

    const groupsSection = dashboardSource.split("function Groups")[1]?.split("function ")[0] ?? "";
    expect(groupsSection).toContain("setSelected(null)");
    expect(groupsSection).toContain("setForm(null)");

    const membersSection = dashboardSource.split("function Members")[1]?.split("function ")[0] ?? "";
    expect(membersSection).toContain("setGroupId(null)");
    expect(membersSection).toContain("setRefreshSummary(null)");
    expect(membersSection).toContain("setIncludeDeparted(false)");

    const moderationSection = dashboardSource.split("function Moderation")[1]?.split("function ")[0] ?? "";
    expect(moderationSection).toContain("setGroupId(null)");

    const forcedJoinSection = dashboardSource.split("function ForcedJoin")[1]?.split("function ")[0] ?? "";
    expect(forcedJoinSection).toContain("clearForcedJoinDraft");
    for (const field of ["destinationReference", "title", "username", "inviteUrl", "groupId", "expiresAt"]) {
      expect(forcedJoinSection).toContain(`${field}: \"\"`);
    }
    expect(forcedJoinSection).toContain('scope: "global"');
    expect(dashboardSource).toContain("new Event(DASHBOARD_RESET_EVENT)");
  });
});
