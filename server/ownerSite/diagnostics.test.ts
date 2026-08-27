import { describe, expect, it } from "vitest";
import { runDiagnostic } from "./diagnostics";

describe("owner diagnostic terminal", () => {
  it("runs a safe server-time diagnostic", async () => {
    const result = await runDiagnostic("server-time");
    expect(result.exitCode).toBe(0);
    expect(result.output).toMatch(/T/);
  });

  it("runs the bounded disk diagnostic without shell interpolation", async () => {
    const result = await runDiagnostic("disk");
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Filesystem");
  });

  it("uses TCP probes rather than a missing system ping binary", async () => {
    const result = await runDiagnostic("ping", "1.1.1.1");
    expect(result.output).toContain("Pinging 1.1.1.1:443 with TCP probes");
    expect(result.output).not.toContain("ENOENT");
  });

  it("rejects command injection-shaped ping hosts", async () => {
    await expect(runDiagnostic("ping", "127.0.0.1;whoami")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
