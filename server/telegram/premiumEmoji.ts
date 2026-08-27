/**
 * A small, curated semantic registry for Kronos Guard's user-facing copy.
 * IDs are read from the Premium Emoji packs explicitly supplied by the owner.
 * Each item keeps its Unicode counterpart inside the tg-emoji tag, so messages
 * remain understandable to clients that do not render the Premium asset.
 */
export const KRONOS_PREMIUM_EMOJI = {
  brand: { glyph: "✨", id: "491124163063316" },
  success: { glyph: "✅", id: "5902399574357581208" },
  error: { glyph: "❌", id: "5210952531676504517" },
  warning: { glyph: "⚠️", id: "5447644880824181073" },
  blocked: { glyph: "⛔️", id: "5260293700088511294" },
  lock: { glyph: "🔒", id: "5296369303661067030" },
  unlock: { glyph: "🔓", id: "6048826648839591666" },
  settings: { glyph: "⚙️", id: "5341715473882955310" },
  statistics: { glyph: "📊", id: "5231200819986047254" },
  notification: { glyph: "🔔", id: "5458603043203327669" },
  pin: { glyph: "📌", id: "5397782960512444700" },
  member: { glyph: "👤", id: "5116582462276764538" },
  owner: { glyph: "👑", id: "5217822164362739968" },
  link: { glyph: "🔗", id: "5271604874419647061" },
  time: { glyph: "⏰", id: "5123230779593196220" },
  idea: { glyph: "💡", id: "5422439311196834318" },
  info: { glyph: "ℹ️", id: "5334544901428229844" },
  search: { glyph: "🔍", id: "5231012545799666522" },
} as const;

const replacementEntries = Object.values(KRONOS_PREMIUM_EMOJI)
  .flatMap(({ glyph, id }) => {
    const normalized = glyph.replace(/\uFE0F/g, "");
    const wrapped = `<tg-emoji emoji-id="${id}">${glyph}</tg-emoji>`;
    return normalized === glyph ? [[glyph, wrapped] as const] : [[glyph, wrapped] as const, [normalized, wrapped] as const];
  })
  .sort(([first], [second]) => second.length - first.length);

const unsafeUnparsedHtml = /[<>&]/;
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
const arabicIndicDigits = "٠١٢٣٤٥٦٧٨٩";

/**
 * Keeps Persian copy RTL while guaranteeing Latin digits in every bot-facing
 * text or caption. IDs, counters, timestamps and mixed Arabic-Indic digits
 * all receive the same stable representation.
 */
export function normalizeBotNumerals(text: string) {
  return text
    .replace(/[۰-۹]/g, digit => String(persianDigits.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String(arabicIndicDigits.indexOf(digit)));
}

export function renderPremiumEmoji(text: string) {
  return replacementEntries.reduce((result, [glyph, wrapped]) => result.split(glyph).join(wrapped), text);
}

/**
 * Telegram may reject or hide tg-emoji entities when the bot owner/account is
 * not eligible to use Premium custom emoji. The Unicode path is therefore the
 * production-safe default; renderPremiumEmoji remains available for an
 * explicitly verified Premium-capable deployment.
 */
export function renderTelegramVisibleEmoji(text: string) {
  return text;
}

export type TelegramApiPayload = Record<string, unknown> | undefined;

const htmlTextMethods = new Set(["sendMessage", "editMessageText"]);
const htmlCaptionMethods = new Set([
  "sendAnimation",
  "sendAudio",
  "sendDocument",
  "sendPhoto",
  "sendVideo",
  "sendVoice",
  "editMessageCaption",
]);

function customEmoji({ glyph, id }: { glyph: string; id: string }) {
  return `<tg-emoji emoji-id="${id}">${glyph}</tg-emoji>`;
}

/**
 * Enriches Telegram message bodies only when it is safe to use HTML parsing.
 * Button labels are deliberately untouched: Telegram's Bot API does not expose
 * message entities for inline/reply keyboard text, so Premium Emoji cannot be
 * attached there reliably.
 */
export function enrichTelegramApiPayloadWithPremiumEmoji(method: string, payload: TelegramApiPayload): TelegramApiPayload {
  if (!payload) return payload;
  const parseMode = payload.parse_mode;
  if (parseMode && parseMode !== "HTML") return payload;

  const field = htmlTextMethods.has(method) && typeof payload.text === "string"
    ? "text"
    : htmlCaptionMethods.has(method) && typeof payload.caption === "string"
      ? "caption"
      : undefined;
  if (!field) return payload;

  const source = payload[field] as string;
  const normalized = normalizeBotNumerals(source);
  if (!parseMode && unsafeUnparsedHtml.test(normalized)) return { ...payload, [field]: normalized };
  const visibleText = renderTelegramVisibleEmoji(normalized);
  const hasSemanticEmoji = renderPremiumEmoji(normalized) !== normalized;
  const branded = hasSemanticEmoji ? visibleText : `${KRONOS_PREMIUM_EMOJI.brand.glyph} ${visibleText}`;

  const nextPayload = { ...payload, [field]: branded };
  if (parseMode === "HTML") return nextPayload;

  const { parse_mode: _ignoredParseMode, ...safePayload } = nextPayload;
  return safePayload;
}
