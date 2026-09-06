// Faz 3 doğrulama — Konumu Düzelt geri-taşıma QC reversal.
// A) Salt QC/Kurşun (çocuk yok): geri taşınır, op VOID edilir (silinir), grade Belirsiz olur.
// B) CUT (parentRollId'li çocuk top var): HARD-STOP.
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
  const { woId: WO, batchId: BATCH, stepIdBySeq, rollIds } = fx;
  const kursun = { id: stepIdBySeq[3] }; // Kurşun+KK2 (seq3)
  const tambur = { id: stepIdBySeq[4] }; // Tambur (seq4)

  try {
    // --- SETUP: hepsi Tambur'da IN_PRODUCTION, grade A1, Tambur'da TAMBUR_PROCESSED op (KESİM YOK) ---
    await p.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
    await p.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
    await p.roll.updateMany({ where: { id: { in: rollIds } }, data: { status: "IN_PRODUCTION", currentStepId: tambur.id, qualityGrade: "A1", parentRollId: null } });
    for (const rid of rollIds) {
      await p.rollMovement.create({ data: { rollId: rid, workOrderStepId: tambur.id, qtyIn: 100 } });
      await p.rollOperation.create({ data: { rollId: rid, workOrderStepId: tambur.id, operationType: "TAMBUR_PROCESSED" } });
    }
    await p.workOrderStep.update({ where: { id: tambur.id }, data: { status: "ACTIVE", skipReason: null } });
    await p.workOrderStep.update({ where: { id: kursun.id }, data: { status: "COMPLETED", skipReason: null } });

    // === TEST B: CUT hard-stop — roll[1]'i roll[0]'ın çocuğu yap (Tambur'da doğmuş kesim) ===
    // Guard yön-bilinçli (2026-07-16): yalnız hedef-VEYA-SONRASI adımda doğmuş kesim
    // çocuğu engeller → sahte çocuğun producedInStepId'si Tambur'a damgalanır.
    await p.roll.update({ where: { id: rollIds[1] }, data: { parentRollId: rollIds[0], producedInStepId: tambur.id } });
    let threw = false;
    try {
      await svc.manualMove(WO, { rollIds: [rollIds[0]], targetStepId: kursun.id, partyMode: "new", reason: "test CUT hard-stop" });
    } catch (e) {
      threw = true;
      ok(/kesim yapılmış|çocuk/i.test((e as Error).message), `CUT HARD-STOP: ${(e as Error).message.slice(0, 55)}`);
    }
    if (!threw) ok(false, "CUT için hard-stop bekleniyordu ama geçti");
    await p.roll.update({ where: { id: rollIds[1] }, data: { parentRollId: null, producedInStepId: null } }); // temizle

    // === TEST A: salt-QC/Kurşun → geri taşınır + op VOID + grade null ===
    const res = await svc.manualMove(WO, { batchId: BATCH, targetStepId: kursun.id, reason: "test QC reversal Tambur->Kurşun" });
    console.log("  move:", (res.data as { movedRollCount: number }).movedRollCount, "top →", (res.data as { targetStepName: string }).targetStepName);

    const after = await p.roll.findMany({ where: { id: { in: rollIds } }, select: { qualityGrade: true, currentStepId: true } });
    ok(after.every((r) => r.currentStepId === kursun.id), "toplar Kurşun'a geri taşındı");
    ok(after.every((r) => r.qualityGrade === null), "kalite VOID edildi (grade → Belirsiz/null)");
    const tamburOps = await p.rollOperation.count({ where: { rollId: { in: rollIds }, workOrderStepId: tambur.id, operationType: "TAMBUR_PROCESSED" } });
    ok(tamburOps === 0, `Tambur işlem log'ları silindi (kalan ${tamburOps})`);

    const audit = await p.systemLog.findFirst({ where: { tableName: "ROLL", action: "UPDATE", recordId: { in: rollIds } }, orderBy: { createdAt: "desc" }, select: { newData: true } });
    const nd = audit?.newData as Record<string, unknown> | null;
    ok(nd?.event === "MANUAL_MOVE" && nd?.qcVoided === true, `audit qcVoided [${JSON.stringify({ qcVoided: nd?.qcVoided })}]`);
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? e.message : e);
  } finally {
    await fx.teardown();
    console.log("(temizlendi — TEST- fixture WO/parti/toplar silindi)");
    await p.$disconnect();
  }

  // Koşucunun tanıdığı özet formatı (run-all-tests.ts) — İngilizce biçim hiçbir
  // regex'e uymaz ve kontrol sayısını gizler.
  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
})();
