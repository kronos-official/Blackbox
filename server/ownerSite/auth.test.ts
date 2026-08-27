import { describe, expect, it } from "vitest";

describe("owner site credential configuration", () => {
  it("has a configured username and a strong password secret", () => {
    const username = process.env.OWNER_SITE_USERNAME ?? "";
    const password = process.env.OWNER_SITE_PASSWORD ?? "";
    expect(username.trim().length).toBeGreaterThanOrEqual(4);
    expect(password.length).toBeGreaterThanOrEqual(12);
  });

  it("accepts the supplied secret through the lightweight login endpoint", async () => {
    const username = process.env.OWNER_SITE_USERNAME ?? "";
    const password = process.env.OWNER_SITE_PASSWORD ?? "";
    const response = await fetch("http://127.0.0.1:3000/api/owner-auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("kronos_owner_session=");
  });

  it("clears the owner cookie through the logout endpoint", async () => {
    const response = await fetch("http://127.0.0.1:3000/api/owner-auth/logout", { method: "POST" });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("kronos_owner_session=;");
  });
});
