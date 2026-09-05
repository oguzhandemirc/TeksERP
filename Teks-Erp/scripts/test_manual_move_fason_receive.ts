// =============================================================================
// Faz 2 doğrulama — "Konumu Düzelt" içindeki inline Fason Kabul (BULGU-T1-018)
// Çalıştır: npx tsx scripts/test_manual_move_fason_receive.ts
// =============================================================================
// preview.openDispatches (stepId/subcontractorId/rolls) → receive(returns+newRolls)
// → orijinaller SUBCONTRACTOR_CONSUMED, dönen parçalar yeni açık-kumaş toplar
// olarak doğar ve bir sonraki adıma bağlanır.
//
// ⚠️ BU DOSYA 2026-08-31'DE YENİDEN YAZILDI. Eski hâli FIXTURE'SIZDI: veritabanında
// RASTGELE bir açık fason sevki bulup onun ÜZERİNDE GERÇEK bir kabul yapıyor,
// hiçbir şeyi temizlemiyordu. Bir geliştirici saha teşhisi için `.env`i saha
// yedeğine (ya da SSH tüneliyle `localhost:5432`ye maplenmiş üretim DB'sine)
// çevirip bu tek dosyayı koşsaydı, fabrikanın boyahanedeki GERÇEK malına sahte
// bir kabul yazılırdı: toplar SUBCONTRACTOR_CONSUMED olur (artık sevk edilemez,
// listelerden düşer), yerlerine sahte bir top doğar, kalem kapanır ve o sevk
// "fasondan geldi" sayılır. Mal fiziksel olarak hâlâ boyahanededir ve fason
// kabul iptali ayrı bir LIFO akışıdır — kolay geri alınamaz.
//
// İKİ KATMAN:
//   ① ORTAM KAPISI — hedef geliştirme DB'si değilse betik HİÇ KOŞMAZ. Kapı host
//      adına DEĞİL DB ADINA da bakar; SSH tüneli host'u `localhost` gösterir.
//   ② KENDİ FIXTURE'I — iş emri, adım, top ve sevk bu dosya tarafından kurulur;
//      `finally` hepsini siler. Artık hiçbir gerçek sevke dokunulmuyor.
// =============================================================================
import { assertGelistirmeVeritabani } from "./db-guard";
// ⛔ İLK İFADE — sıra load-bearing (import'lardan sonraki ilk çalışan satır).
assertGelistirmeVeritabani("test_manual_move_fason_receive");

import { RollStatus } from "@prisma/client";
import p, { pool } from "../src/lib/prisma";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import { ensureTestDyeHouse } from "./fixture-subcontractor";

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string): void => {
  console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${m}`);
  if (c) pass++;
  else fail++;
};

const STAMP = `TSTMMF${Date.now().toString().slice(-7)}`;
const cards = new TravelerCardService();
const woIds: string[] = [];
const rollIds: string[] = [];

async function main(): Promise<void> {
  const need = <T>(v: T | null, l: string): T => {
    if (!v) throw new Error(`fixture eksik: ${l}`);
    return v;
  };
  const ITEM = need(await p.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "PATOS").id;
  const ADMIN = need(await p.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin").id;
  const ST_BOYA = need(
    await p.station.findFirst({ where: { code: "BOYA_FASON" }, select: { id: true } }),
    "BOYA_FASON",
  ).id;
  const ST_SONRA = need(
    await p.station.findFirst({ where: { code: { not: "BOYA_FASON" }, isActive: true }, select: { id: true } }),
    "ikinci istasyon",
  ).id;
  const SUB = (await ensureTestDyeHouse()).id;

  // ── KENDİ FIXTURE'I: iş emri + iki adım + top + fason sevki ────────────────
  const wo = await p.workOrder.create({
    data: {
      workOrderNumber: `${STAMP}`.slice(0, 40),
      type: "STOCK_PRODUCTION",
      status: "IN_PROGRESS",
      targetItemId: ITEM,
      steps: {
        create: [
          { stationId: ST_BOYA, stepSequence: 1, status: "PENDING" },
          { stationId: ST_SONRA, stepSequence: 2, status: "PENDING" },
        ],
      },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  woIds.push(wo.id);
  await p.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  const boyaStep = wo.steps[0]!.id;

  const roll = await p.roll.create({
    data: {
      barcode: `${STAMP}-R`.slice(0, 30),
      itemId: ITEM,
      initialQty: 120,
      currentQty: 120,
      status: RollStatus.STOCK,
      width: 250,
      createdById: ADMIN,
    },
    select: { id: true },
  });
  rollIds.push(roll.id);

  const scSvc = new SubcontractorService();
  const dispRes = await scSvc.dispatch(
    { workOrderId: wo.id, stepId: boyaStep, subcontractorId: SUB, rollIds: [roll.id] },
    ADMIN,
  );
  const disp = dispRes.data as unknown as { id: string; dispatchNo: string };

  const mmSvc = new WorkOrderManualMoveService();

  // 1) preview → openDispatches zenginleştirildi mi?
  // ⚠️ `batchId` ŞART: önizleme kapsamı parti üzerinden çözülüyor, verilmezse
  // iş emrine ait olmayan toplar da kapsama girip 400 üretiyor.
  const tazeTop = await p.roll.findUnique({ where: { id: roll.id }, select: { batchId: true } });
  const prev = await mmSvc.getManualMovePreview(wo.id, {
    ...(tazeTop?.batchId ? { batchId: tazeTop.batchId } : {}),
    targetStepId: wo.steps[1]!.id,
  });
  const od = (
    prev.data as {
      openDispatches: Array<{
        dispatchId: string;
        stepId: string;
        subcontractorId: string;
        rolls: Array<{ id: string; currentQty: number }>;
      }>;
    }
  ).openDispatches;
  const target = od.find((x) => x.dispatchId === disp.id);
  ok(!!target, `openDispatches'te sevk var (${disp.dispatchNo})`);
  if (!target) return;
  ok(!!target.stepId && !!target.subcontractorId, "openDispatches stepId + subcontractorId taşıyor");
  ok(target.rolls.length > 0, `openDispatches rolls dolu (${target.rolls.length} top)`);

  // 2) receive (inline Fason Kabul payload'ı)
  const totalQty = target.rolls.reduce((s, r) => s + Number(r.currentQty), 0);
  const res = await scSvc.receive(
    {
      workOrderId: wo.id,
      stepId: target.stepId,
      subcontractorId: target.subcontractorId,
      returns: target.rolls.map((r) => ({ rollId: r.id })),
      newRolls: [{ qty: totalQty }],
    },
    ADMIN,
  );
  ok((res as { success: boolean }).success !== false, `receive başarılı (${disp.dispatchNo})`);

  // 3) orijinaller emekli + yeni açık-kumaş top(lar) doğdu
  const orig = await p.roll.findMany({ where: { id: { in: [roll.id] } }, select: { status: true } });
  ok(
    orig.every((r) => r.status === "SUBCONTRACTOR_CONSUMED"),
    `orijinaller SUBCONTRACTOR_CONSUMED (${orig.length})`,
  );
  const born = await p.roll.findMany({
    where: { parentReceipt: { workOrderId: wo.id }, status: { notIn: ["SUBCONTRACTOR_CONSUMED", "CANCELLED"] } },
    select: { id: true, currentStepId: true },
  });
  born.forEach((b) => rollIds.push(b.id));
  ok(born.length > 0, `yeni açık-kumaş top(lar) doğdu (${born.length})`);
  ok(born.every((r) => r.currentStepId != null), "yeni toplar bir sonraki adıma bağlı (içeride)");
}

main()
  .catch((e) => {
    console.error("HATA:", e instanceof Error ? e.message : e);
    fail++;
  })
  .finally(async () => {
    // ⚠️ RESTRICT FK: fason kabulü yapan HER temizlik `rollVariance.deleteMany`
    // içermeli (2026-08-21 kuralı — 23 dosya bu yüzden güncellenmişti).
    try {
      await p.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } });
      await p.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } });
      await p.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } });
      await p.subcontractorReceiptItem.deleteMany({ where: { receipt: { workOrderId: { in: woIds } } } });
      await p.subcontractorReceipt.deleteMany({ where: { workOrderId: { in: woIds } } });
      await p.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: { in: woIds } } } });
      await p.subcontractorDispatch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await p.roll.deleteMany({ where: { id: { in: rollIds } } });
      await p.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } });
      await p.batch.deleteMany({ where: { workOrderId: { in: woIds } } });
      await p.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } });
      await p.workOrder.deleteMany({ where: { id: { in: woIds } } });
    } catch (e) {
      console.error("cleanup hata:", e instanceof Error ? e.message : e);
    }
    // Sözleşme formatı — koşucu (`run-all-tests.ts`) sayıları BU satırdan okur.
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await p.$disconnect();
    await pool.end();
    process.exit(fail > 0 ? 1 : 0);
  });
