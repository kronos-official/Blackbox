export type ModerationAction = "ban" | "kick" | "mute" | "warn" | "unban" | "unmute" | "unwarn" | "status" | "panel" | "mute_list";
import { normalizeCommandDigits, normalizeCommandInput } from "./commandInput";
import { INLINE_MENTION_TOKEN, targetReferenceFromToken, type TargetReference } from "./targetResolver";

export type { TargetReference } from "./targetResolver";

export type ParsedModerationCommand = {
  action: ModerationAction;
  sourceAlias: string;
  specialResponse?: "sick_ban";
  target?: TargetReference;
  durationSeconds?: number;
  permanentMute?: boolean;
  warningAdditionCount?: number;
  warningRemovalCount?: number;
  reason?: string;
};

const moderationAliases: Record<ModerationAction, readonly string[]> = {
  ban: ["ban", "بن", "مسدود", "حظر", "yasakla", "забанить", "banea", "prohibir", "interdire", "bloquear", "bannare", "sperren", "zablokuj", "cấm"],
  kick: ["kick", "اخراج", "طرد", "çıkar", "кик", "expulsar", "expulser", "espulsione", "remover", "rauswerfen", "wyrzuć", "đuổi"],
  mute: ["mute", "سکوت", "خفه", "صامت", "sustur", "мут", "silenciar", "rendre muet", "silenzia", "stummschalten", "wycisz", "tắt tiếng"],
  warn: ["warn", "اخطار", "هشدار", "تحذير", "uyar", "предупреждение", "advertir", "avertir", "aviso", "avviso", "verwarnen", "ostrzeż", "cảnh cáo"],
  unban: ["unban", "رفع بن", "حذف بن", "رفع مسدودیت", "فك حظر", "yasak kaldır", "разбан", "desbanear", "débannir", "desbloquear", "sbannare", "entsperren", "odblokuj", "bỏ cấm"],
  unmute: ["unmute", "لغو سکوت", "حذف سکوت", "رفع سکوت", "باز کردن سکوت", "فك كتم", "susturma kaldır", "размут", "desilenciar", "démuter", "desmutar", "riattiva", "stummschaltung aufheben", "wyciszenie usuń", "bỏ tắt tiếng"],
  mute_list: ["لیست سکوت", "لیست محدودیت", "mute list"],
  unwarn: ["unwarn", "حذف اخطار", "رفع اخطار", "کم کردن اخطار"],
  status: ["status", "user status", "وضعیت کاربر", "اطلاعات کاربر"],
  panel: ["user panel", "profile panel", "پنل کاربر", "پنل", "پروفایل کاربر", "لوحة المستخدم", "user profile", "профиль пользователя"],
};

const sickAlias = "سیک";
const persianNumberWords: Record<string, number> = {
  "یک": 1, "دو": 2, "سه": 3, "چهار": 4, "پنج": 5, "شش": 6, "هفت": 7, "هشت": 8, "نه": 9, "ده": 10,
};

function normalize(input: string): string {
  return normalizeCommandInput(input).toLocaleLowerCase("fa-IR");
}

const MAX_TIMED_MUTE_SECONDS = 365 * 86400;

function parseDuration(token: string, allowBareHours = false): number | undefined {
  const normalized = normalizeCommandDigits(token).toLocaleLowerCase("fa-IR");
  if (allowBareHours && /^\d+$/.test(normalized)) {
    const hours = Number(normalized);
    return Number.isSafeInteger(hours) && hours > 0 ? Math.min(hours * 3600, MAX_TIMED_MUTE_SECONDS) : undefined;
  }
  const match = normalized.match(/^(\d+)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|mo|month|months|y|yr|yrs|year|years|دقیقه|ساعت|روز|ماه|سال|ثانیه)$/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  const unit = match[2];
  const multiplier = ["s", "sec", "secs", "second", "seconds", "ثانیه"].includes(unit)
    ? 1
    : ["m", "min", "mins", "minute", "minutes", "دقیقه"].includes(unit)
      ? 60
      : ["h", "hr", "hrs", "hour", "hours", "ساعت"].includes(unit)
        ? 3600
        : ["d", "day", "days", "روز"].includes(unit)
          ? 86400
          : ["mo", "month", "months", "ماه"].includes(unit)
            ? 30 * 86400
            : 365 * 86400;
  return Math.min(value * multiplier, MAX_TIMED_MUTE_SECONDS);
}

function parseWarningCount(token: string): number | undefined {
  const numeric = Number(normalizeCommandDigits(token));
  if (Number.isSafeInteger(numeric) && numeric > 0 && numeric <= 100) return numeric;
  return persianNumberWords[token];
}

function matchAction(text: string): { action: ModerationAction; sourceAlias: string; specialResponse?: "sick_ban"; remainder: string } | undefined {
  if (text === sickAlias || text.startsWith(`${sickAlias} `)) {
    return { action: "ban", sourceAlias: sickAlias, specialResponse: "sick_ban", remainder: text.slice(sickAlias.length).trim() };
  }
  const candidates = (Object.entries(moderationAliases) as [ModerationAction, readonly string[]][])
    .flatMap(([action, aliases]) => aliases.map(alias => ({ action, alias: normalize(alias) })))
    .sort((a, b) => b.alias.length - a.alias.length);
  const candidate = candidates.find(item => {
    if (text === item.alias || text.startsWith(`${item.alias} `)) return true;
    if (!text.startsWith(item.alias)) return false;
    const compactRemainder = text.slice(item.alias.length);
    return compactRemainder.length > 0 && /^(?:-?\d|@)/.test(compactRemainder);
  });
  if (!candidate) return undefined;
  return { action: candidate.action, sourceAlias: candidate.alias, remainder: text.slice(candidate.alias.length).trim() };
}

/** Parses deterministic moderation grammar without accepting natural-language guesses. */
export function parseModerationCommand(rawText: string, isReply: boolean): ParsedModerationCommand | undefined {
  const normalized = normalize(rawText);
  const match = matchAction(normalized);
  if (!match) return undefined;
  const remaining = match.remainder ? match.remainder.split(" ") : [];
  let target: TargetReference | undefined = isReply ? { kind: "reply" } : undefined;
  let durationSeconds: number | undefined;
  let permanentMute = false;
  let warningAdditionCount: number | undefined;
  let warningRemovalCount: number | undefined;

  for (const token of remaining) {
    if (!target && (token === INLINE_MENTION_TOKEN || /^-?\d{5,16}$/.test(token) || /^@[a-zA-Z0-9_]{5,32}$/.test(token))) {
      target = targetReferenceFromToken(token);
      continue;
    }
    if (match.action === "mute" && ["دائمی", "دائم", "permanent", "forever"].includes(token)) {
      permanentMute = true;
      continue;
    }
    if (match.action !== "mute" || !permanentMute) {
      const parsedDuration = parseDuration(token, match.action === "mute");
      if (parsedDuration) {
        durationSeconds = match.action === "mute" ? Math.min(MAX_TIMED_MUTE_SECONDS, (durationSeconds ?? 0) + parsedDuration) : parsedDuration;
        continue;
      }
    }
    if (match.action === "warn" && !warningAdditionCount) {
      const count = parseWarningCount(token);
      if (count) {
        warningAdditionCount = count;
        continue;
      }
    }
    if (match.action === "unwarn" && !warningRemovalCount) {
      const count = parseWarningCount(token);
      if (count) {
        warningRemovalCount = count;
        continue;
      }
    }
    // A moderation command must have an exact grammar. Do not interpret normal
    // conversation such as «بن کنین اینو» as an action or a free-form reason.
    return undefined;
  }

  // User panels intentionally support an exact self-service command. Every
  // other action must point at a reply, a numeric ID, or an @username.
  if (match.action !== "panel" && match.action !== "mute_list" && !target) return undefined;
  if (match.sourceAlias === "خفه" && isReply && !durationSeconds && !permanentMute) return undefined;

  return {
    action: match.action,
    sourceAlias: match.sourceAlias,
    specialResponse: match.specialResponse,
    target,
    durationSeconds,
    ...(permanentMute ? { permanentMute: true } : {}),
    warningAdditionCount,
    warningRemovalCount,
    reason: undefined,
  };
}

export const moderationCommandExamples = ["بن @username دلیل", "سیک 123456789 اسپم", "mute 30m", "اخطار در پاسخ به پیام", "حذف اخطار یک", "وضعیت کاربر @username", "پنل کاربر"] as const;
