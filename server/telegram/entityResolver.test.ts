import { describe, expect, it } from "vitest";
import { buildEntityIdentityCard, conversionProgressText, normalizeEntityReference, parseEntityReference, progressBar } from "./entityResolver";

describe("Telegram entity resolver contracts", () => {
  it("normalizes public usernames and numeric IDs without accepting invite links", () => {
    expect(normalizeEntityReference("https://t.me/@KronosGuard")) .toBe("KronosGuard");
    expect(normalizeEntityReference("@KronosGuard")) .toBe("KronosGuard");
    expect(normalizeEntityReference("-1004444844063")) .toBe("-1004444844063");
    expect(parseEntityReference("https://t.me/+privateInvite", "group")).toBeNull();
    expect(parseEntityReference("@public_group", "group")).toMatchObject({ normalized: "public_group", kind: "group" });
  });

  it("keeps progress bounded and renders a stable Persian conversion state", () => {
    expect(progressBar(-10)).toBe("▱▱▱▱▱▱▱▱▱▱ 0%");
    expect(progressBar(104)).toBe("▰▰▰▰▰▰▰▰▰▰ 100%");
    expect(conversionProgressText("channel", 60)).toContain("کانال");
    expect(conversionProgressText("channel", 60)).toContain("60%");
  });

  it("formats an escaped, identity-focused entity card", () => {
    const card = buildEntityIdentityCard({ id: -10042, kind: "group", name: "A <safe> group", username: "safe_group", bio: null, photoFileId: null, source: "telegram" });
    expect(card).toContain("<code>-10042</code>");
    expect(card).toContain("A &lt;safe&gt; group");
    expect(card).toContain("@safe_group");
  });
});
