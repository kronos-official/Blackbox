import { describe, expect, it } from "vitest";
import { MEMBER_PRESENCE_REFRESH_INTERVAL_MS, shouldRefreshMemberPresence } from "./memberPresenceRefresh";

describe("member presence refresh policy", () => {
  it("refreshes the selected member directory every 60 seconds", () => {
    expect(MEMBER_PRESENCE_REFRESH_INTERVAL_MS).toBe(60_000);
  });

  it("only permits polling while the panel is visible and a group is selected", () => {
    expect(shouldRefreshMemberPresence(true, true)).toBe(true);
    expect(shouldRefreshMemberPresence(false, true)).toBe(false);
    expect(shouldRefreshMemberPresence(true, false)).toBe(false);
  });
});
