import { describe, expect, it, vi } from "vitest";
import { GROUP_ACTIVATION_AUTO_DELETE_DELAY_MS, groupActivationAutoDeleteAt, scheduleGroupActivationMessageAutoDelete } from "./activationMessageCleanup";

describe("group activation message cleanup", () => {
  it("sets the activation message for deletion exactly ten minutes after send time", () => {
    const sentAt = new Date("2026-08-27T06:30:00.000Z");
    expect(GROUP_ACTIVATION_AUTO_DELETE_DELAY_MS).toBe(10 * 60 * 1_000);
    expect(groupActivationAutoDeleteAt(sentAt)).toEqual(new Date("2026-08-27T06:40:00.000Z"));
  });

  it("persists the independent deadline without accepting or reading a group auto-delete preference", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const sentAt = new Date("2026-08-27T06:30:00.000Z");
    const deadline = await scheduleGroupActivationMessageAutoDelete({ groupId: 71, messageId: 902, sentAt, persist });

    expect(deadline).toEqual(new Date("2026-08-27T06:40:00.000Z"));
    expect(persist).toHaveBeenCalledWith({ groupId: 71, messageId: 902, autoDeleteAt: new Date("2026-08-27T06:40:00.000Z") });
  });
});
