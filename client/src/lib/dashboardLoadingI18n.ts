import type { DashboardLocale } from "./dashboardI18n";

export const dashboardLoadingStatus: Record<DashboardLocale, string> = {
  fa: "در حال آماده‌سازی مرکز کنترل شما…",
  en: "Preparing your control center…",
  ar: "جارٍ تجهيز مركز التحكم الخاص بك…",
  ru: "Подготавливаем ваш центр управления…",
  tr: "Kontrol merkeziniz hazırlanıyor…",
  es: "Preparando tu centro de control…",
  fr: "Préparation de votre centre de contrôle…",
  de: "Ihre Kommandozentrale wird vorbereitet…",
  it: "Preparazione del tuo centro di controllo…",
  pt: "Preparando sua central de controle…",
  pl: "Przygotowujemy centrum sterowania…",
  vi: "Đang chuẩn bị trung tâm điều khiển của bạn…",
};

export const dashboardLoadingStages: Record<DashboardLocale, string[]> = {
  fa: ["در حال آماده‌سازی مرکز کنترل شما…", "در حال همگام‌سازی گروه‌ها…", "در حال مرتب‌سازی آمار و اعلان‌ها…", "تقریباً آماده است…"],
  en: ["Preparing your control center…", "Syncing your groups…", "Organizing stats and notifications…", "Almost ready…"],
  ar: ["جارٍ تجهيز مركز التحكم الخاص بك…", "جارٍ مزامنة مجموعاتك…", "جارٍ ترتيب الإحصاءات والتنبيهات…", "أوشكنا على الانتهاء…"],
  ru: ["Подготавливаем центр управления…", "Синхронизируем ваши группы…", "Сортируем статистику и уведомления…", "Почти готово…"],
  tr: ["Kontrol merkeziniz hazırlanıyor…", "Gruplarınız eşitleniyor…", "İstatistikler ve bildirimler düzenleniyor…", "Neredeyse hazır…"],
  es: ["Preparando tu centro de control…", "Sincronizando tus grupos…", "Organizando estadísticas y avisos…", "Casi listo…"],
  fr: ["Préparation de votre centre de contrôle…", "Synchronisation de vos groupes…", "Organisation des statistiques et notifications…", "Presque prêt…"],
  de: ["Ihre Kommandozentrale wird vorbereitet…", "Ihre Gruppen werden synchronisiert…", "Statistiken und Benachrichtigungen werden sortiert…", "Fast fertig…"],
  it: ["Preparazione del tuo centro di controllo…", "Sincronizzazione dei tuoi gruppi…", "Organizzazione di statistiche e notifiche…", "Quasi pronto…"],
  pt: ["Preparando sua central de controle…", "Sincronizando seus grupos…", "Organizando estatísticas e notificações…", "Quase pronto…"],
  pl: ["Przygotowujemy centrum sterowania…", "Synchronizujemy grupy…", "Porządkujemy statystyki i powiadomienia…", "Prawie gotowe…"],
  vi: ["Đang chuẩn bị trung tâm điều khiển…", "Đang đồng bộ các nhóm…", "Đang sắp xếp thống kê và thông báo…", "Gần hoàn tất…"],
};
