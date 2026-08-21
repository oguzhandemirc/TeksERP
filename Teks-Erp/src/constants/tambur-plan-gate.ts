// =============================================================================
// Tambur plan-gerçek sapma kapısı (2026-08-19, kullanıcı kararı: ONAYLI DEVAM)
// =============================================================================
// Saha senaryosu: iş emri MAVİ açıldı, mal boyandı, tamburda beklerken müşteri
// "gri olacaktı" dedi ve planlamacı hedefi GRİ'ye çevirdi. Tambur operatörü
// mavi topu kesip bitirdi — tek kelime uyarı görmeden — ve depoya gri beklenen
// sipariş için MAVİ mal indi. Yanlış en pahalı yerde (sevkiyatta) patladı.
//
// Karar: BLOK DEĞİL, ONAYLI DEVAM (SAP karşılığı "usage decision" — mal
// bloklanmaz ama biri "bunu böyle kabul ediyorum" diye imza atar; blok sahayı
// sistemin dışına iter). Sapma varsa finalize 409 `PLAN_MISMATCH` döner;
// operatör tablette detayı görüp onaylarsa aynı istek `confirmMismatch: true`
// ile tekrarlanır ve karar audit'e düşer.
//
// Kapsam (kullanıcı kararı: renk + EŞİKLİ en):
//   • RENK — top hedeften FARKLI renkte, ya da hedef varken top RENKSİZ.
//     ⚠️ Tersi (hedef renksiz + top boyalı) BİLİNÇLİ OLARAK KAPSAM DIŞI:
//     boyalı depo topu zımpara gibi renk-hedefsiz bir WO'ya meşru olarak
//     girer — orada topun renkli olması sapma değil, işin kendisidir.
//   • EN — iki değer de doluysa ve fark eşiği AŞARSA. Küçük fark üretimde
//     meşrudur (çekme payı, kenar kesimi); eşiksiz uyarı her topta öter ve
//     operatör uyarıyı okumamayı öğrenir.
//   • KALİTE bilinçli dışarıda: kalite kararı ZATEN tamburda verilir —
//     tamburun kendi kararını tambura sormak kendi kendine çelişir.
// =============================================================================

/** 409 `details.code` — istemci dedektörü (mesaj metnine string-match yapma). */
export const PLAN_MISMATCH_CODE = "PLAN_MISMATCH" as const;

/**
 * En sapması eşiği (cm). |top.width − wo.width| bu değeri AŞARSA sapma sayılır
 * (eşit fark sapma DEĞİL — "±10 cm'e kadar normal" okunur).
 *
 * Şimdilik sabit; panelden ayarlanabilir yapılacaksa SystemSetting'in DÖRT
 * KAPI kuralı uygulanır (tip + sanitize + controller Zod + Electron aynası) —
 * o maliyete ihtiyaç doğunca girilir, varsayılan buradan taşınır.
 */
export const TAMBUR_PLAN_WIDTH_TOLERANCE_CM = 10;

/**
 * `RollPlanDeviation.source` değeri — sapma FASON KABULDE onaylandı (2026-08-21):
 * operatör plandan farklı renk kabul edip "sadece bu toplar" dedi. Tambur kapısı
 * bu kaynaklı, aynı değerli satırı gören topa renk sorusunu TEKRAR SORMAZ
 * ("sapma bir kez onaylanır"). Kapının kendi kaynakları: finalize | cut |
 * finalize-open-fabric.
 */
export const FASON_RECEIPT_DEVIATION_SOURCE = "fason-receipt" as const;

/** Tek bir sapma satırı — 409 payload'ında ve audit'te aynı biçim. */
export interface PlanMismatchItem {
  field: "color" | "width";
  /** İnsan-okur özet ("Top MAVİ, iş emri GRİ istiyor"). */
  message: string;
  rollValue: string | number | null;
  planValue: string | number | null;
}
