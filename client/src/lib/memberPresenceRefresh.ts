/**
 * Member presence is inferred from the latest activity observed by Kronos Guard.
 * Keep the dashboard query fresh once per minute while the panel is visible.
 */
export const MEMBER_PRESENCE_REFRESH_INTERVAL_MS = 60_000;

export function shouldRefreshMemberPresence(isDocumentVisible: boolean, hasSelectedGroup: boolean) {
  return isDocumentVisible && hasSelectedGroup;
}

