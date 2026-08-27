import { useEffect, useRef } from "react";

/**
 * The sole client-side reset signal emitted after the owner-only database reset
 * succeeds. Group-scoped panels subscribe through useDashboardReset so stale
 * selection or draft state cannot survive the reset.
 */
export const DASHBOARD_RESET_EVENT = "kronos-dashboard-reset";

/**
 * Audited inventory of Mini App local state that is coupled to a selected group.
 * Keep this inventory and the rendered reset-flow regression in sync whenever a
 * new group-scoped panel or draft is introduced.
 */
export const GROUP_SCOPED_RESET_STATE_HOLDERS = {
  Groups: ["selected group", "settings form draft"],
  Members: ["selected group", "administrator refresh summary", "departed-members filter", "direct role-management form draft"],
  Moderation: ["selected group"],
  ForcedJoin: ["forced-join channel draft, including groupId"],
} as const;

/** Registers a component-local cleanup callback for the protected reset signal. */
export function useDashboardReset(onReset: () => void) {
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    const listener = () => onResetRef.current();
    window.addEventListener(DASHBOARD_RESET_EVENT, listener);
    return () => window.removeEventListener(DASHBOARD_RESET_EVENT, listener);
  }, []);
}

export type DashboardResetCleanupDeps = {
  sessionStore: Pick<Storage, "removeItem">;
  localStore: Pick<Storage, "removeItem">;
  clearCachedQueries: () => void;
  clearSelectedGroups: () => void;
};

/**
 * Removes every dashboard credential and cached query state that could otherwise
 * render pre-reset data before the Telegram Mini App authenticates again.
 */
export function clearDashboardAfterDatabaseReset({ sessionStore, localStore, clearCachedQueries, clearSelectedGroups }: DashboardResetCleanupDeps) {
  clearCachedQueries();
  clearSelectedGroups();
  sessionStore.removeItem("kronos-dashboard-session");
  sessionStore.removeItem("kronos-dashboard-profile");
  localStore.removeItem("kronos-owner-dashboard-session");
}
