import { describe, expect, it } from "vitest";
import { autoDeleteDelayConfirmationText, autoDeleteDelayHelpText, parseAutoDeleteDelayCommand } from "./autoDeleteSettings";

describe("per-group automatic deletion delay command", () => {
  it("accepts Persian digits and spaced Persian command input", () => {
    expect(parseAutoDeleteDelayCommand("زمان حذف ۵")).toEqual({ delaySeconds: 300 });
    expect(parseAutoDeleteDelayCommand("حذف خودکار 90")).toEqual({ delaySeconds: 5_400 });
  });

  it("accepts compact input and all supported time units", () => {
    expect(parseAutoDeleteDelayCommand("زمان حذف۵ثانیه")).toEqual({ delaySeconds: 5 });
    expect(parseAutoDeleteDelayCommand("زمان حذف 10 دقیقه")).toEqual({ delaySeconds: 600 });
    expect(parseAutoDeleteDelayCommand("زمان حذف2ساعت")).toEqual({ delaySeconds: 7_200 });
    expect(parseAutoDeleteDelayCommand("auto delete 15 seconds")).toEqual({ delaySeconds: 15 });
  });

  it("rejects values outside the safe five-second to one-day range", () => {
    expect(parseAutoDeleteDelayCommand("زمان حذف 0")).toBeUndefined();
    expect(parseAutoDeleteDelayCommand("زمان حذف 4 ثانیه")).toBeUndefined();
    expect(parseAutoDeleteDelayCommand("زمان حذف 25 ساعت")).toBeUndefined();
    expect(parseAutoDeleteDelayCommand("زمان حذف پنج")).toBeUndefined();
  });

  it("keeps the confirmation and help text clear in Persian", () => {
    expect(autoDeleteDelayConfirmationText(5)).toContain("5 ثانیه");
    expect(autoDeleteDelayConfirmationText(7_200)).toContain("2 ساعت");
    expect(autoDeleteDelayHelpText()).toContain("زمان حذف 5 ثانیه");
  });
});
