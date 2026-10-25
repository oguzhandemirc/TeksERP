/**
 * "Belge ayarları" paneli — şablon sürümünün DONDURULMUŞ `ayar`ı (plan P-d). Dil
 * kilitlidir: tasarımcı şablonu Türkçe basar, İngilizce yalnız Sistem şablonundadır;
 * hangi yoldan gelirse gelsin `language` "tr"ye sabitlenir.
 */
export type DocumentSettings = Record<string, unknown>;

export const LANGUAGE_LOCK_NOTE = "Belge dili Türkçe (kilitli) — EN yalnız Sistem şablonunda.";
export const STYLE_MOVED_NOTE = "Stil ayarları şablona taşındı — Tasarımcı › Stil sekmesinden düzenlenir.";

export function lockLanguage(settings: DocumentSettings): DocumentSettings {
  return { ...settings, language: "tr" };
}

/** GrapesJS'ten bağımsız sarmalayıcı: GeneralSettings `patch` → yeni ayar nesnesi (dil kilitli). */
export function applySettingsPatch(settings: DocumentSettings, patch: Readonly<Record<string, unknown>>): DocumentSettings {
  const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => k !== "language"));
  return lockLanguage({ ...settings, ...rest });
}

export function settingsEqual(a: DocumentSettings, b: DocumentSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
