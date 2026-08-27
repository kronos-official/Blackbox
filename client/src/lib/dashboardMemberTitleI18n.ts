import type { DashboardLocale } from "./dashboardI18n";

export const dashboardMemberTitleCopy: Record<DashboardLocale, {
  label: string;
  placeholder: string;
  save: string;
  clear: string;
  saved: string;
}> = {
  fa: { label: "لقب داخلی Kronos", placeholder: "لقب داخلی را وارد کنید", save: "ذخیره", clear: "حذف لقب", saved: "لقب داخلی ذخیره شد." },
  en: { label: "Kronos internal title", placeholder: "Enter an internal title", save: "Save", clear: "Remove title", saved: "Internal title saved." },
  ar: { label: "اللقب الداخلي لـ Kronos", placeholder: "أدخل لقباً داخلياً", save: "حفظ", clear: "حذف اللقب", saved: "تم حفظ اللقب الداخلي." },
  tr: { label: "Kronos dahili unvanı", placeholder: "Dahili unvan girin", save: "Kaydet", clear: "Unvanı kaldır", saved: "Dahili unvan kaydedildi." },
  ru: { label: "Внутренний титул Kronos", placeholder: "Введите внутренний титул", save: "Сохранить", clear: "Удалить титул", saved: "Внутренний титул сохранён." },
  es: { label: "Título interno de Kronos", placeholder: "Introduce un título interno", save: "Guardar", clear: "Quitar título", saved: "Título interno guardado." },
  fr: { label: "Titre interne Kronos", placeholder: "Saisissez un titre interne", save: "Enregistrer", clear: "Supprimer le titre", saved: "Titre interne enregistré." },
  pt: { label: "Título interno do Kronos", placeholder: "Insira um título interno", save: "Guardar", clear: "Remover título", saved: "Título interno guardado." },
  it: { label: "Titolo interno Kronos", placeholder: "Inserisci un titolo interno", save: "Salva", clear: "Rimuovi titolo", saved: "Titolo interno salvato." },
  de: { label: "Interner Kronos-Titel", placeholder: "Internen Titel eingeben", save: "Speichern", clear: "Titel entfernen", saved: "Interner Titel gespeichert." },
  pl: { label: "Wewnętrzny tytuł Kronos", placeholder: "Wpisz tytuł wewnętrzny", save: "Zapisz", clear: "Usuń tytuł", saved: "Wewnętrzny tytuł zapisany." },
  vi: { label: "Danh hiệu nội bộ Kronos", placeholder: "Nhập danh hiệu nội bộ", save: "Lưu", clear: "Xóa danh hiệu", saved: "Đã lưu danh hiệu nội bộ." },
};
