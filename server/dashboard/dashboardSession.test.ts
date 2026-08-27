import { describe, expect, it, vi } from "vitest";
import { clearDashboardAfterDatabaseReset } from "../../client/src/lib/dashboardSession";

describe("dashboard reset cleanup", () => {
  it("clears cached queries and every current or legacy dashboard credential", () => {
    const sessionStore = { removeItem: vi.fn() };
    const localStore = { removeItem: vi.fn() };
    const clearCachedQueries = vi.fn();
    const clearSelectedGroups = vi.fn();

    clearDashboardAfterDatabaseReset({ sessionStore, localStore, clearCachedQueries, clearSelectedGroups });

    expect(clearCachedQueries).toHaveBeenCalledOnce();
    expect(clearSelectedGroups).toHaveBeenCalledOnce();
    expect(sessionStore.removeItem).toHaveBeenCalledWith("kronos-dashboard-session");
    expect(sessionStore.removeItem).toHaveBeenCalledWith("kronos-dashboard-profile");
    expect(localStore.removeItem).toHaveBeenCalledWith("kronos-owner-dashboard-session");
  });
});
