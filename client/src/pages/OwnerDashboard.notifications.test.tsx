// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const updateGroupPreferences = vi.fn();
  const setPrivateDelivery = vi.fn();
  const utils = {
    dashboard: {
      notifications: {
        list: { invalidate: vi.fn(), cancel: vi.fn(), getData: vi.fn(), setData: vi.fn() },
        unreadCount: { invalidate: vi.fn() },
        groupPreferences: { invalidate: vi.fn() },
        getMutes: { cancel: vi.fn(), getData: vi.fn(), setData: vi.fn() },
        getPrivateDelivery: { setData: vi.fn() },
      },
    },
  };
  return { updateGroupPreferences, setPrivateDelivery, utils };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => fixture.utils,
    dashboard: {
      groups: {
        list: { useQuery: () => ({ data: [{ id: 42, title: "گروه بدون رخداد", access: "group_owner" }], isLoading: false }) },
      },
      notifications: {
        list: { useQuery: () => ({ data: { items: [], unreadCount: 0 }, isLoading: false, isError: false }) },
        markRead: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        markAllRead: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        getMutes: { useQuery: () => ({ data: { mutedCategories: [] }, isLoading: false, isError: false }) },
        updateMutes: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        getPrivateDelivery: { useQuery: () => ({ data: { enabled: false }, isLoading: false, isError: false }) },
        setPrivateDelivery: { useMutation: (options?: { onSuccess?: (result: { enabled: boolean }) => void }) => ({ isPending: false, mutate: (input: { enabled: boolean }) => { fixture.setPrivateDelivery(input); options?.onSuccess?.({ enabled: input.enabled }); } }) },
        groupPreferences: { useQuery: () => ({ data: { privateDeliveryEnabled: false, protectionRecipientMode: "group_leadership", protectionCooldownSeconds: 300, botMessageAutoDeleteDelaySeconds: 600 }, isLoading: false, isError: false }) },
        updateGroupPreferences: { useMutation: (options?: { onSuccess?: () => void }) => ({ isPending: false, mutate: (input: unknown) => { fixture.updateGroupPreferences(input); options?.onSuccess?.(); } }) },
      },
    },
  },
}));

import { NotificationsWorkspace } from "./OwnerDashboard";

afterEach(() => {
  cleanup();
  fixture.updateGroupPreferences.mockClear();
  fixture.setPrivateDelivery.mockClear();
});

describe("NotificationsWorkspace group controls", () => {
  it("persists the signed user's global choice to also receive eligible events in the bot private chat", async () => {
    render(<NotificationsWorkspace locale="fa" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "ارسال به گفتگوی خصوصی ربات" }));
    });

    expect(fixture.setPrivateDelivery).toHaveBeenCalledWith({ enabled: true });
  });

  it("surfaces a manageable group without recent notifications and resets its controls to safe defaults", async () => {
    render(<NotificationsWorkspace locale="fa" />);

    const groupSelect = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(groupSelect).not.toBeNull();
    fireEvent.change(groupSelect, { target: { value: "42" } });

    await waitFor(() => expect(screen.getByText("تنظیمات اعلان و پیام‌های ربات")).not.toBeNull());
    expect(screen.getAllByText("گروه بدون رخداد").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByDisplayValue("10")).not.toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "بازنشانی پیش‌فرض‌ها" }));
    });

    expect(fixture.updateGroupPreferences).toHaveBeenCalledWith(expect.objectContaining({
      groupId: 42,
      privateDeliveryEnabled: true,
      protectionRecipientMode: "authorized_admins",
      protectionCooldownSeconds: 60,
      botMessageAutoDeleteDelaySeconds: 300,
    }));
  });
});
