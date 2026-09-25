// =============================================================================
// "TÜKENENE KADAR" KARTIN AYARLANABİLİR DAVRANIŞI — URUN-YASAM-DONGUSU.md §4.1
// =============================================================================
// Üç kurulum ayarı (enum, tek grup, profil DEĞİL); varsayılanlar kullanıcının seçtiği
// şıklardır. "Tükenene kadar" yeni bir durum olduğu için varsayılanlar kimsenin
// bugününü değiştirmez (§4.1 ölçümü). Çekirdek kapı (pasif kartta canlı kayıt olamaz)
// bu ayarlara BAĞLANMAZ.
//
// Yaprak modül: `system-setting.service` okuyucuları ve yazma dallarını, kullanım
// politikası (`item-usage.helper`) kararı buradan alır.
// =============================================================================

/** A1 — Tükenene kadar karta yeni sipariş satırı. */
export type PhaseOutNewOrder = "OKUTULAN_TOPLAR" | "KAPALI" | "SERBEST";
export const PHASE_OUT_NEW_ORDER_VALUES: PhaseOutNewOrder[] = ["OKUTULAN_TOPLAR", "KAPALI", "SERBEST"];
export const DEFAULT_PHASE_OUT_NEW_ORDER: PhaseOutNewOrder = "OKUTULAN_TOPLAR";

/** A2 — açık sipariş satırında miktar değişimi. */
export type PhaseOutLineQty = "SERBEST_UYARILI" | "AZALTMA_SERBEST" | "KILITLI";
export const PHASE_OUT_LINE_QTY_VALUES: PhaseOutLineQty[] = ["SERBEST_UYARILI", "AZALTMA_SERBEST", "KILITLI"];
export const DEFAULT_PHASE_OUT_LINE_QTY: PhaseOutLineQty = "SERBEST_UYARILI";

/** A3 — yeni üretim planı (topsuz ve siparişsiz iş emri · hedef ürün değişimi · dokuma işi). */
export const DEFAULT_PHASE_OUT_NEW_PLAN_ENABLED = true;

/** A2 `SERBEST_UYARILI` uyarısı — kullanıcının onayladığı sade metin (§4.1). */
export const PHASE_OUT_LINE_QTY_WARNING =
  "Bu ürün tükenene kadar satılıyor. Stokta yeterli top olduğunu kontrol edin.";

/** KAPALI + sevkte sipariş zorunlu birleşiminin TEK çıkışı "Siparişsiz devam et" beyanıdır. */
export const PHASE_OUT_EXIT_WARNING =
  "Bu ayarlarla 'Tükenene kadar' kartların malı yalnız 'Siparişsiz devam et' ile sevk edilebilir.";

/**
 * ÇIKIŞ UYARISI (1e kararı 2026-09-25 — kapı DEĞİL): `shipping.orderRequirement=block` iken
 * "Siparişsiz devam et" (`orderless`) üç sevk yolunda da muaftır, yani KAPALI + block
 * çıkışsız değildir; kapı meşru bir yapılandırmayı reddederdi. İki ayarın yazma dalı da bu
 * yüklemi çağırır ve yanıta `warnings` ekler. Çıkışın varlığını her birleşimde
 * `test_item_lifecycle_exit_gate` matrisi ölçer.
 */
export function phaseOutExitWarning(newOrder: PhaseOutNewOrder, orderRequirement: string): string | null {
  return newOrder === "KAPALI" && orderRequirement === "block" ? PHASE_OUT_EXIT_WARNING : null;
}
