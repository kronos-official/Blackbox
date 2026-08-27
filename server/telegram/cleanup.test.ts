import { describe, expect, it } from "vitest";
import { buildCleanupCandidateMessageIds, parseCleanupCommand } from "./cleanup";

describe("bounded bulk cleanup grammar", () => {
  it("accepts only one to one hundred recent messages", () => {
    expect(parseCleanupCommand("حذف 25")).toBe(25);
    expect(parseCleanupCommand("clear 100")).toBe(100);
    expect(parseCleanupCommand("delete 101")).toBeUndefined();
    expect(parseCleanupCommand("پاکسازی 0")).toBeUndefined();
    expect(parseCleanupCommand("  حذف ۵۰ ")).toBe(50);
    expect(parseCleanupCommand("حذف۵۰")).toBe(50);
  });

  it("builds a bounded recent Telegram ID window that includes bot-authored messages even when they were not tracked", () => {
    expect(buildCleanupCandidateMessageIds(50, 3)).toEqual([50, 49, 48, 47, 46, 45, 44, 43, 42, 41, 40, 39, 38, 37, 36, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23]);
    expect(buildCleanupCandidateMessageIds(2, 100)).toEqual([2, 1]);
    expect(buildCleanupCandidateMessageIds(0, 3)).toEqual([]);
  });
});
