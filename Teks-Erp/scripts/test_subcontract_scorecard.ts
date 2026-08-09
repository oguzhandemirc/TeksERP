// =============================================================================
// Test: FASON KARNESİ
// Çalıştır: npx tsx scripts/test_subcontract_scorecard.ts
// =============================================================================
// ÜÇ KRİTİK KURAL, üçü de sessizce bozulabilir ve üçü de firmanın ALEYHİNE
// yanlışlar (yani rapor haksız bir suçlama üretir):
//   1. AÇIK KALEM FİRE DEĞİLDİR. Henüz dönmemiş mal fire sayılırsa dün sevk
//      edilmiş bir parti %100 fire görünür.
//   2. DÖNEN METRAJ TÜM kabul satırlarının TOPLAMIDIR. 100 m'lik top 2×48 m
//      olarak dönebilir; `DISTINCT ON` ile teke indirmek 52 m'yi sahte fire yazar.
//   3. DOĞRUDAN SEVK EDİLEN mal fabrikaya DÖNMEZ → fire kümesinin dışındadır.
// =============================================================================
import prisma, { pool } from "../src/lib/prisma";
import { getSubcontractScorecard } from "../src/services/reports/subcontract-scorecard.report.service";
import { resolveCompareRange, type DateRange } from "../src/services/reports/_shared";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const TAG = `TEST-FSC-${Date.now()}`;
const RANGE: DateRange = {
  from: new Date("2096-04-01T00:00:00.000Z"),
  to: new Date("2096-04-30T23:59:59.999Z"),
};
const SENT = new Date("2096-04-10T08:00:00.000Z");
const BACK = new Date("2096-04-14T08:00:00.000Z"); // 4 gün sonra
const PREV_SENT = new Date("2096-03-10T08:00:00.000Z");
const PREV_BACK = new Date("2096-03-20T08:00:00.000Z");

const ids = {
  receiptItems: [] as string[], receipts: [] as string[],
  dispatchItems: [] as string[], dispatches: [] as string[],
  rolls: [] as string[], batches: [] as string[], steps: [] as string[],
  wos: [] as string[], stations: [] as string[], subs: [] as string[],
};

async function main(): Promise<void> {
  console.log("\n=== Fason Karnesi bekçisi ===\n");

  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  if (!item) { console.log("❌ Ön koşul yok (aktif kumaş gerekli)"); fail++; return; }

  // ── Zincir ────────────────────────────────────────────────────────────────
  const station = await prisma.station.create({
    data: { code: `${TAG}-STN`, name: "Fason testi", type: "EXTERNAL" }, select: { id: true },
  });
  ids.stations.push(station.id);
  const wo = await prisma.workOrder.create({
    data: { workOrderNumber: `${TAG}-WO`, status: "IN_PROGRESS" }, select: { id: true },
  });
  ids.wos.push(wo.id);
  const step = await prisma.workOrderStep.create({
    data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1 }, select: { id: true },
  });
  ids.steps.push(step.id);
  const batch = await prisma.batch.create({
    data: { batchNumber: `${TAG}-B`, workOrderId: wo.id }, select: { id: true },
  });
  ids.batches.push(batch.id);
  const subA = await prisma.subcontractor.create({ data: { code: `${TAG}-A`, name: "Boyahane A" }, select: { id: true } });
  const subB = await prisma.subcontractor.create({ data: { code: `${TAG}-B`, name: "Boyahane B" }, select: { id: true } });
  ids.subs.push(subA.id, subB.id);

  const mkRoll = async (qty: number): Promise<string> => {
    const r = await prisma.roll.create({
      data: {
        itemId: item.id, initialQty: qty, currentQty: qty, status: "AT_SUBCONTRACTOR",
        entrySource: "SUPPLIER_RECEIPT", barcode: `${TAG}-R${ids.rolls.length}`,
      },
      select: { id: true },
    });
    ids.rolls.push(r.id);
    return r.id;
  };

  const mkDispatch = async (o: {
    subId: string; at: Date; direct?: boolean; cancelled?: boolean; qtys: number[];
  }): Promise<string[]> => {
    const d = await prisma.subcontractorDispatch.create({
      data: {
        dispatchNo: `${TAG}-SD${ids.dispatches.length}`,
        workOrderId: wo.id, batchId: batch.id, stepId: step.id, subcontractorId: o.subId,
        dispatchedAt: o.at,
        ...(o.direct ? { directShippedAt: o.at, directShipReason: "test" } : {}),
        ...(o.cancelled ? { cancelledAt: o.at, cancelReason: "test" } : {}),
      },
      select: { id: true },
    });
    ids.dispatches.push(d.id);
    const itemIds: string[] = [];
    for (const q of o.qtys) {
      const rid = await mkRoll(q);
      const di = await prisma.subcontractorDispatchItem.create({
        data: { dispatchId: d.id, rollId: rid, dispatchedQty: q }, select: { id: true },
      });
      ids.dispatchItems.push(di.id);
      itemIds.push(di.id);
    }
    return itemIds;
  };

  const mkReceipt = async (o: { subId: string; at: Date; back: Array<{ srcItemId: string; qty: number }> }) => {
    const r = await prisma.subcontractorReceipt.create({
      data: {
        receiptNo: `${TAG}-SR${ids.receipts.length}`,
        subcontractorId: o.subId, workOrderId: wo.id, stepId: step.id, receivedAt: o.at,
      },
      select: { id: true },
    });
    ids.receipts.push(r.id);
    for (const b of o.back) {
      const newRoll = await mkRoll(b.qty);
      const ri = await prisma.subcontractorReceiptItem.create({
        data: { receiptId: r.id, newRollId: newRoll, sourceDispatchItemId: b.srcItemId },
        select: { id: true },
      });
      ids.receiptItems.push(ri.id);
    }
  };

  // ── FIXTURE ────────────────────────────────────────────────────────────────
  // Boyahane A:
  //   • 100 m gitti → 48 + 48 = 96 m döndü (ÇOK SATIRLI dönüş, kural 2)
  //   • 200 m gitti → HİÇ dönmedi (AÇIK, kural 1 — fireye girmemeli)
  const [a1, a2] = await mkDispatch({ subId: subA.id, at: SENT, qtys: [100, 200] });
  await mkReceipt({ subId: subA.id, at: BACK, back: [{ srcItemId: a1!, qty: 48 }, { srcItemId: a1!, qty: 48 }] });
  void a2;
  // Boyahane B: 500 m DOĞRUDAN müşteriye sevk edildi (kural 3 — fireye girmemeli)
  await mkDispatch({ subId: subB.id, at: SENT, direct: true, qtys: [500] });
  // İptal edilmiş sevk — hiçbir yerde sayılmamalı
  await mkDispatch({ subId: subB.id, at: SENT, cancelled: true, qtys: [700] });
  // Önceki dönem (A): 100 m gitti → 90 m döndü → %10 fire
  const [p1] = await mkDispatch({ subId: subA.id, at: PREV_SENT, qtys: [100] });
  await mkReceipt({ subId: subA.id, at: PREV_BACK, back: [{ srcItemId: p1!, qty: 90 }] });

  const compareRange = resolveCompareRange({ compare: "prev" }, RANGE);
  const sc = await getSubcontractScorecard(RANGE, compareRange);
  const rowA = sc.bySubcontractor.find((r) => r.key === subA.id);

  // ── 1) AÇIK KALEM FİRE DEĞİL ──────────────────────────────────────────────
  console.log("── 1) Açık kalem fire sayılmaz ──");
  check("A: giden metraj 300 m", rowA?.dispatchedQty === 300, `gelen: ${rowA?.dispatchedQty}`);
  check(
    "A: fire PAYDASI yalnız kapanmış kalem (100 m), 300 değil",
    rowA?.closedDispatchedQty === 100,
    `gelen: ${rowA?.closedDispatchedQty}`,
  );
  check("A: açık bakiye 200 m / 1 kalem", rowA?.openQty === 200 && rowA?.openItems === 1,
    `gelen: ${rowA?.openQty} m / ${rowA?.openItems} kalem`);
  check(
    "A: fire %4 (100−96)/100 — açık kalem paydaya girseydi %68 çıkardı",
    rowA?.firePct === 4,
    `gelen: ${rowA?.firePct}`,
  );

  // ── 2) ÇOK SATIRLI DÖNÜŞ TOPLANIR ─────────────────────────────────────────
  console.log("\n── 2) Çok satırlı dönüşte metraj TOPLANIR ──");
  check(
    "A: dönen metraj 96 m (48+48)",
    rowA?.returnedQty === 96,
    `gelen: ${rowA?.returnedQty} — DISTINCT ON ile 48 çıkar ve fire %52 görünürdü`,
  );
  check("A: fire metrajı 4 m", rowA?.fireQty === 4, `gelen: ${rowA?.fireQty}`);

  // ── 3) DOĞRUDAN SEVK / İPTAL DIŞARIDA ─────────────────────────────────────
  console.log("\n── 3) Doğrudan sevk ve iptal fire kümesinde değil ──");
  const rowB = sc.bySubcontractor.find((r) => r.key === subB.id);
  check("B hiç satır üretmez (500 doğrudan + 700 iptal)", rowB === undefined,
    `gelen: ${JSON.stringify(rowB)}`);
  check("toplam giden 300 m (1200 değil)", sc.summary.dispatchedQty === 300,
    `gelen: ${sc.summary.dispatchedQty}`);

  // ── 4) SÜRE ───────────────────────────────────────────────────────────────
  console.log("\n── 4) Dönüş süresi ──");
  check("A: ortalama dönüş 4 gün", rowA?.avgTurnaroundDays === 4, `gelen: ${rowA?.avgTurnaroundDays}`);

  // ── 5) AÇIK SEVK LİSTESİ ──────────────────────────────────────────────────
  console.log("\n── 5) Açık sevk takip listesi ──");
  const openRow = sc.oldestOpen.find((r) => r.subcontractorName === "Boyahane A");
  check("açık sevk listede", openRow !== undefined && openRow.openQty === 200,
    `gelen: ${openRow?.openQty}`);
  check(
    "iptal/doğrudan sevkler açık listesine girmez",
    !sc.oldestOpen.some((r) => r.subcontractorName === "Boyahane B"),
  );

  // ── 6) KARŞILAŞTIRMA ──────────────────────────────────────────────────────
  console.log("\n── 6) Dönem karşılaştırma ──");
  check("A: önceki dönem fire %10", rowA?.prevFirePct === 10, `gelen: ${rowA?.prevFirePct}`);
  check("A: önceki dönem giden 100 m", rowA?.prevDispatchedQty === 100, `gelen: ${rowA?.prevDispatchedQty}`);
  check("özet önceki dönem fire %10", sc.summary.prevFirePct === 10, `gelen: ${sc.summary.prevFirePct}`);
}

main()
  .catch((e) => { console.error("HATA:", e); fail++; })
  .finally(async () => {
    if (ids.receiptItems.length) await prisma.subcontractorReceiptItem.deleteMany({ where: { id: { in: ids.receiptItems } } });
    if (ids.receipts.length) await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: ids.receipts } } });
    if (ids.dispatchItems.length) await prisma.subcontractorDispatchItem.deleteMany({ where: { id: { in: ids.dispatchItems } } });
    if (ids.dispatches.length) await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: ids.dispatches } } });
    if (ids.rolls.length) await prisma.roll.deleteMany({ where: { id: { in: ids.rolls } } });
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
