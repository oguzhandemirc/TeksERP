// Faz 1 doğrulama — Konumu Düzelt ileri-atlama BACKFLUSH.
// Setup: bir partiyi IN_PRODUCTION + renksiz olarak Zımpara'ya (renk adımı öncesi) kur;
// manualMove ile Tambur'a atla. Assert: renk uygulandı (targetColorId), kalite Belirsiz
// (null), erişilemez ara adımlar SKIPPED, toplar hedefte. + hedef-renk-yok HARD ERROR.
import p from "../src/lib/prisma";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";

const WO = "10b405e6-ff6f-4e80-9d6b-703f0cd1b315"; // IE1507260026
const BATCH = "0812b220-e90f-4bf9-88e5-eb2342c8692f"; // P1507260092
const svc = new WorkOrderManualMoveService();
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

(async () => {
  const wo = await p.workOrder.findUniqueOrThrow({
    where: { id: WO },
    select: { targetColorId: true, steps: { select: { id: true, stepSequence: true, requiredCategory: { select: { appliesColor: true } } }, orderBy: { stepSequence: "asc" } } },
  });
  const targetColorId = wo.targetColorId!;
  const first = wo.steps[0]!;          // Zımpara (seq1)
  const colorStep = wo.steps.find((s) => s.requiredCategory?.appliesColor)!; // Boyahane (seq2)
  const last = wo.steps[wo.steps.length - 1]!; // Tambur (seq4)
  const midSteps = wo.steps.filter((s) => s.stepSequence > first.stepSequence && s.stepSequence < last.stepSequence); // Boyahane+Kurşun

  const rolls = await p.roll.findMany({ where: { batchId: BATCH }, select: { id: true } });
  const rollIds = rolls.map((r) => r.id);
  console.log(`WO IE1507260026 | batch P1507260092 (${rollIds.length} top) | jump seq${first.stepSequence}→seq${last.stepSequence}`);

  // --- SETUP: renksiz, IN_PRODUCTION @ Zımpara, seq1 movement; ara adımlar PENDING/ACTIVE ---
  await p.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
  await p.roll.updateMany({ where: { id: { in: rollIds } }, data: { status: "IN_PRODUCTION", currentStepId: first.id, colorId: null, qualityGrade: null, sackId: null, shipmentId: null, directShipmentId: null } });
  for (const rid of rollIds) await p.rollMovement.create({ data: { rollId: rid, workOrderStepId: first.id, qtyIn: 100, exitedAt: new Date() } });
  await p.workOrderStep.updateMany({ where: { id: { in: midSteps.map((s) => s.id) } }, data: { status: "PENDING", skipReason: null } });
  await p.workOrderStep.update({ where: { id: last.id }, data: { status: "PENDING", skipReason: null } });
  // WO'nun DİĞER aktif topları ara adımları bloklamasın (deterministik SKIPPED testi): geçici depoya al
  const others = await p.roll.findMany({ where: { batch: { workOrderId: WO }, id: { notIn: rollIds }, status: { in: ["IN_PRODUCTION", "AT_SUBCONTRACTOR", "RETURNED_FROM_SUBCONTRACTOR"] } }, select: { id: true, status: true, currentStepId: true } });
  await p.roll.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "WAREHOUSE", currentStepId: null } });

  // --- TEST 1: hedef-renk-yok HARD ERROR ---
  await p.workOrder.update({ where: { id: WO }, data: { targetColorId: null } });
  let threw = false;
  try { await svc.manualMove(WO, { batchId: BATCH, targetStepId: last.id, reason: "test hedef-renk-yok" }); } catch (e) { threw = true; ok(/hedef rengi yok/i.test((e as Error).message), `hedef-renk-yok HARD ERROR: ${(e as Error).message.slice(0, 60)}`); }
  if (!threw) ok(false, "hedef-renk-yok HARD ERROR bekleniyordu ama fırlatmadı");
  await p.workOrder.update({ where: { id: WO }, data: { targetColorId } });

  // --- TEST 2: backflush jump ---
  const res = await svc.manualMove(WO, { batchId: BATCH, targetStepId: last.id, reason: "test backflush zımpara->tambur" });
  console.log("  move:", (res.data as { movedRollCount: number }).movedRollCount, "top →", (res.data as { targetStepName: string }).targetStepName);

  const after = await p.roll.findMany({ where: { id: { in: rollIds } }, select: { colorId: true, qualityGrade: true, currentStepId: true, status: true } });
  ok(after.every((r) => r.colorId === targetColorId), `renk uygulandı (colorId=targetColorId) [${after.filter((r) => r.colorId === targetColorId).length}/${after.length}]`);
  ok(after.every((r) => r.qualityGrade === null), "kalite Belirsiz (qualityGrade null) — sentezlenmedi");
  ok(after.every((r) => r.currentStepId === last.id), "toplar hedefte (Tambur)");
  ok(after.every((r) => r.status === "IN_PRODUCTION"), "toplar IN_PRODUCTION");

  const midAfter = await p.workOrderStep.findMany({ where: { id: { in: midSteps.map((s) => s.id) } }, select: { status: true, skipReason: true } });
  ok(midAfter.every((s) => s.status === "SKIPPED"), `ara adımlar SKIPPED (${midAfter.map((s) => s.status).join(",")})`);
  ok(midAfter.every((s) => s.skipReason?.startsWith("MANUAL_MOVE_BACKFLUSH")), "skipReason=MANUAL_MOVE_BACKFLUSH");
  const tamburAfter = await p.workOrderStep.findUniqueOrThrow({ where: { id: last.id }, select: { status: true } });
  ok(tamburAfter.status === "ACTIVE", `Tambur ACTIVE (${tamburAfter.status})`);

  // audit
  const audit = await p.systemLog.findFirst({ where: { tableName: "ROLL", action: "UPDATE" }, orderBy: { createdAt: "desc" }, select: { newData: true } });
  const nd = audit?.newData as Record<string, unknown> | null;
  ok(nd?.event === "MANUAL_MOVE" && nd?.backflush === true && nd?.qcBypassed === true, `audit backflush+qcBypassed [${JSON.stringify({ backflush: nd?.backflush, qcBypassed: nd?.qcBypassed })}]`);

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  await p.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
