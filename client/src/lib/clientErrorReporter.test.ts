import { beforeEach, describe, expect, it, vi } from "vitest";
import { getClientErrorLog, reportClientError } from "./clientErrorReporter";

describe("client error reporter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("redacts credential-shaped fields before retaining an error", () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportClientError("error", { message: "failed", token: "secret-token", session: "cookie-value" }, "query");
    const last = getClientErrorLog().at(-1);
    expect(last?.message).not.toContain("secret-token");
    expect(last?.message).not.toContain("cookie-value");
    expect(last?.message).toContain("redacted");
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it("keeps only a bounded in-memory diagnostic history", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (let index = 0; index < 25; index += 1) reportClientError("unhandledrejection", `error-${index}`);
    const log = getClientErrorLog();
    expect(log).toHaveLength(20);
    expect(log[0]?.message).toContain("error-5");
    expect(log.at(-1)?.message).toContain("error-24");
  });
});
