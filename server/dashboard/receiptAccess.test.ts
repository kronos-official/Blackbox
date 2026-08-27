import { describe, expect, it } from "vitest";
import { issueOwnerReceiptLink } from "./receiptAccess";

describe("owner receipt-link issuer", () => {
  it("creates a short-lived link from an opaque receipt key", async () => {
    const signer = async (key: string) => `https://private-storage.example/${encodeURIComponent(key)}`;
    await expect(issueOwnerReceiptLink("payment-receipts/42/receipt.jpg", signer)).resolves.toEqual({ url: "https://private-storage.example/payment-receipts%2F42%2Freceipt.jpg", expiresInSeconds: 300 });
  });

  it("rejects traversal-like or empty storage keys before calling a signer", async () => {
    const signer = async () => "unexpected";
    await expect(issueOwnerReceiptLink("../private", signer)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(issueOwnerReceiptLink("", signer)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
