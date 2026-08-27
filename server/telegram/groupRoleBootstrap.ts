import type { User } from "telegraf/types";
import { recordKnownGroupMember, recordTelegramUser, upsertTelegramGroupAuthorityRole } from "./repository";

type TelegramAdministrator = { status: string; user: User };

export type GroupRoleBootstrapProgress = { completed: number; total: number; percent: number };

export function canBootstrapTelegramGroupRoles(status: string | undefined) {
  return status === "administrator" || status === "creator" || status === "owner";
}

export function groupRoleBootstrapProgressMessage(progress: GroupRoleBootstrapProgress) {
  const filled = Math.round((progress.percent / 100) * 10);
  const track = `${"■".repeat(filled)}${"□".repeat(10 - filled)}`;
  return `⚙️ <b>در حال همگام‌سازی نقش‌ها</b>\n\n<code>${track}</code> <b>${progress.percent}٪</b>\n<i>${progress.completed.toLocaleString("fa-IR")} از ${progress.total.toLocaleString("fa-IR")} مدیر/مالک بررسی شد</i>`;
}

export async function bootstrapTelegramGroupAuthorities(input: {
  groupId: number;
  administrators: TelegramAdministrator[];
  grantedByTelegramId: number;
  restoreSuspensions?: boolean;
  onProgress?: (progress: GroupRoleBootstrapProgress) => Promise<void> | void;
}) {
  const humanAdministrators = input.administrators.filter(member => !member.user.is_bot);
  let ownerCount = 0;
  let administratorCount = 0;
  const total = humanAdministrators.length;
  await input.onProgress?.({ completed: 0, total, percent: 0 });

  for (let index = 0; index < humanAdministrators.length; index += 1) {
    const member = humanAdministrators[index];
    const isOwner = member.status === "creator" || member.status === "owner";
    const role = isOwner ? "group_owner" : "group_admin" as const;
    if (isOwner) ownerCount += 1;
    else administratorCount += 1;
    await recordTelegramUser(member.user);
    await recordKnownGroupMember({
      groupId: input.groupId,
      telegramUserId: member.user.id,
      status: "active",
      telegramRole: isOwner ? "owner" : "administrator",
    });
    await upsertTelegramGroupAuthorityRole({
      groupId: input.groupId,
      telegramUserId: member.user.id,
      role,
      grantedByTelegramId: input.grantedByTelegramId,
      restoreSuspension: input.restoreSuspensions,
    });
    const completed = index + 1;
    await input.onProgress?.({ completed, total, percent: Math.round((completed / total) * 100) });
  }

  if (total === 0) await input.onProgress?.({ completed: 0, total, percent: 100 });

  return { syncedCount: total, ownerCount, administratorCount };
}
