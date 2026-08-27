const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Converts Persian and Arabic-Indic digits while preserving all other command text. */
export function normalizeCommandDigits(value: string): string {
  return value.replace(/[۰-۹٠-٩]/g, digit => {
    const index = PERSIAN_DIGITS.indexOf(digit);
    return String(index >= 0 ? index : ARABIC_DIGITS.indexOf(digit));
  });
}

/** Normalizes command spelling without changing meaningful argument content. */
export function normalizeCommandInput(value: string): string {
  return normalizeCommandDigits(value)
    .trim()
    .replace(/^\//, "")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ");
}

/** Returns a separator-tolerant command remainder for compact forms such as «حذف۵». */
export function commandRemainder(value: string, command: string): string | undefined {
  const normalized = normalizeCommandInput(value);
  const normalizedCommand = normalizeCommandInput(command);
  if (normalized === normalizedCommand) return "";
  if (!normalized.toLocaleLowerCase("fa-IR").startsWith(normalizedCommand.toLocaleLowerCase("fa-IR"))) return undefined;
  const remainder = normalized.slice(normalizedCommand.length);
  if (!remainder || /^\s/.test(remainder) || /^[-@\d]/.test(remainder)) return remainder.trim();
  return undefined;
}

export function splitCommandArguments(value: string): string[] {
  return normalizeCommandInput(value).split(" ").filter(Boolean);
}

export const commandDigitExamples = { persian: "۱۲۳", arabic: "١٢٣", english: "123" } as const;
