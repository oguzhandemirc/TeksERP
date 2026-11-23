// "Terbiye İş Emri oluştur" seçicisinin atlanma kuralı (saf). Dokuma ayrı girişte (İE ayrımı 2026-11-23):
// burada yalnız terbiye seçenekleri sayılır. "Yeni özel" kartı izinliye seçiciyi gösterir — özel iş emri
// tanımlamanın menüden bulunan tek yolu budur; hiçbiri yoksa seçici atlanır = bugünkü doğrudan form.
export interface FinishingPickerInput {
  shortcutCount: number;
  scanRoute: boolean;
  canNewShortcut: boolean;
}

export function terbiyeSeciciGosterilir({ shortcutCount, scanRoute, canNewShortcut }: FinishingPickerInput): boolean {
  return shortcutCount > 0 || scanRoute || canNewShortcut;
}
