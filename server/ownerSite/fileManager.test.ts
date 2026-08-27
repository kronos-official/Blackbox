import { describe, expect, it } from "vitest";
import { readProjectFile } from "./fileManager";

describe("owner file manager safety", () => {
  it("rejects traversal and hidden secret files", async () => {
    await expect(readProjectFile("../.env")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(readProjectFile(".env")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads an allowed project source file without exposing environment files", async () => {
    const file = await readProjectFile("README.md");
    expect(file.path).toBe("README.md");
    expect(file.content).not.toContain("TELEGRAM_BOT_TOKEN=");
  });
});
