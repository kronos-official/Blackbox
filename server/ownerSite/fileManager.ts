import { promises as fs } from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";

const ROOT = path.resolve(process.cwd());
const MAX_FILE_BYTES = 240_000;
const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".css", ".html", ".md", ".sql", ".yaml", ".yml"]);
const HIDDEN_NAMES = new Set([".env", ".env.local", ".env.production", ".git", "node_modules", "dist", "coverage", "uploads"]);
const SECRET_PATTERN = /(TELEGRAM_BOT_TOKEN|TELEGRAM_WEBHOOK_SECRET|JWT_SECRET|DATABASE_URL|API_KEY|SECRET_KEY|ACCESS_TOKEN|PRIVATE_KEY|COOKIE_SECRET|password\s*[:=])/gi;

function safeRelative(relativePath: string) {
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("../") || normalized.includes("/../") || path.posix.isAbsolute(normalized)) throw new TRPCError({ code: "BAD_REQUEST", message: "مسیر فایل معتبر نیست." });
  const absolute = path.resolve(ROOT, normalized);
  if (absolute !== ROOT && !absolute.startsWith(`${ROOT}${path.sep}`)) throw new TRPCError({ code: "BAD_REQUEST", message: "مسیر فایل مجاز نیست." });
  return { normalized, absolute };
}

function isHiddenPart(part: string) {
  return HIDDEN_NAMES.has(part) || part.startsWith(".");
}

function redactSource(source: string) {
  return source.replace(SECRET_PATTERN, match => `${match.split(/\s*[:=]/)[0]}: [REDACTED]`);
}

export async function listProjectFiles() {
  const result: Array<{ path: string; type: "file" | "directory"; size?: number }> = [];
  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (isHiddenPart(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(ROOT, absolute).split(path.sep).join("/");
      if (entry.isDirectory()) {
        result.push({ path: relative, type: "directory" });
        await walk(absolute);
      } else if (entry.isFile() && ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const stat = await fs.stat(absolute);
        result.push({ path: relative, type: "file", size: stat.size });
      }
    }
  }
  await walk(ROOT);
  return result;
}

export async function readProjectFile(relativePath: string) {
  const { normalized, absolute } = safeRelative(relativePath);
  if (normalized.split("/").some(isHiddenPart) || !ALLOWED_EXTENSIONS.has(path.extname(normalized).toLowerCase())) throw new TRPCError({ code: "NOT_FOUND", message: "این فایل برای مشاهده مجاز نیست." });
  const stat = await fs.stat(absolute).catch(() => null);
  if (!stat?.isFile()) throw new TRPCError({ code: "NOT_FOUND", message: "فایل پیدا نشد." });
  if (stat.size > MAX_FILE_BYTES) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "فایل برای نمایش مستقیم بزرگ است." });
  const content = redactSource(await fs.readFile(absolute, "utf8"));
  return { path: normalized, content, size: stat.size, modifiedAt: stat.mtime.toISOString() };
}
