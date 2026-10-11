// =============================================================================
// ALARM SORUMLULARI — GÖRÜNÜRLÜK REJİMİ (saf katman; `alarm-regime.ts` kalıbı)
// =============================================================================
// Ekran TEZGAH İZLEME modülüne aittir (Tezgah Alarmları karosuyla aynı yüklem). Alarm bayrağı modül değil
// davranış bayrağıdır: kapalıyken ekran "kapalı" der (sunucu 403 `LOOM_ALARM_DISABLED`). Kapı `loom:spec-manage`.
// =============================================================================
import type { AlarmVisibilityContext } from "@/pages/Operations/LoomAlarms/alarm-regime";

/** Alarm Sorumluları karosu / palet girişi çizilsin mi? Gövde `return ctx.<alan>` kalır: karo↔manifesto bekçisi metinden okur. */
export function isLoomAlarmDutyVisible(ctx: AlarmVisibilityContext): boolean {
  return ctx.tezgahEnabled;
}
