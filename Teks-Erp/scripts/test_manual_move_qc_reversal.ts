// Faz 3 doğrulama — Konumu Düzelt geri-taşıma QC reversal.
// A) Salt QC/Kurşun (çocuk yok): geri taşınır, op VOID edilir (silinir), grade Belirsiz olur.
// B) CUT (parentRollId'li çocuk top var): HARD-STOP.
import p from "../src/lib/prisma";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";

const WO = "10b405e6-ff6f-4e80-9d6b-703f0cd1b315"; // IE1507260026
const BATCH = "0812b220-e90f-4bf9-88e5-eb2342c8692f"; // P1507260092 (Faz1 testinden Tambur'da)
const svc = new WorkOrderManualMoveService();
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

(async () => {
  const wo = await p.workOrder.findUniqueOrThrow({ where: { id: WO }, select: { steps: { select: { id: true, stepSequence: true }, orderBy: { stepSequence: "asc" } } } });
  const kursun = wo.steps.find((s) => s.stepSequence === 3)!; // Kurşun+KK2
  const tambur = wo.steps.find((s) => s.stepSequence === 4)!; // Tambur
  const rolls = await p.roll.findMany({ where: { batchId: BATCH }, select: { id: true } });
  const rollIds = rolls.map((r) => r.id);

  // --- SETUP: hepsi Tambur'da IN_PRODUCTION, grade A1, Tambur'da TAMBUR_PROCESSED op (KESİM YOK) ---
  await p.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await p.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
  await p.roll.updateMany({ where: { id: { in: rollIds } }, data: { status: "IN_PRODUCTION", currentStepId: tambur.id, qualityGrade: "A1", parentRollId: null, sackId: null, shipmentId: null, directShipmentId: null } });
  for (const rid of rollIds) {
    await p.rollMovement.create({ data: { rollId: rid, workOrderStepId: tambur.id, qtyIn: 100 } });
    await p.rollOperation.create({ data: { rollId: rid, workOrderStepId: tambur.id, operationType: "TAMBUR_PROCESSED" } });
  }
  await p.workOrderStep.update({ where: { id: tambur.id }, data: { status: "ACTIVE", skipReason: null } });
  await p.workOrderStep.update({ where: { id: kursun.id }, data: { status: "COMPLETED", skipReason: null } });

  // === TEST B: CUT hard-stop — roll[0]'a çocuk top ver (roll[1].parentRollId = roll[0]) ===
  // Guard yön-bilinçli (2026-07-16): yalnız hedef-VEYA-SONRASI adımda doğmuş kesim çocuğu
  // engeller. Sahte çocuk gerçek bir Tambur kesimini modellesin diye producedInStepId'si
  // Tambur'a damgalanır (fixture'ın kendi değeri — örn. fason-dönüş Zımpara'sı — hedef
  // ÖNCESİ kalır ve haklı olarak engellemezdi); sonra ön-değerine geri yüklenir.
  const preProdStep = (await p.roll.findUniqueOrThrow({ where: { id: rollIds[1] }, select: { producedInStepId: true } })).producedInStepId;
  await p.roll.update({ where: { id: rollIds[1] }, data: { parentRollId: rollIds[0], producedInStepId: tambur.id } });
  let threw = false;
  try {
    await svc.manualMove(WO, { rollIds: [rollIds[0]], targetStepId: kursun.id, partyMode: "new", reason: "test CUT hard-stop" });
  } catch (e) {
    threw = true;
    ok(/kesim yapılmış|çocuk/i.test((e as Error).message), `CUT HARD-STOP: ${(e as Error).message.slice(0, 55)}`);
  }
  if (!threw) ok(false, "CUT için hard-stop bekleniyordu ama geçti");
  await p.roll.update({ where: { id: rollIds[1] }, data: { parentRollId: null, producedInStepId: preProdStep } }); // temizle

  // === TEST A: salt-QC/Kurşun → geri taşınır + op VOID + grade null ===
  const res = await svc.manualMove(WO, { batchId: BATCH, targetStepId: kursun.id, reason: "test QC reversal Tambur->Kurşun" });
  console.log("  move:", (res.data as { movedRollCount: number }).movedRollCount, "top →", (res.data as { targetStepName: string }).targetStepName);

  const after = await p.roll.findMany({ where: { id: { in: rollIds } }, select: { qualityGrade: true, currentStepId: true } });
  ok(after.every((r) => r.currentStepId === kursun.id), "toplar Kurşun'a geri taşındı");
  ok(after.every((r) => r.qualityGrade === null), "kalite VOID edildi (grade → Belirsiz/null)");
  const tamburOps = await p.rollOperation.count({ where: { rollId: { in: rollIds }, workOrderStepId: tambur.id, operationType: "TAMBUR_PROCESSED" } });
  ok(tamburOps === 0, `Tambur işlem log'ları silindi (kalan ${tamburOps})`);

  const audit = await p.systemLog.findFirst({ where: { tableName: "ROLL", action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
  const nd = audit?.newData as Record<string, unknown> | null;
  ok(nd?.event === "MANUAL_MOVE" && nd?.qcVoided === true, `audit qcVoided [${JSON.stringify({ qcVoided: nd?.qcVoided })}]`);

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  await p.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
