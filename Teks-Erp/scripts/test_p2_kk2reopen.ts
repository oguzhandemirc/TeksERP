// =============================================================================
// P2 kk2-tambur testi — reopenStep F159 (son-adım geri çekme) + F161 (yalnız SON
// finish turu). Doğrudan prisma ile 'finish edilmiş' durum kurulur.  Koşum:
//   DATABASE_URL="...adnansahin_p2_test..." npx tsx scripts/test_p2_kk2reopen.ts
// =============================================================================

import prisma from "../src/lib/prisma";
import { randomUUID } from "crypto";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";

const svc = new KursunQcService();
let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function main(): Promise<void> {
  const station = await prisma.station.findFirst({ where: { kind: "PROCESS_QC", isActive: true }, select: { id: true } });
  const item = await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } });
  const grade = await prisma.qualityGrade.findFirst({ select: { id: true, code: true } });
  const admin = await prisma.user.findFirst({ select: { id: true } });
  if (!station || !item || !grade || !admin) throw new Error("fixture eksik (PROCESS_QC/item/grade/user)");
  const tag = `TESTKK2-${Date.now()}`;
  const woIds: string[] = [];
  const rollIds: string[] = [];

  const mkFinishedWo = async (rollCount: number): Promise<{ woId: string; stepId: string; cardId: string; rolls: string[] }> => {
    const wo = await prisma.workOrder.create({
      data: { batchNumber: `${tag}-WO-${woIds.length}`, status: WorkOrderStatus.COMPLETED },
      select: { id: true },
    });
    woIds.push(wo.id);
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: 1, status: StepStatus.COMPLETED },
      select: { id: true },
    });
    const card = await prisma.travelerCard.create({
      data: { cardNumber: `${tag}-C-${woIds.length}`, barcode: `${tag}-CB-${woIds.length}`, workOrderId: wo.id, version: 1, status: "COMPLETED" },
      select: { id: true },
    });
    const rolls: string[] = [];
    for (let i = 0; i < rollCount; i++) {
      const r = await prisma.roll.create({
        data: {
          barcode: `${tag}-R-${rollIds.length}`, itemId: item.id, initialQty: 100, currentQty: 100,
          status: RollStatus.WAREHOUSE, qualityGrade: grade.code, qualityGradeId: grade.id,
          entrySource: "SUPPLIER_RECEIPT", createdById: admin.id, currentStepId: null,
        },
        select: { id: true },
      });
      rollIds.push(r.id); rolls.push(r.id);
    }
    return { woId: wo.id, stepId: step.id, cardId: card.id, rolls };
  };

  const mkClosedMove = async (stepId: string, rollId: string, marker: string, exitedAt: Date): Promise<void> => {
    await prisma.rollMovement.create({
      data: { rollId, workOrderStepId: stepId, qtyIn: 100, qtyOut: 100, exitedAt, notes: marker, operatorId: admin.id },
    });
  };

  try {
    // === F159: SON ADIM reopen — rolls IN_PRODUCTION+step, WO IN_PROGRESS, card ACTIVE ===
    {
      const { woId, stepId, cardId, rolls } = await mkFinishedWo(2);
      const marker = `QC2_STEP_FINISHED:${randomUUID()}`;
      const t = new Date(Date.now() - 30000);
      for (const r of rolls) await mkClosedMove(stepId, r, marker, t);

      const prev = await svc.reopenPreview(stepId);
      check("F159 preview: canReopen=true (son adım)", (prev.data as { canReopen: boolean }).canReopen, JSON.stringify(prev.data));

      await svc.reopenStep({ stepId }, admin.id);
      const rollsAfter = await prisma.roll.findMany({ where: { id: { in: rolls } }, select: { status: true, currentStepId: true } });
      check("F159: toplar IN_PRODUCTION'a geri çekildi", rollsAfter.every((r) => r.status === RollStatus.IN_PRODUCTION));
      check("F159: currentStepId bu adıma geri döndü", rollsAfter.every((r) => r.currentStepId === stepId));
      const woAfter = await prisma.workOrder.findUniqueOrThrow({ where: { id: woId }, select: { status: true } });
      check("F159: WO COMPLETED→IN_PROGRESS", woAfter.status === WorkOrderStatus.IN_PROGRESS, woAfter.status);
      const cardAfter = await prisma.travelerCard.findUniqueOrThrow({ where: { id: cardId }, select: { status: true } });
      check("F159: refakat kartı COMPLETED→ACTIVE", cardAfter.status === "ACTIVE", cardAfter.status);
    }

    // === F161: İKİ TUR — reopen yalnız SON turu (C,D) geri çeker; ilk tur (A,B) durur ===
    {
      const { stepId, rolls } = await mkFinishedWo(4);
      const [a, b, c, d] = rolls;
      const marker1 = `QC2_STEP_FINISHED:${randomUUID()}`; // eski tur
      const marker2 = `QC2_STEP_FINISHED:${randomUUID()}`; // son tur
      const older = new Date(Date.now() - 120000);
      const newer = new Date(Date.now() - 10000);
      await mkClosedMove(stepId, a, marker1, older);
      await mkClosedMove(stepId, b, marker1, older);
      await mkClosedMove(stepId, c, marker2, newer);
      await mkClosedMove(stepId, d, marker2, newer);

      await svc.reopenStep({ stepId }, admin.id);
      const after = await prisma.roll.findMany({ where: { id: { in: rolls } }, select: { id: true, status: true } });
      const st = new Map(after.map((r) => [r.id, r.status]));
      check("F161: SON tur C IN_PRODUCTION'a çekildi", st.get(c) === RollStatus.IN_PRODUCTION);
      check("F161: SON tur D IN_PRODUCTION'a çekildi", st.get(d) === RollStatus.IN_PRODUCTION);
      check("F161: ESKİ tur A WAREHOUSE kaldı (dokunulmadı)", st.get(a) === RollStatus.WAREHOUSE);
      check("F161: ESKİ tur B WAREHOUSE kaldı (dokunulmadı)", st.get(b) === RollStatus.WAREHOUSE);
      // Eski turun movement'leri hâlâ kapalı; son turunkiler açıldı.
      const closedA = await prisma.rollMovement.count({ where: { rollId: a, exitedAt: { not: null } } });
      const openC = await prisma.rollMovement.count({ where: { rollId: c, exitedAt: null } });
      check("F161: eski tur movement'i hâlâ kapalı", closedA === 1);
      check("F161: son tur movement'i açıldı (exitedAt=null)", openC === 1);
    }
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: woIds } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
  }
}

main()
  .then(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
