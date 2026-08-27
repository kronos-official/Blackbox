import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

const source = path.resolve(process.cwd(), "docs");
const destination = path.resolve(process.cwd(), "client", "public", "docs");

await mkdir(destination, { recursive: true });
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith(".md")) {
    await copyFile(path.join(source, entry.name), path.join(destination, entry.name));
  }
}
