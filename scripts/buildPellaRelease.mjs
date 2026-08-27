import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("pnpm", ["build"]);

const releaseRoot = resolve("pella-release");
await rm(releaseRoot, { force: true, recursive: true });
await mkdir(releaseRoot, { recursive: true });
await cp(resolve("dist", "index.js"), resolve(releaseRoot, "index.js"));
await cp(resolve("dist", "public"), resolve(releaseRoot, "public"), { recursive: true });

console.log("Pella production bundle ready in pella-release/");
