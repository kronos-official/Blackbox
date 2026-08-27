import { normalizeLocale, type SupportedLocale } from "../telegram/i18n";

type AnnouncementWords = {
  heading: string;
  actor: string;
  enabled: string;
  disabled: string;
  time: string;
  date: string;
};

const words: Record<SupportedLocale, AnnouncementWords> = {
  fa: { heading: "تنظیمات محافظت Kronos تغییر کرد", actor: "انجام‌دهنده", enabled: "فعال شد", disabled: "غیرفعال شد", time: "ساعت", date: "تاریخ" },
  en: { heading: "Kronos protection settings updated", actor: "Changed by", enabled: "Enabled", disabled: "Disabled", time: "Time", date: "Date" },
  ar: { heading: "تم تحديث إعدادات حماية Kronos", actor: "بواسطة", enabled: "مفعّل", disabled: "معطّل", time: "الوقت", date: "التاريخ" },
  tr: { heading: "Kronos koruma ayarları güncellendi", actor: "Değiştiren", enabled: "Etkin", disabled: "Devre dışı", time: "Saat", date: "Tarih" },
  ru: { heading: "Настройки защиты Kronos обновлены", actor: "Изменил(а)", enabled: "Включено", disabled: "Выключено", time: "Время", date: "Дата" },
  es: { heading: "Se actualizaron los ajustes de protección de Kronos", actor: "Modificado por", enabled: "Activado", disabled: "Desactivado", time: "Hora", date: "Fecha" },
  fr: { heading: "Les paramètres de protection Kronos ont été mis à jour", actor: "Modifié par", enabled: "Activé", disabled: "Désactivé", time: "Heure", date: "Date" },
  pt: { heading: "As definições de proteção do Kronos foram atualizadas", actor: "Alterado por", enabled: "Ativado", disabled: "Desativado", time: "Hora", date: "Data" },
  it: { heading: "Le impostazioni di protezione Kronos sono state aggiornate", actor: "Modificato da", enabled: "Attivato", disabled: "Disattivato", time: "Ora", date: "Data" },
  de: { heading: "Die Kronos-Schutz­einstellungen wurden aktualisiert", actor: "Geändert von", enabled: "Aktiviert", disabled: "Deaktiviert", time: "Uhrzeit", date: "Datum" },
  pl: { heading: "Ustawienia ochrony Kronos zostały zaktualizowane", actor: "Zmienione przez", enabled: "Włączono", disabled: "Wyłączono", time: "Godzina", date: "Data" },
  vi: { heading: "Cài đặt bảo vệ Kronos đã được cập nhật", actor: "Người thay đổi", enabled: "Đã bật", disabled: "Đã tắt", time: "Thời gian", date: "Ngày" },
};

function escapeTelegramHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function formatDashboardSettingAnnouncement(input: {
  locale: string | null | undefined;
  actorTelegramId: number;
  actorDisplayName: string;
  changes: Array<{ label: string; enabled: boolean }>;
  now?: Date;
}) {
  const locale = normalizeLocale(input.locale);
  const copy = words[locale];
  const now = input.now ?? new Date();
  const dateLocale = locale === "fa" ? "fa-IR-u-ca-persian" : locale;
  const actorMention = `<a href="tg://user?id=${input.actorTelegramId}">${escapeTelegramHtml(input.actorDisplayName)}</a>`;
  const changeLines = input.changes.map(change => `• ${escapeTelegramHtml(change.label)}: <b>${change.enabled ? copy.enabled : copy.disabled}</b>`);
  return `🛡 <b>${copy.heading}</b>\n\n${changeLines.join("\n")}\n\n${copy.actor}: ${actorMention}\n\n${copy.time}: ${new Intl.DateTimeFormat(dateLocale, { timeStyle: "short" }).format(now)}\n${copy.date}: ${new Intl.DateTimeFormat(dateLocale, { dateStyle: "long" }).format(now)}`;
}
