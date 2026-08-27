import { describe, expect, it } from "vitest";
import { resolveOwnerTelegramId } from "./constants";

describe("owner Telegram identity configuration", () => {
  it("uses a safe positive owner chat ID supplied by the deployment configuration", () => {
    expect(resolveOwnerTelegramId("8375579910")).toBe(8375579910);
  });

  it("preserves the coded default access policy for malformed configuration", () => {
    expect(resolveOwnerTelegramId("not-a-chat-id")).toBe(8375579910);
  });
});

