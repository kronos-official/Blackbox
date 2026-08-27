import { describe, expect, it } from "vitest";
import { withTelegramButtonStyle } from "./buttonStyle";
import { forcedJoinManagerKeyboard, stagedForcedJoinConfirmationKeyboard } from "./forcedJoinManager";
import { groupLinkModeKeyboard, linkResultKeyboard } from "./groupInfo";
import { numericIdConfirmKeyboard } from "./persistentKeyboard";

describe("Telegram button styles", () => {
  it("adds only the requested style and preserves the original callback payload", () => {
    const button = withTelegramButtonStyle({ text: "تأیید", callback_data: "confirm:1" }, "success");
    expect(button).toEqual({ text: "تأیید", callback_data: "confirm:1", style: "success" });
  });

  it("colors link navigation and danger actions selectively", () => {
    const menu = groupLinkModeKeyboard().inline_keyboard;
    expect(menu[0][0]).toMatchObject({ callback_data: "group-link:text", style: "primary" });
    expect(menu[4][0]).toMatchObject({ callback_data: "group-link:private", style: "primary" });
    expect(menu[5][0]).toMatchObject({ callback_data: "group-link:close", style: "danger" });

    const result = linkResultKeyboard("text", true, "https://t.me/+example").inline_keyboard;
    expect(result[0][0]).toMatchObject({ style: "primary" });
    expect(result[1][0]).toMatchObject({ style: "primary" });
    expect(result[2][0]).toMatchObject({ callback_data: "group-link:revoke-confirm", style: "danger" });
  });

  it("uses green for confirmation and red for cancellation", () => {
    const confirm = stagedForcedJoinConfirmationKeyboard().reply_markup.inline_keyboard[0];
    expect(confirm[0]).toMatchObject({ callback_data: "forced_join_manager:confirm", style: "success" });
    expect(confirm[1]).toMatchObject({ callback_data: "forced_join_manager:cancel", style: "danger" });

    const numeric = numericIdConfirmKeyboard("group", 123).reply_markup.inline_keyboard[0];
    expect(numeric[0]).toMatchObject({ callback_data: "numeric-confirm:yes:group:123", style: "success" });
    expect(numeric[1]).toMatchObject({ callback_data: "numeric-confirm:no:group:123", style: "danger" });
  });

  it("keeps forced-join management navigation blue and close red", () => {
    const rows = forcedJoinManagerKeyboard().reply_markup.inline_keyboard;
    expect(rows[0][0]).toMatchObject({ style: "primary" });
    expect(rows[0][1]).toMatchObject({ style: "primary" });
    expect(rows[1][0]).toMatchObject({ callback_data: "forced_join_manager:close", style: "danger" });
  });
});
