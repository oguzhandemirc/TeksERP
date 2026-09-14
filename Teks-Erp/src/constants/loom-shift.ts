// =============================================================================
// Vardiya karnesi sabitleri — Faz 1b'de SABİT, Faz 2'de `tezgah.*` bayrağı olur.
// Değer karneye DONAR (`MachineShiftStat.stopThresholdSec`): bayrak geldiğinde
// eski karneler eski eşikle kalır, seri kıyaslanabilir olur.
// =============================================================================

/**
 * Mikro duruş eşiği (sn) — bu sürenin ALTINDAKİ duruş `MINOR` sayılır: APT'den
 * DÜŞÜLMEZ, performansta erir. Tasarım `tezgah.stopEventMinSeconds` varsayılanı
 * (DOKUMA-TEZGAH §6.3 tablosu: 20). `MINOR` bir SÜRE sınıfıdır, sebep değil;
 * `ReasonPreset.stopLossClass`a yazılamaz — tek türetici `loom-shift-terms.helper`.
 */
export const MINOR_STOP_THRESHOLD_SEC = 20;

/** Oran formülünün sürümü — mühürde denormalize edilir; formül değişirse artar. */
export const LOOM_KPI_FORMULA_VERSION = 1;

/**
 * GÖLGE MOD KABUL EŞİĞİ — LIVE'a geçiş için MÜHÜRLÜ ∧ `monitoringState=SHADOW` donmuş karne
 * sayısı (DOKUMA-TEZGAH §2.3 ② `SHADOW_TOO_SHORT`, tasarım `tezgah.shadowMinShifts` = 15).
 * ⚠️ Bugün SABİT (Faz 1b); Faz 2'de `tezgah.*` DAVRANIŞ BAYRAĞINA taşınır — o gün DEFAULT
 * bu değer olur (= bugünkü davranış), okuyucu `?? SHADOW_MIN_SHIFTS` ile düşer.
 */
export const SHADOW_MIN_SHIFTS = 15;
