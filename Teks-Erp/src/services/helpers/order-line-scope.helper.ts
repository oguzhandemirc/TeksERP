// =============================================================================
// SİPARİŞ KALEMİ KAPSAMI — "hangi kalem hâlâ talep sayılır" TEK KAYNAK
// =============================================================================
// 2026-08-27'de kalem iptali eklendi (`OrderLine.cancelledAt`). O günden sonra
// "açık talep" sorgularının HEPSİ iptal edilmiş kalemi dışlamak zorunda: WO
// picker, karşılanma, üretim dengesi, talep analizi, fason doğrudan sevk
// tahsisi… Elle kopyalanan bir `cancelledAt: null` bugün doğru olur, yarın
// birinin eklediği yeni yüzeyde unutulur ve iptal edilmiş kalem sessizce
// yaşamaya devam eder — planlamacı olmayan bir işi üretime alır.
//
// Bu yüzden koşul BURADA yaşar ve elle kopyalanması AST bekçisiyle yasaktır
// (`scripts/test_order_line_scope_single_source.ts`) — fason "açık+outstanding
// sevk" koşulunun (`fason-open-dispatch.helper.ts`) birebir emsali.
//
// ⚠️ NEREDE KULLANILMAZ: DEFTER ve TARİHÇE yüzeyleri. İptal edilmiş kalemin
// SEVK EDİLMİŞ metrajı gerçektir ve kaybolmamalıdır —
//   • `computeLineLedger` (sevk toplamı) iptal kalemi de okur,
//   • `recomputeOrderStatus` iptal kalemin İSTENEN'ini değil SEVK EDİLEN'ini sayar,
//   • sevkiyat detayı / irsaliye / muhasebe export'u geçmişi olduğu gibi basar.
// Kural tek cümleyle: **GELECEK sorusu süzer, GEÇMİŞ sorusu süzmez.**
// =============================================================================

import { Prisma } from "@prisma/client";

/** İptal edilmemiş (aktif) kalem. `cancelledAt IS NULL` = aktif. */
export const ACTIVE_LINE = { cancelledAt: null } as const;

/**
 * Aktif VE hâlâ açık kalem: istenen > sevk edilen.
 *
 * `quantity: { gt: <shippedQty alanı> }` alan-karşılaştırmasıdır ve Prisma'da
 * `prisma.orderLine.fields` referansı ister; çağıran client'ı (prisma ya da tx)
 * geçirir çünkü tx içinde `prisma.*` kullanmak farklı bir bağlantıdır.
 */
export function openLineWhere(fields: {
  shippedQty: Prisma.FieldRef<"OrderLine", "Decimal">;
}): { cancelledAt: null; quantity: { gt: Prisma.FieldRef<"OrderLine", "Decimal"> } } {
  return { ...ACTIVE_LINE, quantity: { gt: fields.shippedQty } };
}

/**
 * Siparişin AKTİF kalemi var mı — "lines: { some: … }" biçiminde.
 * Sipariş listesi/picker'ları bunu kullanır: tüm kalemleri iptal edilmiş bir
 * sipariş artık üretilecek bir iş taşımaz.
 */
export function someOpenLine(fields: {
  shippedQty: Prisma.FieldRef<"OrderLine", "Decimal">;
}): { lines: { some: ReturnType<typeof openLineWhere> } } {
  return { lines: { some: openLineWhere(fields) } };
}
