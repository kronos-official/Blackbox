import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { DASHBOARD_LOCALES, DASHBOARD_LOCALE_LABELS, dashboardConnectedGroupsCopy, dashboardDirection, dashboardMessages, dashboardPanelMessages, dashboardUiCopy, dashboardCommonCopy, dashboardOperationalCopy, dashboardMarketplaceCopy, dashboardOverviewCopy, dashboardOverviewStatusCopy, dashboardBroadcastCopy, dashboardRoleCopy, dashboardModerationCopy, dashboardCapacityCopy, dashboardStarsCopy, dashboardForcedCopy, dashboardWarningFormCopy, dashboardChannelReferencePlaceholder, dashboardLegacyCopy, dashboardMemberCopy, dashboardMemberExtraCopy, dashboardJoinRequiredCopy, normalizeDashboardLocale, type DashboardLocale } from "@/lib/dashboardI18n";
import { dashboardRuntimeCopyFor } from "@/lib/dashboardRuntimeI18n";
import { dashboardHelpCopy } from "@/lib/dashboardHelpI18n";
import { dashboardCommandGuideCopy } from "@/lib/dashboardCommandGuideI18n";
import { dashboardGroupFormCopy } from "@/lib/dashboardGroupFormI18n";
import { dashboardBroadcastResultCopy } from "@/lib/dashboardBroadcastI18n";
import { dashboardCustomInvoiceActions, dashboardCustomInvoiceCopy } from "@/lib/dashboardCustomInvoiceI18n";
import { dashboardNotificationCopy } from "@/lib/dashboardNotificationI18n";
import { dashboardNotificationDeliveryCopy } from "@/lib/dashboardNotificationDeliveryI18n";
import { compactNotificationBody, groupSimilarNotifications } from "@/lib/notificationCompact";
import { dashboardOperationsCopy, type LockPolicyKey } from "@/lib/dashboardOperationsI18n";
import { dashboardMemberTitleCopy } from "@/lib/dashboardMemberTitleI18n";
import { classicCryptoMarketCopyFor } from "@/lib/classicCryptoMarketI18n";
import { invoiceReferenceError, isInvoiceNumericId, isInvoiceReferenceReady } from "@/lib/customInvoiceResolver";
import { MEMBER_PRESENCE_REFRESH_INTERVAL_MS, shouldRefreshMemberPresence } from "@/lib/memberPresenceRefresh";
import { clearDashboardAfterDatabaseReset, DASHBOARD_RESET_EVENT, useDashboardReset } from "@/lib/dashboardSession";
import { waitForTelegramInitData, prepareTelegramWebApp } from "@/lib/dashboardTelegramBridge";
import { safeStorageAdapter, safeStorageGet, safeStorageRemove, safeStorageSet } from "@/lib/safeStorage";
import { MobileMenuLayer } from "@/components/MobileMenuLayer";
import { Activity, AlertTriangle, BellRing, Check, ChevronLeft, CircleDollarSign, ClipboardList, Copy, CreditCard, Database, ExternalLink, Eye, FileCheck2, Flame, LayoutDashboard, LockKeyhole, Menu, Monitor, Moon, Radio, RefreshCw, Save, Settings2, ShieldCheck, Sun, Terminal, Trash2, TrendingUp, UsersRound, X } from "lucide-react";
import { KronosLoader } from "@/components/KronosLoader";
import { KronosIntro } from "@/components/KronosIntro";
import { KronosTypingText } from "@/components/KronosTypingText";
import { SupportCenter } from "@/components/SupportCenter";
import { ClassicCryptoMarket } from "@/components/ClassicCryptoMarket";
import { useTheme } from "@/contexts/ThemeContext";
import React, { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

/** Compatibility wrapper for the shared circular loading mark. */
function Loader2({ className }: { className?: string }) {
  return <KronosLoader size="sm" className={className?.replace("animate-spin", "")} />;
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-bold ${className ?? ""}`}>{children}</span>;
}

function DashboardDataError({ locale, onRetry, isRetrying }: { locale: DashboardLocale; onRetry: () => void; isRetrying: boolean }) {
  const copy = dashboardRuntimeCopyFor(locale);
  const ui = dashboardUiCopy[locale];
  return <div role="alert" className="kronos-dashboard-error mx-auto grid max-w-lg place-items-center rounded-3xl border border-rose-300/15 bg-rose-300/[.045] p-7 text-center shadow-2xl shadow-rose-950/10">
    <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-300/10 text-rose-200"><AlertTriangle className="h-6 w-6" aria-hidden="true" /></div>
    <h2 className="mt-4 text-base font-black text-white">{copy.errors.service}</h2>
    <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">{copy.errors.generic}</p>
    <Button type="button" onClick={onRetry} disabled={isRetrying} className="mt-5 min-w-32 bg-cyan-300 text-slate-950 hover:bg-cyan-200">
      {isRetrying ? <Loader2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
      {ui.actions.refresh}
    </Button>
  </div>;
}

import { toast } from "sonner";

type Tab = "overview" | "groups" | "registry" | "members" | "moderation" | "warningPolicy" | "forced" | "payments" | "cryptoMarket" | "alerts" | "notifications" | "settings" | "audit" | "logs" | "support" | "help" | "about";
type GroupSettingsForm = {
  welcomeEnabled: boolean; welcomeMessage: string; goodbyeEnabled: boolean; goodbyeMessage: string; antiSpamEnabled: boolean; antiRaidEnabled: boolean; marketCommandsEnabled: boolean; floodMessageLimit: number; floodWindowSeconds: number; duplicateMessageLimit: number; warnLimit: number; warnAction: "mute" | "ban"; warnMuteMinutes: number; rulesText: string;
};
type WarningMuteUnit = "permanent" | "hours" | "days" | "months" | "years";
const warningMuteUnitMinutes: Record<WarningMuteUnit, number> = { permanent: 0, hours: 60, days: 1_440, months: 43_200, years: 525_600 };

export const USER_DASHBOARD_NAV_IDS = ["groups", "members", "moderation", "warningPolicy", "forced", "cryptoMarket", "notifications", "support", "help", "about"] as const;

const navigation: Array<{ id: Tab; icon: typeof LayoutDashboard; label?: string }> = [
  { id: "overview", icon: LayoutDashboard },
  { id: "groups", icon: UsersRound },
  { id: "registry", icon: ShieldCheck },
  { id: "members", icon: UsersRound },
  { id: "moderation", icon: ShieldCheck },
  { id: "warningPolicy", icon: BellRing },
  { id: "forced", icon: LockKeyhole },
  { id: "payments", icon: CircleDollarSign },
  { id: "cryptoMarket", icon: TrendingUp, label: "بازار رمزارز" },
  { id: "alerts", icon: BellRing },
  { id: "notifications", icon: BellRing },
  { id: "settings", icon: Settings2 },
  { id: "audit", icon: ClipboardList },
  { id: "logs", icon: Terminal, label: "لاگ ربات" },
  { id: "support", icon: BellRing },
  { id: "help", icon: ClipboardList },
  { id: "about", icon: ShieldCheck },
];

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; ready: () => void; expand: () => void; colorScheme?: "light" | "dark" } };
  }
}

function activeDashboardLocale(): DashboardLocale {
  if (typeof window === "undefined") return "fa";
  return normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale"));
}

function dashboardLocaleTag(locale: DashboardLocale = activeDashboardLocale()) {
  return locale === "fa" ? "fa-IR" : locale === "ar" ? "ar" : locale;
}

function dashboardDate(value: Date | string | null | undefined, locale: DashboardLocale = activeDashboardLocale()) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(dashboardLocaleTag(locale), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

const persianDate = (value: Date | string | null | undefined) => dashboardDate(value);

function dashboardNumber(value: number, locale: DashboardLocale = activeDashboardLocale()) {
  return value.toLocaleString(dashboardLocaleTag(locale));
}

function dashboardErrorMessage(error: unknown, fallback?: string, locale: DashboardLocale = activeDashboardLocale()) {
  const copy = dashboardRuntimeCopyFor(locale).errors;
  const raw = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (raw.includes("unauthorized") || raw.includes("forbidden") || raw.includes("permission")) return copy.permission;
  if (raw.includes("network") || raw.includes("fetch") || raw.includes("timeout")) return copy.network;
  if (raw.includes("database") || raw.includes("internal server") || raw.includes("500")) return copy.service;
  if (raw.includes("invalid") || raw.includes("required")) return copy.invalid;
  const message = error instanceof Error ? error.message.trim() : "";
  if (message && /[\u0600-\u06ff]/.test(message) && message.length <= 500) return message;
  return fallback ?? copy.generic;
}

function statusTone(status: string) {
  if (["active", "paid", "sent", "completed"].includes(status)) return "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25";
  if (["pending_approval", "pending", "awaiting_payment", "warning"].includes(status)) return "bg-amber-400/15 text-amber-100 ring-amber-200/25";
  if (["failed", "rejected", "expired", "critical", "permission_lost"].includes(status)) return "bg-rose-400/15 text-rose-100 ring-rose-200/25";
  return "bg-white/8 text-slate-200 ring-white/10";
}

function StatusBadge({ status, locale = activeDashboardLocale() }: { status: string; locale?: DashboardLocale }) {
  const label = dashboardRuntimeCopyFor(locale).statusLabels[status] ?? status.replaceAll("_", " ");
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${statusTone(status)}`}>{label}</span>;
}

function Metric({ label, value, hint, icon: Icon, accent, locale = "fa" }: { label: string; value: number; hint: string; icon: typeof LayoutDashboard; accent?: string; locale?: DashboardLocale }) {
  return <Card className="kronos-card kronos-metric border-white/8 bg-white/[0.045] shadow-none"><CardContent className="p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-slate-400">{label}</p><p className="mt-2 text-3xl font-black tracking-tight text-white">{dashboardNumber(value, locale)}</p><p className="mt-1 text-[11px] text-slate-500">{hint}</p></div><div className={`kronos-metric__icon grid h-10 w-10 place-items-center rounded-2xl ${accent}`}><Icon className="h-5 w-5" /></div></div></CardContent></Card>;
}

type DashboardMissingChannel = { id: number; title: string; inviteUrl: string | null; username: string | null };
type DashboardProfile = { telegramUserId: number; firstName?: string; username?: string; photoUrl?: string; isOwner: boolean; forcedJoinStatus?: { locked: boolean; unavailable: boolean; missingCount: number; missingChannels: DashboardMissingChannel[] } };

function Gate({ onReady }: { onReady: (profile: DashboardProfile) => void }) {
  const [bridgeUnavailable, setBridgeUnavailable] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [verifyCooldown, setVerifyCooldown] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [authenticatedProfile, setAuthenticatedProfile] = useState<DashboardProfile | null>(null);
  const handoffTimer = useRef<number | undefined>(undefined);
  const loginTimeout = useRef<number | undefined>(undefined);
  const login = trpc.dashboard.auth.loginTelegram.useMutation({
    onSuccess: result => {
      if (loginTimeout.current) window.clearTimeout(loginTimeout.current);
      const profile: DashboardProfile = { ...result.user, isOwner: result.isOwner };
      safeStorageSet("session", "kronos-dashboard-session", result.token);
      safeStorageSet("session", "kronos-dashboard-profile", JSON.stringify(profile));
      setAuthenticatedProfile(profile);
      setSessionReady(true);
    },
    onError: error => {
      if (loginTimeout.current) window.clearTimeout(loginTimeout.current);
      setBridgeUnavailable(true);
      toast.error(error.message);
    },
  });
  const profileQuery = trpc.dashboard.profile.useQuery(undefined, { enabled: sessionReady, retry: false, refetchInterval: false });
  const loginMutation = login.mutate;
  const attempted = useRef(false);
  useEffect(() => {
    const status = profileQuery.data?.forcedJoinStatus;
    if (!status || !authenticatedProfile) return;
    if (status.locked) {
      setIsLeaving(false);
      return;
    }
    setIsLeaving(true);
    handoffTimer.current = window.setTimeout(() => onReady({ ...authenticatedProfile, forcedJoinStatus: status }), 260);
  }, [profileQuery.data, authenticatedProfile, onReady]);
  useEffect(() => { if (verifyCooldown <= 0) return; const timer = window.setInterval(() => setVerifyCooldown(value => Math.max(0, value - 1)), 1000); return () => window.clearInterval(timer); }, [verifyCooldown]);
  useEffect(() => () => {
    if (handoffTimer.current) window.clearTimeout(handoffTimer.current);
    if (loginTimeout.current) window.clearTimeout(loginTimeout.current);
  }, []);
  useEffect(() => {
    setBridgeUnavailable(false);
    setIsLeaving(false);
    setSessionReady(false);
    setAuthenticatedProfile(null);
    attempted.current = false;
    login.reset();
    if (loginTimeout.current) window.clearTimeout(loginTimeout.current);
    // Retire every cached dashboard credential before accepting the current Web App initData.
    // Telegram can retain a webview when a person changes accounts, so no previous identity may
    // authorize even a single group-list request in the new session.
    safeStorageRemove("local", "kronos-owner-dashboard-session");
    safeStorageRemove("session", "kronos-dashboard-session");
    safeStorageRemove("session", "kronos-dashboard-profile");
    let cancelled = false;
    void waitForTelegramInitData(window, { timeoutMs: 30_000, intervalMs: 250 })
      .then(initData => {
        if (cancelled || attempted.current) return;
        attempted.current = true;
        prepareTelegramWebApp(window);
        loginTimeout.current = window.setTimeout(() => {
          login.reset();
          setBridgeUnavailable(true);
          toast.error("اعتبارسنجی مینی‌اپ بیش از حد طول کشید. اتصال Telegram Desktop را بررسی و دوباره تلاش کنید.");
        }, 10_000);
        loginMutation({ initData });
      })
      .catch(() => {
        if (!cancelled) setBridgeUnavailable(true);
      });
    return () => {
      cancelled = true;
      if (loginTimeout.current) window.clearTimeout(loginTimeout.current);
    };
  }, [loginMutation, retryNonce]);
  const gateLocale = normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale"));
  const gateCopy = dashboardUiCopy[gateLocale].gate;
  const joinCopy = dashboardJoinRequiredCopy[gateLocale];
  const lockedStatus = profileQuery.data?.forcedJoinStatus;
  const gateDirection = dashboardDirection(gateLocale);
  if (authenticatedProfile && lockedStatus?.locked) return <main dir={gateDirection} lang={gateLocale} className="kronos-shell grid min-h-screen w-full place-items-center overflow-x-hidden p-5"><Card className={`w-full max-w-md border-amber-300/20 bg-slate-950/90 text-white shadow-2xl shadow-amber-950/30 ${gateDirection === "rtl" ? "text-right" : "text-left"}`}><CardHeader><div className="mb-2 grid h-14 w-14 place-items-center rounded-2xl bg-amber-300 text-slate-950"><ShieldCheck className="h-8 w-8" /></div><CardTitle className="text-2xl font-black">{joinCopy.title}</CardTitle><CardDescription className="mt-2 leading-6 text-slate-400">{joinCopy.description}</CardDescription></CardHeader><CardContent className="space-y-3"><p className="text-sm text-amber-100">{lockedStatus.unavailable ? joinCopy.unavailable : joinCopy.missing(lockedStatus.missingCount)}</p>{lockedStatus.missingChannels.map(channel => { const url = channel.inviteUrl ?? (channel.username ? `https://t.me/${channel.username.replace(/^@/, "")}` : undefined); return url ? <a key={channel.id} href={url} target="_blank" rel="noreferrer" className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[.05] px-4 py-3 text-sm font-bold text-cyan-100 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-200/40 hover:bg-cyan-300/10"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-300/15 text-cyan-200 ring-1 ring-cyan-200/20"><Radio className="h-4 w-4 transition group-hover:scale-110" /></span><span className="min-w-0 flex-1"><span className="block">{joinCopy.join}</span><span className="mt-0.5 block truncate text-[11px] font-normal text-slate-500">{channel.username ? `@${channel.username.replace(/^@/, "")}` : channel.title}</span></span><ExternalLink className="h-4 w-4 shrink-0 opacity-70 transition group-hover:translate-x-0.5 group-hover:opacity-100" /></a> : null; })}<Button type="button" className="w-full bg-cyan-300 text-slate-950 transition duration-200 hover:bg-cyan-200" disabled={profileQuery.isFetching || verifyCooldown > 0} onClick={() => { if (verifyCooldown > 0) return; setVerifyCooldown(5); void profileQuery.refetch(); }}>{profileQuery.isFetching ? <><Loader2 className="h-4 w-4 animate-spin" />{joinCopy.checking}</> : verifyCooldown > 0 ? <><RefreshCw className="h-4 w-4" />{joinCopy.verify} ({verifyCooldown})</> : <><RefreshCw className="h-4 w-4" />{joinCopy.verify}</>}</Button></CardContent></Card></main>;
  const isChecking = login.isPending || profileQuery.isLoading || Boolean(authenticatedProfile && !profileQuery.data);
  const statusText = isLeaving ? gateCopy.verifying : isChecking ? (profileQuery.isLoading ? joinCopy.checking : gateCopy.connecting) : bridgeUnavailable ? gateCopy.unavailable : gateCopy.preparing;
  const status = bridgeUnavailable ? statusText : <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /><KronosTypingText key={isLeaving ? "handoff" : isChecking ? "checking" : "preparing"} text={statusText} /></span>;
  const refreshPreview = () => { if (manualRefreshing) return; setManualRefreshing(true); window.location.reload(); };
  return <main dir={gateDirection} lang={gateLocale} className={`kronos-shell kronos-gate grid min-h-screen w-full place-items-center overflow-x-hidden p-5 ${isLeaving ? "kronos-gate--leaving" : ""}`}><Card className={`kronos-gate__card w-full max-w-md border-white/10 bg-slate-950/85 text-white shadow-2xl shadow-cyan-950/40 ${gateDirection === "rtl" ? "text-right" : "text-left"}`}><CardHeader className="space-y-4"><div className="grid h-14 w-14 place-items-center rounded-2xl bg-cyan-400 text-slate-950"><ShieldCheck className="h-8 w-8" /></div><div><CardTitle className="text-2xl font-black">Kronos Guard</CardTitle><CardDescription className="mt-2 leading-6 text-slate-400">{gateCopy.description}</CardDescription></div></CardHeader><CardContent><div role="status" aria-live="polite" aria-atomic="true" data-gate-state={bridgeUnavailable ? "unavailable" : isLeaving ? "verifying" : isChecking ? "checking" : "preparing"} className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm leading-6 text-slate-300">{status}</div><div className="mt-3 grid gap-2 sm:grid-cols-2">{bridgeUnavailable && <Button type="button" className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" onClick={() => setRetryNonce(value => value + 1)}><RefreshCw className="h-4 w-4" />{dashboardUiCopy[gateLocale].actions.refresh}</Button>}<Button type="button" variant="outline" className="w-full border-cyan-300/25 text-cyan-100 hover:bg-cyan-300/10" aria-label={dashboardUiCopy[gateLocale].actions.refresh} disabled={manualRefreshing} onClick={refreshPreview}><RefreshCw className={`h-4 w-4 ${manualRefreshing ? "animate-spin" : ""}`} />{dashboardUiCopy[gateLocale].actions.refresh}</Button></div></CardContent></Card></main>;
}

function OwnerMaintenance() {
  const locale = activeDashboardLocale();
  const copy = dashboardCommonCopy[locale];
  const [confirmation, setConfirmation] = useState("");
  const utils = trpc.useUtils();
  const reconcile = trpc.dashboard.maintenance.reconcileStaleGroups.useMutation({
    onSuccess: result => {
      toast.success(`${result.removed + result.permissionLost} ${copy.reconcileTitle.toLocaleLowerCase(locale)}`);
      void utils.dashboard.groups.list.invalidate();
    },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const reset = trpc.dashboard.maintenance.resetDatabase.useMutation({
    onSuccess: () => {
      toast.success(`${copy.resetTitle}.`);
      clearDashboardAfterDatabaseReset({
        sessionStore: safeStorageAdapter("session"),
        localStore: safeStorageAdapter("local"),
        clearCachedQueries: () => {
          void utils.dashboard.overview.reset();
          void utils.dashboard.groups.list.reset();
          void utils.dashboard.groups.detail.reset();
          void utils.dashboard.members.list.reset();
        },
        clearSelectedGroups: () => window.dispatchEvent(new Event(DASHBOARD_RESET_EVENT)),
      });
      window.setTimeout(() => window.location.reload(), 900);
    },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const readyToReset = confirmation.trim() === "RESET KRONOS DATABASE";
  return <Card className="border-rose-400/20 bg-rose-400/[0.045] shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 text-base text-rose-100"><AlertTriangle className="h-4 w-4" /> {copy.maintenanceTitle}</CardTitle><CardDescription>{copy.maintenanceDescription}</CardDescription></CardHeader><CardContent className="space-y-5"><div className="flex flex-col gap-3 rounded-xl border border-white/8 bg-black/10 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold text-slate-100">{copy.reconcileTitle}</p><p className="mt-1 text-xs leading-5 text-slate-400">{copy.reconcileDescription}</p></div><Button variant="outline" className="border-cyan-300/25 text-cyan-100 hover:bg-cyan-300/10" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>{reconcile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {copy.reconcileAction}</Button></div><div className="space-y-3 rounded-xl border border-rose-300/20 bg-rose-950/20 p-4"><div><p className="text-sm font-black text-rose-100">{copy.resetTitle}</p><p className="mt-1 text-xs leading-5 text-rose-100/70">{copy.resetDescription}</p></div><Field label={copy.resetDescription}><Input value={confirmation} onChange={event => setConfirmation(event.target.value)} placeholder="RESET KRONOS DATABASE" className="border-rose-300/25 bg-slate-950/50 font-mono text-rose-50" autoComplete="off" /></Field><Button variant="destructive" className="w-full sm:w-auto" disabled={!readyToReset || reset.isPending} onClick={() => { if (window.confirm(copy.resetDescription)) reset.mutate({ confirmation: "RESET KRONOS DATABASE" }); }}>{reset.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />} {copy.resetAction}</Button></div></CardContent></Card>;
}

const localeLabels: Record<string, string> = {
  fa: "فارسی", en: "English", ar: "العربية", tr: "Türkçe", ru: "Русский", es: "Español",
  fr: "Français", pt: "Português", it: "Italiano", de: "Deutsch", pl: "Polski", vi: "Tiếng Việt",
};

function notificationPresentation(eventType: string, category: string | null | undefined) {
  const normalized = category ?? eventType.split(".")[0] ?? "system";
  if (normalized === "membership" || eventType.startsWith("member.")) return { category: "membership", label: "عضویت", icon: UsersRound, tone: "border-emerald-300/25 bg-emerald-300/[.075] text-emerald-100", iconTone: "border-emerald-300/25 bg-emerald-300/[.14] text-emerald-200", accent: "bg-emerald-300" };
  if (normalized === "role" || eventType.startsWith("role.")) return { category: "role", label: "نقش و لقب", icon: ShieldCheck, tone: "border-violet-300/25 bg-violet-300/[.075] text-violet-100", iconTone: "border-violet-300/25 bg-violet-300/[.14] text-violet-200", accent: "bg-violet-300" };
  if (normalized === "metadata" || eventType.startsWith("group.")) return { category: "metadata", label: "اطلاعات گروه", icon: Settings2, tone: "border-sky-300/25 bg-sky-300/[.075] text-sky-100", iconTone: "border-sky-300/25 bg-sky-300/[.14] text-sky-200", accent: "bg-sky-300" };
  if (normalized === "message" || eventType.startsWith("message.")) return { category: "message", label: "پیام", icon: ClipboardList, tone: "border-amber-300/25 bg-amber-300/[.075] text-amber-100", iconTone: "border-amber-300/25 bg-amber-300/[.14] text-amber-200", accent: "bg-amber-300" };
  if (normalized === "moderation" || eventType.startsWith("moderation.")) return { category: "moderation", label: "مدیریت", icon: AlertTriangle, tone: "border-rose-300/25 bg-rose-300/[.075] text-rose-100", iconTone: "border-rose-300/25 bg-rose-300/[.14] text-rose-200", accent: "bg-rose-300" };
  if (normalized === "protection" || eventType.startsWith("protection.")) return { category: "protection", label: "حفاظت", icon: LockKeyhole, tone: "border-orange-300/25 bg-orange-300/[.075] text-orange-100", iconTone: "border-orange-300/25 bg-orange-300/[.14] text-orange-200", accent: "bg-orange-300" };
  return { category: "system", label: "سامانه", icon: BellRing, tone: "border-cyan-300/25 bg-cyan-300/[.075] text-cyan-100", iconTone: "border-cyan-300/25 bg-cyan-300/[.14] text-cyan-200", accent: "bg-cyan-300" };
}

const notificationMuteCategories = [
  { id: "membership", label: "عضویت", description: "ورود، خروج و تغییر وضعیت اعضا" },
  { id: "role", label: "نقش و لقب", description: "تغییر نقش‌ها و لقب‌ها" },
  { id: "metadata", label: "اطلاعات گروه", description: "نام، تصویر و تنظیمات گروه" },
  { id: "message", label: "پیام", description: "پیام، پین و فعالیت‌های مرتبط" },
  { id: "moderation", label: "مدیریت", description: "اخطار، سکوت و اقدامات مدیریتی" },
  { id: "protection", label: "حفاظت", description: "ضداسپم، رید و قفل‌های حفاظتی" },
  { id: "system", label: "سامانه", description: "رویدادهای عملیاتی Kronos Guard" },
] as const;
type NotificationMuteCategory = (typeof notificationMuteCategories)[number]["id"];

function NotificationFeedWorkspace({ locale }: { locale: DashboardLocale }) {
  const copy = dashboardNotificationCopy(locale);
  const utils = trpc.useUtils();
  const [groupFilter, setGroupFilter] = useState("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [expandedNotificationIds, setExpandedNotificationIds] = useState<Set<number>>(() => new Set());
  const [expandedNotificationGroups, setExpandedNotificationGroups] = useState<Set<string>>(() => new Set());
  const input = { limit: 100, relatedGroupId: groupFilter === "all" ? null : Number(groupFilter), eventType: eventFilter === "all" ? null : eventFilter };
  const notifications = trpc.dashboard.notifications.list.useQuery(input, { retry: false });
  const availableGroups = trpc.dashboard.groups.list.useQuery(undefined, { retry: false });
  const markRead = trpc.dashboard.notifications.markRead.useMutation({ onSuccess: () => { toast.success(copy.markedRead); void utils.dashboard.notifications.list.invalidate(); void utils.dashboard.notifications.unreadCount.invalidate(); } });
  const markAll = trpc.dashboard.notifications.markAllRead.useMutation({ onSuccess: result => { toast.success(result.count > 0 ? `${result.count} اعلان خوانده شد.` : copy.markedAllRead); void utils.dashboard.notifications.list.invalidate(); void utils.dashboard.notifications.unreadCount.invalidate(); } });
  const mutes = trpc.dashboard.notifications.getMutes.useQuery(undefined, { retry: false });
  const updateMutes = trpc.dashboard.notifications.updateMutes.useMutation({
    onMutate: async ({ mutedCategories }) => {
      await utils.dashboard.notifications.getMutes.cancel();
      const previous = utils.dashboard.notifications.getMutes.getData();
      utils.dashboard.notifications.getMutes.setData(undefined, { mutedCategories });
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) utils.dashboard.notifications.getMutes.setData(undefined, context.previous);
      toast.error(dashboardErrorMessage(error));
    },
    onSuccess: result => {
      utils.dashboard.notifications.getMutes.setData(undefined, result);
      toast.success("تنظیمات دسته‌بندی اعلان‌ها ذخیره شد.");
      void utils.dashboard.notifications.list.invalidate();
      void utils.dashboard.notifications.unreadCount.invalidate();
    },
  });
  const selectedGroupId = groupFilter === "all" ? null : Number(groupFilter);
  const groupPreferences = trpc.dashboard.notifications.groupPreferences.useQuery({ groupId: selectedGroupId ?? 1 }, { enabled: Boolean(selectedGroupId), retry: false });
  const updateGroupPreferences = trpc.dashboard.notifications.updateGroupPreferences.useMutation({ onSuccess: () => { toast.success("تنظیمات اعلان این گروه ذخیره شد."); void utils.dashboard.notifications.groupPreferences.invalidate(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const items = notifications.data?.items ?? [];
  const mutedCategories = new Set<NotificationMuteCategory>(mutes.data?.mutedCategories as NotificationMuteCategory[] ?? []);
  const visibleItems = items.filter(item => !mutedCategories.has(notificationPresentation(item.eventType, item.relatedRole).category as NotificationMuteCategory));
  const groups = Array.from(new Map(visibleItems.flatMap(item => typeof item.relatedGroupId === "number" ? [[item.relatedGroupId, item.relatedGroup?.title ?? `${copy.unknownGroup} #${item.relatedGroupId}`] as const] : [])).entries());
  const manageableGroups = (availableGroups.data ?? []).filter(group => ["owner", "global_admin", "group_owner", "group_admin"].includes(group.access));
  const eventTypes = Array.from(new Set(visibleItems.map(item => item.eventType).filter(Boolean)));
  const preferences = groupPreferences.data;
  const [autoDeleteDelayMinutes, setAutoDeleteDelayMinutes] = useState("");
  useEffect(() => {
    setAutoDeleteDelayMinutes(preferences ? String(Math.round(preferences.botMessageAutoDeleteDelaySeconds / 60)) : "");
  }, [selectedGroupId, preferences?.botMessageAutoDeleteDelaySeconds]);
  const savePreferences = (patch: Partial<NonNullable<typeof preferences>>) => {
    if (!selectedGroupId || !preferences) return;
    updateGroupPreferences.mutate({ groupId: selectedGroupId, ...preferences, ...patch });
  };
  const resetGroupPreferences = () => {
    if (!selectedGroupId || !preferences) return;
    setAutoDeleteDelayMinutes("5");
    updateGroupPreferences.mutate({
      groupId: selectedGroupId,
      ...preferences,
      privateDeliveryEnabled: true,
      protectionRecipientMode: "authorized_admins",
      protectionCooldownSeconds: 60,
      botMessageAutoDeleteDelaySeconds: 300,
    });
  };
  const selectedGroupTitle = manageableGroups.find(group => group.id === selectedGroupId)?.title
    ?? groups.find(([id]) => id === selectedGroupId)?.[1]
    ?? (selectedGroupId ? `گروه #${selectedGroupId}` : "");
  const saveAutoDeleteDelay = () => {
    const minutes = Number(autoDeleteDelayMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1_440) {
      toast.error("زمان حذف خودکار باید بین 1 تا 1440 دقیقه باشد.");
      setAutoDeleteDelayMinutes(preferences ? String(Math.round(preferences.botMessageAutoDeleteDelaySeconds / 60)) : "");
      return;
    }
    if (preferences && preferences.botMessageAutoDeleteDelaySeconds !== minutes * 60) savePreferences({ botMessageAutoDeleteDelaySeconds: minutes * 60 });
  };
  const copyTelegramId = async (telegramId: string, label: string) => {
    try {
      await navigator.clipboard.writeText(telegramId);
      toast.success(`شناسهٔ ${label} کپی شد.`);
    } catch {
      toast.error("کپی شناسه در این مرورگر ممکن نشد.");
    }
  };
  const toggleCategoryMute = (category: NotificationMuteCategory) => {
    const next = new Set(mutedCategories);
    if (next.has(category)) next.delete(category); else next.add(category);
    updateMutes.mutate({ mutedCategories: notificationMuteCategories.map(item => item.id).filter(item => next.has(item)) });
  };
  return <Card className="kronos-card border-cyan-300/15 bg-gradient-to-br from-cyan-300/[.075] via-slate-950 to-indigo-400/[.055]"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.18em] text-cyan-200">{copy.eyebrow}</p><CardTitle className="mt-1 text-base">{copy.title}</CardTitle><CardDescription className="mt-1">{copy.description}</CardDescription>{(notifications.data?.unreadCount ?? 0) > 0 && <p className="mt-2 text-xs font-bold text-cyan-200">{copy.unreadCount(String(notifications.data?.unreadCount ?? 0))}</p>}</div><Button type="button" variant="outline" disabled={markAll.isPending || !visibleItems.some(item => !item.isRead)} onClick={() => markAll.mutate()}>{markAll.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{copy.loading}</> : copy.markAll}</Button></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><label className="text-xs text-slate-400"><span className="mb-1 block">گروه و تنظیمات اختصاصی</span><select value={groupFilter} onChange={event => setGroupFilter(event.target.value)} className="kronos-input w-full bg-slate-950/80"><option value="all">{copy.allGroups}</option>{manageableGroups.map(group => <option key={group.id} value={group.id}>{group.title || `گروه #${group.id}`}</option>)}</select><span className="mt-1 block text-[10px] leading-4 text-slate-500">انتخاب گروه، تنظیمات اختصاصی آن را حتی بدون رویداد اخیر نمایش می‌دهد.</span></label><label className="text-xs text-slate-400"><span className="mb-1 block">{copy.eventFilter}</span><select value={eventFilter} onChange={event => setEventFilter(event.target.value)} className="kronos-input w-full bg-slate-950/80"><option value="all">{copy.allEvents}</option>{eventTypes.map(eventType => <option key={eventType} value={eventType}>{eventType}</option>)}</select></label><Button type="button" variant="ghost" className="self-end" disabled={groupFilter === "all" && eventFilter === "all"} onClick={() => { setGroupFilter("all"); setEventFilter("all"); }}>{copy.filterReset}</Button></div></CardHeader><CardContent className="space-y-3"><section className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[.045] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black text-cyan-100">تنظیمات شخصی اعلان‌ها</p><p className="mt-1 text-xs leading-5 text-slate-400">دسته‌های بی‌صدا در فید شما پنهان می‌شوند؛ این کنترل‌ها همیشه در دسترس می‌مانند.</p></div><Badge className="border-cyan-300/20 bg-cyan-300/10 text-cyan-100">{mutedCategories.size > 0 ? `${mutedCategories.size} دسته بی‌صدا` : "همهٔ دسته‌ها فعال"}</Badge></div>{mutes.isLoading ? <p className="mt-3 text-xs text-slate-400">{copy.loading}</p> : mutes.isError ? <p className="mt-3 text-xs text-rose-200">بارگذاری تنظیمات شخصی اعلان‌ها ناموفق بود.</p> : <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{notificationMuteCategories.map(category => { const isMuted = mutedCategories.has(category.id); return <div key={category.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2.5"><div className="min-w-0"><p className="text-xs font-bold text-slate-100">{category.label}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{category.description}</p><p className={`mt-1 text-[10px] font-bold ${isMuted ? "text-amber-200" : "text-emerald-200"}`}>{isMuted ? "بی‌صدا" : "فعال"}</p></div><Switch aria-label={`بی‌صدا کردن اعلان‌های ${category.label}`} checked={isMuted} disabled={updateMutes.isPending} onCheckedChange={() => toggleCategoryMute(category.id)} /></div>; })}</div>}</section>{selectedGroupId && <section className="rounded-2xl border border-orange-300/20 bg-orange-300/[.055] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-black text-orange-100">تنظیمات اعلان و پیام‌های ربات</p><p className="mt-1 text-xs leading-5 text-slate-400">این تنظیمات فقط برای گروه انتخاب‌شده اعمال می‌شود. همهٔ رویدادهای مهم همچنان در مرکز اعلان ثبت خواهند شد.</p></div><div className="flex flex-wrap items-center gap-2"><Badge className="border-orange-300/20 bg-orange-300/10 text-orange-100">{selectedGroupTitle}</Badge><Button type="button" variant="outline" size="sm" disabled={updateGroupPreferences.isPending || !preferences} onClick={resetGroupPreferences} className="border-orange-300/30 text-orange-100 hover:bg-orange-300/10">بازنشانی پیش‌فرض‌ها</Button></div></div>{groupPreferences.isLoading ? <p className="mt-3 text-xs text-slate-400">{copy.loading}</p> : groupPreferences.isError ? <p className="mt-3 text-xs text-rose-200">بارگذاری تنظیمات اعلان این گروه ناموفق بود.</p> : preferences && <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2.5"><label htmlFor="private-protection-alerts" className="text-xs font-bold text-slate-200">ارسال خصوصی هشدار حفاظتی</label><Switch id="private-protection-alerts" checked={preferences.privateDeliveryEnabled} disabled={updateGroupPreferences.isPending} onCheckedChange={privateDeliveryEnabled => savePreferences({ privateDeliveryEnabled })} /></div><label className="text-xs text-slate-300"><span className="mb-1 block font-bold">دریافت‌کنندگان هشدار</span><select value={preferences.protectionRecipientMode} disabled={updateGroupPreferences.isPending} onChange={event => savePreferences({ protectionRecipientMode: event.target.value === "group_leadership" ? "group_leadership" : "authorized_admins" })} className="kronos-input w-full bg-slate-950/80"><option value="authorized_admins">تمام مدیران مجاز</option><option value="group_leadership">مالک و ادمین‌های تلگرام</option></select></label><label className="text-xs text-slate-300"><span className="mb-1 block font-bold">فاصلهٔ هشدارهای مشابه</span><select value={String(preferences.protectionCooldownSeconds)} disabled={updateGroupPreferences.isPending} onChange={event => savePreferences({ protectionCooldownSeconds: Number(event.target.value) })} className="kronos-input w-full bg-slate-950/80"><option value="15">15 ثانیه</option><option value="60">60 ثانیه</option><option value="300">300 ثانیه</option><option value="900">900 ثانیه</option></select></label><label className="text-xs text-slate-300"><span className="mb-1 block font-bold">حذف خودکار پیام‌های ربات (دقیقه)</span><Input type="number" inputMode="numeric" min={1} max={1440} step={1} dir="ltr" value={autoDeleteDelayMinutes} disabled={updateGroupPreferences.isPending} onChange={event => setAutoDeleteDelayMinutes(event.target.value)} onBlur={saveAutoDeleteDelay} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-9 bg-slate-950/80 text-left" aria-describedby="bot-message-auto-delete-help" /></label><p id="bot-message-auto-delete-help" className="-mt-2 text-[10px] leading-4 text-slate-500 md:col-span-2 xl:col-span-4">برای پیام‌های جدید این گروه اعمال می‌شود. حداقل 1 دقیقه و حداکثر 1440 دقیقه؛ زمان پیش‌فرض 5 دقیقه است.</p></div>}</section>}{notifications.isLoading ? <div className="rounded-2xl border border-white/10 bg-white/[.035] p-5 text-sm text-slate-400">{copy.loading}</div> : notifications.isError ? <div className="rounded-2xl border border-rose-300/20 bg-rose-300/10 p-5 text-sm text-rose-100">{copy.error}</div> : visibleItems.length === 0 ? <div className="rounded-2xl border border-white/10 bg-white/[.035] p-8 text-center text-sm text-slate-400">{items.length > 0 ? "همهٔ اعلان‌های این فیلتر بی‌صدا شده‌اند." : copy.empty}</div> : groupSimilarNotifications(visibleItems).map(group => {
    const item = group.latest;
    const presentation = notificationPresentation(item.eventType, item.relatedRole);
    const EventIcon = presentation.icon;
    const compact = compactNotificationBody(item.body);
    const isExpanded = expandedNotificationIds.has(item.id);
    const isGroupExpanded = expandedNotificationGroups.has(group.key);
    const unreadIds = group.items.filter(entry => !entry.isRead).map(entry => entry.id);
    const targetIsDistinct = Boolean(compact.target && compact.target !== compact.actor);
    return <article key={group.key} className={`kronos-notification-card relative overflow-hidden rounded-2xl border p-3.5 shadow-lg shadow-slate-950/10 ${unreadIds.length === 0 ? "border-white/10 bg-white/[.025]" : presentation.tone}`}>
      <span className={`absolute inset-y-0 right-0 w-1 ${presentation.accent}`} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl border ${presentation.iconTone}`}><EventIcon className="h-4 w-4" /></span>
            <span className="max-w-44 truncate font-bold text-slate-100">{item.relatedGroup?.title ?? copy.unknownGroup}</span>
            <Badge className={presentation.tone}>{presentation.label}</Badge>
            {group.items.length > 1 && <Badge className="border-violet-300/20 bg-violet-300/10 text-violet-100">{group.items.length} رویداد</Badge>}
            <Badge className={unreadIds.length === 0 ? "border-white/10 bg-white/[.03] text-slate-400" : "border-white/15 bg-slate-950/25 text-white"}>{unreadIds.length === 0 ? copy.read : copy.unread}</Badge>
          </div>
          <h3 className="mt-2 text-sm font-black text-white">{item.title}</h3>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-300">{compact.summary}</p>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="min-w-0 rounded-lg border border-white/8 bg-slate-950/25 px-2.5 py-2"><dt className="text-[10px] text-slate-500">گروه</dt><dd className="mt-1 truncate font-bold text-slate-100">{item.relatedGroup?.title ?? copy.unknownGroup}</dd></div>
            <div className="min-w-0 rounded-lg border border-white/8 bg-slate-950/25 px-2.5 py-2"><dt className="text-[10px] text-slate-500">منشن</dt><dd className="mt-1 truncate font-bold text-cyan-100">{compact.actor ?? "—"}</dd></div>
            <div className="min-w-0 rounded-lg border border-white/8 bg-slate-950/25 px-2.5 py-2"><dt className="text-[10px] text-slate-500">شناسهٔ فرد</dt><dd className="mt-1 truncate font-bold text-slate-100">{compact.actorId ? <button type="button" dir="ltr" className="rounded px-1 text-slate-200 transition hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" onClick={() => void copyTelegramId(compact.actorId!, "فرد")} title="کپی شناسهٔ فرد">{compact.actorId}<span className="sr-only"> کپی شناسهٔ فرد</span></button> : "—"}</dd></div>
            <div className="min-w-0 rounded-lg border border-white/8 bg-slate-950/25 px-2.5 py-2"><dt className="text-[10px] text-slate-500">هدف</dt><dd className="mt-1 truncate font-bold text-slate-100">{targetIsDistinct ? compact.target : "—"}</dd></div>
            <div className="min-w-0 rounded-lg border border-white/8 bg-slate-950/25 px-2.5 py-2"><dt className="text-[10px] text-slate-500">شناسهٔ هدف</dt><dd className="mt-1 truncate font-bold text-slate-100">{targetIsDistinct && compact.targetId ? <button type="button" dir="ltr" className="rounded px-1 text-slate-200 transition hover:bg-cyan-300/10 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" onClick={() => void copyTelegramId(compact.targetId!, "هدف")} title="کپی شناسهٔ هدف">{compact.targetId}<span className="sr-only"> کپی شناسهٔ هدف</span></button> : "—"}</dd></div>
            <div className="min-w-0 rounded-lg border border-white/8 bg-slate-950/25 px-2.5 py-2"><dt className="text-[10px] text-slate-500">زمان تهران</dt><dd className="mt-1 truncate text-slate-300">{compact.tehranTime ?? dashboardDate(item.createdAt, locale)}</dd></div>
            <div className="col-span-2 min-w-0 rounded-lg border border-white/8 bg-slate-950/25 px-2.5 py-2"><dt className="text-[10px] text-slate-500">جزئیات</dt><dd className="mt-1 line-clamp-2 text-slate-300">{compact.summary || "—"}</dd></div>
          </dl>
          {group.items.length > 1 && <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-violet-200 transition hover:text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200" aria-expanded={isGroupExpanded} onClick={() => setExpandedNotificationGroups(current => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next; })}>{isGroupExpanded ? "بستن رویدادهای مشابه" : `نمایش ${group.items.length} رویداد مشابه`}<ChevronLeft className={`h-3.5 w-3.5 transition-transform ${isGroupExpanded ? "-rotate-90" : "rotate-90"}`} /></button>}
          {isGroupExpanded && <div className="mt-2 space-y-1.5 rounded-xl border border-violet-300/15 bg-violet-300/[.045] px-3 py-2.5 text-[11px] text-slate-300">{group.items.map(groupItem => <p key={groupItem.id} className="flex gap-2"><span className="shrink-0 text-violet-200">{dashboardDate(groupItem.createdAt, locale)}</span><span className="min-w-0">{compactNotificationBody(groupItem.body).summary}</span></p>)}</div>}
          <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-cyan-200 transition hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" aria-expanded={isExpanded} onClick={() => setExpandedNotificationIds(current => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{isExpanded ? "بستن جزئیات" : "جزئیات کامل"}<ChevronLeft className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "-rotate-90" : "rotate-90"}`} /></button>
          {isExpanded && <div className="mt-2 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2.5 text-xs leading-6 text-slate-200 [&_a]:font-bold [&_a]:text-cyan-200 [&_a]:underline [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:text-cyan-100" dangerouslySetInnerHTML={{ __html: item.body }} />}
        </div>
        {unreadIds.length > 0 && <Button type="button" variant="outline" size="sm" className="shrink-0 border-white/15 bg-slate-950/25 text-slate-100 hover:bg-white/10" disabled={markRead.isPending} onClick={() => unreadIds.forEach(notificationId => markRead.mutate({ notificationId }))}>{markRead.isPending ? <><Loader2 className="h-4 w-4 animate-spin" />{copy.loading}</> : copy.markRead}</Button>}
      </div>
    </article>;
  })}</CardContent></Card>;
}

function PrivateNotificationDeliverySetting() {
  const locale = activeDashboardLocale();
  const copy = dashboardNotificationDeliveryCopy[locale];
  const utils = trpc.useUtils();
  const preference = trpc.dashboard.notifications.getPrivateDelivery.useQuery(undefined, { retry: false });
  const savePreference = trpc.dashboard.notifications.setPrivateDelivery.useMutation({
    onSuccess: result => {
      utils.dashboard.notifications.getPrivateDelivery.setData(undefined, result);
      toast.success(result.enabled ? "ارسال به گفتگوی خصوصی ربات فعال شد." : "اعلان‌ها فقط در Mini App نمایش داده می‌شوند.");
    },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const enabled = preference.data?.enabled ?? false;
  const unavailable = preference.isLoading || preference.isError;
  return <Card className="kronos-card border-indigo-300/20 bg-gradient-to-l from-indigo-300/[.075] via-slate-950 to-cyan-300/[.045]"><CardContent className="p-4"><div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><p className="text-[10px] font-black tracking-[.16em] text-indigo-200">{copy.eyebrow}</p><h2 className="mt-1 text-sm font-black text-white">{copy.title}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">{copy.description}</p></div><div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/35 px-3 py-2.5"><div className="text-left"><p className="text-xs font-bold text-slate-100">{enabled ? copy.enabled : copy.disabled}</p><p className="mt-0.5 text-[10px] text-slate-500">{enabled ? copy.enabledHint : copy.disabledHint}</p></div><Switch aria-label={copy.aria} checked={enabled} disabled={unavailable || savePreference.isPending} onCheckedChange={nextEnabled => savePreference.mutate({ enabled: nextEnabled })} /></div></div>{preference.isError && <p role="alert" className="mt-3 text-xs text-rose-200">{copy.loadError}</p>}</CardContent></Card>;
}

export function NotificationsWorkspace({ locale }: { locale: DashboardLocale }) {
  return <section className="space-y-4"><PrivateNotificationDeliverySetting /><NotificationFeedWorkspace locale={locale} /></section>;
}

function LanguageSelector({ locale, onChange, pending }: { locale: DashboardLocale; onChange: (locale: DashboardLocale) => void; pending?: boolean }) {
  const messages = dashboardMessages(locale);
  return <label className="flex items-center gap-2 text-xs text-slate-400"><span className="sr-only">{messages.language}</span><select aria-label={messages.language} value={locale} disabled={pending} onChange={event => onChange(normalizeDashboardLocale(event.target.value))} className="kronos-input min-w-32 border-cyan-300/20 bg-slate-950/80 py-2 text-xs"><option value="" disabled>{messages.language}</option>{DASHBOARD_LOCALES.map(item => <option key={item} value={item}>{DASHBOARD_LOCALE_LABELS[item]}</option>)}</select></label>;
}

function profileInitials(name: string) {
  const initials = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0)).join("");
  return initials || "KG";
}
function groupAccessLabel(access: string | null | undefined, locale: DashboardLocale) {
  const copy = dashboardRoleCopy[locale];
  const normalized = (access ?? "").toLowerCase();
  if (!normalized) return copy.noRole;
  if (normalized.includes("owner") || normalized === "global_admin") return copy.botOwner;
  if (normalized.includes("admin") || normalized.includes("moderator")) return copy.botAdmin;
  return copy.operational;
}

const sessionIdentityCopy: Record<DashboardLocale, { id: string; signed: string }> = {
  fa: { id: "شناسهٔ تلگرام", signed: "هویت امضاشده" }, en: { id: "Telegram ID", signed: "Signed identity" }, ar: { id: "معرّف تيليجرام", signed: "هوية موقّعة" }, tr: { id: "Telegram kimliği", signed: "İmzalı kimlik" }, ru: { id: "ID Telegram", signed: "Подписанная личность" }, es: { id: "ID de Telegram", signed: "Identidad firmada" }, fr: { id: "ID Telegram", signed: "Identité signée" }, pt: { id: "ID do Telegram", signed: "Identidade assinada" }, it: { id: "ID Telegram", signed: "Identità firmata" }, de: { id: "Telegram-ID", signed: "Signierte Identität" }, pl: { id: "Identyfikator Telegram", signed: "Podpisana tożsamość" }, vi: { id: "ID Telegram", signed: "Danh tính đã ký" },
};

export function TelegramProfileCard({ sessionProfile }: { sessionProfile: DashboardProfile }) {
  const { data, isLoading } = trpc.dashboard.profile.useQuery(undefined, { refetchInterval: 30_000 });
  const locale = normalizeDashboardLocale(data?.preferredLocale ?? "fa");
  const copy = dashboardUiCopy[locale].profile;
  const displayName = data?.firstName || sessionProfile.firstName || data?.username || sessionProfile.username || copy.telegramUser;
  const username = data?.username || sessionProfile.username;
  const isLocked = data?.forcedJoinStatus.locked ?? false;
  const missingCount = data?.forcedJoinStatus.missingCount ?? 0;
  const membershipText = isLocked ? copy.forcedJoinLocked(missingCount) : copy.forcedJoinVerified;

  return <Card className="overflow-hidden border-cyan-300/15 bg-gradient-to-br from-cyan-300/[.09] via-slate-950/20 to-indigo-400/[.09] shadow-none">
    <CardContent className="p-3.5">
      <div className="flex items-center gap-3">
        <Avatar className="size-14 shrink-0 ring-2 ring-cyan-200/35 ring-offset-2 ring-offset-slate-950">{data?.photoUrl || sessionProfile.photoUrl ? <AvatarImage src={data?.photoUrl ?? sessionProfile.photoUrl} alt={displayName} /> : null}
          <AvatarFallback className="bg-gradient-to-br from-cyan-200 to-indigo-300 text-base font-black text-slate-950">{profileInitials(displayName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-white">{displayName}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400">{username ? `@${username}` : copy.noUsername}</p>
          <p className="mt-1 truncate text-[10px] text-cyan-200/80" data-session-identity="signed">{sessionIdentityCopy[locale].id}: {sessionProfile.telegramUserId} · {sessionIdentityCopy[locale].signed}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-white/10 bg-white/[.05] px-2 py-1 text-[10px] font-bold text-slate-300">{dashboardMessages(locale).language}: {localeLabels[locale] ?? locale}</span>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${isLocked ? "bg-rose-400/15 text-rose-100" : "bg-emerald-400/15 text-emerald-100"}`}>
          <i className={`h-1.5 w-1.5 rounded-full ${isLocked ? "bg-rose-300" : "bg-emerald-300"}`} />
          {isLoading ? dashboardUiCopy[locale].gate.verifying : membershipText}
        </span>
      </div>
    </CardContent>
  </Card>;
}

function BroadcastPanel() {
  const [text, setText] = useState("");
  const [lastResult, setLastResult] = useState<{ total: number; sent: number; failed: number; needsPrivateStart: number } | null>(null);
  const locale = activeDashboardLocale();
  const copy = dashboardBroadcastCopy[locale];
  const broadcast = trpc.dashboard.broadcast.useMutation({
    onSuccess: result => { const format = (value: number) => value.toLocaleString(dashboardLocaleTag()); const resultCopy = dashboardBroadcastResultCopy(locale); setLastResult(result); toast.success(resultCopy.success(format(result.total), format(result.sent), format(result.failed), format(result.needsPrivateStart))); setText(""); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const format = (value: number) => value.toLocaleString(dashboardLocaleTag());
  const resultCopy = dashboardBroadcastResultCopy(locale);
  return <Card className="kronos-card"><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Radio className="h-4 w-4 text-cyan-200" /> {copy.title}</CardTitle><CardDescription>{copy.description}</CardDescription></CardHeader><CardContent><form className="space-y-3" onSubmit={event => { event.preventDefault(); if (text.trim()) broadcast.mutate({ text: text.trim() }); }}><Textarea value={text} onChange={event => setText(event.target.value)} maxLength={4096} placeholder={copy.placeholder} aria-label={copy.aria} /><div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">{text.length.toLocaleString(dashboardLocaleTag())} / 4096</span><Button type="submit" disabled={!text.trim() || broadcast.isPending} className="bg-cyan-300 text-slate-950 hover:bg-cyan-200">{broadcast.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />} {copy.send}</Button></div></form>{lastResult && <p role="status" className="mt-3 rounded-md border border-cyan-300/20 bg-cyan-300/5 px-3 py-2 text-xs text-cyan-50">{resultCopy.detail(format(lastResult.total), format(lastResult.sent), format(lastResult.failed), format(lastResult.needsPrivateStart))}</p>}</CardContent></Card>;
}

function OwnerHealthSnapshot() {
  const locale = activeDashboardLocale();
  const health = trpc.dashboard.health.useQuery(undefined, { refetchInterval: 30_000 });
  const labels: Record<string, string> = locale === "fa"
    ? { healthy: "سالم", degraded: "نیازمند بررسی", unavailable: "در دسترس نیست" }
    : { healthy: "Healthy", degraded: "Needs attention", unavailable: "Unavailable" };
  const tone = (status: string) => status === "healthy" ? "border-emerald-300/20 bg-emerald-300/[.07] text-emerald-100" : status === "degraded" ? "border-amber-300/20 bg-amber-300/[.07] text-amber-100" : "border-rose-300/20 bg-rose-300/[.07] text-rose-100";
  const snapshot = health.data;
  return <Card className="kronos-card overflow-hidden border-cyan-300/15 bg-gradient-to-br from-cyan-300/[.055] to-indigo-400/[.035]">
    <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
      <div><CardTitle className="flex items-center gap-2 text-base"><Activity className="h-4 w-4 text-cyan-200" /> {locale === "fa" ? "مرکز سلامت ربات" : "Bot health center"}</CardTitle><CardDescription>{locale === "fa" ? "نمای مالک از وبهوک، صف عملیات و وضعیت داده‌های اجرایی" : "Owner-only view of webhook, jobs, and runtime data"}</CardDescription></div>
      <Button type="button" size="sm" variant="outline" onClick={() => health.refetch()} disabled={health.isFetching} className="border-white/10 bg-white/[.035] text-slate-100 hover:bg-white/10"><RefreshCw className={`h-3.5 w-3.5 ${health.isFetching ? "animate-spin" : ""}`} />{locale === "fa" ? "به‌روزرسانی" : "Refresh"}</Button>
    </CardHeader>
    <CardContent>{health.isLoading || !snapshot ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /><Skeleton className="h-20 rounded-xl" /></div> : <><div className="flex flex-wrap items-center justify-between gap-2"><span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black ${tone(snapshot.overall)}`}><i className="h-1.5 w-1.5 rounded-full bg-current" />{labels[snapshot.overall]}</span><span className="text-[11px] text-slate-500">{locale === "fa" ? `آخرین بررسی: ${dashboardDate(new Date(snapshot.collectedAt), locale)}` : `Checked: ${dashboardDate(new Date(snapshot.collectedAt), locale)}`}</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><HealthCell icon={Database} label={locale === "fa" ? "پایگاه‌داده" : "Database"} status={snapshot.database.status} value={snapshot.database.latencyMs === null ? "—" : `${dashboardNumber(snapshot.database.latencyMs, locale)} ms`} labels={labels} tone={tone} /><HealthCell icon={Activity} label={locale === "fa" ? "Ping تلگرام" : "Telegram ping"} status={snapshot.webhook.status} value={snapshot.webhook.telegramLatencyMs === null ? "—" : `${dashboardNumber(snapshot.webhook.telegramLatencyMs, locale)} ms`} labels={labels} tone={tone} /><HealthCell icon={ClipboardList} label={locale === "fa" ? "صف عملیات" : "Operations queue"} status={snapshot.scheduler.status} value={locale === "fa" ? `${dashboardNumber(snapshot.scheduler.dueJobs, locale)} معوق` : `${dashboardNumber(snapshot.scheduler.dueJobs, locale)} overdue`} labels={labels} tone={tone} /><HealthCell icon={ShieldCheck} label={locale === "fa" ? "کش گروه‌ها" : "Group cache"} status={snapshot.cache.status} value={locale === "fa" ? `${dashboardNumber(snapshot.cache.hitRate * 100, locale)}٪ موفق` : `${dashboardNumber(snapshot.cache.hitRate * 100, locale)}% hit rate`} labels={labels} tone={tone} /></div></>}</CardContent>
  </Card>;
}

function HealthCell({ icon: Icon, label, status, value, labels, tone }: { icon: typeof Activity; label: string; status: string; value: string; labels: Record<string, string>; tone: (status: string) => string }) {
  return <div className={`rounded-xl border p-3 ${tone(status)}`}><div className="flex items-center justify-between gap-2"><Icon className="h-4 w-4 opacity-80" /><span className="text-[10px] font-bold">{labels[status]}</span></div><p className="mt-3 text-xs font-bold text-slate-100">{label}</p><p className="mt-1 text-[11px] text-slate-300">{value}</p></div>;
}

function OwnerLatencyPill() {
  const locale = activeDashboardLocale();
  const health = trpc.dashboard.health.useQuery(undefined, { refetchInterval: 30_000 });
  const latency = health.data?.webhook.telegramLatencyMs;
  const tone = latency === undefined || latency === null ? "border-slate-300/15 bg-slate-300/[.06] text-slate-300" : latency <= 350 ? "border-emerald-300/20 bg-emerald-300/[.08] text-emerald-100" : latency <= 1_000 ? "border-amber-300/20 bg-amber-300/[.08] text-amber-100" : "border-rose-300/20 bg-rose-300/[.08] text-rose-100";
  const label = locale === "fa" ? "Ping ربات" : "Bot ping";
  const value = health.isLoading ? "…" : latency === null || latency === undefined ? "—" : `${dashboardNumber(latency, locale)} ms`;
  return <span className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black ${tone}`} title={locale === "fa" ? "زمان رفت‌وبرگشت فعلی تا Telegram Bot API" : "Current Telegram Bot API round-trip"}><i className="h-1.5 w-1.5 rounded-full bg-current" />{label}: {value}</span>;
}

function Overview({ isOwner }: { isOwner: boolean }) {
  const { data, isLoading } = trpc.dashboard.overview.useQuery();
  const locale = activeDashboardLocale();
  const copy = dashboardOverviewCopy[locale];
  const statusCopy = dashboardOverviewStatusCopy[locale];
  if (isLoading || !data) return <PanelLoading />;
  return <section className="space-y-5"><div className="kronos-hero"><div><p className="kronos-eyebrow">{statusCopy.eyebrow}</p><h1>{copy.liveTitle}</h1><p>{copy.liveDescription}</p>{isOwner && <OwnerLatencyPill />}</div><div className="hidden rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-left text-xs text-cyan-100 sm:block"><span className="mb-1 block text-[10px] tracking-[.18em] text-cyan-300">{statusCopy.systemStatus}</span><span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_14px_#86efac]" /> {statusCopy.botOperational}</span></div></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric locale={locale} label={copy.activeGroups} value={data.groups} hint={copy.registered} icon={UsersRound} accent="bg-indigo-400/15 text-indigo-200" /><Metric locale={locale} label={copy.forcedJoin} value={data.activeForcedJoin} hint={copy.displayedChannels} icon={LockKeyhole} accent="bg-cyan-400/15 text-cyan-200" /><Metric locale={locale} label={copy.pendingPayments} value={data.pendingPayments} hint={copy.manualReceipts} icon={CreditCard} accent="bg-amber-400/15 text-amber-100" /><Metric locale={locale} label={copy.criticalAlerts} value={data.criticalAlerts} hint={copy.ownerAttention} icon={Flame} accent="bg-rose-400/15 text-rose-100" /></div>{isOwner && <OwnerHealthSnapshot />}<Card className="kronos-card"><CardHeader><CardTitle className="text-base">{copy.openAlerts}</CardTitle><CardDescription>{copy.recentEvents}</CardDescription></CardHeader><CardContent className="space-y-2">{data.recentAlerts.length ? data.recentAlerts.map(alert => <div key={alert.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-100">{alert.title}</p><p className="mt-1 truncate text-xs text-slate-400">{alert.body}</p></div><div className="shrink-0 text-left"><StatusBadge status={alert.severity} /><p className="mt-1 text-[10px] text-slate-500">{dashboardDate(alert.createdAt, locale)}</p></div></div>) : <Empty text={copy.noAlerts} />}</CardContent></Card>{isOwner && <><BroadcastPanel /><OwnerMaintenance /></>}</section>;
}

export function Groups() {
  const locale = activeDashboardLocale();
  const groupCopy = dashboardGroupFormCopy[locale];
  const { data: groups, isLoading } = trpc.dashboard.groups.list.useQuery();
  const [selected, setSelected] = useState<number | null>(null);
  const detail = trpc.dashboard.groups.detail.useQuery({ groupId: selected ?? 0 }, { enabled: Boolean(selected) });
  const save = trpc.dashboard.groups.updateSettings.useMutation({ onSuccess: () => { toast.success(dashboardRoleCopy[activeDashboardLocale()].savedQuiet); detail.refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const selectedGroup = groups?.find(group => group.id === selected);
  const canManageSettings = ["owner", "global_admin", "group_owner", "group_admin"].includes(selectedGroup?.access ?? "");
  const initial = useMemo<GroupSettingsForm | null>(() => detail.data?.settings ? { ...detail.data.settings, marketCommandsEnabled: Boolean(detail.data.settings.marketCommandsEnabled ?? 1), welcomeMessage: detail.data.settings.welcomeMessage ?? "", goodbyeMessage: detail.data.settings.goodbyeMessage ?? "", rulesText: detail.data.settings.rulesText ?? "" } : selectedGroup ? { welcomeEnabled: true, welcomeMessage: "", goodbyeEnabled: false, goodbyeMessage: "", antiSpamEnabled: true, antiRaidEnabled: true, marketCommandsEnabled: true, floodMessageLimit: 7, floodWindowSeconds: 12, duplicateMessageLimit: 3, warnLimit: 3, warnAction: "mute", warnMuteMinutes: 60, rulesText: "" } : null, [detail.data, selectedGroup]);
  const [form, setForm] = useState<GroupSettingsForm | null>(null);
  useEffect(() => { setForm(initial); }, [initial]);
  const clearGroupSelection = () => {
    setSelected(null);
    setForm(null);
  };
  useDashboardReset(clearGroupSelection);
  if (isLoading) return <PanelLoading />;
  return <section className="space-y-5"><SectionHeading {...dashboardPanelMessages(normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale")), "groups")} /><div className="grid gap-4 xl:grid-cols-[.85fr_1.15fr]"><Card className="kronos-card"><CardContent className="p-2">{groups?.length ? groups.map(group => <button key={group.id} onClick={() => setSelected(group.id)} className={`mb-1 flex w-full items-center justify-between rounded-xl p-3 text-right transition ${selected === group.id ? "bg-cyan-300/15" : "hover:bg-white/[0.04]"}`}><div><p className="text-sm font-bold text-white">{group.title}</p><p className="mt-1 text-xs text-slate-500">{group.username ? `@${group.username}` : group.chatId} · {groupAccessLabel(group.access, locale)}</p></div><StatusBadge status={group.status} /></button>) : <Empty text={groupCopy.empty} />}</CardContent></Card>{selected && form ? <Card className="kronos-card"><CardHeader><CardTitle className="flex items-center justify-between gap-3 text-base"><span>{selectedGroup?.title}</span><button aria-label={groupCopy.close} onClick={() => setSelected(null)} className="rounded-lg p-1 text-slate-400 hover:bg-white/10"><X className="h-4 w-4" /></button></CardTitle><CardDescription>{groupCopy.description}</CardDescription></CardHeader><CardContent><form className="space-y-5" onSubmit={event => { event.preventDefault(); if (canManageSettings) save.mutate({ groupId: selected, ...form, welcomeMessage: form.welcomeMessage || null, goodbyeMessage: form.goodbyeMessage || null, rulesText: form.rulesText || null }); }}><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.05] p-3 text-xs leading-6 text-slate-300"><p className="font-bold text-cyan-100">{groupCopy.templateTitle}</p><p>{groupCopy.formats} <code>{groupCopy.formatsExample}</code></p><p className="mt-1">{groupCopy.variables} <code>{groupCopy.variablesExample}</code></p></div>{!canManageSettings && <p className="rounded-xl border border-amber-300/15 bg-amber-300/[.06] p-3 text-xs leading-6 text-amber-100">{groupCopy.readOnly}</p>}<fieldset disabled={!canManageSettings} className="space-y-5 disabled:opacity-55"><Toggle label={groupCopy.welcome} checked={form.welcomeEnabled} onCheckedChange={value => setForm({ ...form, welcomeEnabled: value })} /><Textarea value={form.welcomeMessage} onChange={event => setForm({ ...form, welcomeMessage: event.target.value })} placeholder={groupCopy.welcome} /><Toggle label={groupCopy.goodbye} checked={form.goodbyeEnabled} onCheckedChange={value => setForm({ ...form, goodbyeEnabled: value })} /><Textarea value={form.goodbyeMessage} onChange={event => setForm({ ...form, goodbyeMessage: event.target.value })} placeholder={groupCopy.goodbye} /><div className="grid gap-3 sm:grid-cols-2"><Toggle label={groupCopy.antiSpam} checked={form.antiSpamEnabled} onCheckedChange={value => setForm({ ...form, antiSpamEnabled: value })} /><Toggle label={groupCopy.antiRaid} checked={form.antiRaidEnabled} onCheckedChange={value => setForm({ ...form, antiRaidEnabled: value })} /><Toggle label="صرافی و دستور قیمت" checked={form.marketCommandsEnabled} onCheckedChange={value => setForm({ ...form, marketCommandsEnabled: value })} /></div><div className="grid grid-cols-2 gap-3"><NumberField label={groupCopy.floodLimit} value={form.floodMessageLimit} onChange={value => setForm({ ...form, floodMessageLimit: value })} /><NumberField label={groupCopy.floodWindow} value={form.floodWindowSeconds} onChange={value => setForm({ ...form, floodWindowSeconds: value })} /><NumberField label={groupCopy.duplicateLimit} value={form.duplicateMessageLimit} onChange={value => setForm({ ...form, duplicateMessageLimit: value })} /><NumberField label={groupCopy.warningLimit} value={form.warnLimit} onChange={value => setForm({ ...form, warnLimit: value })} /></div><Textarea value={form.rulesText} onChange={event => setForm({ ...form, rulesText: event.target.value })} placeholder={groupCopy.rules} /><Button type="submit" className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {groupCopy.save}</Button></fieldset></form></CardContent></Card> : <Card className="kronos-card grid min-h-72 place-items-center"><Empty text={groupCopy.empty} /></Card>}</div></section>;
}

export function Members({ isBotOwner }: { isBotOwner: boolean }) {
  const locale = activeDashboardLocale();
  const memberCopy = dashboardMemberCopy[locale];
  const memberExtraCopy = dashboardMemberExtraCopy[locale];
  const { data: groups, isLoading: loadingGroups } = trpc.dashboard.groups.list.useQuery();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [includeDeparted, setIncludeDeparted] = useState(false);
  const [memberSearch, setMemberSearch] = useState("");
  const directory = trpc.dashboard.members.list.useQuery({ groupId: groupId ?? 0, includeDeparted }, {
    enabled: Boolean(groupId),
    refetchInterval: query => shouldRefreshMemberPresence(document.visibilityState === "visible", Boolean(query.state.dataUpdatedAt && groupId)) ? MEMBER_PRESENCE_REFRESH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });
  const [refreshSummary, setRefreshSummary] = useState<{ groupId: number; refreshedAdministrators: number; totalTelegramMembers: number } | null>(null);
  const setRole = trpc.dashboard.members.setKronosRole.useMutation({
    onSuccess: result => { toast.success(result.announced ? dashboardRoleCopy[activeDashboardLocale()].saved : dashboardRoleCopy[activeDashboardLocale()].savedQuiet); directory.refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const setTelegramRole = trpc.dashboard.members.setTelegramRole.useMutation({
    onSuccess: result => { toast.success(result.announced ? dashboardRoleCopy[activeDashboardLocale()].saved : dashboardRoleCopy[activeDashboardLocale()].savedQuiet); directory.refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const titleCopy = dashboardMemberTitleCopy[locale];
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});
  const setKronosTitle = trpc.dashboard.members.setKronosTitle.useMutation({
    onSuccess: () => { toast.success(titleCopy.saved); directory.refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const [vipPolicyTarget, setVipPolicyTarget] = useState<number | null>(null);
  const vipPolicyQuery = trpc.dashboard.members.getVipProtection.useQuery({ groupId: groupId ?? 0, targetTelegramId: vipPolicyTarget ?? 0 }, { enabled: Boolean(groupId && vipPolicyTarget) });
  const setVipPolicy = trpc.dashboard.members.setVipProtection.useMutation({
    onSuccess: () => { toast.success(locale === "fa" ? "سیاست حفاظتی مقام ویژه ذخیره شد." : "VIP protection policy saved."); void vipPolicyQuery.refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const refreshAdmins = trpc.dashboard.members.refreshAdmins.useMutation({
    onSuccess: result => {
      if (!groupId) return;
      setRefreshSummary({ groupId, ...result });
      toast.success(memberExtraCopy.refreshResult(result.refreshedAdministrators.toLocaleString(dashboardLocaleTag())));
      directory.refetch();
    },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const selectedGroup = groups?.find(group => group.id === groupId);
  useEffect(() => {
    if (groupId && groups && !groups.some(group => group.id === groupId)) {
      setGroupId(null);
      setRefreshSummary(null);
    }
  }, [groupId, groups]);
  const clearGroupSelection = () => {
    setGroupId(null);
    setRefreshSummary(null);
    setIncludeDeparted(false);
    setMemberSearch("");
    setVipPolicyTarget(null);
  };
  useDashboardReset(clearGroupSelection);
  const canManageMemberRoles = ["owner", "global_admin", "group_owner", "group_admin"].includes(selectedGroup?.access ?? "");
  const normalizedMemberSearch = memberSearch.trim().toLocaleLowerCase();
  const titleValueFor = (member: { telegramUserId: number; internalTitle?: string | null }) => titleDrafts[String(member.telegramUserId)] ?? member.internalTitle ?? "";
  const filteredMembers = directory.data?.members.filter(member => {
    if (!normalizedMemberSearch) return true;
    const searchable = [member.firstName, member.lastName, member.username, String(member.telegramUserId)].filter(Boolean).join(" ").toLocaleLowerCase();
    return searchable.includes(normalizedMemberSearch);
  }) ?? [];
  const telegramRoleLabel = (member: { isGroupOwner: boolean; telegramRole: string }) => {
    if (member.isGroupOwner || member.telegramRole === "owner") return dashboardRoleCopy[activeDashboardLocale()].botOwner;
    if (member.telegramRole === "administrator") return "Telegram administrator";
    return dashboardRoleCopy[activeDashboardLocale()].regular;
  };
  if (loadingGroups) return <PanelLoading />;
  return <section className="space-y-5"><SectionHeading {...dashboardPanelMessages(normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale")), "members")} /><Card className="kronos-card border-cyan-300/15 bg-cyan-300/[.035]"><CardContent className="grid gap-3 p-4 text-xs leading-6 text-slate-300 md:grid-cols-2"><div><p className="font-black text-cyan-100">{memberCopy.telegramRole}</p><p>{memberCopy.adminOnly}</p></div><div><p className="font-black text-cyan-100">{memberCopy.internalAccess}</p><p>{memberCopy.ownerFixed}</p></div></CardContent></Card><div className="grid gap-4 xl:grid-cols-[.72fr_1.28fr]"><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{dashboardModerationCopy[activeDashboardLocale()].selectGroup}</CardTitle><CardDescription>{memberCopy.selectGroup}</CardDescription></CardHeader><CardContent className="space-y-2">{groups?.length ? groups.map(group => <button key={group.id} onClick={() => { setGroupId(group.id); setRefreshSummary(null); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-right transition ${groupId === group.id ? "bg-cyan-300/15 text-white" : "hover:bg-white/[.04]"}`}><div><p className="text-sm font-bold text-white">{group.title}</p><p className="mt-1 text-[11px] text-slate-500">{group.username ? `@${group.username}` : group.chatId}</p></div><ChevronLeft className="h-4 w-4 text-slate-500" /></button>) : <Empty text={memberCopy.empty} />}</CardContent></Card>{groupId ? <Card className="kronos-card"><CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="text-base">{selectedGroup?.title ?? memberCopy.selectGroup}</CardTitle><CardDescription className="mt-1">{directory.data ? `${directory.data.totalKnown.toLocaleString(dashboardLocaleTag())} ${memberCopy.memberId}` : memberCopy.lastSeen}{refreshSummary?.groupId === groupId ? ` · ${memberExtraCopy.currentTelegramMembers}: ${refreshSummary.totalTelegramMembers.toLocaleString(dashboardLocaleTag())}` : ""}</CardDescription></div><div className="flex flex-wrap items-center gap-2"><Label htmlFor="include-departed" className="text-xs text-slate-400">{memberExtraCopy.showDeparted}</Label><Switch id="include-departed" checked={includeDeparted} onCheckedChange={setIncludeDeparted} />{canManageMemberRoles && <Button type="button" size="sm" variant="outline" className="border-cyan-300/25 text-cyan-100 hover:bg-cyan-300/10" onClick={() => refreshAdmins.mutate({ groupId })} disabled={refreshAdmins.isPending}>{refreshAdmins.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} {memberExtraCopy.refreshAdmins}</Button>}</div></div></CardHeader><CardContent className="space-y-3"><Input aria-label={memberExtraCopy.searchLabel} value={memberSearch} onChange={event => setMemberSearch(event.target.value)} placeholder={memberExtraCopy.searchPlaceholder} className="border-cyan-300/15 bg-white/[.03]" /><p className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.045] p-3 text-xs leading-6 text-cyan-50">{memberExtraCopy.apiLimitation}</p>{vipPolicyTarget && <div className="rounded-2xl border border-violet-300/20 bg-violet-300/[.06] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-violet-100">سیاست حفاظتی مقام ویژه</p><p className="mt-1 text-xs leading-5 text-slate-400">محافظت این عضو از مجازات‌ها و سامانه‌های خودکار گروه را جداگانه تنظیم کنید.</p></div><Button type="button" variant="ghost" size="sm" className="text-slate-300" onClick={() => setVipPolicyTarget(null)}>بستن</Button></div>{vipPolicyQuery.isLoading ? <PanelLoading /> : <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{([['protectMute','محافظت از سکوت'],['protectBan','محافظت از بن'],['protectKick','محافظت از اخراج'],['protectDelete','محافظت از حذف پیام'],['ignoreAntiSpam','نادیده‌گرفتن ضداسپم'],['ignoreAntiRaid','نادیده‌گرفتن ضدحمله'],['ignoreFilters','نادیده‌گرفتن فیلترها'],['ignoreContentLocks','نادیده‌گرفتن قفل محتوا'],['ignoreForcedJoin','نادیده‌گرفتن عضویت اجباری'],['notifyBlockedActions','اعلان جلوگیری از عملیات']] as const).map(([key, label]) => { const checked = vipPolicyQuery.data?.[key] ?? true; return <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] px-3 py-2 text-xs text-slate-200"><span>{label}</span><Switch checked={checked} disabled={setVipPolicy.isPending || !canManageMemberRoles} onCheckedChange={value => vipPolicyTarget && groupId && setVipPolicy.mutate({ groupId, targetTelegramId: vipPolicyTarget, [key]: value })} /></label>; })}</div>}</div>}{directory.isLoading ? <PanelLoading /> : filteredMembers.length ? filteredMembers.map(member => { const displayName = [member.firstName, member.lastName].filter(Boolean).join(" ") || member.username || `${memberCopy.regularTelegram} ${member.telegramUserId}`; const selectedRole = member.managedRoles.includes("kronos_owner") ? "kronos_owner" : member.managedRoles.includes("moderator") ? "moderator" : member.managedRoles.includes("vip") ? "vip" : "user"; const selectedTelegramRole = member.telegramRole === "administrator" ? "telegram_admin" : "telegram_member"; const canEditKronosRole = canManageMemberRoles && (isBotOwner || selectedRole !== "kronos_owner"); const canEditTelegramRole = member.telegramRole !== "owner" && (isBotOwner || selectedGroup?.access === "group_owner"); const kronosLabel = selectedRole === "kronos_owner" ? dashboardRoleCopy[activeDashboardLocale()].botOwner : selectedRole === "moderator" ? dashboardRoleCopy[activeDashboardLocale()].botAdmin : selectedRole === "vip" ? dashboardRoleCopy[activeDashboardLocale()].vip : dashboardRoleCopy[activeDashboardLocale()].regular; return <article key={member.id} className="rounded-2xl border border-white/8 bg-white/[.025] p-3 sm:p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-black text-white">{displayName}</p><StatusBadge status={member.membershipStatus} /></div><p className="mt-1 text-xs text-slate-400">{member.username ? `@${member.username}` : `${memberExtraCopy.idPrefix}: ${member.telegramUserId}`} · {memberExtraCopy.lastSeenPrefix}: {persianDate(member.lastSeenAt)}</p><div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-indigo-300/10 px-2 py-1 text-[10px] font-bold text-indigo-100">{memberExtraCopy.telegramPrefix}: {telegramRoleLabel(member)}</span><span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[10px] font-bold text-cyan-100">{memberExtraCopy.botRolePrefix}: {kronosLabel}</span>{selectedRole === "vip" && <Button type="button" size="sm" variant="outline" className="h-6 border-violet-300/25 px-2 text-[10px] text-violet-100" onClick={() => setVipPolicyTarget(member.telegramUserId)}>تنظیم حفاظت VIP</Button>}{member.warningCount > 0 && <span className="rounded-full bg-amber-300/10 px-2 py-1 text-[10px] font-bold text-amber-100">{member.warningCount.toLocaleString(dashboardLocaleTag())} {memberExtraCopy.warningSuffix}</span>}</div></div><div className="grid gap-2 sm:min-w-44"><Field label={memberCopy.internalAccess}><select aria-label={`${memberCopy.kronosRole} — ${displayName}`} className="kronos-input min-w-40" value={selectedRole} disabled={setRole.isPending || !canEditKronosRole} onChange={event => setRole.mutate({ groupId, targetTelegramId: member.telegramUserId, role: event.target.value as "kronos_owner" | "moderator" | "vip" | "user" })}><option value="user">{memberCopy.regularTelegram}</option><option value="moderator">{dashboardRoleCopy[activeDashboardLocale()].botAdmin}</option><option value="vip">{dashboardRoleCopy[activeDashboardLocale()].vip}</option>{isBotOwner ? <option value="kronos_owner">{dashboardRoleCopy[activeDashboardLocale()].botOwner}</option> : selectedRole === "kronos_owner" ? <option value="kronos_owner" disabled>{dashboardRoleCopy[activeDashboardLocale()].botOwner}</option> : null}</select>{selectedRole === "kronos_owner" && !isBotOwner ? <p className="mt-1 text-[10px] text-amber-100">{memberCopy.ownerFixed}</p> : null}</Field><Field label={memberCopy.telegramRole}><select aria-label={`${memberCopy.telegramRole} — ${displayName}`} className="kronos-input min-w-40" value={selectedTelegramRole} disabled={setTelegramRole.isPending || !canEditTelegramRole} onChange={event => setTelegramRole.mutate({ groupId, targetTelegramId: member.telegramUserId, role: event.target.value as "telegram_admin" | "telegram_member" })}><option value="telegram_member">{memberCopy.regularTelegram}</option><option value="telegram_admin">{memberCopy.adminTelegram}</option></select>{member.telegramRole === "owner" ? <p className="mt-1 text-[10px] text-slate-500">{memberCopy.ownerFixed}</p> : !canEditTelegramRole && <p className="mt-1 text-[10px] text-slate-500">{memberCopy.adminOnly}</p>}</Field><Field label={titleCopy.label}><div className="flex gap-2"><Input aria-label={`${titleCopy.label} — ${displayName}`} value={titleValueFor(member)} onChange={event => setTitleDrafts(current => ({ ...current, [String(member.telegramUserId)]: event.target.value }))} placeholder={titleCopy.placeholder} maxLength={64} disabled={!canManageMemberRoles || setKronosTitle.isPending} className="min-w-0" /><Button type="button" size="sm" variant="outline" aria-label={titleCopy.save} disabled={!canManageMemberRoles || setKronosTitle.isPending} onClick={() => setKronosTitle.mutate({ groupId, targetTelegramId: member.telegramUserId, title: titleValueFor(member).trim() || null })}>{setKronosTitle.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}</Button><Button type="button" size="sm" variant="outline" aria-label={titleCopy.clear} disabled={!canManageMemberRoles || setKronosTitle.isPending || !titleValueFor(member)} onClick={() => { setTitleDrafts(current => ({ ...current, [String(member.telegramUserId)]: "" })); setKronosTitle.mutate({ groupId, targetTelegramId: member.telegramUserId, title: null }); }}><Trash2 className="h-3.5 w-3.5" /></Button></div></Field></div></div></article>; }) : <Empty text={memberSearch.trim() ? memberCopy.noMatch : memberCopy.empty} />}</CardContent></Card> : <Card className="kronos-card grid min-h-64 place-items-center"><Empty text={memberExtraCopy.selectGroupEmpty} /></Card>}</div></section>;
}

export function RoleManagementDashboard({ isBotOwner }: { isBotOwner: boolean }) {
  const locale = activeDashboardLocale();
  const roleCopy = dashboardRoleCopy[locale];
  const panel = dashboardPanelMessages(locale, "members");
  const { data: groups } = trpc.dashboard.groups.list.useQuery();
  const [groupId, setGroupId] = useState("");
  const [targetTelegramId, setTargetTelegramId] = useState("");
  const [role, setRole] = useState<"kronos_owner" | "moderator" | "vip" | "user">("moderator");
  const assign = trpc.dashboard.members.setKronosRole.useMutation({
    onSuccess: result => result.unchanged ? toast.info(roleCopy.unchanged) : toast.success(result.announced ? roleCopy.saved : roleCopy.savedQuiet),
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const manageableGroups = groups?.filter(group => ["owner", "global_admin", "group_owner", "group_admin"].includes(group.access)) ?? [];
  const clearRoleManagementDraft = () => {
    setGroupId("");
    setTargetTelegramId("");
    setRole("moderator");
  };
  useDashboardReset(clearRoleManagementDraft);
  return <Card className="kronos-card border-cyan-300/15 bg-gradient-to-br from-cyan-300/[.075] via-slate-950 to-indigo-400/[.055]"><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-black tracking-[.18em] text-cyan-200">{roleCopy.role}</p><CardTitle className="mt-1 text-base">{panel.title}</CardTitle><CardDescription className="mt-1">{panel.text}</CardDescription></div><span className="rounded-full border border-cyan-200/20 bg-cyan-200/10 px-3 py-1 text-[10px] font-bold text-cyan-100">{dashboardMessages(locale).nav.members}</span></div></CardHeader><CardContent className="space-y-4"><div className="grid gap-2 sm:grid-cols-4"><div className="rounded-xl border border-indigo-200/15 bg-indigo-300/[.06] p-3"><p className="text-[10px] text-indigo-100">{roleCopy.botOwner}</p><p className="mt-1 text-xs text-slate-400">{roleCopy.protected}</p></div><div className="rounded-xl border border-cyan-200/15 bg-cyan-300/[.06] p-3"><p className="text-[10px] text-cyan-100">{roleCopy.botAdmin}</p><p className="mt-1 text-xs text-slate-400">{roleCopy.operational}</p></div><div className="rounded-xl border border-violet-200/15 bg-violet-300/[.06] p-3"><p className="text-[10px] text-violet-100">{roleCopy.vip}</p><p className="mt-1 text-xs text-slate-400">{roleCopy.exception}</p></div><div className="rounded-xl border border-slate-200/10 bg-white/[.035] p-3"><p className="text-[10px] text-slate-200">{roleCopy.regular}</p><p className="mt-1 text-xs text-slate-400">{roleCopy.noRole}</p></div></div><form className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/45 p-3 lg:grid-cols-[1.1fr_.8fr_1fr_auto]" onSubmit={event => { event.preventDefault(); const parsedGroupId = Number(groupId); const parsedTargetId = Number(targetTelegramId); if (!Number.isSafeInteger(parsedGroupId) || !Number.isSafeInteger(parsedTargetId)) return toast.error(roleCopy.invalid); if (role === "kronos_owner" && !isBotOwner) return toast.error(roleCopy.ownerOnly); assign.mutate({ groupId: parsedGroupId, targetTelegramId: parsedTargetId, role }); }}><Field label={roleCopy.group}><select required className="kronos-input" value={groupId} onChange={event => setGroupId(event.target.value)}><option value="">{roleCopy.selectGroup}</option>{manageableGroups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select></Field><Field label={roleCopy.userId}><Input required inputMode="numeric" value={targetTelegramId} onChange={event => setTargetTelegramId(event.target.value)} placeholder="837…" /></Field><Field label={roleCopy.role}><select className="kronos-input" value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="moderator">{roleCopy.moderator}</option><option value="vip">{roleCopy.vip}</option>{isBotOwner && <option value="kronos_owner">{roleCopy.botOwner}</option>}<option value="user">{roleCopy.user}</option></select></Field><Button type="submit" className="self-end bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={assign.isPending}>{assign.isPending ? roleCopy.saving : role === "user" ? roleCopy.remove : roleCopy.save}</Button></form></CardContent></Card>;
}

function StaffConsole({ isBotOwner }: { isBotOwner: boolean }) {
  const locale = activeDashboardLocale();
  const copy = dashboardOperationsCopy[locale].staff;
  const roleCopy = dashboardRoleCopy[locale];
  const { data: groups } = trpc.dashboard.groups.list.useQuery();
  const [groupId, setGroupId] = useState("");
  const [targetTelegramId, setTargetTelegramId] = useState("");
  const [role, setRole] = useState<"kronos_owner" | "moderator" | "vip" | "user">("moderator");
  const [reviewReady, setReviewReady] = useState(false);
  const assign = trpc.dashboard.members.setKronosRole.useMutation({
    onSuccess: () => { toast.success(copy.saved); setReviewReady(false); setTargetTelegramId(""); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const manageableGroups = groups?.filter(group => ["owner", "global_admin", "group_owner", "group_admin"].includes(group.access)) ?? [];
  const selectedGroup = manageableGroups.find(group => String(group.id) === groupId);
  const selectedRoleLabel = role === "kronos_owner" ? roleCopy.botOwner : role === "moderator" ? roleCopy.botAdmin : role === "vip" ? roleCopy.vip : roleCopy.regular;
  const submitReview = (event: FormEvent) => {
    event.preventDefault();
    if (!Number.isSafeInteger(Number(groupId)) || !Number.isSafeInteger(Number(targetTelegramId))) return toast.error(copy.access);
    if (role === "kronos_owner" && !isBotOwner) return toast.error(copy.access);
    setReviewReady(true);
    toast.info(copy.queued);
  };
  return <Card className="kronos-card border-cyan-300/20 bg-gradient-to-br from-cyan-300/[.07] via-slate-950 to-indigo-400/[.06]"><CardHeader><p className="text-[10px] font-black tracking-[.18em] text-cyan-200">{copy.eyebrow}</p><CardTitle className="mt-1 text-base">{copy.title}</CardTitle><CardDescription>{copy.text}</CardDescription></CardHeader><CardContent className="space-y-3"><form className="grid gap-3 lg:grid-cols-[1.1fr_.8fr_1fr_auto]" onSubmit={submitReview}><Field label={copy.group}><select required className="kronos-input" value={groupId} onChange={event => { setGroupId(event.target.value); setReviewReady(false); }}><option value="">{copy.group}</option>{manageableGroups.map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select></Field><Field label={copy.memberId}><Input required inputMode="numeric" value={targetTelegramId} onChange={event => { setTargetTelegramId(event.target.value.replace(/\D/g, "")); setReviewReady(false); }} placeholder="837…" /></Field><Field label={copy.role}><select className="kronos-input" value={role} onChange={event => { setRole(event.target.value as typeof role); setReviewReady(false); }}><option value="moderator">{roleCopy.botAdmin}</option><option value="vip">{roleCopy.vip}</option>{isBotOwner && <option value="kronos_owner">{roleCopy.botOwner}</option>}<option value="user">{roleCopy.regular}</option></select></Field><Button type="submit" className="self-end bg-cyan-300 text-slate-950 hover:bg-cyan-200">{copy.review}</Button></form><p className="text-[11px] leading-5 text-slate-500">{copy.access}</p>{reviewReady && selectedGroup ? <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[.07] p-3"><p className="text-xs font-black text-amber-100">{copy.review}</p><p className="mt-1 text-xs leading-6 text-slate-300">{selectedGroup.title} · {targetTelegramId} · {selectedRoleLabel}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" className="bg-emerald-300 text-slate-950 hover:bg-emerald-200" disabled={assign.isPending} onClick={() => assign.mutate({ groupId: Number(groupId), targetTelegramId: Number(targetTelegramId), role })}>{assign.isPending ? <Loader2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} {copy.confirm}</Button><Button type="button" size="sm" variant="outline" onClick={() => setReviewReady(false)}>{copy.cancel}</Button></div></div> : null}</CardContent></Card>;
}

function MembersWorkspace({ isBotOwner }: { isBotOwner: boolean }) {
  return <div className="space-y-5"><StaffConsole isBotOwner={isBotOwner} /><Members isBotOwner={isBotOwner} /></div>;
}

export function Moderation() {
  const locale = activeDashboardLocale();
  const moderationCopy = dashboardModerationCopy[locale];
  const legacyCopy = dashboardLegacyCopy[locale];
  const { data: groups } = trpc.dashboard.groups.list.useQuery();
  const [groupId, setGroupId] = useState<number | null>(null);
  const clearGroupSelection = () => setGroupId(null);
  useDashboardReset(clearGroupSelection);
  const detail = trpc.dashboard.groups.detail.useQuery({ groupId: groupId ?? 0 }, { enabled: Boolean(groupId) });
  const addNote = trpc.dashboard.moderation.addNote.useMutation({ onSuccess: () => { toast.success(legacyCopy.noteSaved); detail.refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const clearWarnings = trpc.dashboard.moderation.clearWarnings.useMutation({ onSuccess: () => { toast.success(legacyCopy.warningsCleared); detail.refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const [pendingLockValues, setPendingLockValues] = useState<Record<string, boolean>>({});
  const setLock = trpc.dashboard.moderation.setLock.useMutation({
    onMutate: variables => setPendingLockValues(current => ({ ...current, [variables.lockType]: variables.enabled })),
    onSuccess: async result => {
      await detail.refetch();
      toast.success(result.announced ? legacyCopy.lockSavedAnnounced : legacyCopy.lockSaved);
    },
    onError: error => toast.error(dashboardErrorMessage(error)),
    onSettled: (_result, _error, variables) => setPendingLockValues(current => {
      const next = { ...current };
      delete next[variables.lockType];
      return next;
    }),
  });
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const selected = groups?.find(group => group.id === groupId);
  const lockTypes = ["link", "photo", "video", "sticker", "document", "forward", "mention", "hashtag", "english", "persian", "command", "all"] as const;
  // detail.data is guarded by the conditional immediately below; TypeScript loses that narrowing inside map callbacks.
  // @ts-expect-error guarded dashboard data is captured by nested render callbacks
  return <section className="space-y-5"><SectionHeading {...dashboardPanelMessages(normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale")), "moderation")} /><div className="grid gap-4 xl:grid-cols-[.78fr_1.22fr]"><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{dashboardModerationCopy[activeDashboardLocale()].selectGroup}</CardTitle></CardHeader><CardContent className="space-y-1">{groups?.length ? groups.map(group => <button key={group.id} onClick={() => setGroupId(group.id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-right ${groupId === group.id ? "bg-cyan-300/15" : "hover:bg-white/[.04]"}`}><span className="text-sm font-bold text-white">{group.title}</span><ChevronLeft className="h-4 w-4 text-slate-500" /></button>) : <Empty text={moderationCopy.noGroups} />}</CardContent></Card>{groupId && detail.data ? <div className="space-y-4"><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{selected?.title} — {legacyCopy.warningsFor} & {legacyCopy.adminNote}</CardTitle></CardHeader><CardContent className="space-y-5"><div className="grid gap-3 md:grid-cols-2">{detail.data.warnings.length ? detail.data.warnings.map(warning => <div key={warning.id} className="rounded-xl border border-amber-300/15 bg-amber-300/[.045] p-3"><p className="text-sm font-black text-amber-100">{legacyCopy.userId}: {warning.telegramUserId} · {warning.count} {legacyCopy.activeWarnings}</p><p className="mt-1 truncate text-xs text-slate-400">{warning.lastReason || legacyCopy.noReason}</p><Button size="sm" variant="ghost" className="mt-2 h-7 px-2 text-cyan-200" onClick={() => clearWarnings.mutate({ groupId, targetTelegramId: warning.telegramUserId })}>{moderationCopy.warningsCleared}</Button></div>) : <Empty text={moderationCopy.noWarnings} />}</div><form className="grid gap-3 rounded-2xl border border-white/8 bg-white/[.025] p-3 sm:grid-cols-[150px_1fr_auto]" onSubmit={event => { event.preventDefault(); const parsed = Number(targetId); if (!Number.isSafeInteger(parsed) || !note.trim()) return toast.error(`${legacyCopy.userId} · ${legacyCopy.adminNote}`); addNote.mutate({ groupId, targetTelegramId: parsed, body: note.trim() }); setNote(""); }}><Input inputMode="numeric" value={targetId} onChange={event => setTargetId(event.target.value)} placeholder={legacyCopy.userId} /><Input value={note} onChange={event => setNote(event.target.value)} placeholder={legacyCopy.adminNote} /><Button type="submit" className="bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={addNote.isPending}>{legacyCopy.saveNote}</Button></form><div className="space-y-2">{detail.data.notes.length ? detail.data.notes.map(item => <div key={item.id} className="rounded-xl border border-white/7 p-3"><p className="text-sm text-slate-200">{item.body}</p><p className="mt-1 text-[11px] text-slate-500">{legacyCopy.userId} {item.targetTelegramId} · {persianDate(item.createdAt)}</p></div>) : <p className="text-xs text-slate-500">{legacyCopy.noNotes}</p>}</div></CardContent></Card><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{legacyCopy.advancedLocks}</CardTitle><CardDescription>{legacyCopy.lockHelp}</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{lockTypes.map(lockType => { const current = detail.data.locks.find(lock => lock.lockType === lockType); const hasPendingValue = Object.prototype.hasOwnProperty.call(pendingLockValues, lockType); const checked = hasPendingValue ? pendingLockValues[lockType] : current?.enabled ?? false; return <div key={lockType} className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[.025] px-3 py-2.5"><div><p className="text-sm font-bold text-slate-200">{lockType}</p><p className="text-[10px] text-slate-500">{current?.action ?? "delete"} · {current?.exemptionRole ?? "vip"}</p></div><Switch checked={checked} disabled={setLock.isPending} onCheckedChange={enabled => setLock.mutate({ groupId, lockType, enabled, action: current?.action ?? "delete", exemptionRole: current?.exemptionRole ?? "vip" })} /></div>; })}</CardContent></Card><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{legacyCopy.recentActions}</CardTitle></CardHeader><CardContent className="space-y-2">{detail.data.actions.length ? detail.data.actions.map(action => <div key={action.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-white/[.02] px-3 py-2.5"><div><p className="text-sm font-bold text-slate-200">{action.action} <span className="font-normal text-slate-500">→ {action.targetTelegramId ?? "—"}</span></p><p className="mt-1 truncate text-[11px] text-slate-500">{action.reason || action.commandAlias || action.source}</p></div><p className="shrink-0 text-[10px] text-slate-600">{persianDate(action.createdAt)}</p></div>) : <Empty text={legacyCopy.noActions} />}</CardContent></Card></div> : <Card className="kronos-card grid min-h-64 place-items-center"><Empty text={legacyCopy.selectGroupModeration} /></Card>}</div></section>;
}

function LegacyModerationWorkspace() {
  const locale = activeDashboardLocale();
  const moderationCopy = dashboardModerationCopy[locale];
  const legacyCopy = dashboardLegacyCopy[locale];
  const { data: groups } = trpc.dashboard.groups.list.useQuery();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [warningRemovalAmount, setWarningRemovalAmount] = useState("1");
  const [pendingLockValues, setPendingLockValues] = useState<Record<string, boolean>>({});
  useDashboardReset(() => setGroupId(null));
  const detail = trpc.dashboard.groups.detail.useQuery({ groupId: groupId ?? 0 }, { enabled: Boolean(groupId) });
  const removeWarnings = trpc.dashboard.moderation.removeWarnings.useMutation({
    onSuccess: result => { toast.success(`${result.removed} ${moderationCopy.warningsCleared} (${result.remaining})`); void detail.refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const setLock = trpc.dashboard.moderation.setLock.useMutation({
    onMutate: variables => setPendingLockValues(current => ({ ...current, [variables.lockType]: variables.enabled })),
    onSuccess: async result => { await detail.refetch(); toast.success(result.announced ? moderationCopy.lockAnnounced : moderationCopy.lockSaved); },
    onError: error => toast.error(dashboardErrorMessage(error)),
    onSettled: (_result, _error, variables) => setPendingLockValues(current => { const next = { ...current }; delete next[variables.lockType]; return next; }),
  });
  const selected = groups?.find(group => group.id === groupId);
  const lockTypes = ["link", "photo", "video", "voice", "audio", "sticker", "gif", "document", "forward", "mention", "hashtag", "emoji", "phone", "location", "poll", "game", "bot", "command", "english", "persian", "edited_message", "long_message", "text", "reply", "inline_button", "profanity", "all"] as const;
  const lockLabels = Object.fromEntries(lockTypes.map(lockType => [lockType, lockType])) as Record<(typeof lockTypes)[number], string>;
  const requestedRemoval = Math.max(1, Math.min(100, Number(warningRemovalAmount) || 1));
  // @ts-expect-error detail.data is narrowed by the conditional branch below; callback closures lose that narrowing.
  return <section className="space-y-5"><SectionHeading {...dashboardPanelMessages(normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale")), "moderation")} /><div className="grid gap-4 xl:grid-cols-[.78fr_1.22fr]"><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{moderationCopy.selectGroup}</CardTitle><CardDescription>{moderationCopy.chooseGroup}</CardDescription></CardHeader><CardContent className="space-y-1">{groups?.length ? groups.map(group => <button key={group.id} onClick={() => setGroupId(group.id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-right transition-colors ${groupId === group.id ? "bg-cyan-300/15 text-cyan-50" : "hover:bg-white/[.04]"}`}><span className="text-sm font-bold">{group.title}</span><ChevronLeft className="h-4 w-4 text-slate-500" /></button>) : <Empty text={moderationCopy.noGroups} />}</CardContent></Card>{!groupId || !detail.data ? <Card className="kronos-card grid min-h-64 place-items-center"><Empty text={moderationCopy.chooseGroup} /></Card> : <div className="space-y-4"><Card className="kronos-card"><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><div><CardTitle className="text-base">{moderationCopy.warningsTitle} {selected?.title}</CardTitle><CardDescription>{moderationCopy.warningDescription}</CardDescription></div><div className="flex items-center gap-2 rounded-xl border border-amber-300/15 bg-amber-300/[.06] px-2 py-1"><span className="text-[11px] text-amber-100">{moderationCopy.removalCount}</span><Input aria-label={moderationCopy.removeWarnings} inputMode="numeric" className="h-8 w-16 border-0 bg-transparent px-1 text-center" value={warningRemovalAmount} onChange={event => setWarningRemovalAmount(event.target.value.replace(/\D/g, "").slice(0, 3))} /></div></div></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{detail.data.warnings.length ? detail.data.warnings.map(warning => <article key={warning.id} className="rounded-2xl border border-amber-300/15 bg-gradient-to-br from-amber-300/[.08] to-transparent p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black text-amber-100">{legacyCopy.userId} {warning.telegramUserId}</p><p className="mt-1 text-xs text-slate-400">{warning.count} {legacyCopy.activeWarnings} · {warning.lastReason || legacyCopy.noReason}</p></div><Badge className="border-amber-200/20 bg-amber-300/10 text-amber-100">{warning.count}</Badge></div><Button size="sm" variant="ghost" className="mt-3 h-8 px-2 text-cyan-200 hover:bg-cyan-300/10" disabled={removeWarnings.isPending || warning.count === 0} onClick={() => removeWarnings.mutate({ groupId, targetTelegramId: warning.telegramUserId, count: requestedRemoval })}>{moderationCopy.removeWarnings} {requestedRemoval}</Button></article>) : <Empty text={moderationCopy.noWarnings} />}</CardContent></Card><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{moderationCopy.locksTitle}</CardTitle><CardDescription>{moderationCopy.locksDescription}</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{lockTypes.map(lockType => { const current = detail.data.locks.find(lock => lock.lockType === lockType); const hasPendingValue = Object.prototype.hasOwnProperty.call(pendingLockValues, lockType); const checked = hasPendingValue ? pendingLockValues[lockType] : current?.enabled ?? false; return <div key={lockType} className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[.025] px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-200">{lockLabels[lockType]}</p><p className="text-[10px] text-slate-500">{current?.action ?? "delete"} · {current?.exemptionRole ?? "vip"}</p></div><Switch checked={checked} disabled={setLock.isPending} onCheckedChange={enabled => setLock.mutate({ groupId, lockType, enabled, action: current?.action ?? "delete", exemptionRole: current?.exemptionRole ?? "vip" })} /></div>; })}</CardContent></Card><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{moderationCopy.recentActions}</CardTitle></CardHeader><CardContent className="space-y-2">{detail.data.actions.length ? detail.data.actions.map(action => <div key={action.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/7 bg-white/[.02] px-3 py-2.5"><div><p className="text-sm font-bold text-slate-200">{action.action} <span className="font-normal text-slate-500">→ {action.targetTelegramId ?? "—"}</span></p><p className="mt-1 truncate text-[11px] text-slate-500">{action.reason || action.commandAlias || action.source}</p></div><p className="shrink-0 text-[10px] text-slate-600">{persianDate(action.createdAt)}</p></div>) : <Empty text={moderationCopy.noActions} />}</CardContent></Card></div>}</div></section>;
}

function LockPolicyProfiles() {
  const locale = activeDashboardLocale();
  const copy = dashboardOperationsCopy[locale].policies;
  const { data: groups } = trpc.dashboard.groups.list.useQuery();
  const [groupId, setGroupId] = useState<number | null>(null);
  const [pendingPolicy, setPendingPolicy] = useState<LockPolicyKey | null>(null);
  const policyStatus = trpc.dashboard.moderation.lockPolicyStatus.useQuery({ groupId: groupId ?? 0 }, { enabled: Boolean(groupId) });
  const applyPolicy = trpc.dashboard.moderation.applyLockPolicy.useMutation({ onSuccess: result => { toast.success(`${copy.applied} · ${result.activeLockCount} ${copy.activeLocks}`); setPendingPolicy(null); void policyStatus.refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const restorePolicy = trpc.dashboard.moderation.restoreLockPolicy.useMutation({ onSuccess: () => { toast.success(copy.restored); void policyStatus.refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const profiles: Array<{ key: LockPolicyKey; title: string; text: string }> = [{ key: "open", title: copy.open, text: copy.openText }, { key: "media_shield", title: copy.mediaShield, text: copy.mediaShieldText }, { key: "strict_guard", title: copy.strictGuard, text: copy.strictGuardText }];
  return <Card className="kronos-card border-violet-300/20 bg-gradient-to-br from-violet-300/[.08] via-slate-950 to-cyan-300/[.04]"><CardHeader><p className="text-[10px] font-black tracking-[.18em] text-violet-100">{copy.eyebrow}</p><CardTitle className="mt-1 text-base">{copy.title}</CardTitle><CardDescription>{copy.text}</CardDescription></CardHeader><CardContent className="space-y-3"><Field label={dashboardOperationsCopy[locale].staff.group}><select className="kronos-input" value={groupId ?? ""} onChange={event => { setGroupId(event.target.value ? Number(event.target.value) : null); setPendingPolicy(null); }}><option value="">{dashboardOperationsCopy[locale].staff.group}</option>{groups?.filter(group => ["owner", "global_admin", "group_owner", "group_admin"].includes(group.access)).map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select></Field>{groupId ? <><div className="grid gap-2 md:grid-cols-3">{profiles.map(profile => <article key={profile.key} className="rounded-2xl border border-white/10 bg-white/[.025] p-3"><p className="text-sm font-black text-white">{profile.title}</p><p className="mt-1 min-h-10 text-xs leading-5 text-slate-400">{profile.text}</p><Button type="button" size="sm" variant="outline" className="mt-3 border-violet-300/25 text-violet-100 hover:bg-violet-300/10" onClick={() => setPendingPolicy(profile.key)}>{copy.apply}</Button></article>)}</div>{pendingPolicy ? <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[.07] p-3"><p className="text-xs font-black text-amber-100">{copy.review}</p><p className="mt-1 text-xs leading-6 text-slate-300">{profiles.find(profile => profile.key === pendingPolicy)?.title}</p><div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" className="bg-emerald-300 text-slate-950 hover:bg-emerald-200" disabled={applyPolicy.isPending} onClick={() => applyPolicy.mutate({ groupId, profileKey: pendingPolicy })}>{applyPolicy.isPending ? <Loader2 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />} {copy.confirmApply}</Button><Button type="button" size="sm" variant="outline" onClick={() => setPendingPolicy(null)}>{copy.cancel}</Button></div></div> : null}<div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.045] p-3"><p className="text-xs font-black text-cyan-100">{copy.snapshot}</p><p className="mt-1 text-xs leading-5 text-slate-400">{policyStatus.data?.canRestore ? `${copy.restoreText} · ${policyStatus.data.profileKey}` : copy.noRollback}</p><Button type="button" size="sm" variant="outline" className="mt-3 border-cyan-300/25 text-cyan-100 hover:bg-cyan-300/10" disabled={!policyStatus.data?.canRestore || restorePolicy.isPending} onClick={() => restorePolicy.mutate({ groupId })}>{restorePolicy.isPending ? <Loader2 className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />} {copy.restore}</Button></div></> : <p className="rounded-xl border border-white/8 p-3 text-xs text-slate-500">{dashboardModerationCopy[locale].chooseGroup}</p>}</CardContent></Card>;
}

export function ModerationWorkspace() {
  return <div className="space-y-5"><LockPolicyProfiles /><LegacyModerationWorkspace /></div>;
}

export function ForcedJoin({ isOwner }: { isOwner: boolean }) {
  const locale = activeDashboardLocale();
  const forcedCopy = dashboardForcedCopy[locale];
  const legacyCopy = dashboardLegacyCopy[locale];
  const { data, isLoading, refetch } = trpc.dashboard.forcedJoin.list.useQuery();
  const analytics = trpc.dashboard.forcedJoin.analytics.useQuery();
  const { data: groups } = trpc.dashboard.groups.list.useQuery();
  const create = trpc.dashboard.forcedJoin.upsert.useMutation({ onSuccess: () => { toast.success(forcedCopy.add); void refetch(); void analytics.refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const remove = trpc.dashboard.forcedJoin.remove.useMutation({ onSuccess: () => { toast.success(forcedCopy.deleteConfirm.replace("{title}", "")); void refetch(); void analytics.refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const [form, setForm] = useState({ destinationReference: "", title: "", username: "", inviteUrl: "", scope: "global" as "global" | "group" | "marketplace", groupId: "", expiresAt: "" });
  const clearForcedJoinDraft = () => setForm({ destinationReference: "", title: "", username: "", inviteUrl: "", scope: "global", groupId: "", expiresAt: "" });
  useDashboardReset(clearForcedJoinDraft);
  if (isLoading) return <PanelLoading />;
  return <section className="space-y-5"><SectionHeading {...dashboardPanelMessages(normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale")), "forced")} /><div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]"><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{forcedCopy.add}</CardTitle><CardDescription>{forcedCopy.botAdmin}</CardDescription></CardHeader><CardContent><form className="space-y-3" onSubmit={(event: FormEvent) => { event.preventDefault(); const destinationReference = form.destinationReference.trim(); const scope = isOwner ? form.scope : "group"; const groupId = scope === "group" ? Number(form.groupId) : null; if (destinationReference.length < 3) return toast.error("لینک عمومی t.me، یوزرنیم @ یا شناسهٔ عددی ‎-100…‎ را وارد کنید."); if (scope === "group" && !Number.isSafeInteger(groupId)) return toast.error(forcedCopy.chooseGroup); create.mutate({ destinationReference, title: form.title || null, username: form.username || null, inviteUrl: form.inviteUrl || null, scope, groupId, status: "active", expiresAt: form.expiresAt ? new Date(form.expiresAt) : null }); }}><Field label="مقصد کانال یا گروه"><Input required value={form.destinationReference} onChange={event => setForm({ ...form, destinationReference: event.target.value })} placeholder="https://t.me/channel، @channel یا -100…" autoComplete="off" /><p className="mt-1 text-[11px] leading-5 text-slate-500">ربات شناسهٔ عددی و نام مقصد را خودکار از لینک عمومی یا یوزرنیم استخراج می‌کند. برای مقصد خصوصی، شناسهٔ ‎-100…‎ و لینک دعوت را وارد کنید.</p></Field><Field label={`${forcedCopy.channelTitle} (اختیاری)`}><Input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} placeholder="در صورت خوانده‌نشدن نام از Telegram" /></Field><Field label={forcedCopy.username}><Input value={form.username} onChange={event => setForm({ ...form, username: event.target.value })} placeholder="KronosChannel" /></Field><Field label={forcedCopy.invite}><Input value={form.inviteUrl} onChange={event => setForm({ ...form, inviteUrl: event.target.value })} placeholder="https://t.me/+…" /></Field><Field label={forcedCopy.scope}><select className="kronos-input" value={isOwner ? form.scope : "group"} disabled={!isOwner} onChange={event => setForm({ ...form, scope: event.target.value as typeof form.scope })}>{isOwner && <><option value="global">{legacyCopy.scopeGlobal}</option><option value="marketplace">{legacyCopy.scopeMarketplace}</option></>}<option value="group">{legacyCopy.scopeGroup}</option></select></Field>{(form.scope === "group" || !isOwner) && <Field label={forcedCopy.group}><select required className="kronos-input" value={form.groupId} onChange={event => setForm({ ...form, groupId: event.target.value })}><option value="">{forcedCopy.chooseGroup}</option>{groups?.filter(group => isOwner || ["global_admin", "group_owner", "group_admin"].includes(group.access)).map(group => <option key={group.id} value={group.id}>{group.title}</option>)}</select></Field>}<Field label={forcedCopy.expiry}><Input type="datetime-local" value={form.expiresAt} onChange={event => setForm({ ...form, expiresAt: event.target.value })} /></Field><Button type="submit" className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={create.isPending}>{forcedCopy.submit}</Button></form></CardContent></Card><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{forcedCopy.archive}</CardTitle></CardHeader><CardContent className="space-y-2">{data?.length ? data.map(channel => <div key={channel.id} className="rounded-xl border border-white/8 bg-white/[0.025] p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-bold text-white">{channel.title}</p><p className="mt-1 text-xs text-slate-400">{channel.username ? `@${channel.username}` : channel.channelChatId}</p></div><div className="flex items-center gap-2"><StatusBadge status={channel.status} /><Button type="button" size="icon" variant="ghost" aria-label={`${legacyCopy.action}: ${channel.title}`} className="h-8 w-8 text-rose-200 hover:bg-rose-400/10 hover:text-rose-100" disabled={remove.isPending} onClick={() => { if (window.confirm(`${legacyCopy.reject}: ${channel.title}?`)) remove.mutate({ id: channel.id }); }}><Trash2 className="h-4 w-4" /></Button></div></div><p className="mt-2 text-[11px] text-slate-500">{legacyCopy.scopeGroup}: {channel.scope} · {legacyCopy.expires}: {persianDate(channel.expiresAt ?? undefined)}</p></div>) : <Empty text={forcedCopy.noChannels} />}</CardContent></Card></div><Card className="kronos-card overflow-hidden"><CardHeader className="border-b border-white/7 bg-white/[.018]"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">{forcedCopy.stats}</CardTitle><CardDescription className="mt-1">{forcedCopy.statsHelp}</CardDescription></div><span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-[10px] font-bold text-cyan-100">{forcedCopy.scope}</span></div></CardHeader><CardContent className="p-4">{analytics.isLoading ? <PanelLoading /> : analytics.data?.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{analytics.data.map(item => <article key={item.channelId} className="rounded-2xl border border-white/8 bg-gradient-to-br from-white/[.045] to-cyan-300/[.025] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-black text-white">{item.title}</p><p className="mt-1 text-[11px] text-slate-500">{item.buttonLabel} · {item.scope === "global" ? legacyCopy.scopeGlobal : item.scope === "marketplace" ? legacyCopy.scopeMarketplace : legacyCopy.scopeGroup}</p></div><StatusBadge status={item.status} /></div><div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold tracking-wide text-slate-500">{legacyCopy.verifiedAcquisitions}</p><p className="mt-1 text-3xl font-black tracking-tight text-cyan-200">{item.verifiedAcquisitions.toLocaleString(dashboardLocaleTag())}</p></div><div className="text-left text-[10px] leading-5 text-slate-500"><p>{legacyCopy.lastVerified}: {persianDate(item.lastVerifiedAt)}</p><p>{legacyCopy.expires}: {persianDate(item.expiresAt)}</p></div></div></article>)}</div> : <Empty text={legacyCopy.noVerified} />}</CardContent></Card></section>;
}

function CustomStarsInvoicePanel({ isOwner }: { isOwner: boolean }) {
  const locale = activeDashboardLocale();
  const copy = dashboardCustomInvoiceCopy[locale];
  const actions = dashboardCustomInvoiceActions[locale];
  const [form, setForm] = useState({ channelReference: "", channelChatId: "", destinationMode: "public" as "public" | "private", targetReference: "", targetTelegramId: "", amountStars: "", days: "30", expiresInHours: "24" });
  const trpcUtils = trpc.useUtils();
  const [resolvingChannel, setResolvingChannel] = useState(false);
  const [resolvingTarget, setResolvingTarget] = useState(false);
  const resolveChannel = async () => {
    const reference = form.channelReference.trim();
    if (!isInvoiceReferenceReady(reference, 3)) return toast.error(actions.resolveFailed);
    setResolvingChannel(true);
    try {
      const result = await trpcUtils.dashboard.marketplace.resolveCustomInvoiceChannel.fetch({ reference, destinationMode: form.destinationMode });
      setForm(current => ({ ...current, channelChatId: String(result.channelChatId) }));
      toast.success(actions.resolved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : actions.resolveFailed);
    } finally {
      setResolvingChannel(false);
    }
  };
  const resolveTarget = async () => {
    const reference = form.targetReference.trim();
    if (!isInvoiceReferenceReady(reference, 2)) return toast.error(actions.resolveFailed);
    setResolvingTarget(true);
    try {
      const result = await trpcUtils.dashboard.marketplace.resolveCustomInvoiceTarget.fetch({ reference });
      setForm(current => ({ ...current, targetTelegramId: String(result.telegramUserId) }));
      toast.success(actions.resolved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : actions.resolveFailed);
    } finally {
      setResolvingTarget(false);
    }
  };
  const send = trpc.dashboard.marketplace.sendCustomInvoice.useMutation({
    onSuccess: result => { toast.success(`${copy.sent} ${copy.sentDetails.replace("{publicId}", result.publicId)}`); setForm(current => ({ ...current, targetReference: "", targetTelegramId: "", amountStars: "" })); },
    onError: error => toast.error(`${copy.sendFailed} ${error.message}`),
  });
  const clearCustomInvoiceDraft = () => setForm({ channelReference: "", channelChatId: "", destinationMode: "public", targetReference: "", targetTelegramId: "", amountStars: "", days: "30", expiresInHours: "24" });
  useDashboardReset(clearCustomInvoiceDraft);
  if (!isOwner) return null;
  return <section className="space-y-4"><Card className="kronos-card border-cyan-300/15 bg-gradient-to-br from-cyan-300/[.075] via-slate-950/20 to-transparent"><CardHeader><CardTitle className="text-base text-cyan-100">{copy.title}</CardTitle><CardDescription className="leading-6">{copy.description}</CardDescription></CardHeader><CardContent><form className="space-y-4" onSubmit={event => { event.preventDefault(); const channelChatId = Number(form.channelChatId); const targetReference = form.targetReference.trim(); const targetTelegramId = Number(form.targetTelegramId); const amountStars = Number(form.amountStars); const days = Number(form.days); const expiresInHours = Number(form.expiresInHours); const referenceError = invoiceReferenceError(targetReference, 2); const privateDestinationInvalid = form.destinationMode === "private" && !/^-100\d+$/.test(form.channelReference.trim()); if (privateDestinationInvalid || !Number.isSafeInteger(channelChatId) || !isInvoiceNumericId(form.targetTelegramId) || !Number.isInteger(targetTelegramId) || !Number.isInteger(amountStars) || amountStars < 1 || !Number.isInteger(days) || days < 1 || !Number.isInteger(expiresInHours) || expiresInHours < 1 || referenceError) return toast.error(referenceError ?? copy.invalid); send.mutate({ targetReference, targetTelegramId, channelChatId, destinationMode: form.destinationMode, amountStars, days, expiresInHours }); }}><div className="grid gap-3 lg:grid-cols-2"><Field label="نوع مقصد"><select className="kronos-input" value={form.destinationMode} onChange={event => setForm({ ...form, destinationMode: event.target.value as "public" | "private", channelReference: "", channelChatId: "" })}><option value="public">عمومی — لینک یا username</option><option value="private">خصوصی — فقط شناسهٔ -100...</option></select></Field><Field label={actions.channelReference}><div className="flex gap-2"><Input value={form.channelReference} onChange={event => setForm({ ...form, channelReference: event.target.value, channelChatId: "" })} placeholder={form.destinationMode === "private" ? "-1001234567890" : "https://t.me/channel یا @channel"} autoComplete="off" /><Button type="button" variant="outline" className="shrink-0 border-cyan-300/30 text-cyan-100" disabled={resolvingChannel || !isInvoiceReferenceReady(form.channelReference, 3)} onClick={resolveChannel}>{resolvingChannel ? <Loader2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} {actions.resolve}</Button></div></Field><Field label={actions.channelId}><Input required readOnly value={form.channelChatId} placeholder="-100…" /></Field><Field label={actions.targetReference}><div className="flex gap-2"><Input value={form.targetReference} onChange={event => setForm({ ...form, targetReference: event.target.value, targetTelegramId: "" })} placeholder="https://t.me/user یا @username" autoComplete="off" /><Button type="button" variant="outline" className="shrink-0 border-cyan-300/30 text-cyan-100" disabled={resolvingTarget || !isInvoiceReferenceReady(form.targetReference, 2)} onClick={resolveTarget}>{resolvingTarget ? <Loader2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />} {actions.resolve}</Button></div></Field><Field label={actions.targetId}><Input required readOnly value={form.targetTelegramId} placeholder="8375579910" /></Field><Field label={copy.amountStars}><Input required type="number" min="1" step="1" inputMode="numeric" value={form.amountStars} onChange={event => setForm({ ...form, amountStars: event.target.value })} /></Field><Field label={copy.durationDays}><Input required type="number" min="1" max="365" step="1" inputMode="numeric" value={form.days} onChange={event => setForm({ ...form, days: event.target.value })} /></Field><Field label={copy.expiryHours}><Input required type="number" min="1" max="168" step="1" inputMode="numeric" value={form.expiresInHours} onChange={event => setForm({ ...form, expiresInHours: event.target.value })} /></Field></div><div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.055] px-3 py-2.5 text-xs leading-6 text-cyan-100"><p>{copy.targetHint}</p><p className="mt-1 text-slate-400">{copy.paymentNotice}</p></div><Button type="submit" className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={send.isPending}>{send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CircleDollarSign className="h-4 w-4" />} {copy.send}</Button></form></CardContent></Card></section>;
}

function OwnerPayments() {
  const locale = activeDashboardLocale();
  const legacyCopy = dashboardLegacyCopy[locale];
  const { data, isLoading, refetch } = trpc.dashboard.marketplace.payments.useQuery();
  const review = trpc.dashboard.marketplace.review.useMutation({ onSuccess: () => { toast.success(legacyCopy.orderStatusUpdated); refetch(); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const [receipt, setReceipt] = useState<number | null>(null);
  const link = trpc.dashboard.marketplace.receiptUrl.useQuery({ receiptId: receipt ?? 0 }, { enabled: Boolean(receipt), retry: false });
  useEffect(() => { if (link.data?.url) { window.open(link.data.url, "_blank", "noopener,noreferrer"); setReceipt(null); } }, [link.data]);
  if (isLoading) return <PanelLoading />;
  return <section className="space-y-5"><SectionHeading eyebrow="PAYMENT CONTROL" title={dashboardMarketplaceCopy[activeDashboardLocale()].title} text={dashboardMarketplaceCopy[activeDashboardLocale()].description} /><Card className="kronos-card overflow-hidden"><CardContent className="p-0"><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-right text-sm"><thead className="bg-white/[0.04] text-xs text-slate-400"><tr><th className="px-4 py-3">{legacyCopy.order}</th><th className="px-4 py-3">{legacyCopy.method}</th><th className="px-4 py-3">{legacyCopy.channel}</th><th className="px-4 py-3">{legacyCopy.status}</th><th className="px-4 py-3">{legacyCopy.created}</th><th className="px-4 py-3">{legacyCopy.action}</th></tr></thead><tbody>{data?.length ? data.map(order => <tr key={order.id} className="border-t border-white/7"><td className="px-4 py-3 font-mono text-xs text-cyan-200">{order.publicId}</td><td className="px-4 py-3 text-slate-200">{order.method}</td><td className="px-4 py-3 text-slate-400">{order.listing?.channelChatId ?? "—"}</td><td className="px-4 py-3"><StatusBadge status={order.status} /></td><td className="px-4 py-3 text-xs text-slate-500">{persianDate(order.createdAt)}</td><td className="px-4 py-3"><div className="flex items-center gap-2">{order.receipt && <Button size="icon" variant="ghost" className="h-8 w-8 text-cyan-200" title={legacyCopy.showReceipt} onClick={() => setReceipt(order.receipt!.id)}><Eye className="h-4 w-4" /></Button>}{order.status === "pending_approval" && <><Button size="sm" className="h-8 bg-emerald-400 text-emerald-950 hover:bg-emerald-300" onClick={() => review.mutate({ publicId: order.publicId, decision: "approve" })}><Check className="h-3.5 w-3.5" /> {legacyCopy.approve}</Button><Button size="sm" variant="ghost" className="h-8 text-rose-200 hover:bg-rose-400/10" onClick={() => review.mutate({ publicId: order.publicId, decision: "reject" })}>{legacyCopy.reject}</Button></>}</div></td></tr>) : <tr><td colSpan={6}><Empty text={legacyCopy.noOrders} /></td></tr>}</tbody></table></div></CardContent></Card></section>;
}

function StarsMarketplace() {
  const { data: pricing } = trpc.dashboard.marketplace.pricing.useQuery();
  const copy = dashboardStarsCopy[normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale"))];
  const orders = trpc.dashboard.marketplace.myOrders.useQuery();
  const [reference, setReference] = useState("");
  const [duration, setDuration] = useState(1);
  const [unit, setUnit] = useState<"day" | "week" | "month">("day");
  const [selected, setSelected] = useState<{ channelChatId: number; title: string; username: string | null } | null>(null);
  const [invoice, setInvoice] = useState<{ invoiceLink: string; publicId: string; amountStars: number } | null>(null);
  const safeReference = reference.trim().length >= 3 ? reference.trim() : "@__";
  const lookup = trpc.dashboard.marketplace.resolveChannel.useQuery({ reference: safeReference }, { enabled: false, retry: false });
  const createInvoice = trpc.dashboard.marketplace.createStarsInvoice.useMutation({ onSuccess: result => { setInvoice(result); void orders.refetch(); toast.success(copy.invoiceReady); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  useEffect(() => { if (lookup.data?.readyForPayment) { setSelected(lookup.data); setInvoice(null); toast.success(copy.verify); } }, [lookup.data]);
  const days = Math.max(1, duration) * (unit === "month" ? 30 : unit === "week" ? 7 : 1);
  const stars = days * (pricing?.starsPerDay ?? 10);
  return <section className="space-y-5"><SectionHeading eyebrow="STARS MARKETPLACE" title={copy.title} text={copy.description} /><div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]"><Card className="kronos-card"><CardContent className="space-y-5 p-5"><div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.06] p-4"><p className="text-sm font-black text-cyan-100">{copy.verifyStep}</p><p className="mt-1 text-xs leading-5 text-slate-400">{copy.verifyHelp}</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><Input value={reference} onChange={event => { setReference(event.target.value); setSelected(null); setInvoice(null); }} placeholder={dashboardChannelReferencePlaceholder[activeDashboardLocale()]} /><Button type="button" className="shrink-0 bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={lookup.isFetching || reference.trim().length < 3} onClick={() => { void lookup.refetch(); }}><RefreshCw className={`h-4 w-4 ${lookup.isFetching ? "animate-spin" : ""}`} /> {copy.verify}</Button></div>{lookup.error && <p className="mt-2 text-xs text-rose-200">{lookup.error.message}</p>}{selected && <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-300/20 bg-emerald-300/[.06] p-3"><div><p className="font-bold text-emerald-100">{selected.title}</p><p className="mt-1 font-mono text-[11px] text-emerald-200/70">{selected.channelChatId}</p></div><Check className="h-5 w-5 text-emerald-300" /></div>}</div><div><p className="text-sm font-black text-white">{copy.durationStep}</p><div className="mt-3 grid gap-3 sm:grid-cols-[1fr_150px]"><Field label={copy.amount}><Input inputMode="numeric" value={duration} onChange={event => setDuration(Math.max(1, Math.min(365, Number(event.target.value) || 1)))} /></Field><Field label={copy.unit}><select value={unit} onChange={event => setUnit(event.target.value as "day" | "week" | "month")} className="flex h-10 w-full rounded-md border border-white/10 bg-slate-950 px-3 text-sm text-white outline-none focus:border-cyan-300"><option value="day">{copy.day}</option><option value="week">{copy.week}</option><option value="month">{copy.month}</option></select></Field></div><p className="mt-2 text-xs text-slate-500">{copy.fullDay}</p></div><div className="rounded-2xl border border-amber-300/20 bg-amber-300/[.06] p-4"><p className="text-xs font-bold text-amber-100">{copy.calculate}</p><p className="mt-1 text-3xl font-black text-white">{stars.toLocaleString(dashboardLocaleTag())} <span className="text-base text-amber-200">Stars</span></p><p className="mt-1 text-xs text-slate-400">{days.toLocaleString(dashboardLocaleTag())} {copy.day} · {pricing?.starsPerDay ?? 10} Stars / {copy.day}</p><p className="mt-3 text-[11px] leading-5 text-slate-500">{copy.invoiceHelp}</p></div><Button type="button" className="w-full bg-amber-300 text-slate-950 hover:bg-amber-200" disabled={!selected || createInvoice.isPending} onClick={() => selected && createInvoice.mutate({ channelChatId: selected.channelChatId, days })}><CreditCard className="h-4 w-4" /> {createInvoice.isPending ? copy.invoiceReady : `${copy.pay} ${stars.toLocaleString(dashboardLocaleTag())} Stars`}</Button>{invoice && <div className="rounded-2xl border border-cyan-300/25 bg-cyan-300/[.06] p-4"><p className="font-bold text-cyan-100">{copy.invoiceReady.replace(".", ` ${invoice.publicId} `)}</p><p className="mt-1 text-xs text-slate-400">{copy.invoiceHelp}</p><a href={invoice.invoiceLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-black text-slate-950 transition hover:bg-cyan-200"><ExternalLink className="h-4 w-4" /> {copy.pay}</a></div>}</CardContent></Card><Card className="kronos-card"><CardHeader><CardTitle className="text-base text-white">{copy.myOrders}</CardTitle><CardDescription>{copy.ordersHelp}</CardDescription></CardHeader><CardContent className="space-y-3">{orders.isLoading ? <PanelLoading /> : orders.data?.length ? orders.data.map(order => <div key={order.id} className="rounded-xl border border-white/8 bg-white/[.025] p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-xs text-cyan-200">{order.publicId}</p><p className="mt-1 text-sm font-bold text-white">{order.listing?.channelChatId ?? copy.verify}</p></div><StatusBadge status={order.status} /></div><p className="mt-2 text-xs text-slate-500">{order.amountStars ? `${order.amountStars.toLocaleString(dashboardLocaleTag())} Stars` : order.method} · {persianDate(order.createdAt)}</p>{order.listing?.expiresAt && <p className="mt-1 text-xs text-amber-200">{copy.invoiceHelp}: {persianDate(order.listing.expiresAt)}</p>}</div>) : <Empty text={copy.noOrders} />}</CardContent></Card></div></section>;
}

function MarketplaceCapacityNotice() {
  const locale = activeDashboardLocale();
  const copy = dashboardCapacityCopy[locale];
  const pricing = trpc.dashboard.marketplace.pricing.useQuery();
  if (pricing.isLoading || !pricing.data) return null;
  const activeChannels = typeof pricing.data.activeChannels === "number" ? pricing.data.activeChannels : 0;
  const maxActiveChannels = typeof pricing.data.maxActiveChannels === "number" ? pricing.data.maxActiveChannels : 3;
  const availableSlots = typeof pricing.data.availableSlots === "number" ? pricing.data.availableSlots : Math.max(0, maxActiveChannels - activeChannels);
  const isFull = pricing.data.isFull === true || activeChannels >= maxActiveChannels;
  return <div className={`rounded-2xl border p-4 text-sm leading-6 ${isFull ? "border-rose-300/20 bg-rose-400/[.07] text-rose-100" : "border-cyan-300/15 bg-cyan-300/[.06] text-cyan-100"}`}>{isFull ? copy.full : `${copy.available}: ${activeChannels.toLocaleString(dashboardLocaleTag())} / ${maxActiveChannels.toLocaleString(dashboardLocaleTag())} ${copy.activeChannels}; ${availableSlots.toLocaleString(dashboardLocaleTag())} ${copy.slots}.`}</div>;
}
function OwnerPaymentCapacityNotice() {
  const locale = activeDashboardLocale();
  const copy = dashboardCapacityCopy[locale];
  const summary = trpc.dashboard.marketplace.paymentSummary.useQuery();
  if (summary.isLoading || !summary.data) return null;
  const data = summary.data;
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className={`rounded-2xl border p-4 ${data.isFull ? "border-rose-300/20 bg-rose-400/[.07]" : "border-cyan-300/15 bg-cyan-300/[.06]"}`}><p className="text-xs font-bold text-slate-400">{copy.capacity}</p><p className="mt-1 text-2xl font-black text-white">{data.activeChannels.toLocaleString(dashboardLocaleTag())} / {data.maxActiveChannels.toLocaleString(dashboardLocaleTag())}</p><p className="mt-1 text-xs text-slate-400">{data.isFull ? copy.full : copy.activeChannels}</p></div><div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/[.05] p-4"><p className="text-xs font-bold text-slate-400">{copy.slots}</p><p className="mt-1 text-2xl font-black text-emerald-200">{data.availableSlots.toLocaleString(dashboardLocaleTag())}</p><p className="mt-1 text-xs text-slate-400">{copy.ready}</p></div><div className="rounded-2xl border border-amber-300/15 bg-amber-300/[.05] p-4"><p className="text-xs font-bold text-slate-400">{copy.awaiting}</p><p className="mt-1 text-2xl font-black text-amber-100">{data.awaitingReview.toLocaleString(dashboardLocaleTag())}</p><p className="mt-1 text-xs text-slate-400">{copy.manualReceipts}</p></div><div className="rounded-2xl border border-indigo-300/15 bg-indigo-300/[.05] p-4"><p className="text-xs font-bold text-slate-400">{copy.expiring}</p><p className="mt-1 text-2xl font-black text-indigo-100">{data.expiringSoon.toLocaleString(dashboardLocaleTag())}</p><p className="mt-1 text-xs text-slate-400">{copy.next72}</p></div></div>;
}
export function Payments({ isOwner }: { isOwner: boolean }) { return <section className="space-y-5">{isOwner ? <OwnerPaymentCapacityNotice /> : <MarketplaceCapacityNotice />}{isOwner ? <OwnerPayments /> : <StarsMarketplace />}</section>; }

type StarsReferenceRateView = {
  starUsdReference: number;
  usdTomanReference: number;
  starTomanReference: number;
  updatedAt: string;
  isStale: boolean;
  source: "fragment";
  conversionSource: "nobitex" | "wallex";
};

function tomanReference(value: number) {
  return `${Math.round(value).toLocaleString("en-US")} تومان`;
}

function usdReference(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} USD`;
}

function starsReferenceTimestamp(value: string) {
  return new Intl.DateTimeFormat("fa-IR-u-nu-latn", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tehran" }).format(new Date(value));
}

function StarsReferenceRatePanel({ data, isLoading, error }: { data: StarsReferenceRateView | null | undefined; isLoading: boolean; error: unknown }) {
  const [starsInput, setStarsInput] = useState("100");
  const starsAmount = Math.min(1_000_000, Math.max(0, Math.floor(Number(starsInput) || 0)));
  const estimateUsd = data ? starsAmount * data.starUsdReference : 0;
  const estimateToman = data ? starsAmount * data.starTomanReference : 0;
  const conversionLabel = data?.conversionSource === "wallex" ? "Wallex" : "نوبیتکس";
  if (isLoading) return <Card className="kronos-card"><CardContent className="space-y-4 p-5"><Skeleton className="h-5 w-44" /><div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-24 rounded-2xl" /><Skeleton className="h-24 rounded-2xl" /></div><Skeleton className="h-60 rounded-2xl" /></CardContent></Card>;
  if (error || !data) return <Card className="kronos-card border-amber-300/20"><CardContent className="flex gap-3 p-5 text-right"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" /><div><p className="font-black text-amber-100">دادهٔ نرخ مرجع فعلاً در دسترس نیست</p><p className="mt-1 text-xs leading-5 text-slate-400">دریافت نرخ Stars از Fragment یا نرخ تبدیل تومان از نوبیتکس و Wallex ناموفق بود. تنظیمات Stars و پرداخت‌ها بدون تغییر فعال می‌مانند.</p></div></CardContent></Card>;
  return <Card className="kronos-card overflow-hidden"><CardHeader className="border-b border-white/7 bg-gradient-to-l from-cyan-300/[.07] to-transparent"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-cyan-100"><TrendingUp className="h-4 w-4" /><CardTitle className="text-base">نرخ واقعی مرجع Stars</CardTitle></div><CardDescription className="mt-1">قیمت جاری مرجع از Fragment با تبدیل مستقل دلار به تومان</CardDescription></div>{data.isStale && <Badge className="border-amber-300/25 bg-amber-300/10 text-amber-100">دادهٔ ذخیره‌شده</Badge>}</div></CardHeader><CardContent className="space-y-5 p-5"><div className="grid gap-3 sm:grid-cols-2"><article className="rounded-2xl border border-cyan-300/20 bg-cyan-300/[.06] p-4"><p className="text-xs font-bold text-cyan-100">1 Star به تومان</p><p className="mt-2 font-mono text-2xl font-black tracking-tight text-white" dir="ltr">≈ {tomanReference(data.starTomanReference)}</p><p className="mt-1 text-[11px] text-slate-400">نرخ Stars × تبدیل USD/IRR {conversionLabel}</p></article><article className="rounded-2xl border border-indigo-300/20 bg-indigo-300/[.06] p-4"><p className="text-xs font-bold text-indigo-100">1 Star به دلار آمریکا</p><p className="mt-2 font-mono text-2xl font-black tracking-tight text-white" dir="ltr">≈ {usdReference(data.starUsdReference)}</p><p className="mt-1 text-[11px] text-slate-400">قیمت مرجع Fragment، پرداخت USDT روی TON</p></article></div><section className="rounded-2xl border border-white/8 bg-slate-950/40 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-black text-white">ماشین‌حساب تبدیل Stars</p><p className="mt-1 text-[11px] leading-5 text-slate-400">تعداد Stars را وارد کنید تا برآورد هم‌زمان دلار و تومان نمایش داده شود.</p></div><Badge className="border-cyan-300/20 bg-cyan-300/10 text-cyan-100">نرخ مرجع</Badge></div><div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,.8fr)_1fr_1fr]"><Field label="تعداد Stars"><Input id="stars-reference-calculator" inputMode="numeric" min={0} max={1000000} value={starsInput} onChange={event => setStarsInput(event.target.value)} className="font-mono text-lg font-black" dir="ltr" aria-describedby="stars-reference-calculator-help" /></Field><article className="rounded-xl border border-indigo-300/15 bg-indigo-300/[.05] p-3"><p className="text-[11px] font-bold text-indigo-100">برآورد دلار آمریکا</p><p className="mt-1 font-mono text-lg font-black text-white" dir="ltr">{starsAmount ? usdReference(estimateUsd) : "—"}</p></article><article className="rounded-xl border border-cyan-300/15 bg-cyan-300/[.05] p-3"><p className="text-[11px] font-bold text-cyan-100">برآورد تومان ایران</p><p className="mt-1 font-mono text-lg font-black text-white" dir="ltr">{starsAmount ? tomanReference(estimateToman) : "—"}</p></article></div><p id="stars-reference-calculator-help" className="mt-3 text-[11px] text-slate-500">محاسبه برای {starsAmount.toLocaleString("en-US")} Star و نرخ فعلی انجام می‌شود.</p></section><div className="rounded-xl border border-amber-300/15 bg-amber-300/[.045] px-3 py-2.5 text-xs leading-5 text-amber-100">این قیمت، مرجع بازار است؛ نه نرخ قطعی پرداخت در Telegram. قیمت واقعی بسته به روش خرید، پلتفرم و منطقه می‌تواند تغییر کند. Fragment منبع قیمت Stars و {conversionLabel} فقط منبع تبدیل دلار به تومان است.</div><p className="text-[11px] text-slate-500">آخرین به‌روزرسانی: <span dir="ltr">{starsReferenceTimestamp(data.updatedAt)}</span>{data.isStale ? " · نمایش از حافظهٔ موقت تا اتصال دوباره به منبع" : ""}</p></CardContent></Card>;
}

function Settings() {
  const locale = activeDashboardLocale();
  const copy = dashboardMarketplaceCopy[locale];
  const { data, isLoading } = trpc.dashboard.marketplace.settings.useQuery();
  const starsRate = trpc.dashboard.marketplace.starsMarketRate.useQuery(undefined, { refetchInterval: 5 * 60 * 1_000, retry: false });
  const save = trpc.dashboard.marketplace.saveSettings.useMutation({ onSuccess: () => toast.success(copy.saved), onError: error => toast.error(dashboardErrorMessage(error)) });
  const [form, setForm] = useState({ starsPerDay: "10" });
  useEffect(() => { if (data) setForm({ starsPerDay: data.starsPerDay?.toString() ?? "10" }); }, [data]);
  if (isLoading) return <PanelLoading />;
  return <section className="space-y-5"><SectionHeading eyebrow="STARS SETTINGS" title={locale === "fa" ? "تنظیمات Stars" : "Stars settings"} text={locale === "fa" ? "در بازارچه، فقط نرخ پرداخت با Telegram Stars تنظیم می‌شود." : "Only Telegram Stars pricing is configured for the marketplace."} /><Card className="kronos-card"><CardContent className="p-5"><form className="space-y-5" onSubmit={event => { event.preventDefault(); save.mutate({ starsPerDay: Math.max(1, Math.min(100000, Number(form.starsPerDay) || 10)) }); }}><div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.06] p-4"><p className="text-xs font-bold text-cyan-200">{copy.fixedRate}</p><div className="mt-2 flex items-end gap-2"><Input className="max-w-32 text-2xl font-black" inputMode="numeric" min={1} max={100000} value={form.starsPerDay} onChange={event => setForm({ starsPerDay: event.target.value })} aria-label={copy.starsPerDay} /><span className="pb-2 text-sm font-medium text-slate-400">{copy.starsUnit} {copy.perDay}</span></div><p className="mt-2 text-xs text-slate-400">{copy.starsPerDayHelp}</p></div><Button type="submit" className="bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={save.isPending}><Save className="h-4 w-4" /> {copy.save}</Button></form></CardContent></Card><div aria-label="نرخ مرجع Stars"><StarsReferenceRatePanel data={starsRate.data} isLoading={starsRate.isLoading} error={starsRate.error} /></div></section>;
}

function ConnectedGroups() {
  const locale = activeDashboardLocale();
  const copy = dashboardConnectedGroupsCopy[locale];
  const groups = trpc.dashboard.groups.connected.useQuery();
  if (groups.isLoading) return <PanelLoading />;
  return <section className="space-y-5"><SectionHeading eyebrow={copy.eyebrow} title={copy.title} text={copy.text} /><Card className="kronos-card overflow-hidden"><CardHeader className="border-b border-white/7 bg-white/[.018]"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-base">{copy.title}</CardTitle><CardDescription>{groups.data?.length ? `${dashboardNumber(groups.data.length, locale)} ${copy.title}` : copy.empty}</CardDescription></div><Button type="button" variant="outline" className="border-cyan-300/30 text-cyan-100 hover:bg-cyan-300/10" disabled={groups.isFetching} onClick={() => void groups.refetch()}><RefreshCw className={`h-4 w-4 ${groups.isFetching ? "animate-spin" : ""}`} />{copy.refresh}</Button></div></CardHeader><CardContent className="space-y-3 p-4">{groups.error ? <div className="rounded-xl border border-rose-300/20 bg-rose-400/[.06] p-3 text-sm text-rose-100">{dashboardErrorMessage(groups.error)}</div> : groups.data?.length ? groups.data.map(group => { const username = group.username?.replace(/^@/, "") ?? null; const status = group.status === "active" ? copy.active : group.status === "paused" ? copy.paused : group.status === "permission_lost" ? copy.permissionLost : copy.removed; return <article key={group.id} className="rounded-2xl border border-white/8 bg-gradient-to-br from-white/[.045] to-cyan-300/[.02] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-base font-black text-white">{group.title || copy.unnamed}</p><p className="mt-1 font-mono text-xs text-cyan-200">{group.chatId}</p></div><Badge className={statusTone(group.status)}>{status}</Badge></div><div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-4"><div><p className="font-bold text-slate-500">{copy.id}</p><p className="mt-1 font-mono text-slate-200">{group.chatId}</p></div><div><p className="font-bold text-slate-500">{copy.username}</p>{username ? <a className="mt-1 inline-flex items-center gap-1 text-cyan-200 hover:text-cyan-100" href={`https://t.me/${username}`} target="_blank" rel="noreferrer">@{username}<ExternalLink className="h-3 w-3" /></a> : <p className="mt-1 text-slate-400">—</p>}</div><div><p className="font-bold text-slate-500">{copy.installed}</p><p className="mt-1 text-slate-300">{dashboardDate(group.installedAt, locale)}</p></div><div><p className="font-bold text-slate-500">{copy.activity}</p><p className="mt-1 text-slate-300">{dashboardDate(group.lastActivityAt, locale)}</p></div></div></article>; }) : <Empty text={copy.empty} />}</CardContent></Card></section>;
}

function ownerAlertDestination(alert: { relatedEntityType: string | null; relatedEntityId: number | null }) {
  if (alert.relatedEntityType === "telegram_group") return { tab: "groups" as const, label: "بررسی گروه" };
  if (alert.relatedEntityType === "forced_join_channel") return { tab: "forced" as const, label: "بررسی فاجوین" };
  if (alert.relatedEntityType === "payment_order") return { tab: "payments" as const, label: "بررسی پرداخت" };
  return null;
}

function ownerAlertStatusPresentation(status: "pending" | "sent" | "failed" | "acknowledged") {
  if (status === "acknowledged") return { label: "رسیدگی‌شده", tone: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100" };
  if (status === "failed") return { label: "ارسال ناموفق", tone: "border-rose-300/25 bg-rose-300/10 text-rose-100" };
  if (status === "pending") return { label: "در انتظار ارسال", tone: "border-amber-300/25 bg-amber-300/10 text-amber-100" };
  return { label: "نیازمند رسیدگی", tone: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100" };
}

function Alerts({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const locale = activeDashboardLocale();
  const panel = dashboardPanelMessages(locale, "alerts");
  const [filter, setFilter] = useState<"open" | "all" | "acknowledged">("open");
  const { data, isLoading, isError, isFetching, refetch } = trpc.dashboard.alerts.list.useQuery();
  const acknowledge = trpc.dashboard.alerts.acknowledge.useMutation({
    onSuccess: () => { toast.success("هشدار به‌عنوان رسیدگی‌شده ثبت شد."); void refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  const retryDelivery = trpc.dashboard.alerts.retryDelivery.useMutation({
    onSuccess: () => { toast.success("ارسال دوبارهٔ هشدار با موفقیت انجام شد."); void refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  if (isLoading) return <PanelLoading />;
  const alerts = data ?? [];
  const openCount = alerts.filter(alert => alert.status !== "acknowledged").length;
  const failedCount = alerts.filter(alert => alert.status === "failed").length;
  const visibleAlerts = alerts.filter(alert => filter === "all" || (filter === "open" ? alert.status !== "acknowledged" : alert.status === "acknowledged"));
  return <section className="space-y-5">
    <SectionHeading eyebrow={panel.eyebrow} title={panel.title} text="هشدارهای باز نیازمند تصمیم هستند؛ ارسال ناموفق را دوباره بفرستید و پس از رسیدگی، مورد را ببندید." />
    <Card className="kronos-card overflow-hidden border-amber-300/15 bg-gradient-to-br from-amber-300/[.06] via-slate-950 to-rose-400/[.035]">
      <CardHeader className="border-b border-white/8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="text-base">صف رسیدگی هشدارها</CardTitle><CardDescription className="mt-1">هر کارت وضعیت تحویل، تعداد تلاش و اقدام مرتبط را نشان می‌دهد.</CardDescription></div>
          <Button type="button" variant="outline" size="sm" className="border-cyan-300/25 text-cyan-100 hover:bg-cyan-300/10" disabled={isFetching} onClick={() => void refetch()}>{isFetching ? <Loader2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}تازه‌سازی</Button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3"><div className="rounded-xl border border-amber-300/20 bg-amber-300/[.06] px-3 py-2"><p className="text-[10px] font-bold text-amber-200">باز و نیازمند رسیدگی</p><p className="mt-1 text-xl font-black text-white">{dashboardNumber(openCount, locale)}</p></div><div className="rounded-xl border border-rose-300/20 bg-rose-300/[.06] px-3 py-2"><p className="text-[10px] font-bold text-rose-200">ارسال ناموفق</p><p className="mt-1 text-xl font-black text-white">{dashboardNumber(failedCount, locale)}</p></div><div className="rounded-xl border border-white/10 bg-white/[.035] px-3 py-2"><p className="text-[10px] font-bold text-slate-400">کل سابقه</p><p className="mt-1 text-xl font-black text-white">{dashboardNumber(alerts.length, locale)}</p></div></div>
      </CardHeader>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="فیلتر وضعیت هشدارها">{([ ["open", "باز"], ["all", "همه"], ["acknowledged", "رسیدگی‌شده"] ] as const).map(([value, label]) => <Button key={value} type="button" size="sm" variant={filter === value ? "default" : "outline"} className={filter === value ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200" : "border-white/10 text-slate-300 hover:bg-white/[.06]"} onClick={() => setFilter(value)} aria-pressed={filter === value}>{label}</Button>)}</div>
        {isError ? <div role="alert" className="rounded-xl border border-rose-300/20 bg-rose-300/[.06] p-3 text-sm text-rose-100">بارگذاری هشدارها ناموفق بود. با دکمهٔ «تازه‌سازی» دوباره تلاش کنید.</div> : visibleAlerts.length ? <div className="space-y-2">{visibleAlerts.map(alert => {
          const status = ownerAlertStatusPresentation(alert.status);
          const destination = ownerAlertDestination(alert);
          const canRetry = alert.status === "failed" || alert.status === "pending";
          return <Card className={`kronos-card border ${alert.severity === "critical" && alert.status !== "acknowledged" ? "border-rose-300/25 bg-rose-300/[.045]" : "border-white/8 bg-white/[.02]"}`} key={alert.id}><CardContent className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge status={alert.severity} /><Badge className={status.tone}>{status.label}</Badge><p className="font-black text-white">{alert.title}</p></div><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">{alert.body}</p><div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500"><span>شناسه: {dashboardNumber(alert.id, locale)}</span><span>تلاش ارسال: {dashboardNumber(alert.attempts, locale)}</span><span>{dashboardDate(alert.createdAt, locale)}</span></div></div><div className="flex flex-wrap items-center gap-2">{destination && <Button type="button" size="sm" variant="outline" className="border-cyan-300/25 text-cyan-100 hover:bg-cyan-300/10" onClick={() => onNavigate(destination.tab)}>{destination.label}<ChevronLeft className="h-4 w-4" /></Button>}{canRetry && <Button type="button" size="sm" variant="outline" className="border-amber-300/25 text-amber-100 hover:bg-amber-300/10" disabled={retryDelivery.isPending} onClick={() => retryDelivery.mutate({ alertId: alert.id })}>{retryDelivery.isPending ? <Loader2 className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}ارسال دوباره</Button>}{alert.status !== "acknowledged" && <Button type="button" size="sm" className="bg-emerald-300 text-slate-950 hover:bg-emerald-200" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate({ alertId: alert.id })}>{acknowledge.isPending ? <Loader2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}ثبت رسیدگی</Button>}</div></div></CardContent></Card>;
        })}</div> : <Empty text={filter === "open" ? "هشدار باز و نیازمند رسیدگی وجود ندارد." : dashboardOperationalCopy[locale].alertsEmpty} />}
      </CardContent>
    </Card>
  </section>;
}

function AboutUs() { return <section className="space-y-6"><div className="relative overflow-hidden rounded-[2rem] border border-cyan-300/20 bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,.22),transparent_38%),linear-gradient(135deg,#0b172a,#101827)] p-7 shadow-2xl shadow-cyan-950/30 sm:p-10"><div className="absolute -left-16 -top-16 h-48 w-48 rounded-full bg-cyan-300/10 blur-3xl" /><p className="text-xs font-black tracking-[.24em] text-cyan-200">KRONOS GUARD / ABOUT</p><h1 className="mt-4 max-w-3xl text-3xl font-black leading-tight text-white sm:text-5xl">مدیریت گروه؛ وقتی حرفه‌ای می‌شود که ساده، شفاف و قابل اعتماد باشد.</h1><p className="mt-5 max-w-3xl text-sm leading-8 text-slate-300 sm:text-base">Kronos Guard حاصل تلاش یک تیم کوچک و مستقل در شمال ایران است؛ تیمی که می‌خواهد کار روزمرهٔ مدیران گروه را برای هم‌وطنانمان آسان‌تر، سریع‌تر و امن‌تر کند. ما ابزارهای کنترل محتوا، مدیریت اعضا، نقش‌ها، عضویت اجباری و پشتیبانی را در یک تجربهٔ منسجم گرد هم آورده‌ایم.</p><div className="mt-7 grid gap-3 sm:grid-cols-3">{[["امنیت با کنترل انسانی","هیچ تصمیم مهمی بدون مسیر روشن و قابل پیگیری انجام نمی‌شود."],["طراحی برای مدیر واقعی","از فرمان دقیق تا داشبورد، هر بخش برای استفادهٔ روزمره ساخته شده است."],["رشد با بازخورد شما","هر پیشنهاد خوب، بخشی از مسیر بهتر شدن Kronos Guard است."]].map(([title,text]) => <div key={title} className="rounded-2xl border border-white/10 bg-white/[.045] p-4"><p className="font-black text-cyan-100">{title}</p><p className="mt-2 text-xs leading-6 text-slate-400">{text}</p></div>)}</div></div><Card className="kronos-card"><CardHeader><CardTitle>چشم‌انداز Kronos Guard</CardTitle><CardDescription>ساختن یک لایهٔ قابل اعتماد برای ادارهٔ جوامع فارسی‌زبان و بین‌المللی در Telegram.</CardDescription></CardHeader><CardContent><p className="text-sm leading-8 text-slate-300">ما باور داریم ابزار مدیریتی خوب نباید پیچیده یا ترسناک باشد. باید دقیق باشد، قبل از اقدام هشدار بدهد، وضعیت را شفاف نشان دهد و به مدیر اجازه دهد با آرامش تصمیم بگیرد. Kronos Guard با همین نگاه توسعه پیدا می‌کند.</p></CardContent></Card></section>; }

function Audit() {
  const locale = activeDashboardLocale();
  const panel = dashboardPanelMessages(locale, "audit");
  const fa = locale === "fa";
  const policyOptions = [
    ["command.statistics", fa ? "فرمان آمار" : "Statistics command"],
    ["command.cleanup", fa ? "فرمان پاک‌سازی" : "Cleanup command"],
    ["command.locks", fa ? "فرمان قفل‌ها" : "Locks command"],
    ["command.group_info", fa ? "اطلاعات گروه" : "Group information"],
    ["command.group_link", fa ? "لینک گروه" : "Group link"],
    ["command.group_safety", fa ? "ایمنی گروه" : "Group safety"],
    ["command.moderation", fa ? "مدیریت کاربران" : "Moderation"],
  ] as const;
  const groupsQuery = trpc.dashboard.groups.list.useQuery();
  const groups = groupsQuery.data ?? [];
  const [groupId, setGroupId] = useState<number | null>(null);
  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState<"all" | "allowed" | "denied" | "completed" | "failed">("all");
  const [actorTelegramId, setActorTelegramId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [policyKey, setPolicyKey] = useState<(typeof policyOptions)[number][0]>("command.statistics");
  const [policyValue, setPolicyValue] = useState(true);
  const utils = trpc.useUtils();
  useEffect(() => {
    if (groupId === null && groups[0]?.id) setGroupId(groups[0].id);
  }, [groupId, groups]);
  const auditFilters = useMemo(() => {
    const normalizedActorId = actorTelegramId.trim();
    const hasValidActorId = /^\d+$/.test(normalizedActorId);
    return {
      groupId: groupId ?? 1,
      actorTelegramId: hasValidActorId ? Number(normalizedActorId) : undefined,
      action: action.trim() || undefined,
      outcome: outcome === "all" ? undefined : outcome,
      from: fromDate ? new Date(`${fromDate}T00:00:00.000Z`) : undefined,
      to: toDate ? new Date(`${toDate}T23:59:59.999Z`) : undefined,
      limit: 100,
    };
  }, [action, actorTelegramId, fromDate, groupId, outcome, toDate]);
  const auditQuery = trpc.dashboard.policyAudit.list.useQuery(
    auditFilters,
    { enabled: groupId !== null },
  );
  const policyPreview = trpc.dashboard.policyAudit.previewPolicy.useQuery(
    { groupId: groupId ?? 1, policyKey, value: policyValue },
    { enabled: groupId !== null },
  );
  const policyVersions = trpc.dashboard.policyAudit.listPolicyVersions.useQuery(
    { groupId: groupId ?? 1, policyKey, limit: 20 },
    { enabled: groupId !== null },
  );
  const refreshPolicyState = () => Promise.all([
    utils.dashboard.policyAudit.previewPolicy.invalidate(),
    utils.dashboard.policyAudit.listPolicyVersions.invalidate(),
    utils.dashboard.policyAudit.list.invalidate(),
  ]);
  const setPolicy = trpc.dashboard.policyAudit.setPolicy.useMutation({
    onSuccess: result => { toast.success(result.changed ? (fa ? "نسخهٔ جدید سیاست ثبت شد." : "A new policy version was saved.") : (fa ? "این سیاست پیش‌تر همین مقدار را دارد." : "This policy already has that value.")); void refreshPolicyState(); },
    onError: error => toast.error(dashboardErrorMessage(error, fa ? "ذخیرهٔ سیاست ناموفق بود." : "Policy could not be saved.", locale)),
  });
  const rollbackPolicy = trpc.dashboard.policyAudit.rollbackPolicy.useMutation({
    onSuccess: result => { toast.success(result.changed ? (fa ? "نسخهٔ انتخاب‌شده بازگردانی شد." : "The selected version was restored.") : (fa ? "نسخهٔ فعلی تغییری نداشت." : "The current version did not change.")); void refreshPolicyState(); },
    onError: error => toast.error(dashboardErrorMessage(error, fa ? "بازگردانی سیاست ناموفق بود." : "Policy rollback could not be completed.", locale)),
  });
  const items = auditQuery.data ?? [];
  return <section className="space-y-5">
    <SectionHeading eyebrow={panel.eyebrow} title={fa ? "مرکز حسابرسی و سیاست" : "Audit & policy center"} text={fa ? "تصمیم‌های مجوز، نتیجهٔ فرمان‌ها و تغییرات سیاست را به‌صورت قابل‌پیگیری ببینید." : "Search authorization decisions, command outcomes, and policy changes."} />
    <Card className="kronos-card"><CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-5">
      <label className="space-y-1.5 text-xs font-bold text-slate-400"><span>{fa ? "گروه" : "Group"}</span><select aria-label={fa ? "انتخاب گروه" : "Select group"} value={groupId ?? ""} onChange={event => setGroupId(Number(event.target.value) || null)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60"><option value="">{fa ? "انتخاب گروه" : "Select a group"}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.title ?? group.username ?? group.chatId}</option>)}</select></label>
      <label className="space-y-1.5 text-xs font-bold text-slate-400"><span>{fa ? "عملیات" : "Action"}</span><Input value={action} onChange={event => setAction(event.target.value)} placeholder={fa ? "مثلاً command.statistics" : "e.g. command.statistics"} /></label>
      <label className="space-y-1.5 text-xs font-bold text-slate-400"><span>{fa ? "نتیجه" : "Outcome"}</span><select aria-label={fa ? "فیلتر نتیجه" : "Filter outcome"} value={outcome} onChange={event => setOutcome(event.target.value as typeof outcome)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60"><option value="all">{fa ? "همه" : "All"}</option><option value="allowed">{fa ? "مجاز" : "Allowed"}</option><option value="denied">{fa ? "ردشده" : "Denied"}</option><option value="completed">{fa ? "تکمیل‌شده" : "Completed"}</option><option value="failed">{fa ? "ناموفق" : "Failed"}</option></select></label>
      <label className="space-y-1.5 text-xs font-bold text-slate-400"><span>{fa ? "شناسهٔ عامل" : "Actor ID"}</span><Input inputMode="numeric" dir="ltr" value={actorTelegramId} onChange={event => setActorTelegramId(event.target.value.replace(/[^0-9]/g, ""))} placeholder={fa ? "شناسهٔ عددی" : "Numeric ID"} /></label>
      <div className="grid grid-cols-2 gap-3 xl:col-span-1"><label className="space-y-1.5 text-xs font-bold text-slate-400"><span>{fa ? "از تاریخ" : "From"}</span><Input type="date" dir="ltr" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label><label className="space-y-1.5 text-xs font-bold text-slate-400"><span>{fa ? "تا تاریخ" : "To"}</span><Input type="date" dir="ltr" value={toDate} onChange={event => setToDate(event.target.value)} /></label></div>
    </CardContent></Card>
    <Card className="kronos-card"><CardContent className="divide-y divide-white/7 p-0">{auditQuery.isLoading ? <PanelLoading /> : items.length ? items.map(item => <div key={item.id} className="flex gap-3 p-4"><div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.outcome === "denied" || item.outcome === "failed" ? "bg-rose-400" : item.outcome === "allowed" ? "bg-emerald-300" : "bg-cyan-300"}`} /><div className="min-w-0"><p className="truncate text-sm font-bold text-white">{item.action}</p><p className="mt-1 text-xs text-slate-400">{item.outcome} <span className="text-slate-600">·</span> {fa ? "عامل" : "Actor"} {item.actorTelegramId ?? "—"}</p><p className="mt-1 text-xs text-slate-500">{dashboardDate(item.createdAt, locale)} · {dashboardOperationalCopy[locale].groupPrefix} {item.groupId}</p></div></div>) : <Empty text={fa ? "برای این فیلتر هنوز رویدادی ثبت نشده است." : "No audit events match these filters."} />}</CardContent></Card>
    <Card className="kronos-card overflow-hidden"><CardHeader className="border-b border-white/7 bg-cyan-300/[.025]"><CardTitle className="text-base">{fa ? "موتور سیاست نسخه‌دار" : "Versioned policy engine"}</CardTitle><CardDescription>{fa ? "پیش از ذخیره، اثر تغییر را ببینید؛ هر تغییر قابل‌پیگیری است و تنها به نسخه‌های همان گروه بازمی‌گردد." : "Preview changes before saving. Every change is traceable and can only restore a version from the same group."}</CardDescription></CardHeader><CardContent className="space-y-4 p-4"><div className="grid gap-3 md:grid-cols-[1fr_auto_auto]"><label className="space-y-1.5 text-xs font-bold text-slate-400"><span>{fa ? "سیاست" : "Policy"}</span><select aria-label={fa ? "انتخاب سیاست" : "Select policy"} value={policyKey} onChange={event => setPolicyKey(event.target.value as typeof policyKey)} className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300/60">{policyOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="flex items-end gap-2 pb-1"><Switch checked={policyValue} onCheckedChange={setPolicyValue} aria-label={fa ? "فعال‌بودن سیاست" : "Policy enabled"} /><span className="text-sm font-bold text-white">{policyValue ? (fa ? "فعال" : "Enabled") : (fa ? "غیرفعال" : "Disabled")}</span></div><Button type="button" disabled={setPolicy.isPending || !groupId || !policyPreview.data?.changed} onClick={() => groupId && setPolicy.mutate({ groupId, policyKey, value: policyValue })} className="self-end bg-cyan-300 text-slate-950 hover:bg-cyan-200"><Save className="h-4 w-4" />{setPolicy.isPending ? (fa ? "در حال ذخیره" : "Saving") : (fa ? "ثبت نسخه" : "Save version")}</Button></div><div className="rounded-2xl border border-white/8 bg-white/[.03] p-3 text-sm"><p className="font-bold text-cyan-100">{fa ? "پیش‌نمایش اثر" : "Impact preview"}</p>{policyPreview.isLoading ? <p className="mt-2 text-slate-400">{fa ? "در حال بررسی…" : "Checking…"}</p> : policyPreview.data ? <p className="mt-2 text-slate-300">{policyPreview.data.changed ? (fa ? `مقدار از «${String(policyPreview.data.currentValue ?? "پیش‌فرض") }» به «${String(policyPreview.data.nextValue)}» تغییر می‌کند.` : `Value will change from “${String(policyPreview.data.currentValue ?? "default")}” to “${String(policyPreview.data.nextValue)}”.`) : (fa ? "مقدار انتخاب‌شده با نسخهٔ فعلی یکسان است؛ نسخهٔ تکراری ساخته نمی‌شود." : "The selected value matches the current version; no duplicate version will be created.")}</p> : <p className="mt-2 text-slate-500">{fa ? "برای مشاهدهٔ پیش‌نمایش، یک گروه انتخاب کنید." : "Select a group to see the preview."}</p>}</div><div><div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-black text-white">{fa ? "تاریخچهٔ نسخه‌ها" : "Version history"}</p><Badge className="border-cyan-300/20 bg-cyan-300/[.08] text-cyan-100">{policyVersions.data?.length ?? 0}</Badge></div><div className="divide-y divide-white/7 overflow-hidden rounded-2xl border border-white/8 bg-white/[.02]">{policyVersions.isLoading ? <PanelLoading /> : policyVersions.data?.length ? policyVersions.data.map(version => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 p-3"><div><p className="text-sm font-bold text-white">{version.operation === "rollback" ? (fa ? "بازگردانی نسخه" : "Version rollback") : (fa ? "ثبت نسخه" : "Version saved")} <span className="font-mono text-cyan-200">#{version.id}</span></p><p className="mt-1 text-xs text-slate-400">{fa ? "مقدار" : "Value"}: {String(version.value)} <span className="text-slate-600">·</span> {dashboardDate(version.createdAt, locale)}</p></div><Button type="button" size="sm" variant="outline" className="border-amber-300/30 text-amber-100 hover:bg-amber-300/10" disabled={rollbackPolicy.isPending || !groupId || String(version.value) === String(policyPreview.data?.currentValue)} onClick={() => groupId && rollbackPolicy.mutate({ groupId, policyKey, versionId: version.id })}><RefreshCw className="h-3.5 w-3.5" />{fa ? "بازگردانی" : "Restore"}</Button></div>) : <Empty text={fa ? "برای این سیاست هنوز نسخه‌ای ثبت نشده است." : "No versions have been recorded for this policy."} />}</div></div></CardContent></Card>
  </section>;
}

function OwnerRuntimeLogTerminal() {
  const [paused, setPaused] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const logs = trpc.dashboard.runtimeLogs.useQuery({ limit: 220 }, { refetchInterval: paused ? false : 2_500, retry: false });
  const items = logs.data ?? [];
  useEffect(() => {
    if (!paused && terminalRef.current) terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
  }, [items, paused]);
  const lineFor = (item: (typeof items)[number]) => {
    const details = item.details && typeof item.details === "object" && !Array.isArray(item.details) ? item.details as Record<string, unknown> : {};
    const line = typeof details.line === "string" ? details.line : "[رویداد بدون متن]";
    return line;
  };
  return <section className="space-y-5">
    <SectionHeading eyebrow="KRONOS / RUNTIME LOG" title="لاگ زندهٔ ربات" text="فقط برای مالک اصلی. رخدادهای اجرایی ثبت‌شدهٔ سرور به‌صورت خودکار تازه می‌شوند؛ token، cookie، کلید و داده‌های حساس پیش از ذخیره ماسک می‌شوند." />
    <Card className="kronos-card overflow-hidden border-cyan-300/20 bg-[#050a14] shadow-2xl shadow-cyan-950/20">
      <CardHeader className="border-b border-cyan-300/15 bg-cyan-300/[.035]"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100"><Terminal className="h-5 w-5" /></div><div><CardTitle className="text-base text-cyan-50">Kronos Guard · runtime</CardTitle><CardDescription>{paused ? "نمایش متوقف شده است." : "تازه‌سازی خودکار هر ۲٫۵ ثانیه"}</CardDescription></div></div><div className="flex items-center gap-2"><Badge className={paused ? "border-amber-300/25 bg-amber-300/10 text-amber-100" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"}>{paused ? "متوقف" : "زنده"}</Badge><Button type="button" size="sm" variant="outline" className="border-cyan-300/25 text-cyan-100 hover:bg-cyan-300/10" onClick={() => setPaused(current => !current)}>{paused ? <Radio className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{paused ? "ادامه" : "مکث"}</Button><Button type="button" size="sm" variant="outline" className="border-white/15 text-slate-100 hover:bg-white/10" disabled={logs.isFetching} onClick={() => void logs.refetch()}><RefreshCw className={`h-3.5 w-3.5 ${logs.isFetching ? "animate-spin" : ""}`} />بازخوانی</Button></div></div></CardHeader>
      <CardContent className="p-0"><div ref={terminalRef} dir="ltr" className="max-h-[62vh] min-h-80 overflow-y-auto bg-[linear-gradient(180deg,rgba(4,11,22,.98),rgba(2,6,13,.98))] p-4 font-mono text-[11px] leading-6 sm:p-5 sm:text-xs">{logs.isLoading ? <p className="text-cyan-200">$ اتصال به جریان لاگ…</p> : logs.isError ? <p className="text-rose-200">$ دریافت لاگ ناموفق بود. برای بازخوانی دوباره تلاش کنید.</p> : items.length ? items.map(item => <div key={item.id} className={`grid grid-cols-[auto_auto_1fr] gap-x-3 border-b border-white/[.045] py-1.5 ${item.severity === "critical" ? "text-rose-200" : item.severity === "warning" ? "text-amber-100" : "text-cyan-50"}`}><span className="text-slate-500">{new Intl.DateTimeFormat("fa-IR", { timeStyle: "medium" }).format(new Date(item.createdAt))}</span><span className={item.severity === "critical" ? "text-rose-300" : item.severity === "warning" ? "text-amber-300" : "text-emerald-300"}>[{item.event.replace("console.", "").toUpperCase()}]</span><span className="min-w-0 break-words">{lineFor(item)}</span></div>) : <p className="text-slate-500">$ هنوز رویداد اجرایی قابل‌نمایشی ثبت نشده است.</p>}</div></CardContent>
    </Card>
  </section>;
}

function HelpGuide() {
  const locale = activeDashboardLocale();
  const copy = dashboardHelpCopy[locale];
  const commandGuide = dashboardCommandGuideCopy(locale);
  const operations = dashboardOperationsCopy[locale];
  const sections = [
    { title: copy.accessTitle, text: copy.access, icon: ShieldCheck, accent: "from-cyan-300/20 to-cyan-300/[.02] text-cyan-100" },
    { title: copy.groupsTitle, text: copy.groups, icon: UsersRound, accent: "from-indigo-300/20 to-indigo-300/[.02] text-indigo-100" },
    { title: copy.moderationTitle, text: copy.moderation, icon: Radio, accent: "from-emerald-300/20 to-emerald-300/[.02] text-emerald-100" },
    { title: copy.locksTitle, text: copy.locks, icon: LockKeyhole, accent: "from-amber-300/20 to-amber-300/[.02] text-amber-100" },
    { title: copy.forcedTitle, text: copy.forced, icon: Check, accent: "from-sky-300/20 to-sky-300/[.02] text-sky-100" },
    { title: copy.paymentsTitle, text: copy.payments, icon: CircleDollarSign, accent: "from-violet-300/20 to-violet-300/[.02] text-violet-100" },
    { title: copy.warningsTitle, text: copy.warnings, icon: BellRing, accent: "from-rose-300/20 to-rose-300/[.02] text-rose-100" },
    { title: copy.broadcastTitle, text: copy.broadcast, icon: Radio, accent: "from-cyan-300/20 to-cyan-300/[.02] text-cyan-100" },
    { title: copy.privacyTitle, text: copy.privacy, icon: Eye, accent: "from-slate-300/20 to-slate-300/[.02] text-slate-100" },
    { title: `${operations.staff.eyebrow} · ${operations.staff.title}`, text: `${operations.staff.text}\n\n1) ${operations.staff.group}\n2) ${operations.staff.memberId}\n3) ${operations.staff.role}\n4) ${operations.staff.review} → ${operations.staff.confirm}\n\n${operations.staff.access}`, icon: UsersRound, accent: "from-cyan-300/20 to-cyan-300/[.02] text-cyan-100" },
    { title: `${operations.policies.eyebrow} · ${operations.policies.title}`, text: `${operations.policies.text}\n\n• ${operations.policies.open}: ${operations.policies.openText}\n• ${operations.policies.mediaShield}: ${operations.policies.mediaShieldText}\n• ${operations.policies.strictGuard}: ${operations.policies.strictGuardText}\n\n${operations.policies.snapshot} → ${operations.policies.restore}: ${operations.policies.restoreText}`, icon: LockKeyhole, accent: "from-violet-300/20 to-violet-300/[.02] text-violet-100" },
  ];
  const commandAccents = ["border-cyan-300/20 bg-cyan-300/[.09] text-cyan-100", "border-emerald-300/20 bg-emerald-300/[.09] text-emerald-100", "border-violet-300/20 bg-violet-300/[.09] text-violet-100", "border-amber-300/20 bg-amber-300/[.09] text-amber-100", "border-sky-300/20 bg-sky-300/[.09] text-sky-100", "border-indigo-300/20 bg-indigo-300/[.09] text-indigo-100"] as const;
  return <section className="space-y-5">
    <Card className="kronos-card overflow-hidden">
      <CardContent className="relative p-5 sm:p-6">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
        <p className="text-[10px] font-black tracking-[.18em] text-cyan-200/80">KRONOS CONTROL CENTER</p>
        <CardTitle className="mt-2 text-base text-white">{commandGuide.title}</CardTitle>
        <p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-300">{commandGuide.text}</p>
      </CardContent>
    </Card>
    <div className="overflow-hidden rounded-3xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/[.11] via-[#0d1528]/90 to-indigo-400/[.11] p-5 sm:p-7">
      <SectionHeading eyebrow={copy.eyebrow} title={copy.title} text={copy.intro} />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">{sections.slice(0, 3).map((section, index) => <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-4" key={section.title}><p className="text-[10px] font-black tracking-[.18em] text-cyan-200/80">0{index + 1}</p><p className="mt-2 text-sm font-black text-white">{section.title}</p></div>)}</div>
    </div>
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1"><div><p className="kronos-eyebrow">COMMAND REFERENCE</p><h2 className="mt-1 text-xl font-black text-white">{commandGuide.title}</h2></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/[.07] px-3 py-1 text-xs font-bold text-cyan-100">{commandGuide.sections.length}</span></div>
      <div className="grid gap-4 lg:grid-cols-2">{commandGuide.sections.map((section, index) => { const accent = commandAccents[index % commandAccents.length]; return <Card className="kronos-card kronos-interactive group overflow-hidden" key={section.title}><CardContent className="p-5"><div className="flex items-start gap-3"><div className={`grid size-10 shrink-0 place-items-center rounded-xl border text-sm font-black ${accent}`}>{String(index + 1).padStart(2, "0")}</div><div className="min-w-0"><CardTitle className="text-base leading-6 text-white">{section.title}</CardTitle><p className="mt-3 whitespace-pre-line text-sm leading-7 text-slate-300">{section.text}</p></div></div></CardContent></Card>; })}</div>
    </div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sections.map((section, index) => { const Icon = section.icon; return <Card className="kronos-card kronos-interactive overflow-hidden" key={section.title}><CardContent className="p-5"><div className="flex items-start gap-4"><div className={`grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ${section.accent}`}><Icon className="size-5" /></div><div className="min-w-0"><div className="flex items-center justify-between gap-3"><CardTitle className="text-base text-white">{section.title}</CardTitle><span className="text-[10px] font-black text-slate-600">0{index + 1}</span></div><p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-300">{section.text}</p></div></div></CardContent></Card>; })}</div>
  </section>;
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) { return <header className="kronos-section-heading"><p className="kronos-eyebrow">{eyebrow}</p><h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{text}</p></header>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="kronos-field block space-y-1.5"><span className="text-xs font-bold text-slate-300">{label}</span>{children}</label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <Field label={label}><Input inputMode="numeric" value={value} onChange={event => onChange(Math.max(1, Number(event.target.value) || 1))} /></Field>; }
function Toggle({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (value: boolean) => void }) { return <div className="kronos-toggle flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3"><span className="text-sm font-bold text-slate-200">{label}</span><Switch checked={checked} onCheckedChange={onCheckedChange} /></div>; }
function Empty({ text }: { text: string }) { return <div className="kronos-empty-state p-7 text-center text-sm text-slate-500">{text}</div>; }
function PanelLoading() {
  const locale = activeDashboardLocale();
  const label = dashboardRuntimeCopyFor(locale).loadingData;
  return <div className="kronos-panel-loading" role="status" aria-live="polite"><div className="kronos-panel-loading__orb"><Loader2 className="h-8 w-8 text-cyan-200" /></div><p>{label}</p><span>{dashboardRuntimeCopyFor(locale).loadingWait}</span></div>;
}

function WarningPolicy() {
  const locale = activeDashboardLocale();
  const copy = dashboardCommonCopy[locale];
  const formCopy = dashboardWarningFormCopy[locale];
  const { data: groups, isLoading } = trpc.dashboard.groups.list.useQuery();
  const [groupId, setGroupId] = useState<number | null>(null);
  const detail = trpc.dashboard.groups.detail.useQuery({ groupId: groupId ?? 0 }, { enabled: Boolean(groupId) });
  const [warnLimit, setWarnLimit] = useState(3);
  const [warnAction, setWarnAction] = useState<"mute" | "ban">("mute");
  const [durationAmount, setDurationAmount] = useState(1);
  const [durationUnit, setDurationUnit] = useState<WarningMuteUnit>("permanent");
  const selected = groups?.find(group => group.id === groupId);
  const canManage = ["owner", "global_admin", "group_owner", "group_admin"].includes(selected?.access ?? "");
  const save = trpc.dashboard.groups.updateSettings.useMutation({
    onSuccess: () => { toast.success(copy.warningSave); void detail.refetch(); },
    onError: error => toast.error(dashboardErrorMessage(error)),
  });
  useEffect(() => {
    const settings = detail.data?.settings;
    if (!settings) return;
    setWarnLimit(settings.warnLimit);
    setWarnAction(settings.warnAction);
    const minutes = settings.warnMuteMinutes;
    if (minutes <= 0) { setDurationAmount(0); setDurationUnit("permanent"); }
    else if (minutes % 525_600 === 0) { setDurationAmount(minutes / 525_600); setDurationUnit("years"); }
    else if (minutes > 0 && minutes % 43_200 === 0) { setDurationAmount(minutes / 43_200); setDurationUnit("months"); }
    else if (minutes > 0 && minutes % 1_440 === 0) { setDurationAmount(minutes / 1_440); setDurationUnit("days"); }
    else { setDurationAmount(Math.max(1, Math.round(minutes / 60))); setDurationUnit("hours"); }
  }, [detail.data?.settings]);
  const muteMinutes = durationUnit === "permanent" ? 0 : Math.min(525_600, Math.max(1, Math.round(durationAmount) * warningMuteUnitMinutes[durationUnit]));
  if (isLoading) return <PanelLoading />;
  return <section className="space-y-5"><SectionHeading {...dashboardPanelMessages(normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale")), "warningPolicy")} /><div className="grid gap-4 xl:grid-cols-[.82fr_1.18fr]"><Card className="kronos-card"><CardHeader><CardTitle className="text-base">{formCopy.selectGroup}</CardTitle></CardHeader><CardContent className="space-y-1">{groups?.length ? groups.map(group => <button key={group.id} onClick={() => setGroupId(group.id)} className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-right ${groupId === group.id ? "bg-cyan-300/15" : "hover:bg-white/[.04]"}`}><span className="text-sm font-bold text-white">{group.title}</span><ChevronLeft className="h-4 w-4 text-slate-500" /></button>) : <Empty text={formCopy.groupsEmpty} />}</CardContent></Card>{groupId && detail.data ? <Card className="kronos-card"><CardHeader><CardTitle className="text-base">{formCopy.policyTitle} — {selected?.title}</CardTitle><CardDescription>{formCopy.policyDescription}</CardDescription></CardHeader><CardContent><form className="space-y-5" onSubmit={event => { event.preventDefault(); const current = detail.data!.settings; save.mutate({ groupId, welcomeEnabled: current?.welcomeEnabled ?? true, welcomeMessage: current?.welcomeMessage ?? null, goodbyeEnabled: current?.goodbyeEnabled ?? false, goodbyeMessage: current?.goodbyeMessage ?? null, antiSpamEnabled: current?.antiSpamEnabled ?? true, antiRaidEnabled: current?.antiRaidEnabled ?? true, floodMessageLimit: current?.floodMessageLimit ?? 7, floodWindowSeconds: current?.floodWindowSeconds ?? 12, duplicateMessageLimit: current?.duplicateMessageLimit ?? 3, warnLimit, warnAction, warnMuteMinutes: muteMinutes, rulesText: current?.rulesText ?? null }); }}><fieldset disabled={!canManage} className="space-y-5 disabled:opacity-55"><div className="grid gap-3 sm:grid-cols-2"><NumberField label={formCopy.warnLimit} value={warnLimit} onChange={setWarnLimit} /><Field label={formCopy.action}><select className="kronos-input" value={warnAction} onChange={event => setWarnAction(event.target.value as "mute" | "ban")}><option value="mute">{formCopy.mute}</option><option value="ban">{formCopy.ban}</option></select></Field></div>{warnAction === "mute" && <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.045] p-4"><p className="text-sm font-bold text-cyan-100">{copy.warningMuteDuration}</p><div className="mt-3 grid gap-3 sm:grid-cols-2"><NumberField label={formCopy.amount} value={durationAmount} onChange={setDurationAmount} /><Field label={formCopy.unit}><select className="kronos-input" value={durationUnit} onChange={event => setDurationUnit(event.target.value as WarningMuteUnit)}><option value="hours">{formCopy.hours}</option><option value="days">{formCopy.days}</option><option value="months">{formCopy.months}</option><option value="years">{formCopy.years}</option></select></Field></div><p className="mt-3 text-xs leading-6 text-slate-400">{formCopy.result} {warnLimit.toLocaleString(dashboardLocaleTag())} {formCopy.warningUnit} {muteMinutes.toLocaleString(dashboardLocaleTag())} {formCopy.minutes}</p></div>}<div className="rounded-xl border border-amber-300/15 bg-amber-300/[.055] p-3 text-xs leading-6 text-amber-100">{copy.warningManual}</div>{!canManage && <p className="text-xs text-amber-100">{copy.warningPermission}</p>}<Button type="submit" className="w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={save.isPending || !canManage}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {formCopy.save}</Button></fieldset></form></CardContent></Card> : <Card className="kronos-card grid min-h-64 place-items-center"><Empty text={copy.warningEmpty} /></Card>}</div></section>;
}

export default function OwnerDashboard() {
  const { theme, themeMode, toggleTheme, isTransitioning } = useTheme();
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [showIntro, setShowIntro] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");
  const [tabTransition, setTabTransition] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [locale, setLocale] = useState<DashboardLocale>(() => normalizeDashboardLocale(safeStorageGet("local", "kronos-dashboard-locale")));
  const saveLocale = trpc.dashboard.setLocale.useMutation({ onSuccess: result => { const next = normalizeDashboardLocale(result.locale); setLocale(next); safeStorageSet("local", "kronos-dashboard-locale", next); toast.success(dashboardMessages(next).languageSaved); }, onError: error => toast.error(dashboardErrorMessage(error)) });
  const messages = dashboardMessages(locale);
  const unreadNotifications = trpc.dashboard.notifications.unreadCount.useQuery(undefined, { enabled: Boolean(profile), retry: false, refetchInterval: 30_000 });
  const unreadCount = unreadNotifications.data?.count ?? 0;
  const notificationCopy = dashboardNotificationCopy(locale);
  const dashboardRequestFailed = Boolean(unreadNotifications.error);
  const scopedNavigation = (profile?.isOwner ? navigation : navigation.filter(item => USER_DASHBOARD_NAV_IDS.includes(item.id as (typeof USER_DASHBOARD_NAV_IDS)[number]))).map(item => ({ ...item, label: item.id === "cryptoMarket" ? classicCryptoMarketCopyFor(locale).navLabel : item.label ?? (item.id === "about" ? dashboardRuntimeCopyFor(locale).about : item.id === "help" ? messages.nav.help : (item.id === "notifications" ? notificationCopy.nav : messages.nav[item.id as keyof typeof messages.nav])) ?? item.id }));
  const allowedTab = profile?.isOwner || USER_DASHBOARD_NAV_IDS.includes(tab as (typeof USER_DASHBOARD_NAV_IDS)[number]) ? tab : "groups";
  const content = { overview: <Overview isOwner={profile?.isOwner ?? false} />, groups: <Groups />, registry: <ConnectedGroups />, members: <MembersWorkspace isBotOwner={profile?.isOwner ?? false} />, moderation: <ModerationWorkspace />, warningPolicy: <WarningPolicy />, forced: <div className="space-y-5"><ForcedJoin isOwner={profile?.isOwner ?? false} /><CustomStarsInvoicePanel isOwner={profile?.isOwner ?? false} /></div>, payments: <Payments isOwner={profile?.isOwner ?? false} />, cryptoMarket: <ClassicCryptoMarket locale={locale} />, alerts: <Alerts onNavigate={setTab} />, notifications: <NotificationsWorkspace locale={locale} />, settings: <Settings />, audit: <Audit />, logs: <OwnerRuntimeLogTerminal />, support: <SupportCenter locale={locale} isOwner={profile?.isOwner ?? false} />, help: <HelpGuide />, about: <AboutUs /> }[allowedTab];
  if (!profile) return <Gate onReady={nextProfile => { setProfile(nextProfile); setTab(nextProfile.isOwner ? "overview" : "groups"); setShowIntro(true); }} />;
  const changeLocale = (next: DashboardLocale) => { setLocale(next); safeStorageSet("local", "kronos-dashboard-locale", next); saveLocale.mutate({ locale: next }); };
  const direction = dashboardDirection(locale);
  const themeControl = themeMode === "system"
    ? { Icon: Monitor, current: "همگام با تنظیمات دستگاه", next: "حالت تیره" }
    : themeMode === "dark"
      ? { Icon: Moon, current: "حالت تیره", next: "حالت روشن" }
      : { Icon: Sun, current: "حالت روشن", next: "همگام با تنظیمات دستگاه" };
  const ThemeControlIcon = themeControl.Icon;
  const themeControlLabel = `${themeControl.current} فعال است؛ برای انتخاب ${themeControl.next} لمس کنید`;
  const selectTab = (nextTab: Tab) => { setTab(nextTab); setTabTransition(value => value + 1); setMenuOpen(false); };
  return <div dir={direction} lang={locale} className={`kronos-shell kronos-theme-tehran kronos-app-frame ${showIntro ? "kronos-app-frame--intro" : "kronos-app-frame--ready"} min-h-screen ${direction === "rtl" ? "text-right" : "text-left"} text-slate-100`}>{showIntro && <KronosIntro locale={locale} onComplete={() => setShowIntro(false)} />}<MobileMenuLayer open={menuOpen} closeLabel={dashboardUiCopy[locale].actions.closeMenu} onClose={() => setMenuOpen(false)}><div className="flex items-center gap-3 px-5 py-6"><div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-300 text-slate-950"><ShieldCheck className="h-6 w-6" /></div><div><p className="font-black tracking-tight text-white">KRONOS GUARD</p><p className="text-[10px] font-bold tracking-[.16em] text-cyan-300">{messages.groupConsole}</p></div></div><nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4">{scopedNavigation.map(item => <button key={item.id} aria-current={allowedTab === item.id ? "page" : undefined} onClick={() => selectTab(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${allowedTab === item.id ? "bg-cyan-300 text-slate-950 font-black" : "text-slate-400 hover:bg-white/[.06] hover:text-white"}`}><item.icon className="h-4 w-4" />{item.label}{item.id === "notifications" && unreadCount > 0 && <span aria-label={notificationCopy.unreadCount(String(unreadCount))} className="ms-auto inline-flex min-w-5 items-center justify-center rounded-full bg-rose-400 px-1.5 py-0.5 text-[10px] font-black text-slate-950">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>)}</nav><div className="kronos-sidebar-footer sticky bottom-0 z-10 mt-auto space-y-3 bg-[#090f20]/95 px-5 py-5 backdrop-blur-xl"><TelegramProfileCard sessionProfile={profile} /><LanguageSelector locale={locale} onChange={changeLocale} pending={saveLocale.isPending} /><div className="rounded-xl border border-white/8 bg-white/[.035] p-3"><p className="text-[10px] font-bold tracking-widest text-slate-500">{messages.secureSession}</p><p className="mt-1 text-xs text-emerald-300">● {messages.telegramVerified} {profile.isOwner ? `· ${messages.nav.overview}` : `· ${messages.groupAccess}`}</p></div></div></MobileMenuLayer><main className="h-screen min-h-0 overflow-y-auto lg:mr-72"><header className="kronos-topbar sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/7 bg-slate-950/75 px-4 backdrop-blur-xl lg:px-8"><div className="flex items-center gap-3"><button type="button" aria-label={dashboardUiCopy[locale].actions.openMenu} className="grid h-9 w-9 place-items-center rounded-lg bg-white/[.06] lg:hidden" onClick={() => setMenuOpen(true)}><Menu className="h-4 w-4" /></button><div><p className="text-sm font-black text-white">{allowedTab === "help" ? messages.nav.help : scopedNavigation.find(item => item.id === allowedTab)?.label}</p><p className="text-[10px] text-slate-500">{messages.dashboard}</p></div></div><div className="flex items-center gap-2"><button type="button" aria-label={themeControlLabel} title={themeControl.current} className="kronos-theme-toggle grid h-9 w-9 place-items-center rounded-lg bg-white/[.06] text-slate-300 hover:bg-cyan-300/15 hover:text-cyan-100 disabled:cursor-wait disabled:opacity-70" aria-busy={isTransitioning} disabled={isTransitioning} onClick={() => toggleTheme?.()}><ThemeControlIcon className="h-4 w-4" aria-hidden="true" /><span className="sr-only">{themeControlLabel}</span></button><button type="button" aria-label={messages.nav.support} title={messages.nav.support} className={`grid h-9 w-9 place-items-center rounded-lg transition ${allowedTab === "support" ? "bg-cyan-300 text-slate-950" : "bg-white/[.06] text-slate-300 hover:bg-cyan-300/15 hover:text-cyan-100"}`} onClick={() => selectTab("support")}><BellRing className="h-4 w-4" /><span className="sr-only">{messages.nav.support}</span></button><button type="button" aria-label={dashboardUiCopy[locale].actions.refresh} title={dashboardUiCopy[locale].actions.refresh} className="grid h-9 w-9 place-items-center rounded-lg bg-white/[.06] text-slate-300 hover:bg-white/[.1]" onClick={() => window.location.reload()}><Radio className="h-4 w-4" /></button><LanguageSelector locale={locale} onChange={changeLocale} pending={saveLocale.isPending} /></div></header><div key={`${allowedTab}-${tabTransition}`} className="kronos-content-stage kronos-content-stage--switching relative mx-auto max-w-7xl p-4 pb-24 sm:p-6 lg:p-8">{dashboardRequestFailed ? <DashboardDataError locale={locale} isRetrying={unreadNotifications.isFetching} onRetry={() => void unreadNotifications.refetch()} /> : content}</div></main><nav className="kronos-mobile-dock fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-white/10 bg-slate-950/95 px-2 py-2 backdrop-blur lg:hidden">{scopedNavigation.filter(item => ["overview", "groups", "forced", "cryptoMarket", "notifications", "help"].includes(item.id)).slice(0, 5).map(item => <button key={item.id} aria-current={allowedTab === item.id ? "page" : undefined} onClick={() => selectTab(item.id)} className={`relative grid place-items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] ${allowedTab === item.id ? "text-cyan-200" : "text-slate-500"}`}><item.icon className="h-4 w-4" />{item.label}{item.id === "notifications" && unreadCount > 0 && <span aria-label={notificationCopy.unreadCount(String(unreadCount))} className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-400 px-1 text-[9px] font-black text-slate-950">{unreadCount > 99 ? "99+" : unreadCount}</span>}</button>)}</nav></div>;
}
