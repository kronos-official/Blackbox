import { describe, expect, it } from "vitest";
import { invoiceReferenceError, isInvoiceNumericId, isInvoiceReferenceReady } from "./customInvoiceResolver";

describe("custom invoice reference validation", () => {
  it("rejects blank and too-short references before a resolver request", () => {
    expect(isInvoiceReferenceReady("", 2)).toBe(false);
    expect(isInvoiceReferenceReady(" ", 2)).toBe(false);
    expect(isInvoiceReferenceReady("@", 2)).toBe(false);
  });

  it("accepts trimmed usernames and direct links at their minimum length", () => {
    expect(isInvoiceReferenceReady(" @user1 ", 2)).toBe(true);
    expect(isInvoiceReferenceReady("https://t.me/channel", 3)).toBe(true);
    expect(isInvoiceNumericId("8375579910")).toBe(true);
  });

  it("rejects malformed suffixes instead of leaving a spinner or sending an invalid payload", () => {
    expect(isInvoiceReferenceReady("justimmortalman@", 2)).toBe(false);
    expect(invoiceReferenceError("justimmortalman@", 2)).toBeTruthy();
    expect(invoiceReferenceError("", 2)).toBeTruthy();
  });
});
