import { describe, expect, it } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { createOwnerSession } from "./auth";

function caller(cookie?: string) {
  const ctx: TrpcContext = {
    req: { headers: cookie ? { cookie } : {}, header: () => undefined } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: null,
  };
  return appRouter.createCaller(ctx);
}

describe("independent owner control center", () => {
  it("rejects access without the owner session cookie", async () => {
    await expect(caller().ownerSite.overview()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("accepts the signed owner session cookie", async () => {
    const username = process.env.OWNER_SITE_USERNAME;
    if (!username) return;
    const token = await createOwnerSession(username);
    await expect(caller(`kronos_owner_session=${encodeURIComponent(token)}`).ownerSite.session()).resolves.toMatchObject({ username, role: "owner" });
  });
});

  it("protects global settings, global texts, and revision history behind owner auth", async () => {
    await expect(caller().ownerSite.globalSettings()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().ownerSite.globalTexts()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller().ownerSite.configRevisions()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
