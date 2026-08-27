import { describe, expect, it } from "vitest";
import { moderationErrorMessage } from "./moderation";

describe("moderation operational errors", () => {
  it("explains a lost bot membership without incorrectly blaming target resolution", () => {
    expect(moderationErrorMessage(new Error("Bad Request: bot was kicked from the supergroup"))).toContain("در این گروه فعال نیست");
  });

  it("keeps actionable target-resolution guidance only where it remains helpful", () => {
    expect(moderationErrorMessage(new Error("participant_id_invalid"))).toContain("پیام تازه");
    expect(moderationErrorMessage(new Error("unexpected transport response"))).toContain("منشن");
  });
});
