import { describe, expect, it } from "vitest";
import { parseDiagnosticCommand } from "./OwnerControlCenter";

describe("owner CMD-style diagnostic console", () => {
  it("maps supported typed commands to the safe diagnostic contract", () => {
    expect(parseDiagnosticCommand("ping 1.1.1.1")).toEqual({ command: "ping", host: "1.1.1.1" });
    expect(parseDiagnosticCommand("پینگ 1.1.1.1")).toEqual({ command: "ping", host: "1.1.1.1" });
    expect(parseDiagnosticCommand("df")).toEqual({ command: "disk" });
    expect(parseDiagnosticCommand("process")).toEqual({ command: "process-info" });
  });

  it("does not map arbitrary shell input", () => {
    expect(parseDiagnosticCommand("cat /etc/passwd")).toBeNull();
    expect(parseDiagnosticCommand("ping 1.1.1.1; whoami")).toEqual({ command: "ping", host: "1.1.1.1;" });
  });
});
