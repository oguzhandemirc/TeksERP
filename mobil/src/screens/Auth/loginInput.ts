// =============================================================================
// GİRİŞ ALANI TEMİZLEYİCİLERİ — saf mantık (ekran ince kabuk; `docs/standart/MOBIL.md`)
// =============================================================================
// İki alanın İKİ temizleyicisi vardır ve KARIŞTIRILMAZ (K bulgusu 2026-09-18): hızlı-PIN ve
// sayısal parola numpad'i yalnız RAKAM taşır; harfli (ABC) parola alanı ALFASAYISALdır. Sayısal
// süzmeyi harfli alana uygulamak (`\D` ile rakam-dışını atmak) alfasayısal parolayı sessizce bozar
// ("_yNh6z91473t" → "91473") ve sunucu "Geçersiz" der — bu yüzden ayrı fonksiyonlar + bekçi.
// =============================================================================

/** Sayısal alan (hızlı-PIN / sayısal parola numpad'i): yalnız rakam, `cap` uzunlukta. */
export function sanitizeNumericInput(text: string, cap: number): string {
  return text.replace(/\D/g, '').slice(0, cap);
}

/**
 * Harfli (ABC) parola alanı: parola alfasayısaldır — rakam SÜZÜLMEZ, yalnız uzunluk sınırı.
 * `sanitizeNumericInput` buraya uygulanırsa harfli/işaretli parola düşer ve giriş reddedilir.
 */
export function sanitizeAlphaInput(text: string, cap: number): string {
  return text.slice(0, cap);
}
