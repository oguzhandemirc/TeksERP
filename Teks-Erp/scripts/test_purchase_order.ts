// =============================================================================
// BEKÇİ — ALIŞ SİPARİŞİ (PurchaseOrder, Paket D3)
// =============================================================================
// Çalıştırma: npx tsx scripts/test_purchase_order.ts
//
// NEDEN: Alış siparişi "ne ısmarladım, ne geldi" sorusunun TEK kayıtlı cevabı.
// Karşılanma (`receivedQty`) DENORMALİZE bir rollup'tır ve yanlış olduğunda
// HİÇBİR YERDE hata çıkmaz — satın almacı yalnızca yanlış rakam görür ve ona
// göre sipariş verir (ya da vermez). Bu bekçi, o rakamın kaynağıyla mutabık
// kaldığını mekanik olarak kilitler.
//
// ÖLÇÜLENLER:
//   A) Belge numarası `AS + GGAAYY + NNNN` + SAYAÇ YARIŞI (paralel iki sipariş
//      → iki FARKLI numara; `withBarcodeRetry` + tx-içi sıra okuması)
//   B) `clientToken` idempotency — aynı token ikinci sipariş AÇMAZ
//   C) Karşılanma mal kabulle ARTAR + durum OPEN → PARTIAL → CLOSED TÜRETİLİR
//   D) Fiş İPTALİNDE karşılanma GERİ DÜŞER ve durum OPEN'a döner
//   E) ⭐ FAZLA KABUL ENGELLENMEZ ama İŞARETLENİR (`over` / `overReceiptLines`)
//   F) SİPARİŞSİZ mal kabulü hâlâ ÇALIŞIR (sipariş bir PLANDIR, ön koşul değil)
//   G) Kabul görmüş sipariş İPTAL EDİLEMEZ; boş sipariş edilebilir
//   H) Düzenleme yalnız OPEN'da; mal görmüş siparişte 409
//   I) `open-lines` süzmesi SUNUCUDA (kapanan kalem listeden düşer)
//   J) İPLİK (kg) kabulü de karşılanmaya sayılır — kumaşa özel yazılmış bir
//      hesap, ipliği de satan kurulumda siparişin yarısını "hiç gelmedi" derdi
//   K) İptal edilmiş sipariş DİRİLTİLMEZ (senkron bir durum makinesi değildir)
//   O) ⭐ DÜZENLEME SONRASI SENKRON — kalem kümesi değişince karşılanma
//      kaynaktan yeniden çözülür (yoksa mal DEPODAYKEN kalem "hiç gelmedi" der)
//   P) ⭐ FAZLA-KABUL UYARISI `POST /:id/lines` YOLUNDA DA GÖRÜNÜR — fiş bir
//      KAPTIR, satırlar tipik olarak oradan eklenir
//   Q) ⭐ `clientToken` PARALEL YARIŞI — ön kontrol tek başına yetmez
//   R) ⭐ SHORT-CLOSE (G2) — "kalanı gelmeyecek": senkron CLOSED'u EZMEZ,
//      open-lines'tan düşer, geri almada durum yeniden türetilir, claim yarışı
//   S) ⭐ RESYNC — bayat sayacı kaynaktan onarır + short-close'a saygılı
//   U) ⭐ C4 (2026-08-15) — TEDARİKÇİ = müşteri-tipli cari **XOR** fason firma.
//      Siparişte kural mal kabulden DAHA SIKI: TAM BİRİ zorunlu (sipariş bir
//      taahhüttür). Ölçülenler: XOR ihlali + boş taraf 400 ve İZ BIRAKMAZ ·
//      fason bacağı kolona yazılır · detay/liste AYNI şekli taşır · arama fason
//      adını görür · taraf değişiminde ESKİ bacak NULL'lanır (yarım taraf yok) ·
//      taraf gönderilmeyen düzenleme tedarikçiye dokunmaz · KARŞILANMA zinciri
//      fason bacağında da işler · `open-lines`ta iki id uzayı birbirine karışmaz.
//   T) ⭐ TOP İPTALİ SENKRONU — `InventoryService.softDelete` fiş→sipariş
//      zinciri doluysa rollup'ı tetikler (eskiden sayaç BAYAT kalıyordu)
//   Z) KÖRLÜK ZEMİNİ — fixture gerçekten kuruldu mu
// =============================================================================
import { GoodsReceiptStatus, ItemType, ItemUnit, PurchaseOrderStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import prisma, { pool } from "../src/lib/prisma";
import { describeOverReceipt, goodsReceiptService } from "../src/services/goods-receipt.service";
import { InventoryService } from "../src/services/inventory.service";
import { purchaseOrderService, syncPurchaseOrder } from "../src/services/purchase-order.service";
// §U — fason firma TEST tarafından üretilir (seed'in `BOYER`i pasif olabilir ve
// `findFirst` onu yine bulur; fixture dosyası başlığındaki 2026-08-02 bulgusu).

import { ensureIplikModuluAcik } from "./fixture-module-flags";

/** ⚠️ Modül düzeyinde: `finally` bloğu `main()` gövdesinin DIŞINDA koşar. */
let modulGeriAl: (() => Promise<void>) | null = null;
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

const TAG = `TEST-PO-${Date.now()}`;
const orderIds: string[] = [];
const receiptIds: string[] = [];
const itemIds: string[] = [];
const warehouseIds: string[] = [];
const customerIds: string[] = [];
const subcontractorIds: string[] = [];

/** Detay yanıtındaki kalem şekli (servis Decimal döner). */
interface DetailLine {
  id: string;
  lineNo: number;
  qty: { toString(): string };
  receivedQty: { toString(): string };
  remainingQty: { toString(): string };
  over: boolean;
  drift: boolean;
}
interface Detail {
  id: string;
  orderNo: string;
  status: PurchaseOrderStatus;
  lines: DetailLine[];
  totals: {
    totalReceived: { toString(): string };
    overReceiptLineCount: number;
    driftLineCount: number;
    unmatchedItemCount: number;
  };
}

const num = (v: { toString(): string }): number => Number(v.toString());

async function detail(id: string): Promise<Detail> {
  return (await purchaseOrderService.getById(id)) as unknown as Detail;
}

async function main(): Promise<void> {
// ⚠️ MODÜL ORTAMI (2026-09-02): iplik kg defterinin kapısı SERVİS düzeyindedir
// (`applyYarnMovementTx` ilk işi `readIplikEnabled`). Fabrika profilinde iplik
// KAPALI olduğu için bu test onsuz 403 alır ve defteri HİÇ ölçemez. Fixture
// modülü açar, `finally` BULDUĞU değere geri yazar — gevşetilen kapı DEĞİL,
// kurulan ORTAMDIR (kapının kendi bekçileri: test_iplik_regime_gate §4d +
// test_module_flag_off).
  modulGeriAl = await ensureIplikModuluAcik();

  console.log("=== Alış siparişi bekçisi ===\n");

  // ── FIXTURE (test KENDİ verisini yaratır — ortamdaki veriye bağımlı olma) ──
  const supplier = await prisma.customer.create({
    data: { code: `${TAG}-TED`, name: `${TAG} Tedarikçi`, type: "SUPPLIER" },
    select: { id: true },
  });
  customerIds.push(supplier.id);

  const wh = await prisma.warehouse.create({ data: { code: `${TAG}-D`, name: `${TAG} Depo` }, select: { id: true } });
  warehouseIds.push(wh.id);

  const fabric = await prisma.item.create({
    data: { code: `${TAG}-KUM`, name: `${TAG} Kumaş`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
    select: { id: true },
  });
  const fabric2 = await prisma.item.create({
    data: { code: `${TAG}-KUM2`, name: `${TAG} Kumaş 2`, itemType: ItemType.FABRIC, unit: ItemUnit.MT },
    select: { id: true },
  });
  const yarn = await prisma.item.create({
    data: { code: `${TAG}-IPL`, name: `${TAG} İplik`, itemType: ItemType.YARN, unit: ItemUnit.KG },
    select: { id: true },
  });
  itemIds.push(fabric.id, fabric2.id, yarn.id);

  // ── A) Belge numarası + SAYAÇ YARIŞI ────────────────────────────────────
  // ⚠️ İki sipariş PARALEL açılır. `Promise.all` burada MEŞRU: iki AYRI
  // transaction var (yasak olan, tek tx client'ını paylaşan `tx.*` çağrıları).
  const [poA, poB] = await Promise.all([
    purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 100 }] }),
    purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 250 }] }),
  ]);
  const a = poA.data as unknown as Detail;
  const b = poB.data as unknown as Detail;
  orderIds.push(a.id, b.id);

  check("A1) Belge numarası AS + GGAAYY + NNNN", /^AS\d{6}\d{4}$/.test(a.orderNo), a.orderNo);
  check("A2) ⭐ Paralel iki sipariş FARKLI numara aldı (sayaç yarışı)", a.orderNo !== b.orderNo, `${a.orderNo} / ${b.orderNo}`);
  check("A3) Yeni sipariş OPEN doğar", a.status === PurchaseOrderStatus.OPEN, a.status);
  check("A4) Karşılanma sıfır başlar", num(a.lines[0]!.receivedQty) === 0);

  // ── B) clientToken idempotency ──────────────────────────────────────────
  const token = randomUUID();
  const first = (await purchaseOrderService.create({ supplierId: supplier.id, clientToken: token, lines: [{ itemId: fabric.id, qty: 10 }] }))
    .data as unknown as Detail;
  orderIds.push(first.id);
  const second = (await purchaseOrderService.create({ supplierId: supplier.id, clientToken: token, lines: [{ itemId: fabric.id, qty: 10 }] }))
    .data as unknown as Detail;
  const tokenCount = await prisma.purchaseOrder.count({ where: { clientToken: token } });
  check("B1) ⭐ Aynı clientToken İKİNCİ sipariş AÇMADI", tokenCount === 1 && second.id === first.id, `sipariş=${tokenCount}`);
  check("B2) İkinci çağrı MEVCUT belge numarasını döndü", second.orderNo === first.orderNo, second.orderNo);

  // ── C) Karşılanma + durum türetmesi ─────────────────────────────────────
  const poC = (await purchaseOrderService.create({
    supplierId: supplier.id,
    lines: [{ itemId: fabric.id, qty: 100, unitPrice: 12.5 }],
  })).data as unknown as Detail;
  orderIds.push(poC.id);

  const r1 = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poC.id,
    lines: [{ itemId: fabric.id, initialQty: 40 }],
  });
  receiptIds.push((r1.data as { id: string }).id);

  let c = await detail(poC.id);
  check("C1) ⭐ Karşılanma mal kabulle ARTTI (40)", num(c.lines[0]!.receivedQty) === 40, c.lines[0]!.receivedQty.toString());
  check("C2) ⭐ Durum PARTIAL'a TÜRETİLDİ", c.status === PurchaseOrderStatus.PARTIAL, c.status);
  check("C3) Kalan 60 hesaplandı", num(c.lines[0]!.remainingQty) === 60, c.lines[0]!.remainingQty.toString());
  check("C4) Fazla kabul işareti YOK", c.lines[0]!.over === false);
  check("C5) Saklanan ile canlı hesap MUTABIK (drift yok)", c.totals.driftLineCount === 0);

  const r2 = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poC.id,
    lines: [{ itemId: fabric.id, initialQty: 60 }],
  });
  const r2Id = (r2.data as { id: string }).id;
  receiptIds.push(r2Id);

  c = await detail(poC.id);
  check("C6) ⭐ İkinci kabulle karşılanma 100", num(c.lines[0]!.receivedQty) === 100, c.lines[0]!.receivedQty.toString());
  check("C7) ⭐ Durum CLOSED'a TÜRETİLDİ", c.status === PurchaseOrderStatus.CLOSED, c.status);

  // Fişten siparişe bağ görünür olmalı (panelde tıkla-git).
  const linked = await prisma.goodsReceipt.findUnique({ where: { id: r2Id }, select: { purchaseOrderId: true, supplierId: true } });
  check("C8) Fiş siparişe bağlandı", linked?.purchaseOrderId === poC.id);
  check("C9) ⭐ Tedarikçi siparişten MİRAS alındı (fişte boş bırakılmıştı)", linked?.supplierId === supplier.id);

  // ── D) Fiş iptali karşılanmayı GERİ DÜŞÜRÜR ─────────────────────────────
  await goodsReceiptService.cancel(r2Id, `${TAG} iptal`);
  c = await detail(poC.id);
  check("D1) ⭐ İptalle karşılanma geri düştü (100 → 40)", num(c.lines[0]!.receivedQty) === 40, c.lines[0]!.receivedQty.toString());
  check("D2) ⭐ Durum CLOSED → PARTIAL'a döndü", c.status === PurchaseOrderStatus.PARTIAL, c.status);

  await goodsReceiptService.cancel((r1.data as { id: string }).id, `${TAG} iptal`);
  c = await detail(poC.id);
  check("D3) Tüm fişler iptal → karşılanma 0", num(c.lines[0]!.receivedQty) === 0, c.lines[0]!.receivedQty.toString());
  check("D4) ⭐ Durum OPEN'a döndü (yeniden kabule açık)", c.status === PurchaseOrderStatus.OPEN, c.status);

  // ── E) FAZLA KABUL: engellenmez, İŞARETLENİR ────────────────────────────
  const poE = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 50 }] }))
    .data as unknown as Detail;
  orderIds.push(poE.id);
  const rE = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poE.id,
    lines: [{ itemId: fabric.id, initialQty: 70 }],
  });
  const rEData = rE.data as { id: string; rolls: unknown[] };
  receiptIds.push(rEData.id);

  check("E1) ⭐ Fazla mal REDDEDİLMEDİ (top yazıldı)", rEData.rolls.length === 1, `top=${rEData.rolls.length}`);
  const e = await detail(poE.id);
  check("E2) Karşılanma gerçeği yazdı (70 > 50)", num(e.lines[0]!.receivedQty) === 70, e.lines[0]!.receivedQty.toString());
  check("E3) ⭐ Fazla kabul İŞARETLENDİ", e.lines[0]!.over === true && e.totals.overReceiptLineCount === 1);
  check("E4) ⭐ Uyarı KULLANICI MESAJINDA da geçti (yutulmadı)", (rE.message ?? "").includes("AŞILDI"), (rE.message ?? "").slice(-90));
  check("E5) Kalan negatife düşmedi (0'a kırpıldı)", num(e.lines[0]!.remainingQty) === 0, e.lines[0]!.remainingQty.toString());
  check("E6) Fazla kabul durumu CLOSED yapar", e.status === PurchaseOrderStatus.CLOSED, e.status);

  // ── F) SİPARİŞSİZ mal kabulü hâlâ meşru ─────────────────────────────────
  const rFree = await goodsReceiptService.create({
    warehouseId: wh.id,
    supplierId: supplier.id,
    lines: [{ itemId: fabric.id, initialQty: 33 }],
  });
  const rFreeData = rFree.data as { id: string; rolls: unknown[] };
  receiptIds.push(rFreeData.id);
  const freeRow = await prisma.goodsReceipt.findUnique({ where: { id: rFreeData.id }, select: { purchaseOrderId: true } });
  check("F1) ⭐ Siparişsiz mal kabulü ÇALIŞTI (sipariş bir PLANDIR, ön koşul değil)", rFreeData.rolls.length === 1);
  check("F2) Siparişsiz fişte bağ NULL", freeRow?.purchaseOrderId === null);
  const eAfterFree = await detail(poE.id);
  check(
    "F3) ⭐ Siparişsiz kabul BAŞKA siparişin karşılanmasına yazılmadı",
    num(eAfterFree.lines[0]!.receivedQty) === 70,
    eAfterFree.lines[0]!.receivedQty.toString(),
  );

  // ── G) İptal kuralı ─────────────────────────────────────────────────────
  let gMsg = "";
  try {
    await purchaseOrderService.cancel(poE.id, "olmamalı");
  } catch (err) {
    gMsg = (err as Error).message;
  }
  check("G1) ⭐ Kabul görmüş sipariş İPTAL EDİLEMEDİ", gMsg.includes("mal kabul edilmiş"), gMsg.slice(0, 90));
  const gStill = await prisma.purchaseOrder.findUnique({ where: { id: poE.id }, select: { status: true } });
  check("G2) Guard yan etki bırakmadı", gStill?.status === PurchaseOrderStatus.CLOSED, gStill?.status);

  const poG = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 5 }] }))
    .data as unknown as Detail;
  orderIds.push(poG.id);
  await purchaseOrderService.cancel(poG.id, `${TAG} gereksiz`);
  const gAfter = await prisma.purchaseOrder.findUnique({
    where: { id: poG.id },
    select: { status: true, cancelledAt: true, cancelReason: true },
  });
  check("G3) Fişsiz sipariş iptal edildi", gAfter?.status === PurchaseOrderStatus.CANCELLED, gAfter?.status);
  check("G4) İptal damgası + gerekçe yazıldı", gAfter?.cancelledAt !== null && (gAfter?.cancelReason ?? "").includes(TAG));

  // İptal edilmiş siparişe mal kabul REDDEDİLİR (fiş, iptal edilmiş bir plana
  // bağlanıp raporlardan sessizce düşmemeli).
  let gLinkMsg = "";
  try {
    const bad = await goodsReceiptService.create({ warehouseId: wh.id, purchaseOrderId: poG.id });
    receiptIds.push((bad.data as { id: string }).id);
  } catch (err) {
    gLinkMsg = (err as Error).message;
  }
  check("G5) ⭐ İptal edilmiş siparişe mal kabul REDDEDİLDİ", gLinkMsg.includes("iptal edilmiş"), gLinkMsg.slice(0, 80));

  // ── K) İptal edilmiş sipariş DİRİLTİLMEZ ────────────────────────────────
  const kSync = await syncPurchaseOrder(poG.id);
  const kAfter = await prisma.purchaseOrder.findUnique({ where: { id: poG.id }, select: { status: true } });
  check(
    "K1) ⭐ Senkron iptal edilmiş siparişi DİRİLTMEDİ",
    kAfter?.status === PurchaseOrderStatus.CANCELLED && kSync?.status === PurchaseOrderStatus.CANCELLED,
    kAfter?.status,
  );

  // ── H) Düzenleme yalnız OPEN'da ─────────────────────────────────────────
  const poH = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 20 }] }))
    .data as unknown as Detail;
  orderIds.push(poH.id);
  const hEdited = (await purchaseOrderService.update(poH.id, {
    notes: `${TAG} not`,
    lines: [
      { itemId: fabric.id, qty: 30 },
      { itemId: fabric2.id, qty: 15 },
    ],
  })).data as unknown as Detail;
  check("H1) OPEN sipariş düzenlendi (kalemler değişti)", hEdited.lines.length === 2 && num(hEdited.lines[0]!.qty) === 30);
  check("H2) lineNo yeniden numaralandı", hEdited.lines.map((l) => l.lineNo).join(",") === "1,2");

  const rH = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poH.id,
    lines: [{ itemId: fabric.id, initialQty: 10 }],
  });
  receiptIds.push((rH.data as { id: string }).id);
  let hMsg = "";
  try {
    await purchaseOrderService.update(poH.id, { notes: "olmamalı" });
  } catch (err) {
    hMsg = (err as Error).message;
  }
  check("H3) ⭐ Mal görmüş sipariş DÜZENLENEMEDİ", hMsg.includes("düzenlenemez"), hMsg.slice(0, 90));
  const hStill = await prisma.purchaseOrder.findUnique({ where: { id: poH.id }, select: { notes: true } });
  check("H4) Reddedilen düzenleme yan etki bırakmadı", (hStill?.notes ?? "").includes("not"), hStill?.notes ?? "");

  // ── I) open-lines süzmesi SUNUCUDA ──────────────────────────────────────
  const open1 = await purchaseOrderService.openLines({ supplierId: supplier.id, limit: 500 });
  const openIds1 = new Set((open1.rows as Array<{ purchaseOrder: { id: string } }>).map((r) => r.purchaseOrder.id));
  check("I1) Karşılanmamış kalem listede", openIds1.has(poH.id), `açık kalem=${open1.total}`);
  check("I2) ⭐ Tam karşılanan sipariş listede DEĞİL", !openIds1.has(poE.id));
  check("I3) ⭐ İptal edilmiş sipariş listede DEĞİL", !openIds1.has(poG.id));

  const openItem = await purchaseOrderService.openLines({ supplierId: supplier.id, itemId: fabric2.id, limit: 500 });
  check(
    "I4) Ürün süzgeci SUNUCUDA çalıştı",
    openItem.total > 0 && (openItem.rows as Array<{ item: { id: string } }>).every((r) => r.item.id === fabric2.id),
    `satır=${openItem.total}`,
  );

  // ── J) İPLİK (kg) kabulü de karşılanmaya sayılır ─────────────────────────
  const poJ = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: yarn.id, qty: 500 }] }))
    .data as unknown as Detail;
  orderIds.push(poJ.id);
  const rJ = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poJ.id,
    lines: [{ itemId: yarn.id, initialQty: 200 }],
  });
  const rJId = (rJ.data as { id: string }).id;
  receiptIds.push(rJId);

  let j = await detail(poJ.id);
  check("J1) ⭐ İplik (kg) kabulü karşılanmaya sayıldı", num(j.lines[0]!.receivedQty) === 200, j.lines[0]!.receivedQty.toString());
  check("J2) İplikte de durum PARTIAL", j.status === PurchaseOrderStatus.PARTIAL, j.status);

  await goodsReceiptService.cancel(rJId, `${TAG} iplik iptal`);
  j = await detail(poJ.id);
  check("J3) ⭐ İplik fişi iptalinde karşılanma geri düştü", num(j.lines[0]!.receivedQty) === 0, j.lines[0]!.receivedQty.toString());
  check("J4) Durum OPEN'a döndü", j.status === PurchaseOrderStatus.OPEN, j.status);

  // ── L) AYNI ÜRÜN İKİ KALEMDE → FIFO DAĞITIM ─────────────────────────────
  // ⚠️ Bu, senkronun EN SESSİZ kırılabilecek yeri: şemada top ↔ sipariş KALEMİ
  // bağı yok, eşleme yalnız `itemId` üzerinden yapılıyor. Aynı ürün iki
  // kalemde durduğunda (farklı termin — meşru) gelen mal `lineNo` sırasıyla
  // dağıtılmazsa hiçbir hata çıkmaz, yalnız yanlış kalem kapanır.
  const poL = (await purchaseOrderService.create({
    supplierId: supplier.id,
    lines: [
      { itemId: fabric2.id, qty: 30 },
      { itemId: fabric2.id, qty: 40 },
    ],
  })).data as unknown as Detail;
  orderIds.push(poL.id);

  const rL1 = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poL.id,
    lines: [{ itemId: fabric2.id, initialQty: 50 }],
  });
  receiptIds.push((rL1.data as { id: string }).id);

  let l = await detail(poL.id);
  check("L1) ⭐ FIFO: ilk kalem TAM doldu (30)", num(l.lines[0]!.receivedQty) === 30, l.lines[0]!.receivedQty.toString());
  check("L2) ⭐ FIFO: artan İKİNCİ kaleme aktı (20)", num(l.lines[1]!.receivedQty) === 20, l.lines[1]!.receivedQty.toString());
  check("L3) Kısmi karşılanmada durum PARTIAL", l.status === PurchaseOrderStatus.PARTIAL, l.status);
  check("L4) Hiçbir kalemde sahte fazla-kabul işareti yok", l.totals.overReceiptLineCount === 0);

  const rL2 = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poL.id,
    lines: [{ itemId: fabric2.id, initialQty: 30 }],
  });
  receiptIds.push((rL2.data as { id: string }).id);

  l = await detail(poL.id);
  check("L5) ⭐ Fazlalık SON kaleme yazıldı (ilk kalem 30'da kaldı)", num(l.lines[0]!.receivedQty) === 30, l.lines[0]!.receivedQty.toString());
  check("L6) ⭐ Son kalem 50 (40 sipariş + 10 fazla)", num(l.lines[1]!.receivedQty) === 50, l.lines[1]!.receivedQty.toString());
  check("L7) Fazla işareti YALNIZ son kalemde", l.lines[0]!.over === false && l.lines[1]!.over === true);

  // ── M) DRIFT GÖRÜNÜR — sessizlik yok ────────────────────────────────────
  // Rollup'ı tazeleyen olaylar senkronu çağırır ama topun TEKİL iptali
  // (`InventoryService.softDelete`) çağırmaz. Bu durumda saklanan rakam ile
  // kaynak ayrışır; detay yüzeyi bunu SÖYLEMELİ, yoksa satın almacı yanlış
  // rakamı sorgusuz kabul eder.
  await prisma.purchaseOrderLine.update({ where: { id: l.lines[0]!.id }, data: { receivedQty: 999 } });
  const drifted = await detail(poL.id);
  check("M1) ⭐ Saklanan ile kaynak ayrışması GÖRÜNÜR (`drift`)", drifted.lines[0]!.drift === true && drifted.totals.driftLineCount === 1);

  // ⚠️ Ve senkron KENDİNİ ONARIR — `increment` yerine kaynaktan yeniden hesap
  // seçilmesinin tek gerekçesi budur.
  await syncPurchaseOrder(poL.id);
  const healed = await detail(poL.id);
  check(
    "M2) ⭐ Senkron ayrışmayı ONARDI (rollup kendini iyileştirir)",
    num(healed.lines[0]!.receivedQty) === 30 && healed.totals.driftLineCount === 0,
    healed.lines[0]!.receivedQty.toString(),
  );

  // ── N) SİPARİŞTE OLMAYAN ÜRÜN — sessizce düşmez, SÖYLENİR ───────────────
  // Depocu açılır listeden YANLIŞ siparişi seçtiğinde mal yine depoya girer
  // (kayıt doğru) ama hiçbir sipariş kalemine yazılamaz. Bu, karşılanma
  // rakamını sebebi söylenmeden eksik bırakan sessiz bir saha hatasıdır.
  const poN = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 60 }] }))
    .data as unknown as Detail;
  orderIds.push(poN.id);
  const rN = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poN.id,
    // fabric2 bu siparişte HİÇ yok.
    lines: [{ itemId: fabric2.id, initialQty: 25 }],
  });
  receiptIds.push((rN.data as { id: string }).id);

  const n = await detail(poN.id);
  check("N1) Siparişte olmayan ürün hiçbir kaleme YAZILMADI", num(n.lines[0]!.receivedQty) === 0, n.lines[0]!.receivedQty.toString());
  check("N2) ⭐ Eşleşmeyen ürün İŞARETLENDİ (sessizce düşmedi)", n.totals.unmatchedItemCount === 1, `eşleşmeyen=${n.totals.unmatchedItemCount}`);
  check(
    "N3) ⭐ Uyarı KULLANICI MESAJINDA da geçti",
    (rN.message ?? "").includes("bu siparişte YOK"),
    (rN.message ?? "").slice(-95),
  );
  check("N4) Yanlış bağ siparişin durumunu bozmadı (OPEN kaldı)", n.status === PurchaseOrderStatus.OPEN, n.status);

  // ── O) DÜZENLEME SONRASI SENKRON ────────────────────────────────────────
  // ⚠️ SAHA VAKASI (ölçüldü): fiş, siparişte OLMAYAN bir ürün taşıyordu ve
  // sistem bunu `unmatchedItemIds` ile SÖYLEDİ. Satın almacı eksik kalemi
  // ekledi — ama karşılanma senkronu koşmadığı için mal FİZİKSEL OLARAK
  // DEPODAYKEN kalem "0 geldi" kaldı ve sipariş OPEN'da dondu. Hata yok, log
  // yok; rakam ancak bir sonraki kabul olayında kendini onarıyordu.
  // Eşleme ÜRÜN bazında yapıldığı için kalem kümesini değiştirmek karşılanmanın
  // KAYNAĞINI değiştirir — düzenleme bir senkron olayıdır.
  const poO = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 100 }] }))
    .data as unknown as Detail;
  orderIds.push(poO.id);
  const rO = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poO.id,
    // fabric2 bu siparişte HENÜZ yok → hiçbir kaleme yazılamaz.
    lines: [{ itemId: fabric2.id, initialQty: 25 }],
  });
  receiptIds.push((rO.data as { id: string }).id);

  const oBefore = await detail(poO.id);
  check("O1) Körlük zemini: düzenleme öncesi ürün gerçekten eşleşmiyordu", oBefore.totals.unmatchedItemCount === 1);
  check("O2) Körlük zemini: sipariş hâlâ OPEN ve karşılanma 0", oBefore.status === PurchaseOrderStatus.OPEN && num(oBefore.lines[0]!.receivedQty) === 0);

  await purchaseOrderService.update(poO.id, {
    lines: [
      { itemId: fabric.id, qty: 100 },
      { itemId: fabric2.id, qty: 25 },
    ],
  });
  const oAfter = await detail(poO.id);
  const oLine2 = oAfter.lines.find((l) => l.lineNo === 2);
  check(
    "O3) ⭐ Eksik kalem eklenince karşılanma KAYNAKTAN yeniden çözüldü (25)",
    oLine2 !== undefined && num(oLine2.receivedQty) === 25,
    oLine2 ? oLine2.receivedQty.toString() : "kalem yok",
  );
  check("O4) ⭐ Düzenleme sonrası saklanan ile kaynak MUTABIK (drift yok)", oAfter.totals.driftLineCount === 0, `drift=${oAfter.totals.driftLineCount}`);
  check("O5) ⭐ Durum PARTIAL'a türetildi (sipariş OPEN'da DONMADI)", oAfter.status === PurchaseOrderStatus.PARTIAL, oAfter.status);
  check("O6) Eşleşmeyen ürün uyarısı kendiliğinden düştü", oAfter.totals.unmatchedItemCount === 0);

  // ── P) FAZLA-KABUL UYARISI `/:id/lines` YOLUNDA DA GÖRÜNÜR ──────────────
  // ⚠️ Fiş bir KAPTIR: tipik akışta boş fiş açılır, satırlar okutuldukça
  // `addLines` ile eklenir. Uyarı yalnız `create`e konsaydı sahadaki EN YAYGIN
  // yolda hiç görünmezdi — ve fazla kabul reddedilmediği için başka hiçbir
  // yerde durmazdı.
  const poP = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 10 }] }))
    .data as unknown as Detail;
  orderIds.push(poP.id);
  const rP = await goodsReceiptService.create({ warehouseId: wh.id, purchaseOrderId: poP.id });
  const rPId = (rP.data as { id: string }).id;
  receiptIds.push(rPId);
  check("P1) Körlük zemini: boş fiş açıldı, uyarı YOK", describeOverReceipt((rP.data as { purchaseOrder?: unknown }).purchaseOrder as never) === "");

  const addRes = await goodsReceiptService.addLines(rPId, [{ itemId: fabric.id, initialQty: 18 }]);
  check("P2) Körlük zemini: satır gerçekten eklendi", addRes.created.length === 1);
  check(
    "P3) ⭐ `addLines` sipariş senkron sonucunu DÖNDÜ (fazla kabul işaretli)",
    addRes.purchaseOrder?.overReceiptLines.join(",") === "1",
    JSON.stringify(addRes.purchaseOrder?.overReceiptLines ?? null),
  );
  check("P4) ⭐ Uyarı metni üretildi (AŞILDI)", describeOverReceipt(addRes.purchaseOrder).includes("AŞILDI"), describeOverReceipt(addRes.purchaseOrder));
  // Uç, servisin ürettiği uyarıyı GERÇEKTEN basıyor mu — kaynak taraması.
  // Servis doğru dönse bile route onu yutarsa depocu hiçbir şey görmez
  // (2026-08-14 denetiminde tam bu boşluk bulundu).
  const receiptRouteSrc = readFileSync(join(__dirname, "..", "src", "routes", "goods-receipt.routes.ts"), "utf8");
  const linesHandler = receiptRouteSrc.slice(receiptRouteSrc.indexOf('"/:id/lines"'));
  check(
    "P5) ⭐ `/:id/lines` ucu uyarıyı MESAJA basıyor (yutmuyor)",
    linesHandler.slice(0, 2000).includes("describeOverReceipt(result.purchaseOrder)"),
  );
  check("P6) Körlük zemini: kaynak taraması gerçekten dosyayı okudu", receiptRouteSrc.length > 2000 && linesHandler.length > 500);

  // ── Q) clientToken PARALEL YARIŞI ───────────────────────────────────────
  // ⚠️ Ön kontrol (`findUnique` → yoksa yaz) tek başına CHECK-THEN-ACT'tir: iki
  // tekrar aynı anda gelirse ikisi de "token yok" görür. Kaybeden taraf
  // `clientToken` unique'ine çarpar ve bu P2002 RETRY EDİLMEMELİDİR — retry her
  // turda AYNI token'ı yazacağı için beş tur boşa döner ve kullanıcı, gerçek
  // sebebi hiçbir yerde yazmayan "Barkod üretimi 5 denemede başarısız oldu"
  // hatasını alır (kural: `utils/p2002.ts`).
  const raceToken = randomUUID();
  const raceResults = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      purchaseOrderService.create({ supplierId: supplier.id, clientToken: raceToken, lines: [{ itemId: fabric.id, qty: 7 }] }),
    ),
  );
  const raceRows = await prisma.purchaseOrder.findMany({ where: { clientToken: raceToken }, select: { id: true, orderNo: true } });
  for (const row of raceRows) orderIds.push(row.id);
  const rejected = raceResults.filter((r) => r.status === "rejected");
  check("Q1) Körlük zemini: 6 paralel çağrı gerçekten koştu", raceResults.length === 6);
  check("Q2) ⭐ Aynı token'dan TEK sipariş doğdu", raceRows.length === 1, `${raceRows.length} sipariş`);
  check(
    "Q3) ⭐ Hiçbir paralel çağrı hata almadı (yanıltıcı 'barkod' 409'u yok)",
    rejected.length === 0,
    rejected
      .map((r) => String(((r as PromiseRejectedResult).reason as Error | undefined)?.message ?? ""))
      .join(" | ")
      .slice(0, 140),
  );
  const raceNos = new Set(
    raceResults.flatMap((r) => (r.status === "fulfilled" ? [(r.value.data as unknown as Detail).orderNo] : [])),
  );
  check("Q4) ⭐ Tüm çağrılar AYNI belge numarasını döndü", raceNos.size === 1, [...raceNos].join(","));

  // ── R) SHORT-CLOSE — "kalanı gelmeyecek, olan KALIR" (G2) ───────────────
  // ⚠️ Özelliğin asıl işi: `CLOSED` türetilmiş bir durumdur ve short-close
  // olmadan elle işaretlenmesi ilk senkronda geri PARTIAL olurdu. Bayrak
  // (`shortClosedAt`) doluyken senkron durumu EZMEMELİ — negatif sonda:
  // `syncPurchaseOrderTx`teki `po.shortClosedAt ? CLOSED :` dalı düşürülünce
  // R3/R5/S1 kırmızı vermeli.
  const poR = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 100 }] }))
    .data as unknown as Detail;
  orderIds.push(poR.id);
  const rR = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poR.id,
    lines: [{ itemId: fabric.id, initialQty: 40 }],
  });
  receiptIds.push((rR.data as { id: string }).id);
  const rBefore = await detail(poR.id);
  check("R0) Körlük zemini: sipariş PARTIAL (40/100)", rBefore.status === PurchaseOrderStatus.PARTIAL, rBefore.status);

  let rShortMsg = "";
  try {
    await purchaseOrderService.shortClose(poR.id, "ab");
  } catch (err) {
    rShortMsg = (err as Error).message;
  }
  check("R1) ⭐ Sebepsiz/kısa sebeple kapatma REDDEDİLDİ", rShortMsg.includes("sebep") || rShortMsg.includes("Kapatma"), rShortMsg.slice(0, 80));

  const rClosed = await purchaseOrderService.shortClose(poR.id, `${TAG} tedarikçi kalanını üretmeyecek`);
  const rRow = await prisma.purchaseOrder.findUnique({
    where: { id: poR.id },
    select: { status: true, shortClosedAt: true, shortCloseReason: true },
  });
  check("R2) ⭐ Short-close: durum CLOSED + bayrak dolu", rRow?.status === PurchaseOrderStatus.CLOSED && rRow.shortClosedAt !== null);
  check("R2b) Sebep kaydın kendi satırında", (rRow?.shortCloseReason ?? "").includes(TAG));
  check("R2c) Mesaj açık kalem sayısını söyledi", (rClosed.message ?? "").includes("1 açık kalem"), rClosed.message ?? "");

  // ⭐ ASIL ÖLÇÜM: senkron short-close'u EZMEZ.
  const rSync = await syncPurchaseOrder(poR.id);
  const rAfterSync = await prisma.purchaseOrder.findUnique({ where: { id: poR.id }, select: { status: true } });
  check(
    "R3) ⭐ Senkron short-close'u EZMEDİ (CLOSED kaldı)",
    rAfterSync?.status === PurchaseOrderStatus.CLOSED && rSync?.status === PurchaseOrderStatus.CLOSED,
    rAfterSync?.status,
  );

  const rOpen = await purchaseOrderService.openLines({ supplierId: supplier.id, limit: 500 });
  const rOpenIds = new Set((rOpen.rows as Array<{ purchaseOrder: { id: string } }>).map((r) => r.purchaseOrder.id));
  check("R4) ⭐ Short-closed siparişin kalanı open-lines'tan DÜŞTÜ", !rOpenIds.has(poR.id));

  // Short-closed siparişe SONRADAN mal gelirse: kayıt gerçeği yazar (rollup
  // artar) ama durum kararı korunur — mal kabul reddedilmez (yalnız CANCELLED
  // reddedilir), rakam dürüst kalır.
  const rLate = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poR.id,
    lines: [{ itemId: fabric.id, initialQty: 10 }],
  });
  receiptIds.push((rLate.data as { id: string }).id);
  const rLateDetail = await detail(poR.id);
  check(
    "R5) ⭐ Kapalıyken gelen mal rollup'a yazıldı AMA durum CLOSED kaldı",
    num(rLateDetail.lines[0]!.receivedQty) === 50 && rLateDetail.status === PurchaseOrderStatus.CLOSED,
    `received=${rLateDetail.lines[0]!.receivedQty.toString()} durum=${rLateDetail.status}`,
  );

  const rAgain = await purchaseOrderService.shortClose(poR.id, `${TAG} tekrar`);
  const rRowAgain = await prisma.purchaseOrder.findUnique({ where: { id: poR.id }, select: { shortCloseReason: true } });
  check("R6) İkinci kapatma idempotent (409 yok, 'zaten' mesajı)", (rAgain.message ?? "").includes("zaten"), rAgain.message ?? "");
  check("R6b) İdempotent tekrar İLK sebebi EZMEDİ", (rRowAgain?.shortCloseReason ?? "").includes("üretmeyecek"));

  let rCancelledMsg = "";
  try {
    await purchaseOrderService.shortClose(poG.id, `${TAG} olmamalı`);
  } catch (err) {
    rCancelledMsg = (err as Error).message;
  }
  check("R7) İptal edilmiş sipariş kapatılamaz (409)", rCancelledMsg.includes("iptal edilmiş"), rCancelledMsg.slice(0, 80));

  let rFullMsg = "";
  try {
    await purchaseOrderService.shortClose(poE.id, `${TAG} olmamalı`);
  } catch (err) {
    rFullMsg = (err as Error).message;
  }
  check("R8) Tam karşılanmış siparişte kapatılacak kalan yok (409)", rFullMsg.includes("kalan yok"), rFullMsg.slice(0, 90));

  // ── S) RESYNC — bayat sayacı onarır + short-close'a saygılı ─────────────
  await prisma.purchaseOrderLine.updateMany({ where: { purchaseOrderId: poR.id }, data: { receivedQty: 999 } });
  const sDrifted = await detail(poR.id);
  check("S0) Körlük zemini: sayaç gerçekten bozuldu (drift görünür)", sDrifted.totals.driftLineCount === 1);

  const sRes = await purchaseOrderService.resync(poR.id);
  const sHealed = await detail(poR.id);
  check(
    "S1) ⭐ Resync bayat sayacı KAYNAKTAN onardı ve short-close'u EZMEDİ",
    num(sHealed.lines[0]!.receivedQty) === 50 && sHealed.totals.driftLineCount === 0 && sHealed.status === PurchaseOrderStatus.CLOSED,
    `received=${sHealed.lines[0]!.receivedQty.toString()} durum=${sHealed.status}`,
  );
  check("S2) Resync değişikliği mesajda söyledi", (sRes.message ?? "").includes("güncellendi"), sRes.message ?? "");
  const sRes2 = await purchaseOrderService.resync(poR.id);
  check("S3) İkinci resync idempotent ('zaten güncel')", (sRes2.message ?? "").includes("zaten güncel"), sRes2.message ?? "");

  // ── R devam) GERİ ALMA — durum kaynaktan yeniden türetilir ──────────────
  const rReopen = await purchaseOrderService.reopenShortClose(poR.id);
  const rReopened = await prisma.purchaseOrder.findUnique({
    where: { id: poR.id },
    select: { status: true, shortClosedAt: true, shortCloseReason: true },
  });
  check(
    "R9) ⭐ Geri almada bayrak temizlendi ve durum YENİDEN TÜRETİLDİ (PARTIAL)",
    rReopened?.status === PurchaseOrderStatus.PARTIAL && rReopened.shortClosedAt === null && rReopened.shortCloseReason === null,
    `${rReopened?.status} bayrak=${rReopened?.shortClosedAt}`,
  );
  check("R9b) Geri alma mesajı", (rReopen.message ?? "").includes("yeniden açıldı"), rReopen.message ?? "");

  const rOpen2 = await purchaseOrderService.openLines({ supplierId: supplier.id, limit: 500 });
  const rOpen2Ids = new Set((rOpen2.rows as Array<{ purchaseOrder: { id: string } }>).map((r) => r.purchaseOrder.id));
  check("R10) ⭐ Geri almadan sonra kalemler open-lines'a GERİ GELDİ", rOpen2Ids.has(poR.id));

  let rReopenMsg = "";
  try {
    await purchaseOrderService.reopenShortClose(poR.id);
  } catch (err) {
    rReopenMsg = (err as Error).message;
  }
  check("R11) Kapatılmamış siparişte geri alma 409", rReopenMsg.includes("kapatılmış değil"), rReopenMsg.slice(0, 80));

  // ── R12) CLAIM YARIŞI — 4 paralel kapatma, TEK karar ────────────────────
  // Advisory kilit + atomik claim: kazanan yazar, kaybedenler kilit açılınca
  // taze okumada bayrağı görür ve idempotent başarı döner (409 fırtınası yok).
  const poR2 = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 20 }] }))
    .data as unknown as Detail;
  orderIds.push(poR2.id);
  const rR2 = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poR2.id,
    lines: [{ itemId: fabric.id, initialQty: 5 }],
  });
  receiptIds.push((rR2.data as { id: string }).id);

  const raceReasons = [1, 2, 3, 4].map((i) => `${TAG} yarış sebebi ${i}`);
  const shortRace = await Promise.allSettled(raceReasons.map((r) => purchaseOrderService.shortClose(poR2.id, r)));
  const raceRejected = shortRace.filter((r) => r.status === "rejected");
  const r2Row = await prisma.purchaseOrder.findUnique({
    where: { id: poR2.id },
    select: { status: true, shortClosedAt: true, shortCloseReason: true },
  });
  check("R12) Körlük zemini: 4 paralel kapatma gerçekten koştu", shortRace.length === 4);
  check(
    "R13) ⭐ Claim yarışı: hiçbiri hata almadı, TEK karar yazıldı",
    raceRejected.length === 0 && r2Row?.status === PurchaseOrderStatus.CLOSED && r2Row.shortClosedAt !== null,
    raceRejected.map((r) => String(((r as PromiseRejectedResult).reason as Error | undefined)?.message ?? "")).join(" | ").slice(0, 120),
  );
  check(
    "R14) Kazanan sebep dört adaydan biri (karışık/yarım yazım yok)",
    raceReasons.includes(r2Row?.shortCloseReason ?? ""),
    r2Row?.shortCloseReason ?? "",
  );

  // ── T) TOP İPTALİ SENKRONU — softDelete rollup'ı tetikler ───────────────
  // ⚠️ ESKİ DAVRANIŞ (G2 öncesi, ölçülmüştü): fiş→sipariş zinciri doluyken bir
  // topun TEKİL iptali (`InventoryService.softDelete`) senkronu ÇAĞIRMIYORDU →
  // `receivedQty` bayat kalıyor, satın almacı gelmemiş malı gelmiş görüyordu.
  // Negatif sonda: softDelete sonundaki `syncPurchaseOrderSafely` tetiği
  // koparılınca T1/T2 kırmızı vermeli.
  const inventory = new InventoryService();
  const poT = (await purchaseOrderService.create({ supplierId: supplier.id, lines: [{ itemId: fabric.id, qty: 100 }] }))
    .data as unknown as Detail;
  orderIds.push(poT.id);
  const rT = await goodsReceiptService.create({
    warehouseId: wh.id,
    purchaseOrderId: poT.id,
    lines: [
      { itemId: fabric.id, initialQty: 40 },
      { itemId: fabric.id, initialQty: 30 },
    ],
  });
  const rTId = (rT.data as { id: string }).id;
  receiptIds.push(rTId);

  const tBefore = await detail(poT.id);
  check("T0) Körlük zemini: iki topla karşılanma 70", num(tBefore.lines[0]!.receivedQty) === 70, tBefore.lines[0]!.receivedQty.toString());

  const tRolls = await prisma.roll.findMany({
    where: { goodsReceiptId: rTId },
    select: { id: true, initialQty: true },
    orderBy: { initialQty: "desc" },
  });
  check("T0b) Körlük zemini: fiş gerçekten 2 top doğurdu", tRolls.length === 2, `${tRolls.length} top`);

  await inventory.softDelete(tRolls[0]!.id, undefined, {
    confirmActive: true,
    confirmLabelPrinted: true,
    reason: `${TAG} tekil top iptali`,
  });

  const tAfter = await detail(poT.id);
  check(
    "T1) ⭐ Tekil top iptali rollup'ı TETİKLEDİ (70 → 30, sayaç bayat DEĞİL)",
    num(tAfter.lines[0]!.receivedQty) === 30,
    tAfter.lines[0]!.receivedQty.toString(),
  );
  check("T2) ⭐ Saklanan ile kaynak MUTABIK (drift yok — tetik gerçek yazdı)", tAfter.totals.driftLineCount === 0, `drift=${tAfter.totals.driftLineCount}`);
  check("T3) Durum PARTIAL kaldı (30/100)", tAfter.status === PurchaseOrderStatus.PARTIAL, tAfter.status);

  // Zinciri olmayan top iptali senkrona HİÇ dokunmaz (fabrika sıfır-fark):
  // goodsReceiptId NULL → tetik tek sorgu bile koşmaz. Burada ayrıca fiş
  // CANCELLED dalını ölçüyoruz: fiş iptalinden sonra kalan topun tekil iptali
  // no-op senkronu ATLAR ama rakam zaten fiş iptalinde sıfırlanmıştır.
  await goodsReceiptService.cancel(rTId, `${TAG} fiş iptali`);
  const tCancelled = await detail(poT.id);
  check("T4) Fiş iptali rollup'ı sıfırladı (mevcut yol korunuyor)", num(tCancelled.lines[0]!.receivedQty) === 0, tCancelled.lines[0]!.receivedQty.toString());

  // ── §U ⭐ C4 (2026-08-15) — TEDARİKÇİ İKİ BACAKLI: cari **XOR** fason ─────
  // Alış HER cariden yapılabilir (Logo/Mikro/SAP BP) ama TEK cariden. Siparişte
  // kural mal kabulden DAHA SIKI: TAM BİRİ zorunlu — sipariş bir TAAHHÜTTÜR ve
  // kime verildiği belirsiz bir taahhüt yoktur (şemada `supplierId` bu yüzden
  // NOT NULL'dı; C4 ile nullable oldu ve kısıt kolondan SERVİSE TAŞINDI).
  {
    // Rol modeli faz 2 (E): BAĞLI profil alış tarafında KARTA çözülür (`test_supplier_party_tek_adres`); C4 fason
    // bacağı BAĞSIZ profilindir → bu bölüm fixture'ın bağ durumundan bağımsız, kendi bağsız profiliyle ölçer.
    const dye = await prisma.subcontractor.create({ data: { code: `${TAG}-FSN`, name: `${TAG} Fason Bağsız` }, select: { id: true, name: true } });
    subcontractorIds.push(dye.id);

    // U1 — XOR ihlali + boş taraf: ikisi de 400 ve sipariş DOĞMAZ.
    const poBefore = await prisma.purchaseOrder.count();
    let bothErr = "";
    try {
      await purchaseOrderService.create({
        supplierId: supplier.id,
        subcontractorId: dye.id,
        lines: [{ itemId: fabric.id, qty: 10 }],
      });
    } catch (e) {
      bothErr = (e as Error).message;
    }
    let noneErr = "";
    try {
      await purchaseOrderService.create({ lines: [{ itemId: fabric.id, qty: 10 }] });
    } catch (e) {
      noneErr = (e as Error).message;
    }
    const poAfter = await prisma.purchaseOrder.count();
    check("U1a) ⭐ İki tedarikçi birden → 400", bothErr.includes("ikisi birden seçilemez"), bothErr.slice(0, 80));
    check("U1b) ⭐ Tedarikçisiz sipariş → 400 (mal kabulden DAHA SIKI kural)", noneErr.includes("Tedarikçi zorunlu"), noneErr.slice(0, 80));
    check("U1c) Reddedilen iki denemeden hiçbiri sipariş DOĞURMADI", poBefore === poAfter, `${poBefore} → ${poAfter}`);

    // U2 — Fason firmaya sipariş: kolon yazılır, müşteri bacağı NULL.
    const poFason = (await purchaseOrderService.create({
      subcontractorId: dye.id,
      lines: [{ itemId: fabric.id, qty: 200 }],
    })).data as unknown as Detail;
    orderIds.push(poFason.id);
    const fasonRow = await prisma.purchaseOrder.findUnique({
      where: { id: poFason.id },
      select: { supplierId: true, subcontractorId: true, status: true },
    });
    check(
      "U2a) ⭐ Fason firmaya alış siparişi açıldı (subcontractorId dolu, supplierId NULL)",
      fasonRow?.subcontractorId === dye.id && fasonRow?.supplierId === null,
      `sub=${fasonRow?.subcontractorId?.slice(0, 8)} sup=${fasonRow?.supplierId}`,
    );
    const fasonDetail = (await purchaseOrderService.getById(poFason.id)) as unknown as {
      subcontractorSupplier?: { id: string; code: string; name: string } | null;
    };
    check(
      "U2b) ⭐ Detay `subcontractorSupplier` {id, code, name} döndürüyor (müşteri bacağıyla AYNI şekil)",
      fasonDetail.subcontractorSupplier?.id === dye.id &&
        typeof fasonDetail.subcontractorSupplier?.code === "string" &&
        typeof fasonDetail.subcontractorSupplier?.name === "string",
      JSON.stringify(fasonDetail.subcontractorSupplier),
    );

    // U3 — LİSTE: fason bacağı AYRI bir filtre anahtarıdır (id uzayları farklı;
    // tek anahtara katlamak müşteri id'sini fason kolonunda aratıp sessiz 0
    // satır üretirdi) ve ARAMA da fason adını görür.
    const listByFason = await purchaseOrderService.list({
      page: 1,
      pageSize: 100,
      filters: { subcontractorId: dye.id },
    });
    const fasonRowInList = (listByFason.rows as Array<{ id: string; subcontractorSupplier?: { id: string } | null }>)
      .find((r) => r.id === poFason.id);
    check(
      "U3a) ⭐ `filter[subcontractorId]` süzüyor + satır fason bacağını taşıyor",
      fasonRowInList !== undefined && fasonRowInList.subcontractorSupplier?.id === dye.id,
      `bulundu=${fasonRowInList !== undefined}`,
    );
    const listBySearch = await purchaseOrderService.list({
      page: 1,
      pageSize: 100,
      filters: {},
      search: dye.name,
    });
    check(
      "U3b) ⭐ Arama fason firma ADINI da görüyor (yoksa kullanıcı kendi siparişini bulamaz)",
      (listBySearch.rows as Array<{ id: string }>).some((r) => r.id === poFason.id),
      `${(listBySearch.rows as unknown[]).length} satır`,
    );

    // U4 — TARAF DEĞİŞİMİ BÜTÜNDÜR: müşteri→fason geçişinde ESKİ bacak NULL'lanır.
    // ⚠️ Yalnız gönderilen kolonu yazan eski kod, iki bacaklı dünyada "iki
    // tedarikçili sipariş" üretirdi ve XOR'u koruyan tek mekanizmayı delerdi.
    const poSwap = (await purchaseOrderService.create({
      supplierId: supplier.id,
      lines: [{ itemId: fabric.id, qty: 50 }],
    })).data as unknown as Detail;
    orderIds.push(poSwap.id);
    await purchaseOrderService.update(poSwap.id, { subcontractorId: dye.id });
    const swapped = await prisma.purchaseOrder.findUnique({
      where: { id: poSwap.id },
      select: { supplierId: true, subcontractorId: true },
    });
    check(
      "U4a) ⭐ Müşteri → fason geçişinde ESKİ bacak NULL'landı (yarım taraf yok)",
      swapped?.subcontractorId === dye.id && swapped?.supplierId === null,
      `sub=${swapped?.subcontractorId?.slice(0, 8)} sup=${swapped?.supplierId}`,
    );
    // Taraf anahtarı GÖNDERİLMEZSE tedarikçiye DOKUNULMAZ (not düzenlemesi
    // siparişi tedarikçisiz bırakmamalı).
    await purchaseOrderService.update(poSwap.id, { notes: `${TAG} not` });
    const untouched = await prisma.purchaseOrder.findUnique({
      where: { id: poSwap.id },
      select: { supplierId: true, subcontractorId: true, notes: true },
    });
    check(
      "U4b) ⭐ Taraf gönderilmeyen düzenleme tedarikçiye DOKUNMADI",
      untouched?.subcontractorId === dye.id && untouched?.supplierId === null && untouched?.notes === `${TAG} not`,
      `sub=${untouched?.subcontractorId?.slice(0, 8)} not=${untouched?.notes}`,
    );

    // U5 — KARŞILANMA ZİNCİRİ FASON BACAĞINDA DA ÇALIŞIR: fişten sipariş
    // rollup'ına giden yol tedarikçinin HANGİ tabloda olduğunu bilmez ve
    // bilmemeli. (Bilseydi, C4 sessizce yalnız yarısı çalışan bir köprü olurdu.)
    const rFason = await goodsReceiptService.create({
      warehouseId: wh.id,
      purchaseOrderId: poFason.id,
      lines: [{ itemId: fabric.id, initialQty: 120 }],
    });
    receiptIds.push((rFason.data as { id: string }).id);
    const fasonAfter = await detail(poFason.id);
    check(
      "U5a) ⭐ Fason siparişte karşılanma işledi (120/200 → PARTIAL)",
      num(fasonAfter.lines[0]!.receivedQty) === 120 && fasonAfter.status === PurchaseOrderStatus.PARTIAL,
      `${fasonAfter.lines[0]!.receivedQty.toString()} / ${fasonAfter.status}`,
    );
    check("U5b) Saklanan ile kaynak MUTABIK (drift yok)", fasonAfter.totals.driftLineCount === 0, `drift=${fasonAfter.totals.driftLineCount}`);

    // U6 — AÇIK KALEMLER: fason bacağı kendi anahtarıyla süzülür ve müşteri
    // anahtarıyla süzülünce GÖRÜNMEZ (iki uzay birbirine karışmıyor).
    const openFason = await purchaseOrderService.openLines({ subcontractorId: dye.id, itemId: fabric.id });
    const openCustomer = await purchaseOrderService.openLines({ supplierId: supplier.id, itemId: fabric.id });
    const inFason = (openFason.rows as Array<{ purchaseOrder: { id: string } }>).some((r) => r.purchaseOrder.id === poFason.id);
    const inCustomer = (openCustomer.rows as Array<{ purchaseOrder: { id: string } }>).some((r) => r.purchaseOrder.id === poFason.id);
    check("U6a) ⭐ `open-lines` fason anahtarıyla kalemi buluyor", inFason, `fason=${openFason.total}`);
    check("U6b) ⭐ Müşteri anahtarıyla fason kalemi GÖRÜNMÜYOR (uzaylar ayrı)", !inCustomer, `müşteri=${openCustomer.total}`);
  }

  // ── Z) KÖRLÜK ZEMİNİ ────────────────────────────────────────────────────
  // "Hiç satır bulunamadı" ile "ihlal yok" AYNI yeşile çıkmamalı: aşağıdaki
  // sayımlar düşerse fixture kurulmamış demektir ve yukarıdaki her kontrol
  // vakumen geçmiş olur.
  check("Z1) Körlük zemini: en az 10 sipariş üretildi", orderIds.length >= 10, `${orderIds.length} sipariş`);
  check("Z2) Körlük zemini: en az 5 mal kabul fişi üretildi", receiptIds.length >= 5, `${receiptIds.length} fiş`);
  const producedRolls = await prisma.roll.count({ where: { goodsReceiptId: { in: receiptIds } } });
  check("Z3) Körlük zemini: kabul satırları gerçekten top doğurdu", producedRolls >= 4, `${producedRolls} top`);
  const producedLines = await prisma.purchaseOrderLine.count({ where: { purchaseOrderId: { in: orderIds } } });
  check("Z4) Körlük zemini: sipariş kalemleri yazıldı", producedLines >= 8, `${producedLines} kalem`);
  const yarnRows = await prisma.yarnMovement.count({ where: { goodsReceiptId: { in: receiptIds } } });
  check("Z5) Körlük zemini: iplik hareketi gerçekten doğdu (J bölümü ölçtü)", yarnRows >= 1, `${yarnRows} hareket`);
}

main()
  .catch((e) => {
    console.error("Beklenmeyen hata:", e);
    fail++;
  })
  .finally(async () => {
    if (modulGeriAl) {
      await modulGeriAl().catch((e: Error) =>
        console.error("   ⚠️  modül bayrakları geri yazılamadı:", e.message),
      );
    }
    try {
      const rolls = await prisma.roll.findMany({ where: { goodsReceiptId: { in: receiptIds } }, select: { id: true } });
      const rollIds = rolls.map((r) => r.id);
      if (rollIds.length) {
        // ⚠️ `RollVariance` FK RESTRICT — top silen her temizlik onu ÖNCE düşürmeli.
        await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
        await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
      }
      if (receiptIds.length) {
        await prisma.yarnMovement.deleteMany({ where: { goodsReceiptId: { in: receiptIds } } });
        await prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } });
      }
      if (orderIds.length) {
        await prisma.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: { in: orderIds } } });
        await prisma.purchaseOrder.deleteMany({ where: { id: { in: orderIds } } });
      }
      if (warehouseIds.length) {
        await prisma.yarnStock.deleteMany({ where: { warehouseId: { in: warehouseIds } } });
        await prisma.warehouse.deleteMany({ where: { id: { in: warehouseIds } } });
      }
      if (itemIds.length) await prisma.item.deleteMany({ where: { id: { in: itemIds } } });
      if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      if (subcontractorIds.length) await prisma.subcontractor.deleteMany({ where: { id: { in: subcontractorIds } } });
    } catch (e) {
      console.warn("Temizlik uyarısı:", (e as Error).message.slice(0, 300));
    }
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
