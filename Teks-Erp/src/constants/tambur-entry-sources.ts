// =============================================================================
// TAMBUR'DAN ÇIKAN TOP KAPSAMI — "Tambur istasyonundan çıkan top" sorusunun TEK cevabı
// =============================================================================
// İki doğum yolu: TAMBUR_SPLIT (kesim çocuğu, kart okutulmuş akış) · TAMBUR_MANUAL
// ("Manuel Ekle", kartsız bitmiş top — 2026-08-03'te listeye girdi; eksikliği
// operatörü topu sıfırdan girmeye, yani mükerrer stok yazmaya itiyordu). Küme
// `tambur.service` Çıkanlar listesinde elle yazılıydı; KK1_ENTRY_SOURCES emsaliyle
// tek sabite alındı (bekçi: scripts/test_kk1_entry_sources.ts §4).
import { RollEntrySource } from "@prisma/client";

/** Tambur Çıkanlar listesinde/karnesinde sayılan kaynaklar. */
export const TAMBUR_ENTRY_SOURCES = [
  RollEntrySource.TAMBUR_SPLIT,
  RollEntrySource.TAMBUR_MANUAL,
] as const satisfies readonly RollEntrySource[];
