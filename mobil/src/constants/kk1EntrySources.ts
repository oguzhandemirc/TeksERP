// =============================================================================
// KK1 LİSTELERİNİN GİRİŞ KAYNAĞI KAPSAMI + Türkçe etiketler (TEK KAYNAK)
// =============================================================================
// "Son Kayıtlar" ve "Tüm Girişler" sorguları `entrySource` CSV'siyle süzülür
// (backend `buildWhereClause` virgülü `in`'e çevirir). Kapsam iki yerde elle
// yazılıydı ve `WEAVING`i tanımıyordu (01 ölçtü 2026-09-14): tezgahtan inip
// KK1'de doğan top KK1 listelerinde GÖRÜNMEZDİ — kırılma değil görünürlük
// boşluğu; sahada WEAVING'li top bugün 0 ⇒ görünür fark 0.
//
// ⚠️ Etiket haritası `Record<RollEntrySource, string>`: union'a yeni değer
// gelince (ayna mandalı `test_mobil_enum_aynasi` backend'le birebirler) derleme
// burada durur — "bilinmeyen değer ham basılır" sınıfı doğmadan kapanır.
// =============================================================================
import type { RollEntrySource } from '../types/models';

/** KK1 listelerinde görünen kaynaklar — KK1'in kendi yazdıkları + panel elle giriş + tezgah. */
export const KK1_LIST_ENTRY_SOURCES: readonly RollEntrySource[] = [
  'SUPPLIER_RECEIPT',
  'MANUAL_ENTRY',
  'SEMI_FINISHED',
  'WEAVING',
];

/** Backend `entrySource` filtresi CSV bekler. */
export const KK1_LIST_ENTRY_SOURCE_CSV: string = KK1_LIST_ENTRY_SOURCES.join(',');

/** Operatörün okuduğu ad — rozet/etiket yüzeyi çizildiği gün buradan okunur. */
export const rollEntrySourceLabels: Record<RollEntrySource, string> = {
  SUPPLIER_RECEIPT: 'Ham giriş',
  MANUAL_ENTRY: 'Elle giriş (panel)',
  TAMBUR_SPLIT: 'Tambur kesim',
  SUBCONTRACTOR_RETURN: 'Fason dönüşü',
  TAMBUR_MANUAL: 'Tambur elle',
  PURCHASE_RECEIPT: 'Mal kabul',
  SEMI_FINISHED: 'Yarı mamul',
  WEAVING: 'Dokuma',
};
