// =============================================================================
// Test: SEVKİ GERİ AL (STORNO) — "mal hiç çıkmadı", iade DEĞİL
// Çalıştır: npx tsx scripts/test_shipment_undo_dispatch.ts
// =============================================================================
// SAHA VAKASI (2026-08-05): "Sevk yapıldı ama araç hâlâ kapıda, içinden 2 top
// çıkarmamız gerekiyor — nasıl yaparız?" Tek yol iadeydi; oysa iade "mal
// müşteriye ULAŞTI ve geri geldi" demektir. Hiç çıkmamış malı iade defterine
// yazmak (a) rakamı doğru gösterse de OLAYI yanlış anlatır, (b) iade nedeni
// zorunlu olduğu için kalite geri-besleme verisini kirletir.
//
// Sektör karşılığı ayrı bir işlemdir: SAP VL09 "reverse goods issue" (storno).
// Aynı ayrımın projedeki emsali: `InventoryService.softDelete` (qtyOut=0 —
// kayıt baştan hatalıydı) ↔ WO-kapanış dispozisyonu (qtyOut=qtyIn — mal vardı).
//
// Bu bekçi ŞUNLARI kilitler:
//   [1] Sevkte `Roll.preShipStatus` YAZILIR ve raf ayrımı korunur — çuvalda hem
//       WAREHOUSE hem A1_STOCK (2. kalite) top olabilir; geri almada hepsini
//       WAREHOUSE'a döndürmek 2. kaliteyi sessizce 1. kalite rafına yazardı.
//   [2] Storno DISPATCHED → PLANNED; toplar KENDİ eski rafına döner,
//       `preShipStatus` NULL'lanır (bir sonraki sevk taze snapshot alsın).
//   [3] Sipariş karşılanması geri alınır (`shippedQty`), `ShipmentOrder.isActive`
//       true'ya döner (şemada "sevkiyat PLANNED mı" denormu).
//   [4] Sevk irsaliyesi VOIDED (silinmez — donmuş belge kuralı).
//   [5] YENİDEN SEVK belge v2 üretir. `freezeForSource` eskiden `version: 1`
//       SABİT yazıyordu → ikinci freeze `docType_sourceId_version` unique'ine
//       çarpıp 500 verirdi; hem de tam sevk anında, tx'i geri sararak.
//   [6] İADE DEFTERİNE KAYIT GİRMEZ (storno ≠ iade — ayrımın tamamı bu).
//   [7] Engeller ve hepsi SEBEBİNİ söyler: faturalanmış · bu sevkiyattan iade
//       alınmış · (ayar açıksa) aynı gün değil. Sessiz 409 yasak.
//   [8] Önizleme ile mutasyon AYNI kaynaktan konuşur (`resolveUndoBlockReason`):
//       ekranda "yapılabilir" derken uçta 409 alınmaz.
//   [9] Gerekçe ZORUNLU (min 3) — resmi belge iptal ediliyor.
//
// Fixture: elle kurulan PLANNED sevkiyat + gerçek `dispatchShipment` çağrısı
// (freeze/preShipStatus yollarının ikisi de ürün kodundan geçsin). Cleanup
// finally'de; tüm kayıtlar `TEST-` önekli.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { shippingService } from "../src/services/shipping.service";
import { returnService } from "../src/services/return.service";
import { ensureTestAdmin } from "./fixture-test-user";
import { SETTING_KEYS } from "../src/services/system-setting.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

interface UndoPreview {
  canUndo: boolean;
  blockReason: string | null;
  sackCount: number;
  rollCount: number;
  sacks: { sackNo: string; rollCount: number }[];
  affectedOrders: string[];
  returnTargets: { status: string; rollCount: number }[];
  voidsDispatchNote: boolean;
}

const N = (v: unknown) => Number(v);
async function err(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function main() {
  const ts = Date.now();
  const admin = await ensureTestAdmin();

  const customer = await prisma.customer.create({
    data: { code: `TST-UND-${ts}`, name: "TEST STORNO MÜŞTERİ", taxNumber: "9998887771" },
    select: { id: true },
  });
  const item = await prisma.item.create({
    data: { code: `TST-UND-I-${ts}`, name: "STORNO KUMAŞ", itemType: "FABRIC", unit: "MT" },
    select: { id: true },
  });
  const color = await prisma.color.create({
    data: { code: `TST-UND-C-${ts}`, name: "STORNO EKRU" },
    select: { id: true },
  });

  // Sipariş + satır → tahsis defteri (madde 3).
  const order = await prisma.order.create({
    data: { orderNumber: `TEST-UND-O-${ts}`, customerId: customer.id, status: "APPROVED" },
    select: { id: true, orderNumber: true },
  });
  const line = await prisma.orderLine.create({
    data: { orderId: order.id, itemId: item.id, colorId: color.id, quantity: 500, width: 330 },
    select: { id: true },
  });

  const shipment = await prisma.shipment.create({
    data: {
      shipmentNo: `TEST-UND-${ts}`,
      customerId: customer.id,
      status: "PLANNED",
      destination: "DOMESTIC",
    },
    select: { id: true },
  });
  const sack = await prisma.sack.create({
    data: { sackNo: `TEST-UND-SK-${ts}`, customerId: customer.id, shipmentId: shipment.id, seq: 1, weightKg: 60 },
    select: { id: true, sackNo: true },
  });
  await prisma.shipmentOrder.create({ data: { shipmentId: shipment.id, orderId: order.id, isActive: true } });
  await prisma.sackAllocation.create({ data: { sackId: sack.id, orderLineId: line.id, qty: 150 } });

  // İKİ FARKLI RAF — asıl sınama burada: A1 topu WAREHOUSE'a dönmemeli.
  const mkRoll = (n: number, qty: number, status: "WAREHOUSE" | "A1_STOCK") =>
    prisma.roll.create({
      data: {
        barcode: `TEST-UND-R${n}-${ts}`,
        itemId: item.id,
        colorId: color.id,
        status,
        currentQty: qty,
        initialQty: qty,
        width: 330,
        qualityGrade: "A",
        entrySource: "SUPPLIER_RECEIPT",
        shipmentId: shipment.id,
        sackId: sack.id,
      },
      select: { id: true, barcode: true },
    });
  const rWarehouse = await mkRoll(1, 100, "WAREHOUSE");
  const rA1 = await mkRoll(2, 50, "A1_STOCK");

  const rollStatus = async (id: string) =>
    (await prisma.roll.findUnique({ where: { id }, select: { status: true, preShipStatus: true } }))!;
  const preview = async (): Promise<UndoPreview> =>
    ((await shippingService.getUndoDispatchPreview(shipment.id)) as { data: UndoPreview }).data;

  let sameDayKeyWritten = false;

  try {
    // ---------------------------------------------------------------------
    console.log("\n[1] SEVK — preShipStatus yazılıyor, raf ayrımı korunuyor");
    await shippingService.dispatchShipment(shipment.id, { plateNumber: "34TEST01", driverName: "TEST ŞOFÖR" }, admin.id);
    const w1 = await rollStatus(rWarehouse.id);
    const a1 = await rollStatus(rA1.id);
    check("sevk sonrası iki top da SHIPPED", w1.status === "SHIPPED" && a1.status === "SHIPPED");
    check("depo topunun preShipStatus'u WAREHOUSE", w1.preShipStatus === "WAREHOUSE", String(w1.preShipStatus));
    check("2. kalite topunun preShipStatus'u A1_STOCK", a1.preShipStatus === "A1_STOCK", String(a1.preShipStatus));

    const afterDispatch = await prisma.orderLine.findUnique({ where: { id: line.id }, select: { shippedQty: true } });
    check("ön koşul — sevk sonrası shippedQty 150", N(afterDispatch?.shippedQty) === 150, String(afterDispatch?.shippedQty));
    const docV1 = await prisma.printedDocument.findFirst({
      where: { docType: "SHIPMENT_DISPATCH", sourceId: shipment.id },
      orderBy: { version: "desc" },
      select: { version: true, status: true },
    });
    check("ön koşul — sevk irsaliyesi v1 ACTIVE", docV1?.version === 1 && docV1?.status === "ACTIVE", JSON.stringify(docV1));

    // ---------------------------------------------------------------------
    console.log("\n[2] ÖNİZLEME — somut liste + izin verilen durum");
    const p1 = await preview();
    check("önizleme: geri alınabilir", p1.canUndo === true && p1.blockReason === null, String(p1.blockReason));
    check("önizleme: 1 çuval / 2 top somut", p1.sackCount === 1 && p1.rollCount === 2 && p1.sacks[0]?.sackNo === sack.sackNo);
    check("önizleme: etkilenen sipariş listeleniyor", p1.affectedOrders.includes(order.orderNumber), p1.affectedOrders.join(","));
    check("önizleme: irsaliyenin iptal olacağı söyleniyor", p1.voidsDispatchNote === true);
    const targets = Object.fromEntries(p1.returnTargets.map((t) => [t.status, t.rollCount]));
    check(
      "önizleme: dönülecek raflar AYRI gösteriliyor (WAREHOUSE 1 · A1_STOCK 1)",
      targets.WAREHOUSE === 1 && targets.A1_STOCK === 1,
      JSON.stringify(targets),
    );

    // ---------------------------------------------------------------------
    console.log("\n[3] GEREKÇE ZORUNLU");
    const shortReason = await err(() => shippingService.undoDispatch(shipment.id, "ab", admin.id));
    check("2 karakterlik gerekçe reddedildi", shortReason !== null && /gerekçe/i.test(shortReason), String(shortReason));

    // ---------------------------------------------------------------------
    console.log("\n[4] STORNO — toplar KENDİ rafına döner");
    const res = (await shippingService.undoDispatch(
      shipment.id,
      "TEST — araç yüklenmeden sevk onaylandı",
      admin.id,
    )) as { data: { restoredRolls: number; voidedDocs: number } };
    check("2 top geri alındı", res.data.restoredRolls === 2, String(res.data.restoredRolls));

    const w2 = await rollStatus(rWarehouse.id);
    const a2 = await rollStatus(rA1.id);
    check("depo topu WAREHOUSE'a döndü", w2.status === "WAREHOUSE", String(w2.status));
    check("2. KALİTE TOPU A1_STOCK'a döndü (WAREHOUSE'a DEĞİL)", a2.status === "A1_STOCK", String(a2.status));
    check("preShipStatus temizlendi", w2.preShipStatus === null && a2.preShipStatus === null);

    const sh = await prisma.shipment.findUnique({
      where: { id: shipment.id },
      select: { status: true, dispatchedAt: true, plateNumber: true, driverName: true },
    });
    check("sevkiyat PLANNED", sh?.status === "PLANNED", String(sh?.status));
    check("dispatchedAt temizlendi", sh?.dispatchedAt === null);
    check("plaka/şoför KORUNDU (ürün kararı)", sh?.plateNumber === "34TEST01" && sh?.driverName === "TEST ŞOFÖR");

    const so = await prisma.shipmentOrder.findUnique({
      where: { shipmentId_orderId: { shipmentId: shipment.id, orderId: order.id } },
      select: { isActive: true },
    });
    check("ShipmentOrder.isActive true'ya döndü", so?.isActive === true, String(so?.isActive));
    const afterUndo = await prisma.orderLine.findUnique({ where: { id: line.id }, select: { shippedQty: true } });
    check("shippedQty geri alındı (0)", N(afterUndo?.shippedQty) === 0, String(afterUndo?.shippedQty));

    const docAfter = await prisma.printedDocument.findFirst({
      where: { docType: "SHIPMENT_DISPATCH", sourceId: shipment.id, version: 1 },
      select: { status: true, voidReason: true },
    });
    check("sevk irsaliyesi VOIDED (silinmedi)", docAfter?.status === "VOIDED", String(docAfter?.status));
    check("iptal gerekçesi belgeye yazıldı", (docAfter?.voidReason ?? "").includes("araç yüklenmeden"), String(docAfter?.voidReason));

    // MADDE 6 — storno iade DEĞİLDİR.
    const returnRows = await prisma.rollReturn.count({ where: { fromShipmentId: shipment.id } });
    check("İADE DEFTERİNE KAYIT GİRMEDİ (storno ≠ iade)", returnRows === 0, String(returnRows));

    // ---------------------------------------------------------------------
    console.log("\n[5] YENİDEN SEVK — belge v2 (eski sabit version:1 burada 500 verirdi)");
    await shippingService.dispatchShipment(shipment.id, {}, admin.id);
    const versions = await prisma.printedDocument.findMany({
      where: { docType: "SHIPMENT_DISPATCH", sourceId: shipment.id },
      orderBy: { version: "asc" },
      select: { version: true, status: true },
    });
    check("iki versiyon var (v1 VOIDED + v2 ACTIVE)", versions.length === 2, JSON.stringify(versions));
    check("v2 ACTIVE", versions[1]?.version === 2 && versions[1]?.status === "ACTIVE", JSON.stringify(versions[1]));
    check("v1 VOIDED kaldı", versions[0]?.status === "VOIDED", JSON.stringify(versions[0]));
    const reShipped = await rollStatus(rA1.id);
    check("yeniden sevkte preShipStatus TAZE yazıldı", reShipped.preShipStatus === "A1_STOCK", String(reShipped.preShipStatus));

    // ---------------------------------------------------------------------
    console.log("\n[6] ENGEL — FATURALANMIŞ sevkiyat geri alınamaz");
    await prisma.shipment.update({ where: { id: shipment.id }, data: { invoiceNo: "FT-TEST-1", invoicedAt: new Date() } });
    const pInv = await preview();
    check("önizleme: fatura engeli SEBEBİYLE söyleniyor", pInv.canUndo === false && /fatura/i.test(pInv.blockReason ?? ""), String(pInv.blockReason));
    const invErr = await err(() => shippingService.undoDispatch(shipment.id, "TEST fatura denemesi", admin.id));
    check("uç da reddediyor (önizleme ile aynı kaynak)", invErr !== null && /fatura/i.test(invErr), String(invErr));
    await prisma.shipment.update({ where: { id: shipment.id }, data: { invoiceNo: null, invoicedAt: null } });

    // ---------------------------------------------------------------------
    console.log("\n[7] ENGEL — bu sevkiyattan İADE alınmışsa geri alınamaz");
    const ret = (await returnService.createReturn(
      { rollId: rWarehouse.id, reasonText: "TEST — storno engeli sınaması" },
      admin.id,
    )) as { data: { id: string } };
    const pRet = await preview();
    check("önizleme: iade engeli SEBEBİYLE söyleniyor", pRet.canUndo === false && /iade/i.test(pRet.blockReason ?? ""), String(pRet.blockReason));
    const retErr = await err(() => shippingService.undoDispatch(shipment.id, "TEST iade denemesi", admin.id));
    check("uç da reddediyor", retErr !== null && /iade/i.test(retErr), String(retErr));
    // İadeyi iptal et → engel kendiliğinden kalkmalı (cancelledAt süzgeci).
    await returnService.cancelReturn(ret.data.id, "TEST — engel kalksın", admin.id);
    const pRetCancelled = await preview();
    check("iade iptal edilince engel KALKTI", pRetCancelled.canUndo === true, String(pRetCancelled.blockReason));

    // ---------------------------------------------------------------------
    console.log("\n[8] AYAR — 'yalnız aynı gün' açıkken dünkü sevk reddedilir");
    const existing = await prisma.systemSetting.findUnique({
      where: { key: SETTING_KEYS.SHIPMENT_UNDO_SAME_DAY_ONLY },
      select: { key: true },
    });
    sameDayKeyWritten = !existing;
    await prisma.systemSetting.upsert({
      where: { key: SETTING_KEYS.SHIPMENT_UNDO_SAME_DAY_ONLY },
      create: { key: SETTING_KEYS.SHIPMENT_UNDO_SAME_DAY_ONLY, value: "true", description: "TEST" },
      update: { value: "true" },
    });
    // Sevk anını 3 gün geriye al.
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { dispatchedAt: new Date(Date.now() - 3 * 24 * 3600_000) },
    });
    const pOld = await preview();
    check("ayar AÇIK + eski sevk → reddedildi", pOld.canUndo === false && /aynı gün/i.test(pOld.blockReason ?? ""), String(pOld.blockReason));
    const oldErr = await err(() => shippingService.undoDispatch(shipment.id, "TEST eski gün denemesi", admin.id));
    check("uç da reddediyor", oldErr !== null && /aynı gün/i.test(oldErr), String(oldErr));

    await prisma.systemSetting.update({
      where: { key: SETTING_KEYS.SHIPMENT_UNDO_SAME_DAY_ONLY },
      data: { value: "false" },
    });
    const pFlagOff = await preview();
    check("ayar KAPALI (varsayılan) → eski sevk de geri alınabilir", pFlagOff.canUndo === true, String(pFlagOff.blockReason));

    // ---------------------------------------------------------------------
    console.log("\n[9] PLANNED sevkiyat geri alınamaz (zaten çıkmamış)");
    await shippingService.undoDispatch(shipment.id, "TEST — kapanış stornosu", admin.id);
    const twice = await err(() => shippingService.undoDispatch(shipment.id, "TEST — ikinci deneme", admin.id));
    check("PLANNED'da tekrar geri alma reddedildi", twice !== null && /sevk edilmiş/i.test(twice), String(twice));
  } finally {
    // Cleanup — bağımlılık sırasıyla.
    await prisma.rollReturn.deleteMany({ where: { customerId: customer.id } });
    await prisma.printedDocument.deleteMany({ where: { sourceId: shipment.id } });
    await prisma.sackAllocation.deleteMany({ where: { sackId: sack.id } });
    await prisma.shipmentOrder.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.roll.deleteMany({ where: { itemId: item.id } });
    await prisma.sack.deleteMany({ where: { id: sack.id } });
    await prisma.shipment.deleteMany({ where: { id: shipment.id } });
    await prisma.orderLine.deleteMany({ where: { orderId: order.id } });
    await prisma.order.deleteMany({ where: { id: order.id } });
    await prisma.color.deleteMany({ where: { id: color.id } });
    await prisma.item.deleteMany({ where: { id: item.id } });
    await prisma.customer.deleteMany({ where: { id: customer.id } });
    if (sameDayKeyWritten) {
      await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.SHIPMENT_UNDO_SAME_DAY_ONLY } });
    }
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  await pool.end();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  await pool.end();
  process.exit(1);
});
