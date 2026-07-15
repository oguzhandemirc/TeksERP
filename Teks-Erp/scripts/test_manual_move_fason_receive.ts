// Faz 2 (tam) doğrulama — Konumu Düzelt inline "Fason Kabul ile içeri al".
// preview.openDispatches (stepId/subcontractorId/rolls) → receive(returns+newRolls) →
// orijinaller SUBCONTRACTOR_CONSUMED, dönen parçalar yeni açık-kumaş toplar olarak doğar.
import p from "../src/lib/prisma";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";
import { SubcontractorService } from "../src/services/subcontractor.service";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

(async () => {
  // Fasonda (AT_SUBCONTRACTOR) topu olan açık dispatch + batch bul
  const disp = await p.subcontractorDispatch.findFirst({
    where: { cancelledAt: null, directShippedAt: null, items: { some: { roll: { status: "AT_SUBCONTRACTOR", batchId: { not: null } } } } },
    select: { id: true, dispatchNo: true, workOrderId: true, items: { where: { roll: { status: "AT_SUBCONTRACTOR" } }, select: { roll: { select: { id: true, batchId: true } } } } },
  });
  if (!disp) { console.log("(fasonda açık-dispatch'li batch yok — test atlanıyor)"); await p.$disconnect(); process.exit(0); }
  const batchId = disp.items[0].roll.batchId!;
  const fasonRollIds = disp.items.map((i) => i.roll.id);
  const anyStep = await p.workOrderStep.findFirst({ where: { workOrderId: disp.workOrderId }, select: { id: true } });

  const mmSvc = new WorkOrderManualMoveService();
  const scSvc = new SubcontractorService();

  // 1) preview → openDispatches zenginleştirildi mi?
  const prev = await mmSvc.getManualMovePreview(disp.workOrderId, { batchId, targetStepId: anyStep!.id });
  const od = (prev.data as { openDispatches: Array<{ dispatchId: string; stepId: string; subcontractorId: string; rolls: { id: string; currentQty: number }[] }> }).openDispatches;
  const target = od.find((x) => x.dispatchId === disp.id)!;
  ok(!!target, `openDispatches'te sevk var (${disp.dispatchNo})`);
  ok(!!target?.stepId && !!target?.subcontractorId, "openDispatches stepId + subcontractorId taşıyor");
  ok((target?.rolls?.length ?? 0) > 0, `openDispatches rolls dolu (${target?.rolls?.length} top)`);

  // 2) receive (inline Fason Kabul payload'ı) — dönen parça: her top için currentQty
  const totalQty = target.rolls.reduce((s, r) => s + r.currentQty, 0);
  const res = await scSvc.receive({
    workOrderId: disp.workOrderId,
    stepId: target.stepId,
    subcontractorId: target.subcontractorId,
    returns: target.rolls.map((r) => ({ rollId: r.id })),
    newRolls: [{ qty: totalQty }],
  });
  ok((res as { success: boolean }).success !== false, `receive başarılı (${disp.dispatchNo})`);

  // 3) orijinaller emekli + yeni açık-kumaş top(lar) doğdu
  const orig = await p.roll.findMany({ where: { id: { in: fasonRollIds } }, select: { status: true } });
  ok(orig.every((r) => r.status === "SUBCONTRACTOR_CONSUMED"), `orijinaller SUBCONTRACTOR_CONSUMED (${orig.filter((r) => r.status === "SUBCONTRACTOR_CONSUMED").length}/${orig.length})`);
  const born = await p.roll.findMany({ where: { batchId, entrySource: "SUBCONTRACTOR_RETURN", status: { notIn: ["SUBCONTRACTOR_CONSUMED", "CANCELLED"] } }, select: { id: true, barcode: true, currentStepId: true, colorId: true } });
  ok(born.length > 0, `yeni açık-kumaş top(lar) doğdu (${born.length})`);
  ok(born.every((r) => r.currentStepId != null), "yeni toplar bir sonraki adıma bağlı (içeride)");

  console.log(`\n== ${pass} passed, ${fail} failed ==`);
  await p.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
})();
