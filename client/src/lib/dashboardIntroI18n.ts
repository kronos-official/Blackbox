import type { DashboardLocale } from "./dashboardI18n";

type DashboardIntroCopy = { loading: string; creator: string };

const copy: Record<DashboardLocale, DashboardIntroCopy> = {
  fa: { loading: "در حال آماده‌سازی کنترل سنتر", creator: "ساخته‌شده توسط" },
  en: { loading: "Preparing your command center", creator: "Created by" },
  ar: { loading: "جارٍ تجهيز مركز القيادة", creator: "من إنشاء" },
  tr: { loading: "Komuta merkezi hazırlanıyor", creator: "Oluşturan" },
  ru: { loading: "Подготавливаем центр управления", creator: "Создано" },
  es: { loading: "Preparando tu centro de control", creator: "Creado por" },
  fr: { loading: "Préparation de votre centre de contrôle", creator: "Créé par" },
  pt: { loading: "Preparando seu centro de comando", creator: "Criado por" },
  it: { loading: "Preparazione del centro di controllo", creator: "Creato da" },
  de: { loading: "Kontrollzentrum wird vorbereitet", creator: "Erstellt von" },
  pl: { loading: "Przygotowujemy centrum dowodzenia", creator: "Twórca" },
  vi: { loading: "Đang chuẩn bị trung tâm điều khiển", creator: "Được tạo bởi" },
};

export const dashboardIntroCopy = copy;
