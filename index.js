import { spawn } from "node:child_process";

/**
 * Pella starts Node.js servers from a root JavaScript file.  The source repository
 * intentionally excludes build artefacts, so this shim starts the typed Express /
 * Telegraf runtime through tsx without requiring a host-side build command.
 */
const runtime = spawn(process.execPath, ["--import", "tsx", "server/_core/index.ts"], {
  env: {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || "production",
  },
  stdio: "inherit",
});

runtime.once("error", error => {
  console.error("[Kronos Guard] Pella runtime could not start", error);
  process.exitCode = 1;
});

runtime.once("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => runtime.kill(signal));
}
