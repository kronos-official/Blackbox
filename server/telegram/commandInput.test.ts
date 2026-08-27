import { describe, expect, it } from "vitest";
import { commandRemainder, normalizeCommandDigits, normalizeCommandInput, splitCommandArguments } from "./commandInput";

describe("Telegram command input normalization", () => {
  it("converts Persian and Arabic-Indic digits to English digits", () => {
    expect(normalizeCommandDigits("۱۲۳ ١٢٣ 123")).toBe("123 123 123");
  });

  it("trims and collapses separator whitespace without changing arguments", () => {
    expect(normalizeCommandInput("  /حذف   ۵۰  ")).toBe("حذف 50");
    expect(splitCommandArguments("  سکوت   ۲ماه ")).toEqual(["سکوت", "2ماه"]);
  });

  it("accepts a safe compact numeric or username remainder but rejects ambiguous text", () => {
    expect(commandRemainder("حذف۵۰", "حذف")).toBe("50");
    expect(commandRemainder("بن@member", "بن")).toBe("@member");
    expect(commandRemainder("حذفسکوت", "حذف")).toBeUndefined();
  });
});
