import type { DashboardLocale } from "./dashboardI18n";

type BroadcastResultCopy = {
  success: (total: string, sent: string, failed: string, needsPrivateStart: string) => string;
  detail: (total: string, sent: string, failed: string, needsPrivateStart: string) => string;
};
const templates: Record<DashboardLocale, BroadcastResultCopy> = {
  fa: { success: (t, s, f, n) => `پیام برای ${s} نفر از ${t} کاربر واجد شرایط ارسال شد؛ ${f} ارسال ناموفق بود؛ ${n} کاربر باید ابتدا ربات را در خصوصی شروع کنند.`, detail: (t, s, f, n) => `واجد شرایط: ${t} · ارسال‌شده: ${s} · ناموفق: ${f} · نیازمند شروع خصوصی: ${n}` },
  en: { success: (t, s, f, n) => `Sent to ${s} of ${t} eligible users; ${f} deliveries failed; ${n} users must start the bot privately first.`, detail: (t, s, f, n) => `Eligible: ${t} · Sent: ${s} · Failed: ${f} · Need private start: ${n}` },
  ar: { success: (t, s, f, n) => `أُرسلت الرسالة إلى ${s} من أصل ${t} مستخدمين مؤهلين؛ فشل ${f} من عمليات التسليم؛ ويجب أن يبدأ ${n} مستخدمًا البوت في الخاص أولًا.`, detail: (t, s, f, n) => `المؤهلون: ${t} · المرسَل: ${s} · الفاشل: ${f} · يحتاج بدءًا خاصًا: ${n}` },
  tr: { success: (t, s, f, n) => `${t} uygun kullanıcıdan ${s} kişiye gönderildi; ${f} teslimat başarısız oldu; ${n} kullanıcı önce botu özelden başlatmalıdır.`, detail: (t, s, f, n) => `Uygun: ${t} · Gönderildi: ${s} · Başarısız: ${f} · Özel başlangıç gerekli: ${n}` },
  ru: { success: (t, s, f, n) => `Отправлено ${s} из ${t} подходящих пользователей; не доставлено: ${f}; ${n} пользователям нужно сначала запустить бота в личном чате.`, detail: (t, s, f, n) => `Подходят: ${t} · Отправлено: ${s} · Ошибки: ${f} · Нужен личный старт: ${n}` },
  es: { success: (t, s, f, n) => `Enviado a ${s} de ${t} usuarios elegibles; ${f} envíos fallaron; ${n} usuarios deben iniciar el bot en privado primero.`, detail: (t, s, f, n) => `Elegibles: ${t} · Enviados: ${s} · Fallidos: ${f} · Requieren inicio privado: ${n}` },
  fr: { success: (t, s, f, n) => `Envoyé à ${s} utilisateurs sur ${t} éligibles ; ${f} envois ont échoué ; ${n} utilisateurs doivent d’abord démarrer le bot en privé.`, detail: (t, s, f, n) => `Éligibles : ${t} · Envoyés : ${s} · Échecs : ${f} · Démarrage privé requis : ${n}` },
  pt: { success: (t, s, f, n) => `Enviado para ${s} de ${t} usuários elegíveis; ${f} envios falharam; ${n} usuários precisam iniciar o bot no privado primeiro.`, detail: (t, s, f, n) => `Elegíveis: ${t} · Enviados: ${s} · Falhas: ${f} · Início privado necessário: ${n}` },
  it: { success: (t, s, f, n) => `Inviato a ${s} utenti su ${t} idonei; ${f} invii non riusciti; ${n} utenti devono prima avviare il bot in privato.`, detail: (t, s, f, n) => `Idonei: ${t} · Inviati: ${s} · Errori: ${f} · Avvio privato richiesto: ${n}` },
  de: { success: (t, s, f, n) => `An ${s} von ${t} berechtigten Nutzern gesendet; ${f} Zustellungen fehlgeschlagen; ${n} Nutzer müssen den Bot zuerst privat starten.`, detail: (t, s, f, n) => `Berechtigt: ${t} · Gesendet: ${s} · Fehlgeschlagen: ${f} · Privater Start nötig: ${n}` },
  pl: { success: (t, s, f, n) => `Wysłano do ${s} z ${t} uprawnionych użytkowników; nieudane dostarczenia: ${f}; ${n} użytkowników musi najpierw uruchomić bota prywatnie.`, detail: (t, s, f, n) => `Uprawnieni: ${t} · Wysłano: ${s} · Błędy: ${f} · Wymagany start prywatny: ${n}` },
  vi: { success: (t, s, f, n) => `Đã gửi cho ${s}/${t} người dùng đủ điều kiện; ${f} lượt gửi thất bại; ${n} người dùng cần khởi động bot riêng tư trước.`, detail: (t, s, f, n) => `Đủ điều kiện: ${t} · Đã gửi: ${s} · Thất bại: ${f} · Cần khởi động riêng: ${n}` },
};
export const dashboardBroadcastResultCopy = (locale: DashboardLocale) => templates[locale];
