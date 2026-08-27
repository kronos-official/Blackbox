import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(resolve(process.cwd(), "client/src/pages/OwnerDashboard.tsx"), "utf8");

describe("Mini App dashboard loading gate", () => {
  it("keeps its Telegram connection effect stable across mutation state updates", () => {
    expect(dashboardSource).toContain("const loginMutation = login.mutate;");
    expect(dashboardSource).toContain("}, [loginMutation, retryNonce]);");
    expect(dashboardSource).toContain("loginTimeout.current = window.setTimeout");
    expect(dashboardSource).toContain("10_000");
    expect(dashboardSource).not.toContain("}, [login]);");
  });

  it("exits the indefinite loading appearance when Telegram sign-in fails", () => {
    expect(dashboardSource).toContain("onError: error => {");
    expect(dashboardSource).toContain("setBridgeUnavailable(true);");
    expect(dashboardSource).toContain("onClick={() => setRetryNonce(value => value + 1)}");
  });

  it("offers a manual preview refresh control with a guarded reload action", () => {
    expect(dashboardSource).toContain("const [manualRefreshing, setManualRefreshing] = useState(false);");
    expect(dashboardSource).toContain("const refreshPreview = () => { if (manualRefreshing) return; setManualRefreshing(true); window.location.reload(); };");
    expect(dashboardSource).toContain("disabled={manualRefreshing}");
    expect(dashboardSource).toContain("aria-label={dashboardUiCopy[gateLocale].actions.refresh}");
  });

  it("exposes the gate state as an accessible live status", () => {
    expect(dashboardSource).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(dashboardSource).toContain('data-gate-state={bridgeUnavailable ? "unavailable"');
  });
});
