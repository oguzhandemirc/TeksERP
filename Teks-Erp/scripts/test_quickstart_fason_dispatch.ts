// =============================================================================
// TEST: Hızlı İş Emri ilk adım fason ise otomatik fason sevki
//       (feat/quickstart-fason-auto-dispatch)
// Çalıştır: npx tsx scripts/test_quickstart_fason_dispatch.ts
// =============================================================================
// Kapsam:
//   1) İlk adım EXTERNAL (boyahane) + planlı firma → quickStart toplar AT_SUBCONTRACTOR,
//      SubcontractorDispatch oluştu, response.dispatch dolu, committed = Σ initialQty.
//   2) İlk adım EXTERNAL + firma YOK → 400; toplar STOCK kalır (bağlanmaz).
//   3) İlk adım INTERNAL → sadece attach (dispatch yok); toplar IN_PRODUCTION, sevk yok.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { computeWoMaterial } from "../src/services/helpers/coverage.helper";
import { RollStatus } from "@prisma/client";

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

const svc = new WorkOrderService();

let ITEM = "", GRADE = "", ADMIN = "", ST_BOYA = "", ST_KURSUN = "", SUB_BOYER = "";
const WIDTH = 250;
let bc = 0;
function barcode(): string { bc++; return `TST-QSF-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }
let woN = 0;
function woBatch(): string { woN++; return `TST-QSF-${`${Date.now()}`.slice(-7)}-${woN}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  GRADE = need(await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true } }), "QualityGrade 1.KALITE");
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_BOYA = need(await prisma.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }), "BOYA_FASON");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  SUB_BOYER = need(await prisma.subcontractor.findFirst({ where: { code: "BOYER" }, select: { id: true } }), "BOYER");
}

async function makeStockRoll(qty: number): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code, itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE,
      width: WIDTH, createdById: ADMIN,
    },
    select: { id: true },
  });
  return { id: r.id, barcode: code };
}

async function expectReject(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    check(label, false, "beklenen hata atılmadı");
  } catch (e) {
    check(label, true, (e instanceof Error ? e.message : String(e)).slice(0, 80));
  }
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === 1) EXTERNAL ilk adım + firma → otomatik sevk ===
    console.log("\n=== 1) İlk adım fason + firma → otomatik sevk ===");
    {
      const r1 = await makeStockRoll(100);
      const r2 = await makeStockRoll(200);
      const res = await svc.quickStart(
        {
          batchNumber: woBatch(),
          steps: [
            { stationId: ST_BOYA, plannedSubcontractorId: SUB_BOYER },
            { stationId: ST_KURSUN },
          ],
          rollBarcodes: [r1.barcode, r2.barcode],
        } as Parameters<typeof svc.quickStart>[0],
        ADMIN,
      );
      check("quickStart success", res.success === true);
      check("response.dispatch dolu (SD no)", !!res.data?.dispatch?.dispatchNo, `dispatchNo=${res.data?.dispatch?.dispatchNo}`);
      const woId = res.data!.workOrder.id;
      const rolls = await prisma.roll.findMany({ where: { id: { in: [r1.id, r2.id] } }, select: { status: true } });
      check("toplar AT_SUBCONTRACTOR (fasonda)", rolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR), rolls.map((r) => r.status).join(","));
      const dispCount = await prisma.subcontractorDispatch.count({ where: { workOrderId: woId } });
      check("SubcontractorDispatch oluştu", dispCount === 1, `count=${dispCount}`);
      const committed = Number((await computeWoMaterial(prisma, [woId])).get(woId)?.committed ?? 0);
      check("üretime giren (committed) = 300", committed === 300, `committed=${committed}`);
    }

    // === 2) EXTERNAL ilk adım + firma YOK → 400, toplar STOCK kalır ===
    console.log("\n=== 2) İlk adım fason + firma YOK → reddedilir ===");
    {
      const r = await makeStockRoll(100);
      await expectReject("firma yok → quickStart reddedildi (fason firması)", () =>
        svc.quickStart(
          {
            batchNumber: woBatch(),
            steps: [{ stationId: ST_BOYA }, { stationId: ST_KURSUN }],
            rollBarcodes: [r.barcode],
          } as Parameters<typeof svc.quickStart>[0],
          ADMIN,
        ),
      );
      const fresh = await prisma.roll.findUnique({ where: { id: r.id }, select: { status: true, currentStepId: true } });
      check("top hâlâ STOCK (bağlanmadı)", fresh?.status === RollStatus.STOCK && fresh?.currentStepId === null, `st=${fresh?.status}`);
    }

    // === 3) INTERNAL ilk adım → sadece attach (sevk yok) ===
    console.log("\n=== 3) İlk adım iç istasyon → sadece bağla ===");
    {
      const r = await makeStockRoll(100);
      const res = await svc.quickStart(
        {
          batchNumber: woBatch(),
          steps: [{ stationId: ST_KURSUN }, { stationId: ST_BOYA, plannedSubcontractorId: SUB_BOYER }],
          rollBarcodes: [r.barcode],
        } as Parameters<typeof svc.quickStart>[0],
        ADMIN,
      );
      check("quickStart success", res.success === true);
      check("response.dispatch YOK (sevk yapılmadı)", !res.data?.dispatch, `dispatch=${JSON.stringify(res.data?.dispatch)}`);
      const woId = res.data!.workOrder.id;
      const fresh = await prisma.roll.findUnique({ where: { id: r.id }, select: { status: true } });
      check("top IN_PRODUCTION (bağlandı, fasonda değil)", fresh?.status === RollStatus.IN_PRODUCTION, `st=${fresh?.status}`);
      const dispCount = await prisma.subcontractorDispatch.count({ where: { workOrderId: woId } });
      check("SubcontractorDispatch YOK", dispCount === 0, `count=${dispCount}`);
    }
  } finally {
    await cleanup();
    console.log("(test verisi temizlendi)");
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function cleanup(): Promise<void> {
  const wos = await prisma.workOrder.findMany({ where: { batchNumber: { startsWith: "TST-QSF-" } }, select: { id: true } });
  const woIds = wos.map((w) => w.id);
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const stepIds = steps.map((s) => s.id);
  const dispatches = await prisma.subcontractorDispatch.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const dispatchIds = dispatches.map((d) => d.id);
  const rolls = await prisma.roll.findMany({
    where: { OR: [{ barcode: { startsWith: "TST-QSF-" } }, { currentStepId: { in: stepIds } }, { producedInStepId: { in: stepIds } }] },
    select: { id: true },
  });
  const rollIds = rolls.map((r) => r.id);
  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
  await prisma.subcontractorDispatchItem.deleteMany({ where: { OR: [{ dispatchId: { in: dispatchIds } }, { rollId: { in: rollIds } }] } });
  await prisma.subcontractorDispatch.deleteMany({ where: { id: { in: dispatchIds } } });
  await prisma.printedDocument.deleteMany({ where: { sourceId: { in: [...dispatchIds, ...woIds] } } });
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const cardIds = cards.map((c) => c.id);
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
  await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
  await prisma.workOrderStep.deleteMany({ where: { id: { in: stepIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
