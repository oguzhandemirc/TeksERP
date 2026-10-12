// =============================================================================
// Gece bakım penceresi — fabrika saat diliminde 02:00–05:00 (SAF)
// =============================================================================
// Ağır bakım (audit arşivi, budama, yedek rotasyonu) vardiya içinde koşmasın diye
// tek pencere; duvar saati fabrikanın dilimidir, süreç dilimi değil.
// =============================================================================

import { factoryMinuteOfDay } from "../../constants/time";

export const MAINTENANCE_WINDOW_START_MINUTE = 2 * 60;
export const MAINTENANCE_WINDOW_END_MINUTE = 5 * 60;

/** `at` anı fabrika gününün bakım penceresinde mi ([başlangıç, bitiş)). */
export function isInMaintenanceWindow(at: Date): boolean {
  const start = factoryMinuteOfDay(at, MAINTENANCE_WINDOW_START_MINUTE).getTime();
  const end = factoryMinuteOfDay(at, MAINTENANCE_WINDOW_END_MINUTE).getTime();
  const t = at.getTime();
  return t >= start && t < end;
}
