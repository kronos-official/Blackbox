import { TRPCError } from "@trpc/server";

/** Converts a private receipt storage key into a short-lived link only after ownership has been verified by the caller. */
export async function issueOwnerReceiptLink(storageKey: string, signer: (key: string) => Promise<string>, expiresInSeconds = 300) {
  if (!storageKey || storageKey.includes("..")) throw new TRPCError({ code: "NOT_FOUND" });
  return { url: await signer(storageKey), expiresInSeconds };
}
