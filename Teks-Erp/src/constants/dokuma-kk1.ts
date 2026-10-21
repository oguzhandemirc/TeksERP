// =============================================================================
// KK1 TOP DOĞUŞU (dokuma.rollBirth) — sabitler
// =============================================================================
// D10 (2026-10-21): levent değişim penceresi SABİTTİR, ayar DEĞİL — sayısal ayar
// kapalı modülde ölü kapıdır; ilk sahada ölçüldükten sonra ayara terfi edebilir.
// KK1'de beyan edilen levent (`warpBeamId`) ancak o tezgahta bu pencere içinde
// takılmış/sökülmüş ise otomatik tüketime override olarak girer; aksi 400
// `WARP_BEAM_NOT_RECENT` (uydurulmuş levent beyanı defteri kirletmesin).
// =============================================================================

/** Beyan edilen leventin tezgahta MOUNTED/DISMOUNTED olayının en fazla kaç saat eski olabileceği. */
export const KK1_BEAM_CHANGE_WINDOW_HOURS = 12;
export const KK1_BEAM_CHANGE_WINDOW_MS = KK1_BEAM_CHANGE_WINDOW_HOURS * 3_600_000;

/** KK1 doğuşunda sunucunun yazdığı indirme notları (D9) — kaynak OPERATOR, sayaç NULL. */
export const KK1_DOFF_NOTE_LABEL = "KK1 doğuşu (etiket)";
export const KK1_DOFF_NOTE_ORDER = "KK1 doğuşu (dokuma iş emri)";
