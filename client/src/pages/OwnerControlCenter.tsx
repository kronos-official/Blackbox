import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Activity, Database, FileCode2, Globe2, LogOut, RefreshCw, Search, Server, Terminal, UsersRound } from "lucide-react";
import { OwnerMotionBackdrop } from "@/components/OwnerMotionBackdrop";

type Section = "overview" | "users" | "groups" | "logs" | "terminal" | "webhook" | "files" | "settings";

const sections: Array<{ id: Section; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "نمای کلی", icon: Activity },
  { id: "users", label: "کاربران ربات", icon: UsersRound },
  { id: "groups", label: "گروه‌ها", icon: Globe2 },
  { id: "logs", label: "ترمینال لاگ", icon: Terminal },
  { id: "terminal", label: "Terminal", icon: Terminal },
  { id: "webhook", label: "Webhook", icon: Server },
  { id: "files", label: "File Manager", icon: FileCode2 },
  { id: "settings", label: "تنظیمات ربات", icon: Server },
];

function number(value: number) {
  return value.toLocaleString("fa-IR");
}

function statusLabel(status: string) {
  return ({ active: "فعال", permission_lost: "دسترسی از دست رفته", removed: "حذف‌شده", paused: "متوقف" } as Record<string, string>)[status] ?? status;
}

function OwnerControlCenterContent() {
  const [section, setSection] = useState<Section>("overview");
  const [userSearch, setUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");
  const overview = trpc.ownerSite.overview.useQuery(undefined, { refetchInterval: 10_000 });
  const webhook = trpc.ownerSite.webhook.useQuery(undefined, { refetchInterval: 10_000 });
  const telegramWebhook = trpc.ownerSite.telegramWebhook.useQuery(undefined, { refetchInterval: 15_000 });
  const settings = trpc.ownerSite.settings.useQuery(undefined, { enabled: section === "settings" });
  const users = trpc.ownerSite.users.useQuery({ search: userSearch || undefined, page: 1, pageSize: 40 }, { enabled: section === "users" });
  const groups = trpc.ownerSite.groups.useQuery({ search: groupSearch || undefined, page: 1, pageSize: 40 }, { enabled: section === "groups" });
  const logs = trpc.ownerSite.logs.useQuery({ limit: 300 }, { enabled: section === "logs", refetchInterval: 3_000 });
  const diagnostics = trpc.ownerSite.diagnostics.useQuery(undefined, { enabled: section === "terminal" });
  const metrics = overview.data;
  const lastLogs = useMemo(() => (logs.data ?? []).slice(-220), [logs.data]);
  const [liveLogs, setLiveLogs] = useState<any[]>([]);
  useEffect(() => { setLiveLogs(lastLogs); }, [lastLogs]);
  useEffect(() => {
    if (section !== "logs") return;
    const after = liveLogs.at(-1)?.id ?? 0;
    const stream = new EventSource(`/api/owner-site/log-stream?after=${after}`);
    const onLog = (event: MessageEvent<string>) => { try { const row = JSON.parse(event.data); setLiveLogs(current => [...current, row].slice(-300)); } catch { /* fallback query remains active */ } };
    stream.addEventListener("log", onLog);
    return () => { stream.removeEventListener("log", onLog); stream.close(); };
  }, [section]);
  const files = trpc.ownerSite.files.useQuery(undefined, { enabled: section === "files" });
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const file = trpc.ownerSite.file.useQuery({ path: selectedFile ?? "README.md" }, { enabled: section === "files" && Boolean(selectedFile) });
  useEffect(() => { if (section === "files" && !selectedFile && files.data?.length) { const first = files.data.find(item => item.type === "file"); if (first) setSelectedFile(first.path); } }, [section, selectedFile, files.data]);
  const logout = async () => { await fetch("/api/owner-auth/logout", { method: "POST" }); window.location.reload(); };

  return (
    <OwnerMotionBackdrop><div dir="rtl" className="owner-panel-enter min-h-screen text-slate-100">
      <header className="border-b border-cyan-200/10 bg-[#081a2b]/90 px-5 py-4 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4">
          <div><p className="text-xs font-bold tracking-[0.25em] text-cyan-300/70">KRONOS CONTROL CENTER</p><h1 className="mt-1 text-2xl font-black text-white">مرکز مدیریت خصوصی مالک</h1><p className="mt-1 text-xs text-slate-400">دسترسی مستقیم به وضعیت سرویس، داده‌ها، Webhook و لاگ‌های امن ربات</p></div>
          <div className="flex items-center gap-2"><Badge className="border-emerald-300/25 bg-emerald-300/10 text-emerald-200"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-300" />فقط مالک</Badge><Button type="button" variant="outline" onClick={() => void logout()} className="border-rose-300/25 bg-rose-300/5 text-rose-100 hover:border-rose-200/50 hover:bg-rose-300/10"><LogOut className="h-4 w-4" />Logout</Button></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1500px] gap-5 p-5 lg:grid-cols-[230px_1fr]">
        <aside className="owner-card h-fit rounded-3xl border border-cyan-200/10 bg-slate-950/50 p-3 lg:sticky lg:top-5">
          <p className="px-3 pb-3 text-[11px] font-bold text-slate-500">بخش‌های مدیریتی</p>
          <nav className="space-y-1">{sections.map(item => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setSection(item.id)} className={`flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-bold transition ${section === item.id ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/5 hover:text-white"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>
        </aside>
        <main className="min-w-0 space-y-5">
          {section === "overview" && <Overview metrics={metrics} onRefresh={() => { void overview.refetch(); void webhook.refetch(); }} />}
          {section === "users" && <DataTable title="کاربران ثبت‌شدهٔ ربات" search={userSearch} setSearch={setUserSearch} loading={users.isLoading} rows={users.data?.rows ?? []} total={users.data?.total ?? 0} columns={["شناسه عددی", "نام کاربری", "نام", "شروع ربات", "آخرین تغییر"]} renderRow={(row: any) => <><td className="font-mono text-cyan-200">{row.telegramUserId}</td><td dir="ltr">{row.username ? `@${row.username}` : "—"}</td><td>{[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}</td><td>{row.startedBotAt ? new Date(row.startedBotAt).toLocaleString("fa-IR") : "شروع نشده"}</td><td>{new Date(row.updatedAt).toLocaleString("fa-IR")}</td></>} />}
          {section === "groups" && <DataTable title="گروه‌های متصل به Kronos Guard" search={groupSearch} setSearch={setGroupSearch} loading={groups.isLoading} rows={groups.data?.rows ?? []} total={groups.data?.total ?? 0} columns={["شناسه گروه", "عنوان", "Username", "وضعیت", "آخرین فعالیت"]} renderRow={(row: any) => <><td className="font-mono text-cyan-200">{row.chatId}</td><td>{row.title || "—"}</td><td dir="ltr">{row.username ? `@${row.username}` : "خصوصی"}</td><td><Badge className="border-white/10 bg-white/5 text-slate-200">{statusLabel(row.status)}</Badge></td><td>{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString("fa-IR") : "—"}</td></>} />}
          {section === "logs" && <LogTerminal rows={liveLogs} loading={logs.isLoading} onRefresh={() => void logs.refetch()} />}
          {section === "terminal" && <DiagnosticTerminal commands={diagnostics.data ?? []} />}
          {section === "webhook" && <WebhookPanel data={webhook.data} telegram={telegramWebhook.data} loading={webhook.isLoading || telegramWebhook.isLoading} onRefresh={() => { void webhook.refetch(); void telegramWebhook.refetch(); }} />}
          {section === "files" && <FileManager files={files.data ?? []} selectedFile={selectedFile} setSelectedFile={setSelectedFile} file={file.data} loading={files.isLoading || file.isLoading} />}
          {section === "settings" && <><SettingsCenter rows={settings.data ?? []} loading={settings.isLoading} /><GlobalControlCenter /></>}
        </main>
      </div>
    </div></OwnerMotionBackdrop>
  );
}

function Overview({ metrics, onRefresh }: { metrics?: any; onRefresh: () => void }) {
  const cards = [{ label: "کاربران Start کرده", value: metrics?.startedUsers ?? 0, icon: UsersRound }, { label: "گروه‌ها", value: metrics?.groups ?? 0, icon: Globe2 }, { label: "گروه‌های فعال", value: metrics?.activeGroups ?? 0, icon: Server }, { label: "نقش‌های ثبت‌شده", value: metrics?.roles ?? 0, icon: Database }, { label: "Webhook در ۲۴ ساعت", value: metrics?.webhookEvents24h ?? 0, icon: RefreshCw }];
  return <><div className="flex items-center justify-between"><div><h2 className="text-xl font-black text-white">نمای کلی عملیاتی</h2><p className="mt-1 text-sm text-slate-400">آمار از دیتابیس واقعی خوانده می‌شود؛ کارت کاربران فقط اعضایی را می‌شمارد که ربات را Start کرده‌اند.</p></div><Button variant="outline" onClick={onRefresh} className="border-cyan-200/20 text-cyan-100"><RefreshCw className="h-4 w-4" />به‌روزرسانی</Button></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(card => { const Icon = card.icon; return <Card key={card.label} className="owner-card border-cyan-200/10 bg-slate-950/50"><CardContent className="flex items-center justify-between p-5"><div><p className="text-xs text-slate-400">{card.label}</p><p className="mt-2 text-3xl font-black text-white">{number(card.value)}</p></div><div className="rounded-2xl bg-cyan-300/10 p-3 text-cyan-200"><Icon className="h-6 w-6" /></div></CardContent></Card>; })}</div></>;
}

function DataTable({ title, search, setSearch, loading, rows, total, columns, renderRow }: { title: string; search: string; setSearch: (value: string) => void; loading: boolean; rows: any[]; total: number; columns: string[]; renderRow: (row: any) => React.ReactNode }) {
  return <Card className="border-cyan-200/10 bg-slate-950/50"><CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-white">{title}</CardTitle><p className="mt-1 text-xs text-slate-400">{number(total)} رکورد در دیتابیس</p></div><div className="relative w-full sm:w-72"><Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-500" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="جست‌وجو در اطلاعات..." className="border-white/10 bg-white/5 pr-9 text-white" /></div></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[700px] text-right text-sm"><thead><tr className="border-b border-white/10 text-xs text-slate-500">{columns.map(column => <th key={column} className="px-3 py-3 font-bold">{column}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={columns.length} className="p-8 text-center text-slate-400">در حال بارگذاری...</td></tr> : rows.length ? rows.map(row => <tr key={row.id} className="border-b border-white/5 text-slate-300 last:border-0">{renderRow(row)}</tr>) : <tr><td colSpan={columns.length} className="p-8 text-center text-slate-500">رکوردی پیدا نشد.</td></tr>}</tbody></table></CardContent></Card>;
}

export function parseDiagnosticCommand(value: string) {
  const [head = "", ...rest] = value.trim().split(/\s+/);
  const command = head.toLowerCase();
  if (["ping", "پینگ"].includes(command)) return { command: "ping" as const, host: rest[0] || "1.1.1.1" };
  if (["uptime", "up"].includes(command)) return { command: "uptime" as const };
  if (["node", "node-version", "node -v"].includes(command)) return { command: "node-version" as const };
  if (["memory", "mem"].includes(command)) return { command: "memory" as const };
  if (["time", "date", "server-time"].includes(command)) return { command: "server-time" as const };
  if (["disk", "df"].includes(command)) return { command: "disk" as const };
  if (["process", "ps", "process-info"].includes(command)) return { command: "process-info" as const };
  return null;
}

function DiagnosticTerminal({ commands }: { commands: Array<{ command: string; label: string }> }) {
  const run = trpc.ownerSite.runDiagnostic.useMutation();
  const [commandLine, setCommandLine] = useState("ping 1.1.1.1");
  const [history, setHistory] = useState<string[]>(["Kronos Guard diagnostic console v1", "برای راهنما: help"]);
  const execute = async () => {
    const entered = commandLine.trim();
    if (!entered) return;
    if (entered.toLowerCase() === "help") {
      setHistory(current => [...current, `$ ${entered}`, "فرمان‌های مجاز: ping <host>، uptime، node، memory، time، disk، process", "برای امنیت، اجرای shell خام و دستورهای خارج از این فهرست مجاز نیستند."]);
      return;
    }
    const parsed = parseDiagnosticCommand(entered);
    if (!parsed) {
      setHistory(current => [...current, `$ ${entered}`, `command not allowed: ${entered}`, "help را برای دیدن فرمان‌های مجاز بنویسید."]);
      return;
    }
    setHistory(current => [...current, `$ ${entered}`, "running..."]);
    try {
      const result = await run.mutateAsync(parsed);
      setHistory(current => [...current.slice(0, -1), result.output.trim() || "command completed"]);
    } catch (error) {
      setHistory(current => [...current.slice(0, -1), error instanceof Error ? error.message : "diagnostic failed"]);
    }
  };
  return <Card className="owner-card overflow-hidden border-emerald-300/15 bg-[#050b12]"><CardHeader className="border-b border-emerald-300/10"><CardTitle className="flex items-center gap-2 font-mono text-emerald-200"><Terminal className="h-5 w-5" />Terminal</CardTitle><p className="mt-1 text-xs leading-5 text-slate-500">حس و تجربهٔ CMD؛ فرمان‌های تشخیصی مجاز واقعاً اجرا می‌شوند و همهٔ اجراها audit می‌گردند.</p></CardHeader><CardContent className="space-y-4 p-4"><div className="rounded-2xl border border-emerald-300/10 bg-black/50 p-4 font-mono text-xs leading-6 text-emerald-100" dir="ltr"><p className="mb-3 text-emerald-300">owner@kronos:~$ <span className="text-slate-500">{commands.map(item => item.command).join(" · ")}</span></p>{history.map((line, index) => <p key={`${line}-${index}`} className={line.startsWith("$") ? "text-cyan-200" : "whitespace-pre-wrap"}>{line}</p>)}</div><div className="flex gap-2" dir="ltr"><span className="grid place-items-center rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 font-mono text-emerald-200">$</span><Input value={commandLine} onChange={event => setCommandLine(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void execute(); }} placeholder="ping 1.1.1.1" className="border-emerald-300/20 bg-black/40 font-mono text-emerald-100 placeholder:text-emerald-300/30" /><Button onClick={() => void execute()} disabled={run.isPending} className="bg-emerald-300 font-bold text-slate-950 hover:bg-emerald-200">{run.isPending ? "..." : "Enter"}</Button></div></CardContent></Card>;
}

function LogTerminal({ rows, loading, onRefresh }: { rows: any[]; loading: boolean; onRefresh: () => void }) {
  return <Card className="overflow-hidden border-emerald-300/15 bg-[#050b12]"><CardHeader className="flex-row items-center justify-between border-b border-emerald-300/10"><div><CardTitle className="flex items-center gap-2 font-mono text-emerald-200"><Terminal className="h-5 w-5" />ترمینال لاگ زنده</CardTitle><p className="mt-1 text-xs text-slate-500">به‌روزرسانی خودکار هر ۳ ثانیه؛ secretها از سمت سرور حذف می‌شوند.</p></div><Button variant="outline" onClick={onRefresh} className="border-emerald-300/20 text-emerald-200"><RefreshCw className="h-4 w-4" /></Button></CardHeader><CardContent className="p-0"><div className="h-[620px] overflow-auto p-4 font-mono text-xs leading-6" dir="ltr">{loading ? <p className="text-slate-500">loading runtime stream...</p> : rows.map((row: any) => <div key={row.id} className="whitespace-pre-wrap border-b border-white/[.035] py-1 text-slate-300"><span className="mr-3 text-slate-600">{new Date(row.createdAt).toLocaleTimeString("en-GB")}</span><span className={row.severity === "critical" ? "text-rose-300" : row.severity === "warning" ? "text-amber-200" : "text-emerald-200"}>[{row.event}]</span> {String(row.details?.line ?? "")}</div>)}</div></CardContent></Card>;
}

function WebhookPanel({ data, telegram, loading, onRefresh }: { data?: any; telegram?: any; loading: boolean; onRefresh: () => void }) {
  return <Card className="border-cyan-200/10 bg-slate-950/50"><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-white">کنترل و پایش Webhook</CardTitle><p className="mt-1 text-sm text-slate-400">وضعیت دریافت آپدیت‌های Telegram و خطاهای ثبت‌شده.</p></div><Button variant="outline" onClick={onRefresh} className="border-cyan-200/20 text-cyan-100"><RefreshCw className="h-4 w-4" /></Button></CardHeader><CardContent className="space-y-5"><div className="rounded-2xl border border-cyan-200/15 bg-cyan-200/5 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs text-slate-400">وضعیت اتصال واقعی Telegram</p><p className="mt-1 font-mono text-sm text-cyan-100">{telegram?.available ? (telegram.info?.url || "Webhook پاسخ‌گو است") : (telegram?.error || "در حال بررسی")}</p></div><Badge className={`border-white/10 ${telegram?.available ? "bg-emerald-300/10 text-emerald-200" : "bg-amber-300/10 text-amber-100"}`}>{telegram?.available ? "متصل" : "نامشخص"}</Badge></div></div><div className="grid gap-4 sm:grid-cols-2">
<div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/5 p-4"><p className="text-xs text-slate-400">دریافت در ۲۴ ساعت</p><p className="mt-2 text-3xl font-black text-emerald-200">{number(data?.received24h ?? 0)}</p></div><div className="rounded-2xl border border-rose-300/15 bg-rose-300/5 p-4"><p className="text-xs text-slate-400">خطای Webhook در ۲۴ ساعت</p><p className="mt-2 text-3xl font-black text-rose-200">{number(data?.failed24h ?? 0)}</p></div></div><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-sm"><thead><tr className="border-b border-white/10 text-xs text-slate-500"><th className="px-2 py-3 text-right">Update ID</th><th className="px-2 py-3 text-right">نوع</th><th className="px-2 py-3 text-right">وضعیت</th><th className="px-2 py-3 text-right">زمان دریافت</th></tr></thead><tbody>{loading ? <tr><td colSpan={4} className="p-6 text-center text-slate-500">در حال بارگذاری...</td></tr> : (data?.latest ?? []).map((row: any) => <tr key={row.id} className="border-b border-white/5"><td className="px-2 py-3 font-mono text-cyan-200">{row.updateId}</td><td className="px-2 py-3 text-slate-300">{row.eventType}</td><td className="px-2 py-3"><Badge className="border-white/10 bg-white/5 text-slate-200">{row.status}</Badge></td><td className="px-2 py-3 text-slate-400">{new Date(row.receivedAt).toLocaleString("fa-IR")}</td></tr>)}</tbody></table></div></CardContent></Card>;
}

function SettingsCenter({ rows, loading }: { rows: Array<{ group: any; settings: any }>; loading: boolean }) {
  const utils = trpc.useUtils();
  const update = trpc.ownerSite.updateSettings.useMutation();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = rows.find(row => row.group.id === selectedId) ?? rows[0];
  const base = selected?.settings ?? { welcomeEnabled: true, welcomeMessage: null, goodbyeEnabled: false, goodbyeMessage: null, antiSpamEnabled: true, antiRaidEnabled: true, marketCommandsEnabled: true, floodMessageLimit: 7, floodWindowSeconds: 12, duplicateMessageLimit: 3, warnLimit: 3, warnAction: "mute", warnMuteMinutes: 0, rulesText: null };
  const [form, setForm] = useState<any>(base);
  useEffect(() => { if (selected?.group.id) { setSelectedId(selected.group.id); setForm({ ...base }); } }, [selected?.group.id]);
  if (loading) return <Card className="border-cyan-200/10 bg-slate-950/50"><CardContent className="p-8 text-center text-slate-400">در حال بارگذاری تنظیمات گروه‌ها...</CardContent></Card>;
  if (!rows.length) return <Card className="border-cyan-200/10 bg-slate-950/50"><CardContent className="p-8 text-center text-slate-400">هنوز گروهی برای تنظیم‌کردن ثبت نشده است.</CardContent></Card>;
  const set = (key: string, value: unknown) => setForm((current: any) => ({ ...current, [key]: value }));
  return <Card className="border-cyan-200/10 bg-slate-950/50"><CardHeader><CardTitle className="text-white">شخصی‌سازی قابلیت‌های ربات</CardTitle><p className="text-sm text-slate-400">تنظیمات هر گروه مستقیماً ذخیره می‌شود و تغییرات در audit log ثبت خواهد شد.</p></CardHeader><CardContent className="grid gap-5 lg:grid-cols-[260px_1fr]"><div className="space-y-2">{rows.map(row => <button key={row.group.id} type="button" onClick={() => { setSelectedId(row.group.id); setForm({ ...(row.settings ?? base) }); }} className={`block w-full rounded-xl px-3 py-3 text-right text-sm ${selected?.group.id === row.group.id ? "bg-cyan-300 text-slate-950" : "bg-white/5 text-slate-300"}`}>{row.group.title || row.group.username || row.group.chatId}</button>)}</div><form className="space-y-5" onSubmit={event => { event.preventDefault(); if (!selected) return; update.mutate({ ...form, groupId: selected.group.id, welcomeMessage: form.welcomeMessage || null, goodbyeMessage: form.goodbyeMessage || null, rulesText: form.rulesText || null }, { onSuccess: () => { void utils.ownerSite.settings.invalidate(); } }); }}><div className="grid gap-3 sm:grid-cols-2">{[["welcomeEnabled", "پیام ورود"], ["goodbyeEnabled", "پیام خروج"], ["antiSpamEnabled", "ضد اسپم"], ["antiRaidEnabled", "ضد حمله"], ["marketCommandsEnabled", "دستورات بازار"]].map(([key, label]) => <label key={key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200"><span>{label}</span><input type="checkbox" checked={Boolean(form[key])} onChange={event => set(key, event.target.checked)} /></label>)}</div><div className="grid gap-3 sm:grid-cols-3">{[["floodMessageLimit", "حد پیام flood"], ["floodWindowSeconds", "بازه flood"], ["duplicateMessageLimit", "حد تکرار"], ["warnLimit", "حد اخطار"], ["warnMuteMinutes", "مدت سکوت" ]].map(([key, label]) => <label key={key} className="space-y-2 text-xs text-slate-400">{label}<Input type="number" value={form[key] ?? 0} onChange={event => set(key, Number(event.target.value))} className="border-white/10 bg-white/5 text-white" /></label>)}</div><div className="grid gap-3 sm:grid-cols-2"><label className="space-y-2 text-xs text-slate-400">متن ورود<textarea value={form.welcomeMessage ?? ""} onChange={event => set("welcomeMessage", event.target.value)} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" /></label><label className="space-y-2 text-xs text-slate-400">قوانین گروه<textarea value={form.rulesText ?? ""} onChange={event => set("rulesText", event.target.value)} className="min-h-24 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" /></label></div><Button type="submit" disabled={update.isPending} className="bg-cyan-300 text-slate-950">{update.isPending ? "در حال ذخیره..." : "ذخیرهٔ تنظیمات"}</Button></form></CardContent></Card>;
}

function FileManager({ files, selectedFile, setSelectedFile, file, loading }: { files: Array<{ path: string; type: "file" | "directory"; size?: number }>; selectedFile: string | null; setSelectedFile: (value: string) => void; file?: { path: string; content: string; size: number; modifiedAt: string }; loading: boolean }) {
  const [search, setSearch] = useState("");
  const visibleFiles = files.filter(item => item.type === "file" && item.path.toLowerCase().includes(search.toLowerCase()));
  return <Card className="overflow-hidden border-cyan-200/10 bg-slate-950/50"><CardHeader className="flex-row items-center justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-white"><FileCode2 className="h-5 w-5 text-cyan-200" />File Manager امن</CardTitle><p className="mt-1 text-xs text-slate-400">مشاهدهٔ کدهای پروژه با حذف مسیرهای حساس و secretها</p></div><Badge className="border-amber-200/20 bg-amber-200/5 text-amber-100">فقط مشاهده</Badge></CardHeader><CardContent className="grid gap-4 p-0 lg:grid-cols-[300px_1fr]"><aside className="border-l border-white/10 p-4"><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="جست‌وجوی فایل..." className="mb-3 border-white/10 bg-white/5 text-white" /><div className="max-h-[620px] space-y-1 overflow-auto">{loading && !files.length ? <p className="p-3 text-xs text-slate-500">در حال خواندن ساختار پروژه...</p> : visibleFiles.map(item => <button key={item.path} type="button" onClick={() => setSelectedFile(item.path)} className={`block w-full rounded-xl px-3 py-2 text-right font-mono text-xs transition ${selectedFile === item.path ? "bg-cyan-300 text-slate-950" : "text-slate-300 hover:bg-white/5"}`}>{item.path}</button>)}</div></aside><section className="min-w-0 p-4"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="font-mono text-sm text-cyan-200">{file?.path ?? selectedFile ?? "یک فایل را انتخاب کنید"}</p>{file && <span className="text-[11px] text-slate-500">{file.size.toLocaleString("fa-IR")} بایت · {new Date(file.modifiedAt).toLocaleString("fa-IR")}</span>}</div><pre className="min-h-[620px] max-h-[620px] overflow-auto rounded-2xl border border-white/10 bg-[#050b12] p-4 text-left font-mono text-xs leading-6 text-slate-300" dir="ltr">{file?.content ?? (selectedFile ? "در حال بارگذاری فایل..." : "یک فایل را از سمت راست انتخاب کنید.")}</pre></section></CardContent></Card>;
}

function OwnerSiteAuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "login" | "authenticated">("loading");
  const [mode, setMode] = useState<"login" | "recovery">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recoveryStarted, setRecoveryStarted] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/owner-auth/session").then(response => { setState(response.ok ? "authenticated" : "login"); }); }, []);
  if (state === "loading") return <OwnerMotionBackdrop><div dir="rtl" className="flex min-h-screen items-center justify-center text-slate-200"><div className="owner-auth-card rounded-3xl border border-cyan-200/10 bg-slate-950/70 px-8 py-6">در حال بررسی نشست مالک...</div></div></OwnerMotionBackdrop>;
  if (state === "authenticated") return <>{children}</>;
  const submitLogin = async (event: React.FormEvent) => { event.preventDefault(); setError(""); const response = await fetch("/api/owner-auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); if (!response.ok) { const result = await response.json().catch(() => ({})); setError(result.message || "ورود انجام نشد."); return; } setState("authenticated"); setPassword(""); };
  const startRecovery = async () => { setError(""); const response = await fetch("/api/owner-auth/recovery/start", { method: "POST" }); const result = await response.json().catch(() => ({})); if (!response.ok) { setError(result.message || "ارسال کد بازیابی ناموفق بود."); return; } setRecoveryStarted(true); setError(result.message || "کد بازیابی ارسال شد."); };
  const verifyRecovery = async (event: React.FormEvent) => { event.preventDefault(); setError(""); const response = await fetch("/api/owner-auth/recovery/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, username, password }) }); const result = await response.json().catch(() => ({})); if (!response.ok) { setError(result.message || "کد بازیابی معتبر نیست."); return; } setState("authenticated"); setPassword(""); };
  return <OwnerMotionBackdrop><div dir="rtl" className="flex min-h-screen items-center justify-center px-4 text-slate-100"><div className="owner-auth-card w-full max-w-md rounded-3xl border border-cyan-200/15 bg-slate-950/80 p-7 shadow-2xl shadow-cyan-950/30"><div className="mb-7"><div className="owner-brand-mark"><span>K</span><i /></div><p className="mt-4 text-xs font-bold tracking-[0.25em] text-cyan-300/70">KRONOS OWNER ACCESS</p><h1 className="mt-2 text-2xl font-black text-white">{mode === "login" ? "ورود به پنل مالک" : "بازیابی دسترسی مالک"}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{mode === "login" ? "دسترسی محدود و محافظت‌شده به مرکز فرمان Kronos Guard." : "کد تأیید فقط به اکانت تلگرامی مالک ربات ارسال می‌شود."}</p></div>{mode === "login" ? <form className="space-y-4" onSubmit={submitLogin}><label className="block text-sm text-slate-300">نام کاربری<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-white outline-none ring-cyan-300 focus:ring-2" dir="ltr" required /></label><label className="block text-sm text-slate-300">گذرواژه<input autoComplete="current-password" type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-white outline-none ring-cyan-300 focus:ring-2" dir="ltr" required /></label><button type="submit" className="w-full rounded-xl bg-cyan-300 px-4 py-3 font-black text-slate-950 transition hover:bg-cyan-200">ورود امن</button><button type="button" onClick={() => { setMode("recovery"); setError(""); }} className="w-full text-sm text-cyan-200 hover:text-cyan-100">نام کاربری یا گذرواژه را فراموش کرده‌اید؟</button></form> : <form className="space-y-4" onSubmit={verifyRecovery}><label className="block text-sm text-slate-300">نام کاربری جدید<input value={username} onChange={event => setUsername(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-white" dir="ltr" minLength={4} required /></label><label className="block text-sm text-slate-300">گذرواژهٔ جدید<input type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-white" dir="ltr" minLength={12} required /></label>{recoveryStarted && <label className="block text-sm text-slate-300">کد ارسال‌شده در Telegram<input inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-white" dir="ltr" minLength={6} maxLength={6} required /></label>}<button type="button" onClick={() => void startRecovery()} className="w-full rounded-xl border border-cyan-200/20 px-4 py-3 font-bold text-cyan-100">{recoveryStarted ? "ارسال دوبارهٔ کد" : "ارسال کد به Telegram مالک"}</button>{recoveryStarted && <button type="submit" className="w-full rounded-xl bg-cyan-300 px-4 py-3 font-black text-slate-950">تأیید کد و ذخیرهٔ دسترسی</button>}<button type="button" onClick={() => { setMode("login"); setError(""); }} className="w-full text-sm text-slate-400">بازگشت به ورود</button></form>}{error && <p className="mt-4 rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-3 text-sm text-cyan-100">{error}</p>}<p className="mt-5 text-center text-xs leading-5 text-slate-500">هیچ credential خامی در لاگ یا File Manager نمایش داده نمی‌شود.</p></div></div></OwnerMotionBackdrop>;
}

export default function OwnerControlCenter() {
  return <OwnerSiteAuthGate><OwnerControlCenterContent /></OwnerSiteAuthGate>;
}


function GlobalControlCenter() {
  const utils = trpc.useUtils();
  const settings = trpc.ownerSite.globalSettings.useQuery(undefined, { refetchInterval: 20_000 });
  const texts = trpc.ownerSite.globalTexts.useQuery(undefined, { refetchInterval: 20_000 });
  const revisions = trpc.ownerSite.configRevisions.useQuery({ limit: 10 });
  const saveSetting = trpc.ownerSite.updateGlobalSetting.useMutation({ onSuccess: () => void utils.ownerSite.globalSettings.invalidate() });
  const saveText = trpc.ownerSite.updateGlobalText.useMutation({ onSuccess: () => void utils.ownerSite.globalTexts.invalidate() });
  const [settingKey, setSettingKey] = useState("");
  const [settingValue, setSettingValue] = useState("");
  const [valueType, setValueType] = useState<"string" | "number" | "boolean" | "json">("string");
  const [textKey, setTextKey] = useState("");
  const [category, setCategory] = useState("general");
  const [textValue, setTextValue] = useState("");
  const [enabled, setEnabled] = useState(true);
  const loadSetting = (key: string) => { const row = (settings.data ?? []).find(item => item.settingKey === key); if (row) { setSettingKey(row.settingKey); setSettingValue(row.settingValue); setValueType(row.valueType); } };
  const loadText = (key: string) => { const row = (texts.data ?? []).find(item => item.textKey === key); if (row) { setTextKey(row.textKey); setCategory(row.category); setTextValue(row.textValue); setEnabled(Boolean(row.enabled)); } };
  return <Card className="border-cyan-200/10 bg-slate-950/50"><CardHeader><CardTitle className="text-white">مرکز کنترل سراسری ربات</CardTitle><p className="text-sm leading-6 text-slate-400">مقادیر پیش‌فرض و متن‌های مشترک را ویرایش کنید. تنظیمات اختصاصی هر گروه در پنل بالا باقی می‌ماند و هر تغییر در audit log ثبت می‌شود.</p></CardHeader><CardContent className="space-y-6">
    <div className="grid gap-5 xl:grid-cols-2">
      <form className="space-y-3 rounded-2xl border border-cyan-200/10 bg-white/[.03] p-4" onSubmit={event => { event.preventDefault(); if (!settingKey.trim()) return; saveSetting.mutate({ settingKey: settingKey.trim(), settingValue, valueType }); }}>
        <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-cyan-100">تنظیمات پیش‌فرض</h3><select value={settingKey} onChange={event => loadSetting(event.target.value)} className="max-w-[55%] rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-xs text-white"><option value="">انتخاب کلید موجود</option>{(settings.data ?? []).map(item => <option key={item.settingKey} value={item.settingKey}>{item.settingKey}</option>)}</select></div>
        <Input value={settingKey} onChange={event => setSettingKey(event.target.value)} placeholder="مثلاً default_delete_delay" className="border-white/10 bg-white/5 text-white" dir="ltr" required />
        <select value={valueType} onChange={event => setValueType(event.target.value as typeof valueType)} className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"><option value="string">متن</option><option value="number">عدد</option><option value="boolean">منطقی</option><option value="json">JSON</option></select>
        <textarea value={settingValue} onChange={event => setSettingValue(event.target.value)} className="min-h-28 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" dir="ltr" placeholder="مقدار تنظیم" required />
        <Button type="submit" disabled={saveSetting.isPending} className="bg-cyan-300 text-slate-950">{saveSetting.isPending ? "در حال ذخیره..." : "ذخیرهٔ تنظیم سراسری"}</Button>
      </form>
      <form className="space-y-3 rounded-2xl border border-violet-200/10 bg-white/[.03] p-4" onSubmit={event => { event.preventDefault(); if (!textKey.trim()) return; saveText.mutate({ textKey: textKey.trim(), category: category.trim() || "general", textValue, enabled }); }}>
        <div className="flex items-center justify-between gap-3"><h3 className="font-bold text-violet-100">متن‌ها و برچسب‌های ربات</h3><select value={textKey} onChange={event => loadText(event.target.value)} className="max-w-[55%] rounded-lg border border-white/10 bg-slate-900 px-2 py-2 text-xs text-white"><option value="">انتخاب متن موجود</option>{(texts.data ?? []).map(item => <option key={item.textKey} value={item.textKey}>{item.textKey}</option>)}</select></div>
        <Input value={textKey} onChange={event => setTextKey(event.target.value)} placeholder="مثلاً command.ban.success" className="border-white/10 bg-white/5 text-white" dir="ltr" required /><Input value={category} onChange={event => setCategory(event.target.value)} placeholder="دسته‌بندی" className="border-white/10 bg-white/5 text-white" dir="ltr" required />
        <textarea value={textValue} onChange={event => setTextValue(event.target.value)} className="min-h-28 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" placeholder="متن قابل ویرایش ربات" required /><label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} />فعال باشد</label>
        <Button type="submit" disabled={saveText.isPending} className="bg-violet-300 text-slate-950">{saveText.isPending ? "در حال ذخیره..." : "ذخیرهٔ متن سراسری"}</Button>
      </form>
    </div>
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4"><h3 className="mb-3 font-bold text-slate-200">آخرین revisionهای پیکربندی</h3>{revisions.isLoading ? <p className="text-sm text-slate-500">در حال بارگذاری...</p> : revisions.data?.length ? <div className="space-y-2 text-xs text-slate-400">{revisions.data.map(row => <div key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-2"><span>نسخهٔ {row.version} · {row.scope} · {row.status}</span><span>{new Date(row.createdAt).toLocaleString("fa-IR")}</span></div>)}</div> : <p className="text-sm text-slate-500">هنوز revision ثبت نشده است.</p>}</div>
  </CardContent></Card>;
}
