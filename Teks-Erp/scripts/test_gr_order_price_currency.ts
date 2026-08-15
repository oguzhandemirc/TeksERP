// =============================================================================
// BEKÇİ — MAL KABUL ↔ ALIŞ SİPARİŞİ: PARA BİRİMİ GUARD'I + SÖZLEŞME FİYATI + VADE
// =============================================================================
// Çalıştırma: npx tsx scripts/test_gr_order_price_currency.ts
//
// NEDEN VAR (2026-08-15 saha taraması, "çifte-giriş" merceği) — üç ayrı boşluk,
// hepsi aynı üçgende (sipariş → fiş → alış faturası):
//
//  ③ PARA BİRİMİ SESSİZ VE BÜYÜK: "Kalemleri siparişten doldur" fiyatları
//     SİPARİŞİN para biriminde satıra yazıyor, fiş ise TRY kaydediliyordu.
//     Alış faturası `receipt.currency` ile kesiliyor, TRY kuru 1 olduğu için
//     cari defter ~30 kat yanlışlanıyordu — hata yok, log yok. Tedarikçi
//     çelişkisinin guard'ı vardı, para biriminin YOKTU.
//  ④ SÖZLEŞME FİYATI HİÇ OKUNMUYORDU: `invoice.service` içinde "purchaseOrder"
//     kelimesi hiç geçmiyordu. Depocu "siparişten doldur" demediyse satın
//     almacının anlaştığı fiyat kayboluyor, fatura kart fiyatıyla doğuyor ve
//     muhasebeci aynı rakamı ÜÇÜNCÜ kez yazıyordu. Satış tarafında aynı kural
//     zaten uygulanıyordu (`shipment-auto-draft.helper`) — bu onun ALIŞ ikizi.
//  ⑤ VADE: otomatik taslak `dueDate` hiç yazmıyordu → Faturalar listesi
//     "gecikmemiş" (yalnız `Invoice.dueDate`e bakar), Yaşlandırma raporu
//     "gecikmiş" (`issueDate + paymentTermDays` fallback'i) diyordu. Aynı
//     faturaya iki ekran iki cevap veriyordu.
//
// ÖLÇÜLENLER:
//   §1 Para birimi çelişkisi fiş AÇILIŞINDA 400 + mesaj İKİ para birimini de
//      söylüyor · aynı para biriminde sorunsuz açılıyor
//   §2 ⭐ Çelişki fiş BAĞLIYKEN de yakalanıyor (sipariş OPEN'ken para birimi
//      değiştirilebiliyor → boş fişe satır eklerken)
//   §3 ⭐ Sözleşme fiyatı KART fiyatını EZİYOR (satırda fiyat YOKKEN)
//   §4 ⭐ Satırın DONMUŞ fiyatı sözleşme fiyatını EZİYOR ("ASLA EZMEZ" kuralı)
//   §5 ⭐ Çelişkili sipariş fiyatı UYDURULMUYOR (kart fiyatına düşülüyor) ve
//      sayaç MESAJDA söyleniyor
//   §6 ⭐ Vade cari kartının `paymentTermDays`inden türüyor · vade tanımsızsa
//      dueDate NULL (uydurma yok)
//   §8 ⭐⭐ GERÇEK SAHA SIRASI: kart fiyatı fişten ÖNCE tanımlıyken de sözleşme
//      fiyatı kazanıyor · karar fiş mesajında söyleniyor · SİPARİŞSİZ fişte
//      kart fiyatı hâlâ kazanıyor (kapsam kontrolü)
//   §7 Körlük zemini
//
// ⚠️ §8 NEDEN AYRI VE NEDEN SONDA: bu bekçinin İLK yazımı katmanı yalnız
// FATURA tarafında ölçüyordu ve §3 fixture'ı kart fiyatını bilerek fişten
// SONRA yaratıyordu — yani "doğru sonucu YANLIŞ sebeple" veriyordu. Gerçek
// kurulumda kart fiyatı ZATEN vardır ve o sırada katman hiç çalışmıyordu
// (mal kabul kart fiyatını kabul anında donduruyor, fatura zinciri ilk terimde
// duruyor). Düzeltme katmanı `goods-receipt.addLines`e taşıdı; §8 tam o sırayı
// kurar. Fixture'ın SIRASI ölçünün parçasıdır — değiştirme.
//
// NEGATİF SONDALAR (2026-08-15 — dördü de koşuldu, kırmızı GÖRÜLDÜ, dosyalar
// shasum ile birebir geri yüklendi):
//   • `assertReceiptOrderCurrency` gövdesi no-op yapıldı → §1a · §1b · §2a ·
//     §2b KIRMIZI (dört kontrol).
//   • Kumaş fiyat zincirinden `contractPriceOf(...)` çıkarıldı → §3b (satır
//     kart fiyatı 2.00 ile doğdu) · §3c · §5b KIRMIZI.
//   • `dueDate` alanı `createDraft` çağrısından düşürüldü → §6b KIRMIZI
//     ("due=(yok)"). ⚠️ §6a bu sondada YEŞİL KALIR ve bu DOĞRUDUR: o kontrol
//     "vade tanımsızsa yazılmaz" diyor, sonda da tam olarak onu yapıyor —
//     §6a'yı da kırmızıya düşüren bir kurgu, kontrolü anlamsızlaştırırdı.
//   • `goods-receipt.priceFor` zincirinden `contract.priceOf(...)` çıkarıldı
//     (yani katman ESKİ hâline, yalnız faturaya döndürüldü) → §8a · §8b · §8c
//     KIRMIZI (top 2.00 ile dondu, fatura 2.00 bastı) + §3c · §3d KIRMIZI.
// =============================================================================
import { PriceKind } from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import { goodsReceiptService } from "../src/services/goods-receipt.service";
import { purchaseOrderService } from "../src/services/purchase-order.service";
import { invoiceService } from "../src/services/invoice.service";
import { ensureDefaultWarehouse } from "../src/jobs/default-warehouse.job";
import { D } from "../src/services/helpers/finance.helper";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.error(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
async function expectError(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "";
  } catch (e) {
    return (e as Error).message;
  }
}

const TAG = `TEST-GRPC-${Date.now()}`;
const receiptIds: string[] = [];
const poIds: string[] = [];
const invoiceIds: string[] = [];
const cariIds: string[] = [];
const customerIds: string[] = [];
const itemIds: string[] = [];
const priceIds: string[] = [];
const rateIds: string[] = [];
const startedAt = Date.now();

async function main(): Promise<void> {
  console.log("=== Mal kabul ↔ alış siparişi: para birimi + sözleşme fiyatı + vade ===\n");

  const wh = await ensureDefaultWarehouse();
  if (!wh) throw new Error("Varsayılan depo yok.");
  const item = await prisma.item.create({
    data: { code: `${TAG}-ITM`, name: `${TAG} KUMAŞ`, itemType: "FABRIC", unit: "MT" },
    select: { id: true, name: true },
  });
  itemIds.push(item.id);
  const supplier = await prisma.customer.create({
    data: { code: `${TAG}-SUP`, name: `${TAG} Tedarikçi`, type: "SUPPLIER" },
    select: { id: true },
  });
  customerIds.push(supplier.id);

  // ⚠️ KUR FİXTURE'I TESTİN KENDİSİNE AİT (CLAUDE.md: "ortamdaki veriye BAĞIMLI
  // OLMA"). Bu bekçi ilk yazımında bugüne ait bir USD kuru bulunmasına
  // güveniyordu ve YALNIZ `test_goods_receipt_invoice`den SONRA koştuğunda
  // yeşildi (o test aynı kuru upsert ediyor); tek başına koşturulunca
  // `createDraft` "USD için kur bulunamadı" ile 400 verip paketi düşürdü.
  // Ürün davranışı DOĞRU — kur uydurmuyor; kırılan şey fixture'dı.
  // ⚠️ Var olan kuru EZMEZ ve yalnız KENDİ yarattığını siler: aynı gün gerçek
  // kur girilmişse onu değiştirmek başka ekranların rakamını kaydırırdı.
  const rateDay = new Date();
  rateDay.setUTCHours(0, 0, 0, 0);
  const rateRow = await prisma.exchangeRate.upsert({
    where: { rateDate_currency: { rateDate: rateDay, currency: "USD" } },
    update: {},
    create: { rateDate: rateDay, currency: "USD", rate: "40.000000", source: "MANUAL" },
    select: { id: true, createdAt: true },
  });
  if (rateRow.createdAt.getTime() >= startedAt) rateIds.push(rateRow.id);

  // ── §1 PARA BİRİMİ ÇELİŞKİSİ — fiş AÇILIŞINDA ───────────────────────────
  const poUsd = await purchaseOrderService.create({
    supplierId: supplier.id,
    currency: "USD",
    lines: [{ itemId: item.id, qty: 1000, unitPrice: 3.5 }],
  });
  const poUsdId = (poUsd.data as { id: string }).id;
  poIds.push(poUsdId);

  const clashMsg = await expectError(() =>
    goodsReceiptService.create({
      warehouseId: wh.id,
      supplierId: supplier.id,
      purchaseOrderId: poUsdId,
      currency: "TRY", // ⚠️ panelin bugünkü sabit varsayılanı
      lines: [{ itemId: item.id, initialQty: 100 }],
    }),
  );
  check("§1a ⭐ USD siparişe TRY fiş REDDEDİLDİ", clashMsg.length > 0, clashMsg.slice(0, 140));
  check(
    "§1b Mesaj İKİ para birimini de söylüyor (düzeltilecek alan belli)",
    clashMsg.includes("TRY") && clashMsg.includes("USD"),
    clashMsg.slice(0, 160),
  );
  const okReceipt = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    purchaseOrderId: poUsdId,
    currency: "USD",
    lines: [{ itemId: item.id, initialQty: 100 }],
  });
  const okReceiptId = (okReceipt.data as { id: string }).id;
  receiptIds.push(okReceiptId);
  check("§1c Aynı para biriminde fiş sorunsuz açıldı", Boolean(okReceiptId));

  // ── §2 ÇELİŞKİ FİŞ BAĞLIYKEN DE YAKALANIYOR ─────────────────────────────
  // Senaryo gerçek: fiş boş açılır (satır sonra eklenir), sipariş hâlâ OPEN
  // olduğu için para birimi düzenlenebilir → ilk satır çelişkiyi taşır.
  const poTry = await purchaseOrderService.create({
    supplierId: supplier.id,
    currency: "TRY",
    lines: [{ itemId: item.id, qty: 500, unitPrice: 42 }],
  });
  const poTryId = (poTry.data as { id: string }).id;
  poIds.push(poTryId);
  const lateReceipt = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    purchaseOrderId: poTryId,
    currency: "TRY",
  });
  const lateId = (lateReceipt.data as { id: string }).id;
  receiptIds.push(lateId);
  await purchaseOrderService.update(poTryId, { currency: "EUR" });
  const lateMsg = await expectError(() =>
    goodsReceiptService.addLines(lateId, [{ itemId: item.id, initialQty: 10 }]),
  );
  check("§2a ⭐ Sipariş sonradan EUR'ya çevrildi → satır ekleme REDDEDİLDİ", lateMsg.length > 0, lateMsg.slice(0, 140));
  check("§2b Mesaj aynı kuralı söylüyor (TRY ↔ EUR)", lateMsg.includes("TRY") && lateMsg.includes("EUR"), lateMsg.slice(0, 160));
  // Sipariş geri TRY'ye çevrilince satır girer — guard "kilit" değil "çelişki".
  await purchaseOrderService.update(poTryId, { currency: "TRY" });
  const lateOk = await goodsReceiptService.addLines(lateId, [{ itemId: item.id, initialQty: 10 }]);
  check("§2c Çelişki giderilince satır girdi", lateOk.created.length + lateOk.createdYarn.length === 1, JSON.stringify(lateOk.failed));

  // ── §3 SÖZLEŞME FİYATI KART FİYATINI EZİYOR ─────────────────────────────
  // Kart fiyatı: 2.00 USD · sipariş fiyatı: 3.50 USD · satırda fiyat YOK.
  //
  // ⚠️ KART FİYATI FİŞTEN SONRA YARATILIR ve bu BİLİNÇLİDİR: mal kabul D2
  // ön-dolumunu KABUL ANINDA yapıyor (kart fiyatı o an varsa `Roll.
  // purchasePrice`e DONAR ve fatura zinciri onu kullanır — ki bu doğrudur,
  // "fişte donan fiyat kazanır"). Ölçülen şey, satırın fiyatsız kaldığı
  // durumda sözleşme fiyatının kart fiyatının ÖNÜNE geçmesi.
  const cardPrice = await prisma.itemPrice.create({
    data: { itemId: item.id, customerId: null, kind: PriceKind.PURCHASE, currency: "USD", price: "2.0000" },
    select: { id: true },
  });
  priceIds.push(cardPrice.id);
  const draft1 = await invoiceService.createDraftFromGoodsReceipt(okReceiptId);
  invoiceIds.push(draft1.data.id);
  const inv1 = await prisma.invoice.findUniqueOrThrow({
    where: { id: draft1.data.id },
    select: { currency: true, dueDate: true, lines: { select: { unitPrice: true, qty: true } } },
  });
  check("§3a Fatura fişin para biriminde (USD)", inv1.currency === "USD", inv1.currency);
  check(
    "§3b ⭐ Satır SİPARİŞ fiyatını aldı (3.50), kart fiyatını (2.00) DEĞİL",
    inv1.lines.length === 1 && D(inv1.lines[0]!.unitPrice).equals(D("3.5")),
    `unitPrice=${inv1.lines[0]?.unitPrice}`,
  );
  // ⚠️ SAYAÇ ARTIK FİŞ MESAJINDA (2026-08-15 düzeltmesi): fiyat kararı satırın
  // DOĞDUĞU yerde veriliyor, dolayısıyla "sipariş fiyatı kullanıldı" cümlesinin
  // yeri de orası. Fatura mesajı yalnız ARTIK durumlarda (top fiyatsız kaldıysa)
  // konuşur — §5 tam olarak onu ölçer.
  check(
    "§3c Fiş mesajı kaç kalemde sipariş fiyatı kullanıldığını söylüyor",
    (okReceipt.message ?? "").includes("sipariş fiyatı kullanıldı"),
    okReceipt.message ?? "",
  );
  const frozen1 = await prisma.roll.findFirst({
    where: { goodsReceiptId: okReceiptId },
    select: { purchasePrice: true },
  });
  check(
    "§3d ⭐ Topun DONMUŞ fiyatı sözleşme fiyatı (3.50) — kart fiyatı 2.00 değil",
    frozen1?.purchasePrice != null && D(frozen1.purchasePrice).equals(D("3.5")),
    `Roll.purchasePrice=${frozen1?.purchasePrice}`,
  );

  // ── §4 SATIRIN DONMUŞ FİYATI SÖZLEŞMEYİ EZİYOR ──────────────────────────
  // "ASLA EZMEZ" kuralı: fişte fiyat DOLUYSA o kazanır (malı teslim alan
  // kişinin bilinçli girdisi; çoğu zaman zaten siparişten doldurulmuş hâli).
  const poUsd2 = await purchaseOrderService.create({
    supplierId: supplier.id,
    currency: "USD",
    lines: [{ itemId: item.id, qty: 200, unitPrice: 3.5 }],
  });
  const poUsd2Id = (poUsd2.data as { id: string }).id;
  poIds.push(poUsd2Id);
  const rcpt2 = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    purchaseOrderId: poUsd2Id,
    currency: "USD",
    lines: [{ itemId: item.id, initialQty: 50, unitPrice: 9.99 }],
  });
  const rcpt2Id = (rcpt2.data as { id: string }).id;
  receiptIds.push(rcpt2Id);
  const draft2 = await invoiceService.createDraftFromGoodsReceipt(rcpt2Id);
  invoiceIds.push(draft2.data.id);
  const inv2Lines = await prisma.invoiceLine.findMany({
    where: { invoiceId: draft2.data.id },
    select: { unitPrice: true },
  });
  check(
    "§4a ⭐ Fişte girilen fiyat (9.99) korundu — sipariş fiyatı EZMEDİ",
    inv2Lines.length === 1 && D(inv2Lines[0]!.unitPrice).equals(D("9.99")),
    `unitPrice=${inv2Lines[0]?.unitPrice}`,
  );

  // ── §5 ÇELİŞKİLİ SİPARİŞ FİYATI UYDURULMUYOR ────────────────────────────
  // Aynı ürüne İKİ farklı fiyatlı kalem → ortalama YASAK; zincirin bir sonraki
  // katmanına (kart fiyatı, yoksa 0) düşülür ve sayaç mesajda söylenir.
  //
  // ⚠️ FİXTURE AYRI KALEM KULLANIR ve bu ZORUNLU: mal kabul `addLines` D2
  // ön-dolumunu KABUL ANINDA yapıyor, yani kart fiyatı varsa `Roll.
  // purchasePrice` DOLU doğar ve fatura zinciri sözleşme katmanına HİÇ
  // düşmez. Bu bekçinin ilk yazımında §5, `item`ın kart fiyatını taşıdığı
  // için "doğru sonucu YANLIŞ sebeple" veriyordu (fiyat 2.00'di ama sözleşme
  // katmanı hiç çalışmamıştı) — sahte yeşil. Kalem ayrımı o tuzağı kapatır.
  const item2 = await prisma.item.create({
    data: { code: `${TAG}-ITM2`, name: `${TAG} KUMAŞ 2`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemIds.push(item2.id);
  const poClash = await purchaseOrderService.create({
    supplierId: supplier.id,
    currency: "USD",
    lines: [
      { itemId: item2.id, qty: 100, unitPrice: 3.5 },
      { itemId: item2.id, qty: 100, unitPrice: 4.25 },
    ],
  });
  const poClashId = (poClash.data as { id: string }).id;
  poIds.push(poClashId);
  const rcpt3 = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    purchaseOrderId: poClashId,
    currency: "USD",
    lines: [{ itemId: item2.id, initialQty: 30 }],
  });
  const rcpt3Id = (rcpt3.data as { id: string }).id;
  receiptIds.push(rcpt3Id);
  const draft3 = await invoiceService.createDraftFromGoodsReceipt(rcpt3Id);
  invoiceIds.push(draft3.data.id);
  const inv3Lines = await prisma.invoiceLine.findMany({
    where: { invoiceId: draft3.data.id },
    select: { unitPrice: true },
  });
  check(
    "§5a ⭐ Çelişkide ORTALAMA uydurulmadı — fiyat 0 kaldı (onay seddi yakalar)",
    inv3Lines.length === 1 && D(inv3Lines[0]!.unitPrice).isZero(),
    `unitPrice=${inv3Lines[0]?.unitPrice}`,
  );
  check(
    "§5b Çelişki mesajda söylendi (sessiz yanlış fiyat, boş fiyattan kötüdür)",
    (draft3.message ?? "").includes("çelişkili"),
    draft3.message ?? "",
  );
  check(
    "§5c Çelişkili kalem 'sipariş fiyatı kullanıldı' sayacına GİRMEDİ (0 satırı da BASILMAZ)",
    !/kalemde sipariş fiyatı kullanıldı/.test(draft3.message ?? ""),
    draft3.message ?? "",
  );

  // ── §6 VADE ÖN-DOLUMU ────────────────────────────────────────────────────
  // §3'teki fatura kesilirken cari YOKTU (lazy açılış `createDraft` içinde
  // olur) → vade YAZILMAMALI. Şimdi cariye vade tanımlayıp yeni fiş kesiyoruz.
  check("§6a Cari vadesi yokken dueDate NULL (uydurma yok)", inv1.dueDate === null, String(inv1.dueDate));

  const cari = await prisma.cariAccount.findFirstOrThrow({
    where: { customerId: supplier.id },
    select: { id: true },
  });
  cariIds.push(cari.id);
  await prisma.cariAccount.update({ where: { id: cari.id }, data: { paymentTermDays: 45 } });

  const poTerm = await purchaseOrderService.create({
    supplierId: supplier.id,
    currency: "USD",
    lines: [{ itemId: item.id, qty: 10, unitPrice: 1 }],
  });
  poIds.push((poTerm.data as { id: string }).id);
  const rcpt4 = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    currency: "USD",
    lines: [{ itemId: item.id, initialQty: 5, unitPrice: 1 }],
  });
  const rcpt4Id = (rcpt4.data as { id: string }).id;
  receiptIds.push(rcpt4Id);
  const draft4 = await invoiceService.createDraftFromGoodsReceipt(rcpt4Id);
  invoiceIds.push(draft4.data.id);
  const inv4 = await prisma.invoice.findUniqueOrThrow({
    where: { id: draft4.data.id },
    select: { issueDate: true, dueDate: true },
  });
  const expected = new Date(inv4.issueDate.getTime() + 45 * 86_400_000);
  check(
    "§6b ⭐ Vade = fatura tarihi + cari vade günü (45)",
    inv4.dueDate != null && Math.abs(inv4.dueDate.getTime() - expected.getTime()) < 1000,
    `issue=${inv4.issueDate.toISOString()} due=${inv4.dueDate?.toISOString() ?? "(yok)"}`,
  );

  // ── §8 ⭐⭐ GERÇEK SAHA SIRASI: KART FİYATI FİŞTEN **ÖNCE** VAR ───────────
  // Bu bölüm bu bekçinin ilk yazımındaki KÖR NOKTAYI kapatır. §3 kart fiyatını
  // bilerek fişten SONRA yaratıyor; oysa gerçek kurulumda kalem kartının alış
  // fiyatı ZATEN tanımlıdır. O sırada mal kabul D2 ön-dolumu kart fiyatını
  // KABUL ANINDA `Roll.purchasePrice`e donduruyordu ve fatura zinciri
  // (`r.purchasePrice ?? contractPriceOf(...) ?? kart`) İLK terimde duruyordu —
  // yani "sözleşme fiyatı" katmanı, tarif edildiği senaryoda HİÇ çalışmıyordu
  // (ölçüldü: kart 2,00 · sipariş 3,50 → fatura 2,00, üstelik tek uyarı bile
  // yok). Muhasebeci ya rakamı üçüncü kez yazacak ya metre başına 1,50 fark
  // sessizce defterlenecekti.
  const item3 = await prisma.item.create({
    data: { code: `${TAG}-ITM3`, name: `${TAG} KUMAŞ 3`, itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  itemIds.push(item3.id);
  // SIRA LOAD-BEARING: kart fiyatı ÖNCE.
  const card3 = await prisma.itemPrice.create({
    data: { itemId: item3.id, customerId: null, kind: PriceKind.PURCHASE, currency: "USD", price: "2.0000" },
    select: { id: true },
  });
  priceIds.push(card3.id);
  const poReal = await purchaseOrderService.create({
    supplierId: supplier.id,
    currency: "USD",
    lines: [{ itemId: item3.id, qty: 500, unitPrice: 3.5 }],
  });
  const poRealId = (poReal.data as { id: string }).id;
  poIds.push(poRealId);
  const rcptReal = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    purchaseOrderId: poRealId,
    currency: "USD",
    // Depocu "siparişten doldur" DEMİYOR ve satıra fiyat YAZMIYOR.
    lines: [{ itemId: item3.id, initialQty: 40 }],
  });
  const rcptRealId = (rcptReal.data as { id: string }).id;
  receiptIds.push(rcptRealId);
  const realRoll = await prisma.roll.findFirst({
    where: { goodsReceiptId: rcptRealId },
    select: { purchasePrice: true },
  });
  check(
    "§8a ⭐⭐ Kart fiyatı ÖNCEDEN varken bile top SÖZLEŞME fiyatıyla dondu (3.50)",
    realRoll?.purchasePrice != null && D(realRoll.purchasePrice).equals(D("3.5")),
    `Roll.purchasePrice=${realRoll?.purchasePrice}`,
  );
  check(
    "§8b Fiş mesajı kararı SÖYLÜYOR (sessiz doğru cevap, görünmez cevaptır)",
    (rcptReal.message ?? "").includes("sipariş fiyatı kullanıldı"),
    rcptReal.message ?? "",
  );
  const draftReal = await invoiceService.createDraftFromGoodsReceipt(rcptRealId);
  invoiceIds.push(draftReal.data.id);
  const invReal = await prisma.invoiceLine.findMany({
    where: { invoiceId: draftReal.data.id },
    select: { unitPrice: true },
  });
  check(
    "§8c ⭐ Alış faturası da 3.50 — muhasebeci rakamı ÜÇÜNCÜ kez yazmıyor",
    invReal.length === 1 && D(invReal[0]!.unitPrice).equals(D("3.5")),
    `unitPrice=${invReal[0]?.unitPrice}`,
  );
  // KONTROL GRUBU — SİPARİŞSİZ FİŞTE KART FİYATI HÂLÂ KAZANIR. Katmanın
  // kapsamı "siparişe bağlı fiş"tir; buraya sızsaydı üretici fabrikanın
  // siparişsiz mal kabulü de sessizce başka bir fiyat yolundan geçerdi.
  const rcptNoOrder = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    currency: "USD",
    lines: [{ itemId: item3.id, initialQty: 7 }],
  });
  const rcptNoOrderId = (rcptNoOrder.data as { id: string }).id;
  receiptIds.push(rcptNoOrderId);
  const noOrderRoll = await prisma.roll.findFirst({
    where: { goodsReceiptId: rcptNoOrderId },
    select: { purchasePrice: true },
  });
  check(
    "§8d Kontrol: siparişsiz fişte KART fiyatı (2.00) uygulandı",
    noOrderRoll?.purchasePrice != null && D(noOrderRoll.purchasePrice).equals(D("2")),
    `Roll.purchasePrice=${noOrderRoll?.purchasePrice}`,
  );
  check(
    "§8e Kontrol: siparişsiz fişin mesajı sözleşme cümlesi BASMIYOR",
    !/sipariş fiyatı/.test(rcptNoOrder.message ?? ""),
    rcptNoOrder.message ?? "",
  );

  // ── §7 KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────
  check(
    "§7 Körlük zemini: fixture gerçekten kuruldu",
    receiptIds.length >= 7 && poIds.length >= 5 && invoiceIds.length >= 5,
    `fiş=${receiptIds.length} sipariş=${poIds.length} fatura=${invoiceIds.length}`,
  );
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    try {
      if (invoiceIds.length) {
        await prisma.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      if (receiptIds.length || itemIds.length) {
        // ⚠️ TOPLAR HEM FİŞTEN HEM KALEMDEN toplanır. Yalnız `goodsReceiptId`e
        // bakan eski hâl, sonda koşumları gibi ORTADA patlayan bir çalışmada
        // fişi listeye girmemiş topu bırakıyor, `item.deleteMany` FK'ya takılıp
        // catch'e düşüyor ve fixture dev DB'sinde birikiyordu (ölçüldü).
        const rolls = await prisma.roll.findMany({
          where: { OR: [{ goodsReceiptId: { in: receiptIds } }, { itemId: { in: itemIds } }] },
          select: { id: true, goodsReceiptId: true },
        });
        const ids = rolls.map((r) => r.id);
        for (const g of rolls.map((r) => r.goodsReceiptId)) {
          if (g && !receiptIds.includes(g)) receiptIds.push(g);
        }
        if (ids.length) {
          await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
          await prisma.rollVariance.deleteMany({ where: { rollId: { in: ids } } });
          await prisma.rollOperation.deleteMany({ where: { rollId: { in: ids } } });
          await prisma.rollMovement.deleteMany({ where: { rollId: { in: ids } } });
          await prisma.roll.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.yarnMovement.deleteMany({ where: { goodsReceiptId: { in: receiptIds } } });
        await prisma.printedDocument.deleteMany({ where: { sourceId: { in: receiptIds } } });
        await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      }
      if (poIds.length) {
        await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
      }
      if (priceIds.length) await prisma.itemPrice.deleteMany({ where: { id: { in: priceIds } } });
      if (rateIds.length) await prisma.exchangeRate.deleteMany({ where: { id: { in: rateIds } } });
      if (cariIds.length) {
        await prisma.cariBalance.deleteMany({ where: { cariId: { in: cariIds } } });
        await prisma.cariAccount.deleteMany({ where: { id: { in: cariIds } } });
      }
      if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
