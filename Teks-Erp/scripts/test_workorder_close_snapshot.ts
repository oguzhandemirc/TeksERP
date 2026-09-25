// =============================================================================
// TEST: İŞ EMRİ KAPANIŞ KÜNYESİ (D3) — kapanışta donar, sonradan kaymaz
// Çalıştır: npx tsx scripts/test_workorder_close_snapshot.ts
// =============================================================================
// Tasarım: docs/design/IS-EMRI-HAREKET-DEFTERI.md §5. Künye GERÇEK yoldan doğar:
// attachRolls (üretime alma) → completeWorkOrder (kapanış dispozisyonu).
//   §1 elle kapanış v1: kalemler = üretim çıktısı kümesi (`producedOutputWhere`),
//      ham stoğa dönen top çıktı DEĞİL; kova/toplam/verim/künye alanları
//   §2 giren metre `computeWoInput` tek kaynağından; verim = çıkan ÷ giren
//   §3 kayma: kapanıştan sonra kalite fireye çekilir → canlı başlık değişir,
//      künye DEĞİŞMEZ (detay yanıtında ikisi yan yana)
//   §4 yeniden açma + otomatik kapanış → v2 (AUTO_LAST_STEP, tetik çağırandan);
//      v1 aynen durur; görünüm en yüksek sürümü ve sürüm sayısını verir
//   §5 mühür: künye satırı UPDATE edilemez
//   §6 kapanmamış iş emrinde künye yok (null)
// NEGATİF SONDA (elle, 2026-09-25): `completeWorkOrder`deki `freezeCloseSnapshotTx`
// çağrısı yoruma alındı → §1–§3 kırmızı; md5 ile geri alındı.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { completeWorkOrderIfStepsDone } from "../src/services/helpers/roll-step.helper";
import { reopenWorkOrderTx } from "../src/services/helpers/workorder-event.helper";
import { computeWoInput } from "../src/services/helpers/coverage.helper";
import { roleGrade } from "./fixture-quality-grade";
import { ensureTestAdmin } from "./fixture-test-user";
import { RollStatus, StepStatus } from "@prisma/client";

const svc = new WorkOrderService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}

let ITEM = "", ADMIN = "", ST_KURSUN = "", ST_TAMBUR = "", GRADE = "", GRADE_CODE = "", FIRE_CODE = "";
const woIds: string[] = [];
const rollIds: string[] = [];
let bc = 0;

async function fikstur(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed' + 'seed:fixtures')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  ADMIN = (await ensureTestAdmin()).id;
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
  const g = await roleGrade("FIRST");
  GRADE = g.id; GRADE_CODE = g.code;
  FIRE_CODE = (await roleGrade("SCRAP")).code;
}

async function yeniWo(): Promise<string> {
  const res = await svc.create(
    { type: "STOCK_PRODUCTION", targetItemId: ITEM, width: 180, steps: [{ stationId: ST_KURSUN }, { stationId: ST_TAMBUR }] },
    ADMIN,
  );
  const id = (res.data as { id: string }).id;
  woIds.push(id);
  return id;
}

/** Ham stok topu → iş emrine bağlanır (gerçek `attachRolls`). */
async function bagliTop(woId: string, qty: number): Promise<string> {
  bc++;
  const barcode = `TST-WOK-${Date.now().toString(36).toUpperCase()}${bc}`;
  const r = await prisma.roll.create({
    data: { barcode, itemId: ITEM, initialQty: qty, currentQty: qty, status: RollStatus.STOCK,
      qualityGrade: GRADE_CODE, qualityGradeId: GRADE, width: 180, createdById: ADMIN },
    select: { id: true },
  });
  rollIds.push(r.id);
  await svc.attachRolls(woId, [barcode], ADMIN);
  return r.id;
}

type Detay = { producedRolls: { count: number; totalMeters: unknown }; closeSnapshot: null | { version: number; versionCount: number; rollCount: number; outputM: number; warehouseM: number; scrapM: number; lines: { rollId: string; bucket: string }[] } };
const detay = async (id: string) => (await svc.findById(id)).data as unknown as Detay;

async function main(): Promise<void> {
  console.log("=== İş emri kapanış künyesi ===");
  await fikstur();
  try {
    // §1 elle kapanış
    const a = await yeniWo();
    const r1 = await bagliTop(a, 100);
    const r2 = await bagliTop(a, 120);
    const r3 = await bagliTop(a, 80);
    await svc.completeWorkOrder(a, {
      reason: "TST-WOK kapanış",
      dispositions: [
        { rollId: r1, action: "WAREHOUSE" },
        { rollId: r2, action: "WAREHOUSE" },
        { rollId: r3, action: "STOCK" },
      ],
    }, ADMIN);
    const girdi = (await computeWoInput(prisma, [a])).get(a);
    const v1 = await prisma.workOrderCloseSnapshot.findFirst({ where: { workOrderId: a, version: 1 }, include: { lines: true } });
    check("§1 elle kapanış tek künye yazdı (v1, MANUAL, tetik MANUAL_COMPLETE, kapatan fikstür kullanıcısı)",
      !!v1 && v1.closeKind === "MANUAL" && v1.trigger === "MANUAL_COMPLETE" && v1.closedById === ADMIN,
      `${v1?.closeKind} · ${v1?.trigger}`);
    const kalemIds = new Set(v1?.lines.map((l) => l.rollId));
    check("§1b kalemler = depoya inen iki top; ham stoğa dönen top çıktı DEĞİL",
      v1?.rollCount === 2 && kalemIds.has(r1) && kalemIds.has(r2) && !kalemIds.has(r3), `${v1?.rollCount}`);
    check("§1c kova toplamı üretim metresinden (100 + 120), çıkan = depo + A1 + fire",
      Number(v1?.warehouseM) === 220 && Number(v1?.outputM) === 220 && Number(v1?.scrapM) === 0);
    check("§1d kalem: barkod, metre, en, statü ve kova dondu",
      !!v1?.lines.every((l) => l.barcode?.startsWith("TST-WOK-") && Number(l.producedQtyM) > 0 && Number(l.width) === 180
        && l.status === "WAREHOUSE" && l.bucket === "WAREHOUSE"));

    // §2 verim
    check("§2 giren metre computeWoInput'la aynı; verim = çıkan ÷ giren",
      !!girdi && Number(v1?.inputM) === Number(girdi.meters) && v1?.inputRollCount === girdi.count
        && Number(v1?.yieldPct) === Number((220 / Number(girdi.meters) * 100).toFixed(3)),
      `giren ${girdi?.meters} · verim ${v1?.yieldPct}`);
    check("§2b süre ve başlama damgası yazıldı", v1?.startedAt != null && (v1?.durationSec ?? -1) >= 0);

    // §3 kayma — kalite sonradan fireye çekilir
    await prisma.roll.update({ where: { id: r2 }, data: { qualityGrade: FIRE_CODE } });
    const d = await detay(a);
    check("§3 canlı başlık kaydı (fire metresi başlıktan düştü)", Number(d.producedRolls.totalMeters) === 100, `${d.producedRolls.totalMeters}`);
    check("§3b künye DEĞİŞMEDİ (kapanışta 220 m, r2 depo kovasında)",
      d.closeSnapshot?.outputM === 220 && d.closeSnapshot?.warehouseM === 220
        && d.closeSnapshot?.lines.find((l) => l.rollId === r2)?.bucket === "WAREHOUSE");

    // §4 yeniden açma + otomatik kapanış
    await prisma.$transaction((tx) => reopenWorkOrderTx(tx, a, { trigger: "TST_REOPEN" }));
    await prisma.workOrderStep.updateMany({ where: { workOrderId: a }, data: { status: StepStatus.COMPLETED } });
    await prisma.$transaction((tx) => completeWorkOrderIfStepsDone(tx, a, { trigger: "TAMBUR_FINALIZE", userId: ADMIN }));
    const surumler = await prisma.workOrderCloseSnapshot.findMany({ where: { workOrderId: a }, orderBy: { version: "asc" } });
    check("§4 ikinci kapanış v2 (AUTO_LAST_STEP, tetik TAMBUR_FINALIZE)",
      surumler.length === 2 && surumler[1].closeKind === "AUTO_LAST_STEP" && surumler[1].trigger === "TAMBUR_FINALIZE");
    check("§4b v1 aynen duruyor (220 m, 2 top)", Number(surumler[0].outputM) === 220 && surumler[0].rollCount === 2);
    check("§4c v2 o anki kovayı donurdu (r2 artık fire)", Number(surumler[1].scrapM) === 120 && Number(surumler[1].warehouseM) === 100);
    const d2 = await detay(a);
    check("§4d görünüm en yüksek sürümü ve sürüm sayısını veriyor", d2.closeSnapshot?.version === 2 && d2.closeSnapshot?.versionCount === 2);

    // §5 mühür
    let degisti = true;
    try { await prisma.workOrderCloseSnapshot.update({ where: { id: surumler[0].id }, data: { trigger: "kurcalama" } }); }
    catch { degisti = false; }
    check("§5 künye satırı UPDATE edilemez", !degisti);

    // §6 kapanmamış iş emri
    const b = await yeniWo();
    check("§6 kapanmamış iş emrinde künye yok", (await detay(b)).closeSnapshot === null);
  } finally {
    await temizle();
  }
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function temizle(): Promise<void> {
  const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  const stepIds = steps.map((s) => s.id);
  const rolls = await prisma.roll.findMany({
    where: { OR: [{ id: { in: rollIds } }, { producedInStepId: { in: stepIds } }, { currentStepId: { in: stepIds } }] },
    select: { id: true },
  });
  const ids = rolls.map((r) => r.id);
  await prisma.systemLog.deleteMany({ where: { tableName: { in: ["ROLL", "WORK_ORDER"] }, recordId: { in: [...ids, ...woIds] } } });
  await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: ids } }, { workOrderStepId: { in: stepIds } }] } });
  await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: ids } }, { workOrderStepId: { in: stepIds } }] } });
  await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: ids } } });
  await prisma.roll.deleteMany({ where: { id: { in: ids } } });
  const cards = await prisma.travelerCard.findMany({ where: { workOrderId: { in: woIds } }, select: { id: true } });
  await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cards.map((c) => c.id) } } });
  await prisma.travelerCard.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } });
  await prisma.batch.updateMany({ where: { workOrderId: { in: woIds } }, data: { splitFromId: null } });
  await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
  await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
}

main().catch(async (e) => {
  console.error("HATA:", e);
  await temizle().catch((err) => console.error("temizlik hatası:", err));
  await prisma.$disconnect();
  process.exit(1);
});
