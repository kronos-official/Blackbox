import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";

const execFileAsync = promisify(execFile);
const HOST_PATTERN = /^(?=.{1,253}$)[a-zA-Z0-9][a-zA-Z0-9.-]*$/;
const COMMANDS = ["ping", "uptime", "node-version", "memory", "server-time", "disk", "process-info"] as const;
export type DiagnosticCommand = (typeof COMMANDS)[number];

export const diagnosticCommands = COMMANDS.map(command => ({ command, label: ({ ping: "ping میزبان", uptime: "uptime سرور", "node-version": "نسخهٔ Node", memory: "حافظهٔ فرآیند", "server-time": "زمان سرور", disk: "فضای دیسک", "process-info": "اطلاعات فرآیند" } as Record<DiagnosticCommand, string>)[command] }));

function isPrivateOrLocalHost(host: string) {
  const lower = host.toLowerCase();
  return lower === "localhost" || lower === "0.0.0.0" || lower.startsWith("127.") || lower.startsWith("10.") || lower.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(lower);
}

async function tcpProbe(host: string) {
  return new Promise<number>((resolve, reject) => {
    const startedAt = performance.now();
    const socket = net.createConnection({ host, port: 443 });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error("timeout")); }, 4_000);
    socket.once("connect", () => { clearTimeout(timer); const latency = performance.now() - startedAt; socket.end(); resolve(latency); });
    socket.once("error", error => { clearTimeout(timer); reject(error); });
  });
}

async function runTcpPing(host: string) {
  const lines = [`Pinging ${host}:443 with TCP probes:`];
  const results: number[] = [];
  for (let index = 1; index <= 3; index += 1) {
    try {
      const latency = await tcpProbe(host);
      results.push(latency);
      lines.push(`Reply ${index}: time=${latency.toFixed(1)}ms`);
    } catch (error) {
      lines.push(`Request ${index}: ${error instanceof Error ? error.message : "failed"}`);
    }
  }
  if (results.length) {
    const min = Math.min(...results); const max = Math.max(...results); const avg = results.reduce((sum, value) => sum + value, 0) / results.length;
    lines.push(`\nTCP latency: min=${min.toFixed(1)}ms avg=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms`);
    return { command: "ping" as const, output: lines.join("\n"), exitCode: 0 };
  }
  return { command: "ping" as const, output: lines.join("\n"), exitCode: 1 };
}

export async function runDiagnostic(command: DiagnosticCommand, host?: string) {
  if (!COMMANDS.includes(command)) throw new TRPCError({ code: "BAD_REQUEST", message: "این دستور تشخیصی مجاز نیست." });
  if (command === "memory") return { command, output: JSON.stringify(process.memoryUsage(), null, 2), exitCode: 0 };
  if (command === "server-time") return { command, output: new Date().toISOString(), exitCode: 0 };
  if (command === "process-info") return { command, output: JSON.stringify({ pid: process.pid, node: process.version, platform: process.platform, arch: process.arch, uptimeSeconds: Math.floor(process.uptime()) }, null, 2), exitCode: 0 };
  if (command === "ping") {
    if (!host || !HOST_PATTERN.test(host) || host.includes("..") || isPrivateOrLocalHost(host)) throw new TRPCError({ code: "BAD_REQUEST", message: "برای Ping فقط یک hostname یا IP عمومی معتبر مجاز است." });
    return runTcpPing(host);
  }
  const executable = command === "uptime" ? "uptime" : command === "disk" ? "df" : "node";
  const args = command === "node-version" ? ["--version"] : command === "disk" ? ["-h", "/"] : [];
  try {
    const result = await execFileAsync(executable, args, { timeout: 8_000, maxBuffer: 64_000 });
    return { command, output: result.stdout || result.stderr, exitCode: 0 };
  } catch (error: any) {
    return { command, output: String(error?.stdout || error?.stderr || error?.message || "diagnostic failed"), exitCode: Number(error?.code ?? 1) };
  }
}
