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
