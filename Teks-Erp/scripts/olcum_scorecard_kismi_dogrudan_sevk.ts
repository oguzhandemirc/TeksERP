// GEÇİCİ ÖLÇÜM — commit edilmez. Fason karnesi kısmi doğrudan sevki fire/açık sayıyor mu?
// Çalıştır: npx tsx scripts/olcum_scorecard_kismi_dogrudan_sevk.ts               (dev DB: senaryo + ölçüm)
//           npx tsx scripts/olcum_scorecard_kismi_dogrudan_sevk.ts --salt-okuma  (canlı kopya: yalnız Bölüm 2)
// Bölüm 1: gerçek servislerle senaryo kurar, her senaryoyu ayrı uzak-gelecek penceresine koyup
// karneyi okur, fixture'ı siler. Bölüm 2: bulunulan DB'de (salt okuma) etkilenen kalemleri sayar.
import { Prisma, RollStatus } from "@prisma/client";

import prisma, { pool } from "../src/lib/prisma";
import { OPEN_OUTSTANDING } from "../src/services/helpers/fason-open-dispatch.helper";
import { getSubcontractScorecard } from "../src/services/reports/subcontract-scorecard.report.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";
import { assertGelistirmeVeritabani } from "./db-guard";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";

const sub = new SubcontractorService();
const cards = new TravelerCardService();
let ITEM = "";
let ADMIN = "";
let ST_BOYA = "";
let ST_KURSUN = "";
let SUB_BOYER = "";
let CUSTOMER = "";
const woIds: string[] = [];
const dispatchIds: string[] = [];
let bc = 0;

async function kur(tag: string, qtys: number[]): Promise<{ woId: string; stepId: string; dispatchId: string; rollIds: string[] }> {
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `IE-OSK-${tag}-${`${Date.now()}`.slice(-6)}`,
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
      steps: { create: [{ stationId: ST_BOYA, stepSequence: 1, status: "PENDING" }, { stationId: ST_KURSUN, stepSequence: 2, status: "PENDING" }] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const rollIds: string[] = [];
  for (const q of qtys) {
    bc++;
    const r = await prisma.roll.create({
      data: { barcode: `TST-OSK-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`, itemId: ITEM, initialQty: q, currentQty: q, status: RollStatus.STOCK, width: 250, createdById: ADMIN },
      select: { id: true },
    });
    rollIds.push(r.id);
  }
  const stepId = wo.steps[0]!.id;
  const d = await sub.dispatch({ workOrderId: wo.id, stepId, subcontractorId: SUB_BOYER, rollIds }, ADMIN);
  const dispatchId = (d.data as { id: string }).id;
  dispatchIds.push(dispatchId);
  return { woId: wo.id, stepId, dispatchId, rollIds };
}

async function karne(dispatchId: string, ay: number, beklenen: string): Promise<void> {
  const from = new Date(Date.UTC(2097, ay, 1));
  const to = new Date(Date.UTC(2097, ay + 1, 1) - 1);
  await prisma.subcontractorDispatch.update({ where: { id: dispatchId }, data: { dispatchedAt: new Date(Date.UTC(2097, ay, 10)) } });
  const k = await getSubcontractScorecard({ from, to });
  const r = k.bySubcontractor.find((x) => x.key === SUB_BOYER);
  const acik = await prisma.subcontractorDispatch.count({ where: { id: dispatchId, ...OPEN_OUTSTANDING } });
  console.log(
    `   karne: giden ${r?.dispatchedQty} · kapanmış-giden ${r?.closedDispatchedQty} · dönen ${r?.returnedQty} · FİRE ${r?.fireQty} m (%${r?.firePct})` +
      ` · açık ${r?.openItems} kalem / ${r?.openQty} m · OPEN_OUTSTANDING=${acik}`,
  );
  console.log(`   doğrusu: ${beklenen}`);
}

async function senaryolar(): Promise<void> {
  console.log("\n=== K0 KONTROL: 300 m gitti, 300 m döndü (doğrudan sevk yok) ===");
  const k0 = await kur("K0", [300]);
  await sub.receive({ workOrderId: k0.woId, stepId: k0.stepId, subcontractorId: SUB_BOYER, returns: [{ rollId: k0.rollIds[0]! }], newRolls: [{ qty: 300 }] }, ADMIN);
  await karne(k0.dispatchId, 0, "fire 0 · açık 0");

  console.log("\n=== K1: 300 gitti → 100 fasondan müşteriye (bölünme) → kalan 200 TAM kabul ===");
  const k1 = await kur("K1", [300]);
  await sub.executeDirectShip({ dispatchId: k1.dispatchId, reason: "olcum kismi", customerId: CUSTOMER, rollIds: k1.rollIds, rollShipQtys: { [k1.rollIds[0]!]: 100 } }, ADMIN);
  await sub.receive({ workOrderId: k1.woId, stepId: k1.stepId, subcontractorId: SUB_BOYER, returns: [{ rollId: k1.rollIds[0]! }], newRolls: [{ qty: 200 }] }, ADMIN);
  await karne(k1.dispatchId, 1, "fire 0 (100 m müşteriye gitti, 200 m döndü) · açık 0");

  console.log("\n=== K2: 300 gitti → 100 müşteriye → 100 kısmi kabul → kalan 100 'gelmeyecek' kapama ===");
  const k2 = await kur("K2", [300]);
  await sub.executeDirectShip({ dispatchId: k2.dispatchId, reason: "olcum kismi", customerId: CUSTOMER, rollIds: k2.rollIds, rollShipQtys: { [k2.rollIds[0]!]: 100 } }, ADMIN);
  await sub.receive({ workOrderId: k2.woId, stepId: k2.stepId, subcontractorId: SUB_BOYER, returns: [{ rollId: k2.rollIds[0]!, receivedQty: 100 }], newRolls: [{ qty: 100 }] }, ADMIN);
  await sub.closeRemainder({ stepId: k2.stepId, rollId: k2.rollIds[0]!, reasonCode: "BOYA_HATASI" }, ADMIN);
  await karne(k2.dispatchId, 2, "fire 100 / 200 fabrikaya ait metraj (%50) · açık 0");

  console.log("\n=== K3: 300 gitti → 100 müşteriye → kalan 200 hâlâ fasonda ===");
  const k3 = await kur("K3", [300]);
  await sub.executeDirectShip({ dispatchId: k3.dispatchId, reason: "olcum kismi", customerId: CUSTOMER, rollIds: k3.rollIds, rollShipQtys: { [k3.rollIds[0]!]: 100 } }, ADMIN);
  await karne(k3.dispatchId, 3, "fire 0 · açık 1 kalem / 200 m");

  console.log("\n=== K4: 2×200 gitti → 1 top TAMAMEN müşteriye (alt küme) → diğeri TAM kabul ===");
  const k4 = await kur("K4", [200, 200]);
  await sub.executeDirectShip({ dispatchId: k4.dispatchId, reason: "olcum altkume", customerId: CUSTOMER, rollIds: [k4.rollIds[0]!] }, ADMIN);
  await sub.receive({ workOrderId: k4.woId, stepId: k4.stepId, subcontractorId: SUB_BOYER, returns: [{ rollId: k4.rollIds[1]! }], newRolls: [{ qty: 200 }] }, ADMIN);
  const k4d = await prisma.subcontractorDispatch.findUnique({ where: { id: k4.dispatchId }, select: { directShippedAt: true } });
  console.log(`   sevk directShippedAt: ${k4d?.directShippedAt ? "DOLU" : "NULL"}`);
  await karne(k4.dispatchId, 4, "fire 0 · açık 0 (fasonda mal yok) · OPEN_OUTSTANDING=0");
}

async function veritabaniOlcumu(): Promise<void> {
  console.log("\n=== BÖLÜM 2 — bulunulan DB'de etkilenen kalemler (salt okuma, sonda fixture'ı hariç) ===");
  const [db] = await prisma.$queryRaw<Array<{ db: string }>>`SELECT current_database() AS db`;
  const [zemin] = await prisma.$queryRaw<Array<{ sevk: bigint; kalem: bigint; ds: bigint; dsTop: bigint }>>`
    SELECT
      (SELECT COUNT(*) FROM subcontractor_dispatches sd WHERE sd."cancelledAt" IS NULL AND sd."directShippedAt" IS NULL
        AND sd.id <> ALL(${dispatchIds}::uuid[])) AS sevk,
      (SELECT COUNT(*) FROM subcontractor_dispatch_items sdi JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
        WHERE sd."cancelledAt" IS NULL AND sd."directShippedAt" IS NULL AND sd.id <> ALL(${dispatchIds}::uuid[])) AS kalem,
      (SELECT COUNT(*) FROM direct_shipments WHERE "dispatchId" <> ALL(${dispatchIds}::uuid[])) AS ds,
      (SELECT COUNT(*) FROM rolls r JOIN direct_shipments d ON d.id = r."directShipmentId"
        WHERE d."dispatchId" <> ALL(${dispatchIds}::uuid[])) AS "dsTop"`;
  // A: kalemin topu bölünüp bir parçası müşteriye gitti — karnede o parça fire (kapanınca) ya da açık bakiye.
  const bolunme = await prisma.$queryRaw<Array<{ firma: string; sevkNo: string; barkod: string | null; giden: Prisma.Decimal; musteriye: Prisma.Decimal; kapali: boolean }>>`
    SELECT sub.name AS firma, sd."dispatchNo" AS "sevkNo", r.barcode AS barkod, sdi."dispatchedQty" AS giden,
           SUM(c."initialQty") AS musteriye,
           (sdi."remainderClosedAt" IS NOT NULL OR EXISTS (
              SELECT 1 FROM subcontractor_receipt_items sri JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
              WHERE sri."sourceDispatchItemId" = sdi.id AND sr."cancelledAt" IS NULL AND NOT sri."isPartial")) AS kapali
    FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    JOIN subcontractors sub ON sub.id = sd."subcontractorId"
    JOIN rolls r ON r.id = sdi."rollId"
    JOIN rolls c ON c."parentRollId" = r.id AND c."directShipmentId" IS NOT NULL
    WHERE sd."cancelledAt" IS NULL AND sd."directShippedAt" IS NULL
      AND NOT EXISTS (SELECT 1 FROM subcontractor_dispatch_items x WHERE x."rollId" = c.id)
      AND sd.id <> ALL(${dispatchIds}::uuid[])
    GROUP BY sub.name, sd."dispatchNo", r.barcode, sdi.id, sdi."dispatchedQty", sdi."remainderClosedAt"`;
  // B: kalemin topu TAMAMEN müşteriye gitti ama sevk kısmi kaldığı için damgasız — kalem sonsuza dek açık.
  const altKume = await prisma.$queryRaw<Array<{ firma: string; sevkNo: string; barkod: string | null; giden: Prisma.Decimal }>>`
    SELECT sub.name AS firma, sd."dispatchNo" AS "sevkNo", r.barcode AS barkod, sdi."dispatchedQty" AS giden
    FROM subcontractor_dispatch_items sdi
    JOIN subcontractor_dispatches sd ON sd.id = sdi."dispatchId"
    JOIN subcontractors sub ON sub.id = sd."subcontractorId"
    JOIN rolls r ON r.id = sdi."rollId"
    WHERE sd."cancelledAt" IS NULL AND sd."directShippedAt" IS NULL AND r."directShipmentId" IS NOT NULL
      AND sd.id <> ALL(${dispatchIds}::uuid[])`;
  console.log(`  Veritabanı: ${db?.db}`);
  console.log(`  Karne evreni: ${zemin?.sevk} sevk / ${zemin?.kalem} kalem (iptalsiz, directShippedAt NULL)`);
  console.log(`  DirectShipment: ${zemin?.ds} · directShipmentId dolu top: ${zemin?.dsTop}`);
  console.log(`  A) bölünmeli kısmi doğrudan sevk kalemi: ${bolunme.length}`);
  for (const b of bolunme) console.log(`     ${b.firma} · ${b.sevkNo} · ${b.barkod} · giden ${b.giden} · müşteriye ${b.musteriye} · ${b.kapali ? "KAPALI → fire şişer" : "AÇIK → açık bakiye şişer"}`);
  console.log(`  B) alt-küme tam doğrudan sevk kalemi (sonsuza dek açık): ${altKume.length}`);
  for (const b of altKume) console.log(`     ${b.firma} · ${b.sevkNo} · ${b.barkod} · giden ${b.giden}`);
}

async function temizle(): Promise<void> {
  if (woIds.length === 0) return;
  try {
    const stepIds = (await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((s) => s.id);
    const dsIds = (await prisma.directShipment.findMany({ where: { dispatchId: { in: dispatchIds } }, select: { id: true } })).map((d) => d.id);
    const receiptIds = (await prisma.subcontractorReceipt.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((r) => r.id);
    const taban = (await prisma.roll.findMany({
      where: { OR: [{ currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }, { parentReceiptId: { in: receiptIds } }, { directShipmentId: { in: dsIds } }, { barcode: { startsWith: "TST-OSK-" } }] },
      select: { id: true },
    })).map((r) => r.id);
    const cocuk = (await prisma.roll.findMany({ where: { parentRollId: { in: taban } }, select: { id: true } })).map((r) => r.id);
    const rollIds = [...new Set([...taban, ...cocuk])];
    await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds, ...dsIds, ...receiptIds] } } });
    await prisma.subcontractorDirectShipAllocation.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
    await prisma.subcontractorReceiptItem.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorReceiptProperty.deleteMany({ where: { receiptId: { in: receiptIds } } });
    await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatchId: { in: dispatchIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    await prisma.directShipment.deleteMany({ where: { id: { in: dsIds } } });
    await prisma.subcontractorReceipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
    const cardIds = (await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } })).map((c) => c.id);
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...rollIds, ...receiptIds, ...dispatchIds, ...woIds, ...dsIds] } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    const kalan = await prisma.roll.count({ where: { barcode: { startsWith: "TST-OSK-" } } });
    const kalanSevk = await prisma.subcontractorDispatch.count({ where: { id: { in: dispatchIds } } });
    console.log(`\n(ölçüm verisi temizlendi · kalan TST-OSK top ${kalan} · kalan sevk ${kalanSevk})`);
  } catch (e) {
    console.error("temizlik hatası:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--salt-okuma")) {
    await veritabaniOlcumu();
    return;
  }
  // Buradan sonrası SENARYO kurar (fixture yazar + siler) → yıkıcı betik kapısı.
  // ⚠️ `--salt-okuma` dalı YUKARIDA döndü: o dal yalnız OKUR ve canlı kopyada
  // koşmak İÇİN vardır; kapıyı oraya koymak teşhisi canlıda imkânsız kılardı.
  assertGelistirmeVeritabani("olcum_scorecard_kismi_dogrudan_sevk");
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label}`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  CUSTOMER = need(await prisma.customer.findFirst({ where: { code: "MUS-001" }, select: { id: true } }), "MUS-001");
  SUB_BOYER = (await ensureTestDyeHouse()).id;
  await senaryolar();
  await veritabaniOlcumu();
}

main()
  .catch((e) => {
    console.error("HATA:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await temizle();
    await prisma.$disconnect();
    await pool.end();
  });
