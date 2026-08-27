export type CompactNotificationBody = {
  actor: string | null;
  actorId: string | null;
  target: string | null;
  targetId: string | null;
  summary: string;
  tehranTime: string | null;
  rawText: string;
};

export type GroupableNotification = {
  id: number;
  eventType: string;
  relatedGroupId: number | null;
  body: string;
  createdAt: Date | string;
  isRead: boolean;
};

export type GroupedNotification<T extends GroupableNotification> = {
  key: string;
  latest: T;
  items: T[];
};

function normalizeNotificationText(html: string) {
  return html
    .replace(/<br\s*\/?\s*>/gi, " · ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function capture(text: string, pattern: RegExp) {
  return pattern.exec(text)?.[1]?.trim() || null;
}

function shortText(value: string, maxLength = 132) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function captureLabeledHtmlValue(html: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return capture(html, new RegExp(`<code>\\s*${escapedLabel}\\s*<\\/code>\\s*│\\s*([\\s\\S]+?)(?=\\s*<code>|$)`, "i"));
}

function notificationHtmlValueToText(value: string | null) {
  return value ? normalizeNotificationText(value) : null;
}

function numericNotificationValue(value: string | null) {
  return notificationHtmlValueToText(value)?.match(/[0-9]+/)?.[0] ?? null;
}

/** Extracts a concise, RTL-friendly summary while retaining the original rich body for on-demand details. */
export function compactNotificationBody(html: string): CompactNotificationBody {
  const rawText = normalizeNotificationText(html);
  const labeledActor = notificationHtmlValueToText(captureLabeledHtmlValue(html, "انجام‌دهنده"));
  const labeledActorId = numericNotificationValue(captureLabeledHtmlValue(html, "شناسه"));
  const labeledTarget = notificationHtmlValueToText(captureLabeledHtmlValue(html, "هدف"));
  const labeledTargetId = numericNotificationValue(captureLabeledHtmlValue(html, "شناسهٔ هدف"));
  const labeledDetails = notificationHtmlValueToText(captureLabeledHtmlValue(html, "جزئیات"));
  const labeledTehranTime = notificationHtmlValueToText(captureLabeledHtmlValue(html, "زمان تهران"));
  // Keep compact summaries readable for notification records persisted before the label-based format.
  const legacyActor = capture(rawText, /👤\s*انجام[\s‌-]*دهنده:\s*(.+?)(?=\s*🆔\s*شناسه[ٔ ]*انجام|\s*🎯|\s*📌|\s*🕰|$)/);
  const legacyActorId = capture(rawText, /🆔\s*شناسه[ٔ ]*انجام[\s‌-]*دهنده:\s*([0-9]+)/);
  const legacyTarget = capture(rawText, /🎯\s*(?:کاربر\/هدف|هدف):\s*(.+?)(?=\s*🆔\s*شناسه[ٔ ]*هدف|\s*📌|\s*🕰|$)/);
  const legacyTargetId = capture(rawText, /🆔\s*شناسه[ٔ ]*هدف:\s*([0-9]+)/);
  const legacyDetails = capture(rawText, /📌\s*جزئیات:\s*(.+?)(?=\s*🕰|$)/);
  const legacyTehranTime = capture(rawText, /🕰\s*زمان تهران:\s*(.+)$/);
  const details = labeledDetails ?? legacyDetails;
  return {
    actor: labeledActor ?? legacyActor,
    actorId: labeledActorId ?? legacyActorId,
    target: labeledTarget ?? legacyTarget,
    targetId: labeledTargetId ?? legacyTargetId,
    summary: shortText(details ?? rawText),
    tehranTime: labeledTehranTime ?? legacyTehranTime,
    rawText,
  };
}

/** Groups repeated event activity for the same group and actor/target during a recent six-hour window. */
export function groupSimilarNotifications<T extends GroupableNotification>(items: T[], windowMs = 6 * 60 * 60 * 1000): GroupedNotification<T>[] {
  const groups: GroupedNotification<T>[] = [];
  const latestGroupBySignature = new Map<string, GroupedNotification<T>>();
  for (const item of items) {
    const compact = compactNotificationBody(item.body);
    const signature = [
      item.eventType,
      item.relatedGroupId ?? "none",
      compact.actorId ?? compact.actor ?? "unknown-actor",
      compact.targetId ?? compact.target ?? "no-target",
    ].join(":");
    const prior = latestGroupBySignature.get(signature);
    const withinWindow = prior && Math.abs(new Date(prior.latest.createdAt).getTime() - new Date(item.createdAt).getTime()) <= windowMs;
    if (prior && withinWindow) {
      prior.items.push(item);
      continue;
    }
    const group = { key: `${signature}:${item.id}`, latest: item, items: [item] };
    groups.push(group);
    latestGroupBySignature.set(signature, group);
  }
  return groups;
}
