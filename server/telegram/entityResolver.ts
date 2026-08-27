function escapeHtml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"); }

export type EntityKind = "channel" | "group" | "user" | "bot";
export type EntityReference = { raw: string; normalized: string; kind: EntityKind };

export type ResolvedEntity = {
  id: number;
  kind: EntityKind;
  name: string;
  username: string | null;
  bio: string | null;
  photoFileId: string | null;
  source: "telegram" | "directory" | "known_group";
};

export function normalizeEntityReference(raw: string) {
  const value = raw.trim();
  if (!value) return "";
  const withoutScheme = value.replace(/^https?:\/\/(?:www\.)?t\.me\//i, "");
  const withoutInvitePrefix = withoutScheme.replace(/^joinchat\//i, "").replace(/^\+/, "");
  return withoutInvitePrefix.split(/[/?#]/, 1)[0].replace(/^@/, "").trim();
}

export function parseEntityReference(raw: string, kind: EntityKind): EntityReference | null {
  const normalized = normalizeEntityReference(raw);
  if (!normalized) return null;
  if (kind === "channel" || kind === "group") {
    if (/^\+|^joinchat\//i.test(raw.trim().replace(/^https?:\/\/(?:www\.)?t\.me\//i, ""))) return null;
    if (!/^-?\d+$/.test(normalized) && !/^[A-Za-z0-9_]{3,}$/.test(normalized)) return null;
  } else if (kind === "user" || kind === "bot") {
    if (!/^\d+$/.test(normalized) && !/^[A-Za-z0-9_]{3,}$/.test(normalized)) return null;
  }
  return { raw, normalized, kind };
}

export function entityKindLabel(kind: EntityKind) {
  return ({ channel: "کانال", group: "گروه", user: "کاربر", bot: "ربات" } satisfies Record<EntityKind, string>)[kind];
}

export function buildEntityIdentityCard(entity: ResolvedEntity) {
  const username = entity.username ? `@${escapeHtml(entity.username.replace(/^@/, ""))}` : "ثبت نشده";
  const bio = entity.bio ? escapeHtml(entity.bio) : "برای این مقصد توضیحی ثبت نشده است";
  return `<b>◈ پروندهٔ شناسایی Kronos Guard</b>\n\n<b>نوع مقصد:</b> ${entityKindLabel(entity.kind)}\n<b>نام:</b> ${escapeHtml(entity.name || "بدون نام")}\n<b>شناسهٔ عددی:</b> <code>${entity.id}</code>\n<b>نام کاربری:</b> ${username}\n<b>معرفی:</b> ${bio}\n\n<i>این شناسه از مسیر امن Telegram/دفترچهٔ شناخته‌شدهٔ Kronos Guard استخراج شده است.</i>`;
}

export function progressBar(percent: number) {
  const bounded = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round(bounded / 10);
  return `${"▰".repeat(filled)}${"▱".repeat(10 - filled)} ${bounded}%`;
}

export function conversionProgressText(kind: EntityKind, percent: number) {
  return `در حال تبدیل ${entityKindLabel(kind)} به شناسهٔ عددی…\n\n${progressBar(percent)}\n\nKronos Guard در حال بررسی امن مقصد است.`;
}

export function linkModeLabel(mode: "text" | "image" | "limited") {
  return ({ text: "لینک متنی", image: "لینک تصویری", limited: "لینک محدود" } as const)[mode];
}
