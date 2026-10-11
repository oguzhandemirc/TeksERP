// =============================================================================
// TEZGAH ALARMLARI — GÖRÜNÜRLÜK REJİMİ (saf katman; `floor-regime.ts` kalıbı)
// =============================================================================
// Ekran TEZGAH İZLEME modülüne aittir (referans profilde KAPALI → karo çizilmez). Alarm
// bayrağı (`tezgah.alarmEnabled`) modül değil davranış bayrağıdır: kapalıyken ekran "kapalı"
// der, zil hiç çizilmez. Kapı izindir (`loom:alarm-view`), asıl sed backend.
// =============================================================================

export interface AlarmVisibilityContext {
  /** Tezgah izleme — ETKİN değer (`production && tezgah`). */
  tezgahEnabled: boolean;
}

/** Tezgah Alarmları karosu / palet girişi çizilsin mi? */
export function isLoomAlarmsVisible(ctx: AlarmVisibilityContext): boolean {
  return ctx.tezgahEnabled;
}
