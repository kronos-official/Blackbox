import { describe, expect, it } from "vitest";
import { dashboardOperationsCopy } from "./dashboardOperationsI18n";

describe("dashboard operations translations", () => {
  it("provides complete staff-console and lock-profile copy for every dashboard locale", () => {
    for (const [locale, copy] of Object.entries(dashboardOperationsCopy)) {
      expect(copy.staff.eyebrow, `${locale} staff label`).toBeTruthy();
      expect(copy.staff.text, `${locale} staff instructions`).toBeTruthy();
      expect(copy.staff.access, `${locale} staff access boundary`).toBeTruthy();
      expect(copy.policies.title, `${locale} policy title`).toBeTruthy();
      expect(copy.policies.text, `${locale} policy instructions`).toBeTruthy();
      expect(copy.policies.openText, `${locale} open policy explanation`).toBeTruthy();
      expect(copy.policies.mediaShieldText, `${locale} media policy explanation`).toBeTruthy();
      expect(copy.policies.strictGuardText, `${locale} strict policy explanation`).toBeTruthy();
      expect(copy.policies.restoreText, `${locale} rollback explanation`).toBeTruthy();
      expect(copy.policies.noRollback, `${locale} rollback empty state`).toBeTruthy();
    }
  });
});
