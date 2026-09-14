// Faz 1 doğrulama — Konumu Düzelt ileri-atlama BACKFLUSH.
// Setup: bir partiyi IN_PRODUCTION + renksiz olarak Zımpara'ya (renk adımı öncesi) kur;
// manualMove ile Tambur'a atla. Assert: renk uygulandı (targetColorId), kalite Belirsiz
// (null), erişilemez ara adımlar SKIPPED, toplar hedefte. + hedef-renk-yok HARD ERROR.
//
// 2026-07-27: hardcoded WO/parti UUID fixture'ı (reseed'de P2025) dinamik
// createManualMoveFixture'a taşındı; teardown fixture içinde.
import p from "../src/lib/prisma";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";
import { createManualMoveFixture } from "./fixture-manual-move";

const svc = new WorkOrderManualMoveService();
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`); c ? pass++ : fail++; };

(async () => {
  const fx = await createManualMoveFixture(3);
  const { woId: WO, batchId: BATCH, targetColorId, stepIdBySeq, rollIds } = fx;
  const first = { id: stepIdBySeq[1], stepSequence: 1 };     // Zımpara (seq1)
  const last = { id: stepIdBySeq[4], stepSequence: 4 };      // Tambur (seq4)
  const midSteps = [
    { id: stepIdBySeq[2], stepSequence: 2 },                 // Boyahane (renk)
    { id: stepIdBySeq[3], stepSequence: 3 },                 // Kurşun+KK2
  ];

  try {
    console.log(`WO ${WO.slice(0, 8)} | batch ${BATCH.slice(0, 8)} (${rollIds.length} top) | jump seq1→seq4`);

    // --- SETUP: renksiz, IN_PRODUCTION @ Zımpara, seq1 movement (kapalı); ara adımlar PENDING ---
    // @silme-baglami: FIKSTUR_KURULUMU — SETUP: seq1 kapalı hareketi kurmadan önce fikstürün kendi hareketleri sıfırlanıyor
    await p.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await p.roll.updateMany({ where: { id: { in: rollIds } }, data: { status: "IN_PRODUCTION", currentStepId: first.id, colorId: null, qualityGrade: null } });
    for (const rid of rollIds) await p.rollMovement.create({ data: { rollId: rid, workOrderStepId: first.id, qtyIn: 100, exitedAt: new Date() } });

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

    // audit — bu WO'nun toplarına ait en güncel MANUAL_MOVE kaydı
    const audit = await p.systemLog.findFirst({ where: { tableName: "ROLL", action: "UPDATE", recordId: { in: rollIds } }, orderBy: { createdAt: "desc" }, select: { newData: true } });
    const nd = audit?.newData as Record<string, unknown> | null;
    ok(nd?.event === "MANUAL_MOVE" && nd?.backflush === true && nd?.qcBypassed === true, `audit backflush+qcBypassed [${JSON.stringify({ backflush: nd?.backflush, qcBypassed: nd?.qcBypassed })}]`);
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    await fx.teardown();
    console.log("(temizlendi — TEST- fixture WO/parti/toplar silindi)");
    await p.$disconnect();
  }

  // Koşucunun tanıdığı TEK özet formatı (run-all-tests.ts). İngilizce
  // `== N passed, M failed ==` hiçbir regex'e uymuyordu ve dosya özet tablosunda
  // "geçti (exit 0)" görünüyordu — kaç kontrolün koştuğu gizliydi.
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
