// =============================================================================
// DEMO SEED — DOĞRULAMA
// =============================================================================
// Seed'in sonunda koşar ve İKİ soruyu ayrı ayrı cevaplar:
//   ① KABUL ÖLÇÜTLERİ tutuyor mu? (tutmuyorsa seed KIRMIZI biter)
//   ② Hangi ekran DOLU, hangisi boş? ("hiçbir ekran boş kalmayacak" sözünün
//      ölçülebilir karşılığı — bir senaryo sessizce atlanmışsa burada görünür)
//
// ⚠️ Sayaç TEK BAŞINA yetmez: "0 yeni" hem "zaten vardı" hem "hiç yazılmadı"
// demek olabilir. Bu yüzden doluluk tablosu MEVCUT TOPLAMLARI okur, seed'in o
// koşumda kaç satır eklediğini değil.
// =============================================================================
import prisma from "../../src/lib/prisma";

let hata = 0;

function olcut(ad: string, ok: boolean, detay = ""): void {
  if (ok) {
    console.log(`   ✅ ${ad}${detay ? ` — ${detay}` : ""}`);
  } else {
    hata++;
    console.error(`   ❌ ${ad}${detay ? ` — ${detay}` : ""}`);
  }
}

export async function dogrula(): Promise<number> {
  console.log("\n▶ KABUL ÖLÇÜTLERİ");

  // ── ⭐ 1) BİTMİŞ TOP RENKSİZ OLAMAZ (kullanıcı şartı) ─────────────────────
  const renksizBitmis = await prisma.roll.count({
    where: { status: { in: ["WAREHOUSE", "A1_STOCK", "SHIPPED"] }, colorId: null },
  });
  olcut(
    "Bitmiş/sevk edilmiş hiçbir top RENKSİZ değil",
    renksizBitmis === 0,
    renksizBitmis === 0 ? "0 renksiz" : `${renksizBitmis} RENKSİZ TOP VAR`,
  );

  // ── 2) HAM STOK renksiz KALMALI (ters yön — fazla düzeltme de hatadır) ────
  // Ham kumaş boyasız gelir; hepsine renk yazmak "renk üretimde kazanılır"
  // kuralını yalanlar ve KK1 ekranını yanlış öğretir.
  const hamRenkli = await prisma.roll.count({
    where: { status: "STOCK", entrySource: "SUPPLIER_RECEIPT", colorId: { not: null } },
  });
  const hamToplam = await prisma.roll.count({
    where: { status: "STOCK", entrySource: "SUPPLIER_RECEIPT" },
  });
  olcut(
    "Ham stok (KK1 girişi) RENKSİZ kalmış",
    hamToplam === 0 || hamRenkli / hamToplam < 0.2,
    `${hamRenkli}/${hamToplam} renkli`,
  );

  // ── 3) RAPOR PENCERESİ (son 30 gün) DOLU ─────────────────────────────────
  // `reports/_shared.ts` → `DEFAULT_RANGE_DAYS = 30`. Veri 4 aya EŞİT
  // dağıtılsaydı her rapor ilk açılışta neredeyse boş görünürdü.
  const otuzGun = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sonAySiparis = await prisma.order.count({ where: { orderDate: { gte: otuzGun } } });
  const sonAyTop = await prisma.roll.count({ where: { finalizedAt: { gte: otuzGun } } });
  olcut("Son 30 günde sipariş var (raporlar boş açılmasın)", sonAySiparis >= 5, `${sonAySiparis} sipariş`);
  olcut("Son 30 günde bitmiş top var (kalite karnesi)", sonAyTop >= 10, `${sonAyTop} top`);

  // ── EKRAN DOLULUK TABLOSU ────────────────────────────────────────────────
  console.log("\n▶ EKRAN DOLULUK");
  const satirlar: Array<[string, number]> = [
    ["Kumaşlar", await prisma.item.count({ where: { itemType: "FABRIC", isActive: true } })],
    ["Renkler", await prisma.color.count({ where: { isActive: true } })],
    ["Kumaş Özellikleri", await prisma.fabricProperty.count({ where: { isActive: true } })],
    ["İplik kartları", await prisma.item.count({ where: { itemType: "YARN" } })],
    ["Müşteriler", await prisma.customer.count({ where: { isActive: true, mergedIntoId: null } })],
    ["Siparişler", await prisma.order.count()],
    ["  └ iptal", await prisma.order.count({ where: { status: "CANCELLED" } })],
    ["Envanter — ham stok", await prisma.roll.count({ where: { status: "STOCK", entrySource: "SUPPLIER_RECEIPT" } })],
    ["Envanter — yarı mamul", await prisma.roll.count({ where: { entrySource: "SEMI_FINISHED" } })],
    ["Envanter — bitmiş depo", await prisma.roll.count({ where: { status: "WAREHOUSE" } })],
    ["Envanter — 2. kalite", await prisma.roll.count({ where: { status: "A1_STOCK" } })],
    ["Top Arşivi (iptal+fire)", await prisma.roll.count({ where: { status: { in: ["CANCELLED", "SCRAP"] } } })],
    ["İş emirleri", await prisma.workOrder.count()],
    ["Sevkiyatlar", await prisma.shipment.count()],
    ["Çuvallar", await prisma.sack.count()],
    ["Kartela sevkleri", await prisma.kartelaDispatch.count()],
    ["Fason sevkleri", await prisma.subcontractorDispatch.count()],
    ["Mal kabul fişleri", await prisma.goodsReceipt.count()],
    ["Alış siparişleri", await prisma.purchaseOrder.count()],
    ["Depo transferleri", await prisma.warehouseTransfer.count()],
    ["Stok sayımları", await prisma.stockCount.count()],
    ["Faturalar", await prisma.invoice.count()],
    ["Tahsilat/ödeme", await prisma.payment.count()],
    ["Çek/senet", await prisma.cheque.count()],
    ["Kasa hareketleri", await prisma.cashTransaction.count()],
    ["Kur satırları", await prisma.exchangeRate.count()],
  ];
  for (const [ad, n] of satirlar) {
    const isaret = n === 0 ? "○" : "✓";
    if (n === 0 && !ad.startsWith("  ")) hata++;
    console.log(`   ${isaret} ${ad.padEnd(26)} ${n}`);
  }

  return hata;
}
