import { describe, expect, it } from "vitest";
import { DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES, normalizeGroupEventNotificationPreferences } from "./groupEventPreferences";

describe("group event notification preferences", () => {
  it("uses private delivery defaults that preserve important alerts", () => {
    expect(normalizeGroupEventNotificationPreferences(null)).toEqual(DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES);
  });

  it("accepts known settings and bounds cooldown and deletion-delay values", () => {
    expect(normalizeGroupEventNotificationPreferences({ privateDeliveryEnabled: false, protectionRecipientMode: "group_leadership", protectionCooldownSeconds: 900 })).toEqual({
      privateDeliveryEnabled: false,
      protectionRecipientMode: "group_leadership",
      protectionCooldownSeconds: 900,
      botMessageAutoDeleteDelaySeconds: 300,
      temporarySuccessDeleteDelaySeconds: 5,
    });
    expect(normalizeGroupEventNotificationPreferences({ protectionRecipientMode: "unknown", protectionCooldownSeconds: 2, botMessageAutoDeleteDelaySeconds: 2 })).toEqual({
      ...DEFAULT_GROUP_EVENT_NOTIFICATION_PREFERENCES,
      protectionCooldownSeconds: 15,
      botMessageAutoDeleteDelaySeconds: 60,
      temporarySuccessDeleteDelaySeconds: 5,
    });
    expect(normalizeGroupEventNotificationPreferences({ botMessageAutoDeleteDelaySeconds: 90_000 }).botMessageAutoDeleteDelaySeconds).toBe(86_400);
  });
});
