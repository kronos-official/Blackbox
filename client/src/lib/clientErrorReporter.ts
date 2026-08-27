const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|initdata|session|api[-_]?key)/i;
const MAX_MESSAGE_LENGTH = 240;
const MAX_ENTRIES = 20;

type SafeClientError = {
  kind: "error" | "unhandledrejection";
  message: string;
  source?: string;
  timestamp: string;
};

const sanitize = (value: unknown): string => {
  if (value instanceof Error) return value.message.slice(0, MAX_MESSAGE_LENGTH);
  if (typeof value === "string") return value.slice(0, MAX_MESSAGE_LENGTH);
  try {
    return JSON.stringify(value, (key, nested) =>
      SENSITIVE_KEY.test(key) ? "[redacted]" : nested
    ).slice(0, MAX_MESSAGE_LENGTH);
  } catch {
    return "Unknown client error";
  }
};

const entries: SafeClientError[] = [];

export const reportClientError = (
  kind: SafeClientError["kind"],
  error: unknown,
  source?: string
) => {
  const entry: SafeClientError = {
    kind,
    message: sanitize(error),
    source: source?.slice(0, 80),
    timestamp: new Date().toISOString(),
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  console.error("[Kronos Client Error]", entry);
};

export const getClientErrorLog = (): readonly SafeClientError[] => entries;
