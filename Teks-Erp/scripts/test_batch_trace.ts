// =============================================================================
// Test: PARTİ İZLEME (geri izleme)
// Çalıştır: npx tsx scripts/test_batch_trace.ts
// =============================================================================
// ÜÇ KRİTİK KURAL — üçü de şikâyet araştırmasında yanlış cevap üretir:
//   1. PARTİ NUMARASI BENZERSİZ DEĞİL (P01…P99 döner, @unique kalktı). Arama
//      DAİMA liste döner; tek sonuç varsaymak, aynı numarayı taşıyan BAŞKA bir
//      partinin müşterilerini göstermek olurdu.
//   2. İADE EDİLMİŞ TOP MÜŞTERİ LİSTESİNDEN DÜŞMEZ. İade `Roll.shipmentId`'yi
//      NULL'lar; yalnız canlı bağa bakmak, malı iade eden müşteriyi listeden
//      siler — oysa şikâyet araştırmasında en çok aranan müşteri odur.
//   3. KESİM ÇOCUKLARI MİRAS ALIR — tek `batchId` sorgusu ebeveyni de çocuğu da
//      getirir; ayrı soyağacı gezintisi çocukları İKİ kez sayardı.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getBatchTrace, searchBatches } from "../src/services/reports/batch-trace.report.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-BTR-${Date.now()}`;
const SHARED_NO = `TSTP${String(Date.now()).slice(-4)}`; // İKİ partiye verilecek AYNI numara

const ids = {
  returns: [] as string[], rolls: [] as string[], shipments: [] as string[],
  dispatchItems: [] as string[], dispatches: [] as string[],
  batches: [] as string[], steps: [] as string[], wos: [] as string[],
  stations: [] as string[], subs: [] as string[],
};

async function main(): Promise<void> {
  console.log("\n=== Parti İzleme bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const cusA = await prisma.customer.findFirst({ where: { isActive: true }, select: { id: true, name: true } });
  const cusB = await prisma.customer.findFirst({
    where: { isActive: true, id: { not: cusA?.id } }, select: { id: true, name: true },
  });
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!item || !cusA || !cusB || !user) { console.log("❌ Ön koşul yok (2 müşteri gerekli)"); fail++; return; }

  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true },
  });
  ids.wos.push(wo.id);

  // ── İKİ parti, AYNI numara (numara döngüsünün simülasyonu) ───────────────
  const mkBatch = async (num: string) => {
    const b = await prisma.batch.create({
      data: { batchNumber: num, workOrderId: wo.id }, select: { id: true },
    });
    ids.batches.push(b.id);
    return b.id;
  };
  const batch1 = await mkBatch(SHARED_NO);
  const batch2 = await mkBatch(SHARED_NO); // @unique kalktığı için MÜMKÜN

  const mkRoll = async (o: {
    batchId: string; qty: number; shipmentId?: string | null;
    parentRollId?: string | null; status?: "WAREHOUSE" | "SHIPPED" | "TAMBUR_CONSUMED";
  }) => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: o.qty, currentQty: o.qty,
        status: o.status ?? "SHIPPED", entrySource: "SUPPLIER_RECEIPT",
        batchId: o.batchId, shipmentId: o.shipmentId ?? null,
        parentRollId: o.parentRollId ?? null,
        barcode: `${TAG}-R${ids.rolls.length}`,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };
  const mkShipment = async (customerId: string) => {
    const s = await prisma.shipment.create({
      data: {
        shipmentNo: `${TAG}-S${ids.shipments.length}`, customerId,
        status: "DISPATCHED", dispatchedAt: new Date(),
      },
      select: { id: true },
    });
    ids.shipments.push(s.id);
    return s.id;
  };

  // ── FIXTURE (batch1) ──────────────────────────────────────────────────────
  // Müşteri A: 200 m sevk edildi ve DURUYOR
  const shipA = await mkShipment(cusA.id);
  await mkRoll({ batchId: batch1, qty: 200, shipmentId: shipA });
  // Müşteri B: 150 m sevk edildi ve İADE ALINDI → shipmentId NULL'landı.
  // Yalnız canlı bağa bakan bir izleme B'yi HİÇ göstermez.
  const shipB = await mkShipment(cusB.id);
  const returnedRoll = await mkRoll({ batchId: batch1, qty: 150, shipmentId: null, status: "WAREHOUSE" });
  const ret = await prisma.rollReturn.create({
    data: {
      rollId: returnedRoll, customerId: cusB.id, itemId: item.id, qty: 150,
      receivedById: user.id, fromShipmentId: shipB,
    },
    select: { id: true },
  });
  ids.returns.push(ret.id);
  // Kesim: ebeveyn tüketildi, çocuk aynı partiyi MİRAS aldı
  const parent = await mkRoll({ batchId: batch1, qty: 0, status: "TAMBUR_CONSUMED" });
  await mkRoll({ batchId: batch1, qty: 90, parentRollId: parent, status: "WAREHOUSE" });
  // batch2 (aynı numara, BAŞKA parti): hiç sevk yok → müşterisi olmamalı
  await mkRoll({ batchId: batch2, qty: 999, status: "WAREHOUSE" });

  // Fason sevki
  const station = await prisma.station.create({
    data: { code: `${TAG}-STN`, name: "Parti izleme testi", type: "EXTERNAL" }, select: { id: true },
  });
  ids.stations.push(station.id);
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true },
  });
  ids.steps.push(step.id);
  const sub = await prisma.subcontractor.create({
    data: { code: `${TAG}-SUB`, name: `Parti izleme fason ${TAG}` }, select: { id: true, name: true },
  });
  ids.subs.push(sub.id);
  const disp = await prisma.subcontractorDispatch.create({
    data: {
      dispatchNo: `${TAG}-SD`, workOrderId: wo.id, batchId: batch1,
      stepId: step.id, subcontractorId: sub.id, dispatchedAt: new Date(),
    },
    select: { id: true },
  });
  ids.dispatches.push(disp.id);
  const di = await prisma.subcontractorDispatchItem.create({
    data: { dispatchId: disp.id, rollId: ids.rolls[0] as string, dispatchedQty: 200 },
    select: { id: true },
  });
  ids.dispatchItems.push(di.id);

  // ── 1) NUMARA BENZERSİZ DEĞİL ─────────────────────────────────────────────
  console.log("── 1) Parti numarası benzersiz değil → arama LİSTE döner ──");
  const found = await searchBatches(SHARED_NO);
  const mine = found.filter((b) => [batch1, batch2].includes(b.batchId));
  check("aynı numaralı İKİ parti de listede", mine.length === 2, `gelen: ${mine.length}`);
  check(
    "ikisi ayrı batchId taşır (izleme id ile yapılır)",
    new Set(mine.map((b) => b.batchId)).size === 2,
  );

  // ── 2) BARKODLA ARAMA ─────────────────────────────────────────────────────
  const byBarcode = await searchBatches(`${TAG}-R0`);
  check("top barkoduyla da parti bulunur", byBarcode.some((b) => b.batchId === batch1),
    `gelen: ${byBarcode.length} aday`);

  // ── 3) GERİ İZLEME — iade edilmiş müşteri DÜŞMEZ ──────────────────────────
  console.log("\n── 2) Geri izleme: bu partiden kime ne gitti ──");
  const trace = await getBatchTrace(batch1);
  const custA = trace?.customers.find((c) => c.customerId === cusA.id);
  const custB = trace?.customers.find((c) => c.customerId === cusB.id);
  check("sevk duran müşteri (A) listede", custA?.qty === 200, `gelen: ${custA?.qty}`);
  check(
    "İADE ALINMIŞ müşteri (B) de listede — canlı bağ koptuğu hâlde",
    custB?.qty === 150,
    `gelen: ${custB?.qty} — yalnız canlı shipmentId'ye bakılsaydı B HİÇ görünmezdi`,
  );

  // ── 4) KESİM ÇOCUĞU MİRAS ALIR, ÇİFT SAYILMAZ ─────────────────────────────
  console.log("\n── 3) Kesim çocuğu partiyi miras alır ──");
  check("parti toplamı 4 top", trace?.totals.rollCount === 4, `gelen: ${trace?.totals.rollCount}`);
  const consumed = trace?.byStatus.find((s) => s.status === "TAMBUR_CONSUMED");
  check("tüketilen ebeveyn statü kırılımında görünür", consumed?.count === 1, `gelen: ${consumed?.count}`);
  check(
    "çocuğun metrajı (90) toplamda BİR kez",
    trace?.totals.qty === 440,
    `gelen: ${trace?.totals.qty} (200 + 150 + 0 + 90)`,
  );

  // ── 5) BAŞKA PARTİ KARIŞMAZ ───────────────────────────────────────────────
  console.log("\n── 4) Aynı numaralı diğer parti karışmaz ──");
  const trace2 = await getBatchTrace(batch2);
  check("batch2'nin müşterisi yok", trace2?.customers.length === 0, `gelen: ${trace2?.customers.length}`);
  check("batch2'nin metrajı 999", trace2?.totals.qty === 999, `gelen: ${trace2?.totals.qty}`);
  check(
    "batch1'in 440 m'si batch2'ye sızmadı",
    trace?.totals.qty === 440 && trace2?.totals.qty === 999,
  );

  // ── 6) İADE VE FASON LİSTELERİ ────────────────────────────────────────────
  console.log("\n── 5) İade ve fason izleri ──");
  check("iade kaydı listede", trace?.returns.length === 1 && trace.returns[0]?.qty === 150,
    `gelen: ${JSON.stringify(trace?.returns)}`);
  check("fason sevki listede", trace?.subcontractorDispatches.length === 1,
    `gelen: ${trace?.subcontractorDispatches.length}`);
  check("fason firma adı çözüldü",
    trace?.subcontractorDispatches[0]?.subcontractorName === sub.name,
    `gelen: ${trace?.subcontractorDispatches[0]?.subcontractorName}`);

  // ── 7) OLMAYAN PARTİ ──────────────────────────────────────────────────────
  check("olmayan parti null döner", (await getBatchTrace("00000000-0000-0000-0000-000000000000")) === null);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    if (ids.returns.length) await prisma.rollReturn.deleteMany({ where: { id: { in: ids.returns } } });
    if (ids.dispatchItems.length) await prisma.subcontractorDispatchItem.deleteMany({ where: { id: { in: ids.dispatchItems } } });
    if (ids.dispatches.length) await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatches } } });
    // Çocuk önce silinir (parentRollId FK).
    await prisma.roll.deleteMany({ where: { id: { in: ids.rolls }, parentRollId: { not: null } } });
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
    if (ids.shipments.length) await prisma.shipment.deleteMany({ where: { id: { in: ids.shipments } } });
    if (ids.batches.length) await prisma.batch.deleteMany({ where: { id: { in: ids.batches } } });
    if (ids.steps.length) await prisma.workOrderStep.deleteMany({ where: { id: { in: ids.steps } } });
    if (ids.wos.length) await prisma.workOrder.deleteMany({ where: { id: { in: ids.wos } } });
    if (ids.subs.length) await prisma.subcontractor.deleteMany({ where: { id: { in: ids.subs } } });
    if (ids.stations.length) await prisma.station.deleteMany({ where: { id: { in: ids.stations } } });
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    await pool.end();
    process.exitCode = fail > 0 ? 1 : 0;
  });
