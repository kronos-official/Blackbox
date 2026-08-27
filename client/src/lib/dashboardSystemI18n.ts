import { normalizeDashboardLocale, type DashboardLocale } from "./dashboardI18n";

type DashboardSystemCopy = {
  notFoundTitle: string;
  notFoundText: string;
  goHome: string;
  unexpectedError: string;
  reloadPage: string;
  technicalDetails: string;
};

const systemCopy: Record<DashboardLocale, DashboardSystemCopy> = {
  fa: { notFoundTitle: "صفحه پیدا نشد", notFoundText: "صفحه‌ای که به‌دنبال آن هستید وجود ندارد یا جابه‌جا شده است.", goHome: "بازگشت به صفحهٔ اصلی", unexpectedError: "یک خطای غیرمنتظره رخ داد.", reloadPage: "بارگیری دوبارهٔ صفحه", technicalDetails: "جزئیات فنی" },
  en: { notFoundTitle: "Page not found", notFoundText: "The page you are looking for does not exist or has been moved.", goHome: "Return to home", unexpectedError: "An unexpected error occurred.", reloadPage: "Reload page", technicalDetails: "Technical details" },
  ar: { notFoundTitle: "الصفحة غير موجودة", notFoundText: "الصفحة التي تبحث عنها غير موجودة أو تم نقلها.", goHome: "العودة إلى الصفحة الرئيسية", unexpectedError: "حدث خطأ غير متوقع.", reloadPage: "إعادة تحميل الصفحة", technicalDetails: "التفاصيل التقنية" },
  tr: { notFoundTitle: "Sayfa bulunamadı", notFoundText: "Aradığınız sayfa yok veya taşınmış olabilir.", goHome: "Ana sayfaya dön", unexpectedError: "Beklenmeyen bir hata oluştu.", reloadPage: "Sayfayı yeniden yükle", technicalDetails: "Teknik ayrıntılar" },
  ru: { notFoundTitle: "Страница не найдена", notFoundText: "Запрошенная страница не существует или была перемещена.", goHome: "На главную", unexpectedError: "Произошла непредвиденная ошибка.", reloadPage: "Перезагрузить страницу", technicalDetails: "Технические сведения" },
  es: { notFoundTitle: "Página no encontrada", notFoundText: "La página que buscas no existe o se ha movido.", goHome: "Volver al inicio", unexpectedError: "Ocurrió un error inesperado.", reloadPage: "Recargar página", technicalDetails: "Detalles técnicos" },
  fr: { notFoundTitle: "Page introuvable", notFoundText: "La page que vous recherchez n’existe pas ou a été déplacée.", goHome: "Retour à l’accueil", unexpectedError: "Une erreur inattendue s’est produite.", reloadPage: "Recharger la page", technicalDetails: "Détails techniques" },
  pt: { notFoundTitle: "Página não encontrada", notFoundText: "A página que você procura não existe ou foi movida.", goHome: "Voltar ao início", unexpectedError: "Ocorreu um erro inesperado.", reloadPage: "Recarregar página", technicalDetails: "Detalhes técnicos" },
  it: { notFoundTitle: "Pagina non trovata", notFoundText: "La pagina cercata non esiste o è stata spostata.", goHome: "Torna alla home", unexpectedError: "Si è verificato un errore imprevisto.", reloadPage: "Ricarica la pagina", technicalDetails: "Dettagli tecnici" },
  de: { notFoundTitle: "Seite nicht gefunden", notFoundText: "Die gesuchte Seite existiert nicht oder wurde verschoben.", goHome: "Zur Startseite", unexpectedError: "Ein unerwarteter Fehler ist aufgetreten.", reloadPage: "Seite neu laden", technicalDetails: "Technische Details" },
  pl: { notFoundTitle: "Nie znaleziono strony", notFoundText: "Szukana strona nie istnieje lub została przeniesiona.", goHome: "Wróć do strony głównej", unexpectedError: "Wystąpił nieoczekiwany błąd.", reloadPage: "Odśwież stronę", technicalDetails: "Szczegóły techniczne" },
  vi: { notFoundTitle: "Không tìm thấy trang", notFoundText: "Trang bạn tìm không tồn tại hoặc đã được chuyển đi.", goHome: "Về trang chủ", unexpectedError: "Đã xảy ra lỗi không mong muốn.", reloadPage: "Tải lại trang", technicalDetails: "Chi tiết kỹ thuật" },
};

export function dashboardSystemCopyFor(locale: DashboardLocale): DashboardSystemCopy {
  return systemCopy[locale];
}

export function dashboardSystemCopy(): DashboardSystemCopy {
  const locale = typeof window === "undefined" ? "fa" : normalizeDashboardLocale(window.localStorage.getItem("kronos-dashboard-locale"));
  return dashboardSystemCopyFor(locale);
}
