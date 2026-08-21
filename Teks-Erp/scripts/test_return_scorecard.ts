// =============================================================================
// Test: İADE KARNESİ
// Çalıştır: npx tsx scripts/test_return_scorecard.ts
// =============================================================================
// EN KRİTİK KONTROL — PAYDA BRÜT MÜ:
// İade, topun `shipmentId`'sini NULL'lar. Payda canlı okunursa iade edilen
// metraj paydadan DA düşer ve oran şişer — üstelik en çok iade alınan dönemde
// en çok şişer, yani rapor tam da alarm vermesi gereken yerde abartır.
// Fixture bunu sayıyla ayırt edilebilir kurar: brüt payda 1000 → %10,
// net payda 900 → %11,1. İki değer birbirine yakın ama EŞİT DEĞİL; test
// eşitliği değil DOĞRU DEĞERİ arar.
//
// İkinci kritik kontrol: `DirectShipment` (fasondan doğrudan müşteriye) paydaya
// dahil mi. Ayrı tablo + farklı tarih kolonu (`shippedAt`) olduğu için unutulması
// kolaydır ve unutulursa payda küçülüp oran yine şişer.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getReturnScorecard } from "../src/services/reports/return-scorecard.report.service";
import { resolveCompareRange, type DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-RET-${Date.now()}`;
const RANGE: DateRange = {
  from: new Date("2097-09-01T00:00:00.000Z"),
  to: new Date("2097-09-30T23:59:59.999Z"),
};
const IN_WINDOW = new Date("2097-09-15T10:00:00.000Z");
const IN_PREV = new Date("2097-08-15T10:00:00.000Z");

const rollIds: string[] = [];
const returnIds: string[] = [];
const shipmentIds: string[] = [];
const directIds: string[] = [];
const dispatchIds: string[] = [];
const batchIds: string[] = [];
const stepIds: string[] = [];
const woIds: string[] = [];
const stationIds: string[] = [];
const subIds: string[] = [];

async function main(): Promise<void> {
  console.log("\n=== İade Karnesi bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const customer = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const user = await prisma.user.findFirst({ select: { id: true } });
  const reason = await prisma.returnReason.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  if (!item || !customer || !user || !reason) {
    console.log("❌ Ön koşul yok (kumaş + müşteri + kullanıcı + iade sebebi gerekli)");
    fail++;
    return;
  }

  // ── SEVKİYAT (payda) ──────────────────────────────────────────────────────
  // 1000 m sevk edildi; sonra 100 m iade alındı → iade topun shipmentId'si
  // NULL'landı, yani CANLI sorgu yalnız 900 m görür.
  const ship = await prisma.shipment.create({
    data: {
      shipmentNo: `${TAG}-S1`, customerId: customer.id,
      status: "DISPATCHED", dispatchedAt: IN_WINDOW,
    },
    select: { id: true },
  });
  shipmentIds.push(ship.id);

  const mkRoll = async (qty: number, shipmentId: string | null): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: qty, currentQty: qty, status: "SHIPPED",
        entrySource: "SUPPLIER_RECEIPT", shipmentId,
        barcode: `${TAG}-R${rollIds.length}`,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    return r.id;
  };
  await mkRoll(900, ship.id);                 // sevkiyatta DURAN metraj
  const returnedRoll = await mkRoll(100, null); // iade edildi → shipmentId NULL

  // ── İADE (pay) ────────────────────────────────────────────────────────────
  const mkReturn = async (o: {
    rollId: string; qty: number; at: Date; reasonId?: string | null;
    reasonText?: string | null; cancelled?: boolean; fromShipmentId?: string | null;
  }): Promise<void> => {
    const r = await prisma.rollReturn.create({
      data: {
        rollId: o.rollId, customerId: customer.id, itemId: item.id, qty: o.qty,
        receivedById: user.id, createdAt: o.at,
        reasonId: o.reasonId ?? null, reasonText: o.reasonText ?? null,
        fromShipmentId: o.fromShipmentId ?? null,
        ...(o.cancelled ? { cancelledAt: o.at, cancelReason: "test" } : {}),
      },
      select: { id: true },
    });
    returnIds.push(r.id);
  };
  await mkReturn({ rollId: returnedRoll, qty: 100, at: IN_WINDOW, reasonId: reason.id, fromShipmentId: ship.id });
  // Sebebi serbest metin — ayrı kovada sayılmalı (katalog eksikliği sinyali)
  const freeRoll = await mkRoll(30, null);
  await mkReturn({ rollId: freeRoll, qty: 30, at: IN_WINDOW, reasonText: "musteri begenmedi" });
  // Sebepsiz
  const noneRoll = await mkRoll(20, null);
  await mkReturn({ rollId: noneRoll, qty: 20, at: IN_WINDOW });
  // İPTAL EDİLMİŞ iade — hiçbir yerde sayılmamalı
  const cancelledRoll = await mkRoll(500, null);
  await mkReturn({ rollId: cancelledRoll, qty: 500, at: IN_WINDOW, reasonId: reason.id, cancelled: true });
  // Önceki dönem: 60 m iade / 600 m sevk → %10
  const prevShip = await prisma.shipment.create({
    data: { shipmentNo: `${TAG}-S0`, customerId: customer.id, status: "DISPATCHED", dispatchedAt: IN_PREV },
    select: { id: true },
  });
  shipmentIds.push(prevShip.id);
  await mkRoll(600, prevShip.id);
  const prevRet = await mkRoll(60, null);
  // ⚠️ `fromShipmentId` GERÇEK AKIŞTA HER ZAMAN DOLUDUR (servis onu topun
  // sevkiyatından türetir) ve geri-eklemenin anahtarıdır. Fixture'da boş
  // bırakmak "iade payda oldu ama geri eklenmedi" gibi YANLIŞ bir beklenti
  // üretiyordu — ilk yazımda tam bu oldu ve bekçi yakaladı.
  await mkReturn({ rollId: prevRet, qty: 60, at: IN_PREV, reasonId: reason.id, fromShipmentId: prevShip.id });
  // Sevkiyat bağı OLMAYAN iade (alan nullable): paya girer, paydaya geri
  // EKLENEMEZ — çünkü hangi sevkiyattan düştüğü bilinmiyor. Bu asimetri
  // bilinçlidir ve burada kilitlenir ki sonradan "eksik" sanılıp uydurma bir
  // atıf eklenmesin.
  const orphanRet = await mkRoll(10, null);
  await mkReturn({ rollId: orphanRet, qty: 10, at: IN_PREV, reasonId: reason.id });

  // ── DOĞRUDAN SEVK (fasondan müşteriye) — PAYDAYA girmeli ─────────────────
  // ⚠️ Bu fixture TESTİN GÖREBİLİRLİĞİ için load-bearing: onsuz "doğrudan sevkler
  // paydaya dahil" kuralı VAKUMEN yeşil kalıyordu (ölçüldü — kaldıran sonda
  // hiçbir kontrolü kırmıyordu). Ayrı tablo + farklı tarih kolonu (`shippedAt`)
  // olduğu için unutulması en kolay paydadır ve unutulunca oran sessizce şişer.
  // Zincir TEST TARAFINDAN kurulur, ortamdan ARANMAZ: `findFirst` ile hazır bir
  // sevk bulmaya çalışmak temiz CI veritabanında sessizce atlanır ve kural
  // orada korumasız kalırdı (CLAUDE.md "ortamdaki veriye bağımlı olma").
  const station = await prisma.station.create({
    data: { code: `${TAG}-STN`, name: "İade testi istasyonu", type: "EXTERNAL" },
    select: { id: true },
  });
  stationIds.push(station.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" },
    select: { id: true },
  });
  woIds.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 },
    select: { id: true },
  });
  stepIds.push(step.id);
  const batch = await prisma.batch.create({
    data: { batchNumber: `${TAG}-B`, workOrderId: wo.id },
    select: { id: true },
  });
  batchIds.push(batch.id);
  const sub = await prisma.subcontractor.create({
    data: { code: `${TAG}-SUB`, name: `İade testi fason ${TAG}` },
    select: { id: true },
  });
  subIds.push(sub.id);
  const disp = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `${TAG}-SD`,
      workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: sub.id,
    },
    select: { id: true },
  });
  dispatchIds.push(disp.id);
  const ds = await prisma.directShipment.create({
    data: {
      shipmentNo: `${TAG}-D1`, dispatchId: disp.id, customerId: customer.id,
      reason: "test", totalQty: 500, rollCount: 1, shippedAt: IN_WINDOW,
    },
    select: { id: true },
  });
  directIds.push(ds.id);

  const compareRange = resolveCompareRange({ compare: "prev" }, RANGE);
  const sc = await getReturnScorecard(RANGE, compareRange);

  // ── 1) BRÜT PAYDA ─────────────────────────────────────────────────────────
  console.log("── 1) Payda BRÜT (iade geri eklenmiş) ──");
  check(
    "sevk metrajı 1500 m (900 canlı + 100 iade geri-eklemesi + 500 doğrudan sevk)",
    sc.summary.shippedQty === 1500,
    `gelen: ${sc.summary.shippedQty} — canlı okunsaydı 1400, doğrudan sevk atlanınca 1000 çıkardı`,
  );
  check("iade metrajı 150 m", sc.summary.returnQty === 150, `gelen: ${sc.summary.returnQty}`);
  check(
    "iade oranı %10 (150/1500)",
    sc.summary.returnPct === 10,
    `gelen: ${sc.summary.returnPct}`,
  );

  // ── 2) İPTAL EDİLMİŞ İADE HİÇBİR YERDE YOK ────────────────────────────────
  console.log("\n── 2) İptal edilmiş iade sayılmaz ──");
  check("500 m iptal edilmiş iade paya girmedi", sc.summary.returnQty === 150, "girseydi 650 olurdu");
  check("top adedi 3", sc.summary.returnRollCount === 3, `gelen: ${sc.summary.returnRollCount}`);
  check(
    "iptal edilmiş iade PAYDAYA da geri eklenmedi",
    sc.summary.shippedQty === 1500,
    "500 m iptal iade de geri eklenseydi 2000 olurdu",
  );

  // ── 3) SEBEP ÜÇ DURUMLU ───────────────────────────────────────────────────
  console.log("\n── 3) Sebep: katalog / serbest metin / boş ──");
  check("serbest metin sayacı 1", sc.summary.freeTextReasonCount === 1, `gelen: ${sc.summary.freeTextReasonCount}`);
  check("sebepsiz sayacı 1", sc.summary.missingReasonCount === 1, `gelen: ${sc.summary.missingReasonCount}`);
  const catalogRow = sc.byReason.find((r) => r.label === reason.name);
  check("katalog sebebi 100 m ile listede", catalogRow?.qty === 100, `gelen: ${catalogRow?.qty}`);
  const freeRow = sc.byReason.find((r) => r.key === "__FREE_TEXT__");
  check(
    "serbest metinler TEK kovada (her yazım ayrı satır olmaz)",
    freeRow?.qty === 30 && freeRow.label === "Serbest metin (katalog dışı)",
    `gelen: ${freeRow?.label} ${freeRow?.qty}`,
  );

  // ── 4) KIRILIM TOPLAMLARI ─────────────────────────────────────────────────
  console.log("\n── 4) Kırılım toplamları = özet ──");
  const sum = (rows: { qty: number }[]) => Math.round(rows.reduce((a, r) => a + r.qty, 0) * 10) / 10;
  check("müşteri kırılımı", sum(sc.byCustomer) === 150, `${sum(sc.byCustomer)}`);
  check("sebep kırılımı", sum(sc.byReason) === 150, `${sum(sc.byReason)}`);
  check("kumaş kırılımı", sum(sc.byItem) === 150, `${sum(sc.byItem)}`);
  const dailySum = Math.round(sc.daily.reduce((a, d) => a + d.qty, 0) * 10) / 10;
  check("günlük seri", dailySum === 150, `${dailySum}`);

  // ── 5) KARŞILAŞTIRMA ──────────────────────────────────────────────────────
  console.log("\n── 5) Dönem karşılaştırma ──");
  check("önceki dönem iade 70 m (60 sevkiyat bağlı + 10 bağsız)",
    sc.summary.prevReturnQty === 70, `gelen: ${sc.summary.prevReturnQty}`);
  check("önceki dönem sevk 660 m (600 canlı + 60 geri-ekleme)", sc.summary.prevShippedQty === 660,
    `gelen: ${sc.summary.prevShippedQty}`);
  check(
    "sevkiyat bağı olmayan iade paydaya geri EKLENMEZ (uydurma atıf yok)",
    sc.summary.prevShippedQty === 660,
    "10 m de eklenseydi 670 olurdu — hangi sevkiyattan düştüğü bilinmiyor",
  );
  check("önceki dönem oranı %10,6", sc.summary.prevReturnPct === 10.6, `gelen: ${sc.summary.prevReturnPct}`);
  check("kırılım satırında önceki dönem taşınıyor",
    sc.byCustomer[0]?.prevQty === 70, `gelen: ${sc.byCustomer[0]?.prevQty}`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    if (returnIds.length) await prisma.rollReturn.deleteMany({ where: { id: { in: returnIds } } });
    if (rollIds.length) await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    if (directIds.length) await prisma.directShipment.deleteMany({ where: { id: { in: directIds } } });
    if (dispatchIds.length) await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    if (batchIds.length) await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
    if (stepIds.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
    if (woIds.length) await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    if (subIds.length) await prisma.subcontractor.deleteMany({ where: { id: { in: subIds } } });
    if (stationIds.length) await prisma.station.deleteMany({ where: { id: { in: stationIds } } });
    if (shipmentIds.length) await prisma.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
