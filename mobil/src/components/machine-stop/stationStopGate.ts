// =============================================================================
// İSTASYON DURUŞ KAPISI (2026-11-09) — `Station.machineStopEnabled` tablet yansıması
// =============================================================================
// Sunucu oturum yanıtında `station.machineStopEnabled` taşır; false iken duruş AÇMA yüzeyi
// (başlık çipi, Dokuma "Duruş Bildir") çizilmez. Eski sunucu alanı göndermez → açık (bugünkü).
// Açık duruş varsa çip/bant yine çizilir: kapatma/sebep atama serbest (sunucu da kesmez).
// =============================================================================

/** Oturum istasyonu duruş AÇMAYA izin veriyor mu? Alan yoksa (eski sunucu) true. */
export function stationAllowsStopOpen(station: { machineStopEnabled?: boolean } | null | undefined): boolean {
  return station?.machineStopEnabled !== false;
}

/** Başlık çipi çizilsin mi: kapı (izin ∧ ayar ∧ makine) ∧ uç erişilebilir ∧ (istasyon izin verir ∨ açık duruş var). */
export function machineStopChipVisible(g: { enabled: boolean; unavailable: boolean; stationAllows: boolean; stopOpen: boolean }): boolean {
  return g.enabled && !g.unavailable && (g.stationAllows || g.stopOpen);
}
