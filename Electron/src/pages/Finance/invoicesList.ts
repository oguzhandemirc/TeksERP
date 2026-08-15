// =============================================================================
// FATURA LİSTESİ — SAF KATMAN (taslak sayacı + kırpma bandı)
// =============================================================================
// Bekçi: `invoicesList.test.ts`.
//
// ⚠️⚠️ SAYAÇ **YÜKLENEN SAYFADAN** SAYILAMAZ (2026-08-15 düzeltmesi). İlk
// yazımda öyleydi ve rozet tam da VAR OLMA SEBEBİ olan taslakları göremiyordu:
//   • liste `pageSize: 100` ve `issueDate desc` sıralı;
//   • mal kabulden doğan alış taslağı `issueDate: receipt.createdAt` ile doğar
//     (`invoice.service`), yani ÜÇ HAFTA ÖNCEKİ bir fişten BUGÜN üretilen
//     taslak listenin başında değil ÜÇ HAFTA GERİDE durur.
// 100'den fazla faturası olan bir firmada o taslak ilk sayfaya hiç girmez →
// rozet çizilmez → "onay bekleyen taslak yok" okunur. Kırpma bandı bunu
// kapatmaz: bant listenin kesildiğini söyler, rozetin SIFIRLANDIĞINI değil.
//
// ⚠️ "Ayrı bir uç gerekir" gerekçesi de OLGUSAL OLARAK YANLIŞTI: aynı liste ucu
// `pagination.total` döndürüyor (`invoice.service` `count(where)`), yani
// `listInvoices({ status: "DRAFT", pageSize: 1 }).pagination.total` sistemdeki
// KESİN taslak sayısını tek hafif istekle veriyor.
//
// ⚠️ KAPSAM: sayaç, EKRANDAKİ diğer filtrelerle (arama/tür/cari) AYNI kapsamda
// sorulur — yalnız `status` TASLAĞA sabitlenir. Filtresiz global bir sayı,
// "PATOS müşterisi" süzgeciyle bakan kullanıcıya alakasız bir rakam gösterirdi.
// =============================================================================

/** Yüklenen satırlar arasındaki TASLAK sayısı (yalnız bilgi amaçlı; rozet KULLANMAZ). */
export function draftCountOf(rows: Array<{ status: string }>): number {
  return rows.filter((r) => r.status === "DRAFT").length;
}

/**
 * Sayaç rozeti metni — `null` ise rozet HİÇ ÇİZİLMEZ.
 *
 * @param total Sunucudan gelen KESİN taslak sayısı (`pagination.total`).
 *              `undefined` → sayı henüz bilinmiyor (yükleniyor/hata) → rozet yok;
 *              sıfırla karıştırma, "0 taslak" da zaten çizilmez.
 *
 * "0 taslak" bir bilgi değil gürültüdür; ayrıca DURUM SÜZGECİ taslağa
 * kilitliyken rozet totolojidir (listenin tamamı zaten taslak).
 */
export function draftBadgeText(total: number | undefined, statusFilter: string): string | null {
  if (statusFilter === "DRAFT") return null;
  if (total === undefined || total <= 0) return null;
  return `${total} taslak`;
}

/**
 * Kırpma bandı — sunucu sayfası dolduğunda "listenin tamamı bu değil" der.
 *
 * ⚠️ SESSİZ KIRPMA EN KÖTÜSÜDÜR: kullanıcı aradığı faturayı bulamayınca onu
 * "yok" sayar ve İKİNCİ KEZ keser. Emsal metin: `PurchaseOrdersPage`.
 */
export function trimNotice(total: number | undefined, shown: number): string | null {
  if (!total || total <= shown) return null;
  return `${total} faturanın ilk ${shown} tanesi gösteriliyor (en yeni tarihli önce). Aradığınızı bulmak için arama, tür ya da durum filtresini kullanın.`;
}
