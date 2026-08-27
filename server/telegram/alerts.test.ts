import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOwnerAlertRecord, markOwnerAlertDelivery } = vi.hoisted(() => ({
  createOwnerAlertRecord: vi.fn(),
  markOwnerAlertDelivery: vi.fn(),
}));

vi.mock("./repository", () => ({ createOwnerAlertRecord, markOwnerAlertDelivery }));
vi.mock("./retry", () => ({ withTelegramRetry: <T>(operation: () => Promise<T>) => operation() }));
vi.mock("./constants", () => ({ OWNER_TELEGRAM_ID: 8375579910 }));

import { alertOwner } from "./alerts";

describe("owner alerts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends one notification when concurrent webhook failures share a dedupe key", async () => {
    let resolveRecord: ((value: { id: number; status: "pending" }) => void) | undefined;
    createOwnerAlertRecord.mockImplementationOnce(() => new Promise(resolve => { resolveRecord = resolve; }));
    const telegram = { sendMessage: vi.fn().mockResolvedValue({}) };
    const input = { alertType: "webhook_problem" as const, severity: "critical" as const, title: "خطای وبهوک", body: "خطا", dedupeKey: "webhook-dispatch-test" };

    const first = alertOwner(telegram as never, input);
    const second = alertOwner(telegram as never, input);
    resolveRecord?.({ id: 810001, status: "pending" });
    await Promise.all([first, second]);

    expect(telegram.sendMessage).toHaveBeenCalledTimes(1);
    expect(markOwnerAlertDelivery).toHaveBeenCalledWith(810001, "sent");
  });
});
