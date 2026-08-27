import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OWNER_TELEGRAM_ID } from "../telegram/constants";
import { verifyTelegramMiniAppInitData } from "./telegramMiniAppAuth";

const originalToken = process.env.TELEGRAM_BOT_TOKEN;
const testToken = "123456:dashboard-test-token";

function signedInitData(user: Record<string, unknown>, authDate: number) {
  const params = new URLSearchParams({ auth_date: String(authDate), query_id: "AAE-test", user: JSON.stringify(user) });
  const dataCheckString = Array.from(params.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(testToken).digest();
  params.set("hash", createHmac("sha256", secret).update(dataCheckString).digest("hex"));
  return params.toString();
}

afterEach(() => {
  if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = originalToken;
});

describe("Telegram Mini App signed identity authentication", () => {
  it("accepts fresh, correctly signed initData for both the configured owner and a group user", () => {
    process.env.TELEGRAM_BOT_TOKEN = testToken;
    const now = Date.now();
    const initData = signedInitData({ id: OWNER_TELEGRAM_ID, first_name: "Owner", username: "kronosowner" }, Math.floor(now / 1000));
    expect(verifyTelegramMiniAppInitData(initData, now)).toEqual({ telegramUserId: OWNER_TELEGRAM_ID, firstName: "Owner", username: "kronosowner" });
    const groupAdmin = signedInitData({ id: OWNER_TELEGRAM_ID + 1, first_name: "Admin", username: "groupadmin" }, Math.floor(now / 1000));
    expect(verifyTelegramMiniAppInitData(groupAdmin, now)).toEqual({ telegramUserId: OWNER_TELEGRAM_ID + 1, firstName: "Admin", username: "groupadmin" });
  });

  it("rejects tampered signatures and stale payloads", () => {
    process.env.TELEGRAM_BOT_TOKEN = testToken;
    const now = Date.now();
    const valid = signedInitData({ id: OWNER_TELEGRAM_ID, first_name: "Owner" }, Math.floor(now / 1000));
    const tampered = new URLSearchParams(valid);
    const hash = tampered.get("hash")!;
    tampered.set("hash", `${hash[0] === "0" ? "1" : "0"}${hash.slice(1)}`);
    expect(() => verifyTelegramMiniAppInitData(tampered.toString(), now)).toThrow("signature");
    const stale = signedInitData({ id: OWNER_TELEGRAM_ID }, Math.floor(now / 1000) - 901);
    expect(() => verifyTelegramMiniAppInitData(stale, now)).toThrow("expired");
  });
});
