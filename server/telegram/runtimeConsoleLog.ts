import { writeAuditLog } from "./repository";

const MAX_RUNTIME_LOG_LINE_LENGTH = 4_000;
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|session|initdata)/i;
const URL_SENSITIVE_PARAM_PATTERN = /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|session|initdata)=)[^&#\s]+/gi;
const KEY_VALUE_SECRET_PATTERN = /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|session|initdata)\s*[:=]\s*)[^\s,;"'}\]]+/gi;

type RuntimeLogLevel = "log" | "info" | "warn" | "error";
type ConsoleMethod = (...args: unknown[]) => void;

function redactedValue() {
  return "[REDACTED]";
}

export function redactRuntimeLogText(value: string) {
  return value
    .replace(URL_SENSITIVE_PARAM_PATTERN, `$1${redactedValue()}`)
    .replace(KEY_VALUE_SECRET_PATTERN, `$1${redactedValue()}`)
    .slice(0, MAX_RUNTIME_LOG_LINE_LENGTH);
}

function serializeRuntimeLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactRuntimeLogText(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return "undefined";
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactRuntimeLogText(value.message),
      stack: value.stack ? redactRuntimeLogText(value.stack) : undefined,
    };
  }
  if (typeof value === "bigint") return String(value);
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (Array.isArray(value)) return value.slice(0, 32).map(item => serializeRuntimeLogValue(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 64)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? redactedValue() : serializeRuntimeLogValue(item, seen);
    }
    return output;
  }
  return redactRuntimeLogText(String(value));
}

export function formatRuntimeConsoleArguments(args: unknown[]) {
  const safeArgs = args.map(arg => serializeRuntimeLogValue(arg));
  const text = safeArgs.map(arg => typeof arg === "string" ? arg : JSON.stringify(arg)).join(" ");
  return { text: redactRuntimeLogText(text), args: safeArgs };
}

export function installRuntimeConsoleLogging() {
  const marker = "__kronosRuntimeConsoleLoggingInstalled" as const;
  const consoleWithMarker = console as Console & Partial<Record<typeof marker, boolean>>;
  if (consoleWithMarker[marker]) return;
  consoleWithMarker[marker] = true;

  (Object.keys({ log: true, info: true, warn: true, error: true }) as RuntimeLogLevel[]).forEach(level => {
    const original = console[level].bind(console) as ConsoleMethod;
    console[level] = ((...args: unknown[]) => {
      original(...args);
      const formatted = formatRuntimeConsoleArguments(args);
      const severity = level === "error" ? "critical" : level === "warn" ? "warning" : "info";
      void writeAuditLog({
        severity,
        category: "runtime_console",
        event: `console.${level}`,
        details: { line: formatted.text, args: formatted.args, source: "production_runtime" },
      }).catch(() => undefined);
    }) as ConsoleMethod;
  });
}
