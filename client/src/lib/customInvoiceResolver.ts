const TELEGRAM_USERNAME = /^[A-Za-z0-9_]{5,32}$/;
const TELEGRAM_NUMERIC_ID = /^-?\d+$/;

export function normalizeInvoiceReference(reference: string) {
  return reference
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/)[0]
    .trim();
}

export function isInvoiceReferenceReady(reference: string, minimumLength: number) {
  const normalized = normalizeInvoiceReference(reference);
  if (normalized.length < minimumLength) return false;
  return TELEGRAM_NUMERIC_ID.test(normalized) || TELEGRAM_USERNAME.test(normalized);
}

export function isInvoiceNumericId(value: string) {
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim()));
}

export function invoiceReferenceError(reference: string, minimumLength: number) {
  if (!reference.trim()) return "Reference is required";
  if (!isInvoiceReferenceReady(reference, minimumLength)) return "Enter a valid Telegram link, @username, or numeric ID";
  return null;
}
