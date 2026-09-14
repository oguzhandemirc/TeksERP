// =============================================================================
// KK1 GİRİŞ KAYNAĞI KAPSAMI — "KK1'in işi olan top" sorusunun TEK cevabı
// =============================================================================
// Mobil `constants/kk1EntrySources.ts` `KK1_LIST_ENTRY_SOURCES` ile BİREBİR aynı
// küme (bekçi: scripts/test_kk1_entry_sources.ts). Dashboard KK1 karnesi bu listeyi
// SQL'de elle yazıyordu ve `WEAVING`/`SEMI_FINISHED` doğan topu saymıyordu; tablet
// listesi dört kaynağa geçince iki yüzey ayrıştı (47 D3, 2026-09-14).
import { RollEntrySource } from "@prisma/client";

/** KK1 listelerinde/karnesinde sayılan kaynaklar — KK1'in kendi yazdıkları + panel elle giriş + yarı mamul + tezgah. */
export const KK1_ENTRY_SOURCES = [
  RollEntrySource.SUPPLIER_RECEIPT,
  RollEntrySource.MANUAL_ENTRY,
  RollEntrySource.SEMI_FINISHED,
  RollEntrySource.WEAVING,
] as const satisfies readonly RollEntrySource[];
