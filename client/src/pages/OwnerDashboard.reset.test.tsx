// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardLegacyCopy, dashboardMemberCopy, dashboardMemberExtraCopy, dashboardMessages } from "@/lib/dashboardI18n";
import {
  clearDashboardAfterDatabaseReset,
  DASHBOARD_RESET_EVENT,
  GROUP_SCOPED_RESET_STATE_HOLDERS,
} from "@/lib/dashboardSession";

const dashboardFixture = vi.hoisted(() => {
  const groups = [{ id: 42, title: "گروه آزمون", username: "kronos_test", chatId: -10042, status: "active", access: "group_owner" }];
  const detail = {
    settings: {
      welcomeEnabled: true,
      welcomeMessage: "پیام خوش‌آمد ثبت‌شده",
      goodbyeEnabled: false,
      goodbyeMessage: "",
      antiSpamEnabled: true,
      antiRaidEnabled: true,
      floodMessageLimit: 7,
      floodWindowSeconds: 12,
      duplicateMessageLimit: 3,
      warnLimit: 3,
      warnAction: "mute" as const,
      warnMuteMinutes: 60,
      rulesText: "",
    },
    warnings: [],
    notes: [],
    locks: [],
    actions: [],
  };

  const idleMutation = (options?: { onSuccess?: (result: unknown) => void }) => ({
    isPending: false,
    mutate: () => options?.onSuccess?.({}),
  });

  return { detail, groups, idleMutation };
});

vi.mock("@/lib/trpc", () => ({
  trpc: {
    dashboard: {
      groups: {
        list: { useQuery: () => ({ data: dashboardFixture.groups, isLoading: false, refetch: vi.fn() }) },
        detail: { useQuery: () => ({ data: dashboardFixture.detail, isLoading: false, refetch: vi.fn() }) },
        updateSettings: { useMutation: dashboardFixture.idleMutation },
      },
      members: {
        list: { useQuery: () => ({ data: { totalKnown: 1, members: [{ id: 1, firstName: "سارا", lastName: "آزمایشی", username: "sara_test", telegramUserId: 7788, membershipStatus: "active", lastSeenAt: new Date("2026-08-15T00:00:00Z"), warningCount: 0, managedRoles: [], telegramRole: "member", isGroupOwner: false }] }, isLoading: false, refetch: vi.fn() }) },
        setKronosRole: { useMutation: dashboardFixture.idleMutation },
        setKronosTitle: { useMutation: dashboardFixture.idleMutation },
        getVipProtection: { useQuery: () => ({ data: null, isLoading: false, refetch: vi.fn() }) },
        setVipProtection: { useMutation: dashboardFixture.idleMutation },
        setTelegramRole: { useMutation: dashboardFixture.idleMutation },
        refreshAdmins: {
          useMutation: (options?: { onSuccess?: (result: { refreshedAdministrators: number; totalTelegramMembers: number }) => void }) => ({
            isPending: false,
            mutate: () => options?.onSuccess?.({ refreshedAdministrators: 3, totalTelegramMembers: 17 }),
          }),
        },
      },
      moderation: {
        addNote: { useMutation: dashboardFixture.idleMutation },
        clearWarnings: { useMutation: dashboardFixture.idleMutation },
        setLock: { useMutation: dashboardFixture.idleMutation },
      },
      profile: {
        useQuery: () => ({ data: { firstName: "فروزان", username: "kronos_owner", preferredLocale: "fa", forcedJoinStatus: { locked: false, missingCount: 0, lastMembershipCheckAt: null } }, isLoading: false }),
      },
      forcedJoin: {
        list: { useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }) },
        analytics: { useQuery: () => ({ data: [{ channelId: 7, title: "کانال آزمایشی", buttonLabel: "عضویت", scope: "global", groupId: null, status: "active", expiresAt: null, verifiedAcquisitions: 12, lastVerifiedAt: null }], isLoading: false, refetch: vi.fn() }) },
        upsert: { useMutation: dashboardFixture.idleMutation },
        remove: { useMutation: dashboardFixture.idleMutation },
      },
      marketplace: {
        pricing: { useQuery: () => ({ data: { starsPerDay: 10 }, isLoading: false }) },
        myOrders: { useQuery: () => ({ data: [], isLoading: false, refetch: vi.fn() }) },
        resolveChannel: { useQuery: () => ({ data: null, isLoading: false, isFetching: false, refetch: vi.fn(), error: null }) },
        createStarsInvoice: { useMutation: dashboardFixture.idleMutation },
      },
    },
  },
}));

import { ForcedJoin, Groups, Members, Moderation, Payments, RoleManagementDashboard, TelegramProfileCard } from "./OwnerDashboard";
import { dashboardStarsCopy } from "@/lib/dashboardI18n";
import { dashboardGroupFormCopy } from "@/lib/dashboardGroupFormI18n";

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("kronos-dashboard-locale");
});

function simulateOwnerResetSuccess() {
  act(() => {
    clearDashboardAfterDatabaseReset({
      sessionStore: { removeItem: vi.fn() },
      localStore: { removeItem: vi.fn() },
      clearCachedQueries: vi.fn(),
      clearSelectedGroups: () => window.dispatchEvent(new Event(DASHBOARD_RESET_EVENT)),
    });
  });
}

describe("OwnerDashboard protected database-reset flow", () => {
  it("documents the complete reset-sensitive dashboard-state inventory", () => {
    expect(GROUP_SCOPED_RESET_STATE_HOLDERS).toEqual({
      Groups: ["selected group", "settings form draft"],
      Members: ["selected group", "administrator refresh summary", "departed-members filter", "direct role-management form draft"],
      Moderation: ["selected group"],
      ForcedJoin: ["forced-join channel draft, including groupId"],
    });
  });

  it("clears the real Groups panel selection and settings draft after reset success", () => {
    render(<Groups />);
    fireEvent.click(screen.getByRole("button", { name: /گروه آزمون/ }));
    const welcomeMessage = screen.getByDisplayValue("پیام خوش‌آمد ثبت‌شده");
    fireEvent.change(welcomeMessage, { target: { value: "پیش‌نویس ذخیره‌نشده" } });
    expect((welcomeMessage as HTMLTextAreaElement).value).toBe("پیش‌نویس ذخیره‌نشده");

    simulateOwnerResetSuccess();

    expect(screen.getByText(dashboardGroupFormCopy.fa.empty)).not.toBeNull();
    expect(screen.queryByDisplayValue("پیش‌نویس ذخیره‌نشده")).toBeNull();
  });

  it("filters the Members panel by username without changing the persisted member data", () => {
    render(<Members isBotOwner />);
    fireEvent.click(screen.getByRole("button", { name: /گروه آزمون/ }));
    expect(screen.getByText("سارا آزمایشی")).not.toBeNull();

    const search = screen.getByRole("textbox", { name: "جست‌وجوی عضو بر اساس نام، نام کاربری یا شناسهٔ عددی" });
    fireEvent.change(search, { target: { value: "sara_test" } });
    expect(screen.getByText("سارا آزمایشی")).not.toBeNull();

    fireEvent.change(search, { target: { value: "نام-وجود-ندارد" } });
    expect(screen.getByText(dashboardMemberCopy.fa.noMatch)).not.toBeNull();
  });

  it("clears the real Members panel group, administrator summary, and departed-members filter after reset success", () => {
    render(<Members isBotOwner />);
    fireEvent.click(screen.getByRole("button", { name: /گروه آزمون/ }));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "بازخوانی مدیران" }));
    expect(screen.getByText(new RegExp(`${dashboardMemberExtraCopy.fa.currentTelegramMembers}: ۱۷`))).not.toBeNull();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");

    simulateOwnerResetSuccess();

    expect(screen.getAllByText(dashboardMemberExtraCopy.fa.selectGroupEmpty).length).toBeGreaterThan(0);
    expect(screen.queryByText(new RegExp(`${dashboardMemberExtraCopy.fa.currentTelegramMembers}: ۱۷`))).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("uses the active non-Persian locale for the role-management card copy", () => {
    window.localStorage.setItem("kronos-dashboard-locale", "en");
    render(<RoleManagementDashboard isBotOwner />);

    expect(screen.getByText("Members and group roles")).not.toBeNull();
    expect(screen.queryByText("مدیریت مستقیم مقام‌های ربات")).toBeNull();
  });

  it("clears the direct Kronos role-management draft after reset success", () => {
    render(<RoleManagementDashboard isBotOwner />);
    const selectors = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const targetTelegramId = screen.getByLabelText(/شناسه عددی کاربر|User numeric ID/) as HTMLInputElement;
    fireEvent.change(selectors[0], { target: { value: "42" } });
    fireEvent.change(selectors[1], { target: { value: "vip" } });
    fireEvent.change(targetTelegramId, { target: { value: "8375579910" } });
    expect(selectors[0].value).toBe("42");
    expect(selectors[1].value).toBe("vip");
    expect(targetTelegramId.value).toBe("8375579910");

    simulateOwnerResetSuccess();

    expect(selectors[0].value).toBe("");
    expect(selectors[1].value).toBe("moderator");
    expect(targetTelegramId.value).toBe("");
  });

  it("clears the real Moderation panel group selection after reset success", () => {
    render(<Moderation />);
    fireEvent.click(screen.getByRole("button", { name: "گروه آزمون" }));
    expect(screen.getByText(`گروه آزمون — ${dashboardLegacyCopy.fa.warningsFor} & ${dashboardLegacyCopy.fa.adminNote}`)).not.toBeNull();

    simulateOwnerResetSuccess();

    expect(screen.getByText(dashboardLegacyCopy.fa.selectGroupModeration)).not.toBeNull();
    expect(screen.queryByText(`گروه آزمون — ${dashboardLegacyCopy.fa.warningsFor} & ${dashboardLegacyCopy.fa.adminNote}`)).toBeNull();
  });

  it("clears the real ForcedJoin draft, including its selected group, after reset success", () => {
    render(<ForcedJoin isOwner={false} />);
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(inputs[1], { target: { value: "کانال پیش‌نویس" } });
    const groupSelector = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    fireEvent.change(groupSelector, { target: { value: "42" } });
    expect(inputs[1].value).toBe("کانال پیش‌نویس");
    expect(groupSelector.value).toBe("42");

    simulateOwnerResetSuccess();

    expect(inputs[1].value).toBe("");
    expect(groupSelector.value).toBe("");
  });

  it("renders the Telegram identity, preferred language, and live forced-join status without an avatar URL", () => {
    render(<TelegramProfileCard sessionProfile={{ telegramUserId: 99, firstName: "فروزان", username: "kronos_owner", isOwner: true }} />);

    expect(screen.getByText("فروزان")).not.toBeNull();
    expect(screen.getByText("@kronos_owner")).not.toBeNull();
    expect(screen.getByText(`${dashboardMessages("fa").language}: فارسی`)).not.toBeNull();
    expect(screen.getByText("عضویت اجباری تأیید شده")).not.toBeNull();
  });

  it("renders role-scoped aggregate acquisition analytics without exposing member identities", () => {
    render(<ForcedJoin isOwner />);

    expect(screen.getByText("آمار جذب عضویت اجباری")).not.toBeNull();
    expect(screen.getByText("کانال آزمایشی")).not.toBeNull();
    expect(screen.getByText("۱۲")).not.toBeNull();
    expect(screen.getByText(/بدون نگهداری یا نمایش هویت خصوصی کاربران/)).not.toBeNull();
  });

  it("renders a Stars purchase calculator for a verified ordinary Mini App user", () => {
    render(<Payments isOwner={false} />);

    expect(screen.getByText("افزودن کانال به جوین اجباری")).not.toBeNull();
    expect(screen.getByText(new RegExp(`${dashboardStarsCopy.fa.day}.*Stars`))).not.toBeNull();
    expect(screen.getByRole("button", { name: /پرداخت ۱۰ Stars/ })).not.toBeNull();
    expect(screen.getByText(dashboardStarsCopy.fa.invoiceHelp)).not.toBeNull();
  });
});
