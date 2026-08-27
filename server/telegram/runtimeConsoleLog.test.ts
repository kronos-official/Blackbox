import { describe, expect, it } from "vitest";
import { formatRuntimeConsoleArguments, redactRuntimeLogText } from "./runtimeConsoleLog";

describe("runtime console log sanitization", () => {
  it("masks secret-like values in direct terminal text and URL parameters", () => {
    const redacted = redactRuntimeLogText("token=super-secret-value https://example.test/callback?api_key=key-value&safe=1");
    expect(redacted).toContain("token=[REDACTED]");
    expect(redacted).toContain("api_key=[REDACTED]");
    expect(redacted).not.toContain("super-secret-value");
    expect(redacted).not.toContain("key-value");
  });

  it("masks sensitive object properties while preserving useful operational context", () => {
    const formatted = formatRuntimeConsoleArguments(["webhook failed", { chatId: -10001, botToken: "do-not-display", error: "timeout" }]);
    expect(formatted.text).toContain("webhook failed");
    expect(formatted.text).toContain('"chatId":-10001');
    expect(formatted.text).toContain('"botToken":"[REDACTED]"');
    expect(formatted.text).not.toContain("do-not-display");
  });
});
