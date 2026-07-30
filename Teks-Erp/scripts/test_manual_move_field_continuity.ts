// =============================================================================
// TEST (2026-07-30): Manuel taşıma sonrası SAHA SÜREKLİLİĞİ — personel işine
// devam edebiliyor mu? Konum düzeltmenin bıraktığı durum, istasyon uçlarının
// kabul kurallarıyla uyuşmak ZORUNDA; yoksa top "canlı ama kimse dokunamıyor"
// çıkmazına düşer.
// Çalıştır: npx tsx scripts/test_manual_move_field_continuity.ts
// =============================================================================
//   A) Fason dönüşü top → GERİ boyahane adımına: adım ACTIVE + kart ACTIVE olur,
//      Fason SEVK kabul eder, bekleyen-dönüş listesinde görünür, Fason KABUL çalışır.
//      (Kabul doğrudan yapılamaz — önce sevk gerekir; önizleme bunu uyarı ile söyler.)
//   B) Tambur'daki top → GERİ Kurşun/KK2'ye: PROCESS_QC açık-kart panelinde görünür.
//   C) İPTAL/DEVREDİLMİŞ iş emrinde taşıma REDDEDİLİR (409) — kart VOIDED olduğu için
//      taşınsaydı saha personeli okutamazdı. Önizleme de woBlocked=true döner.
// =============================================================================

import prisma, { pool } from "../src/lib/prisma";
import { RollEntrySource, RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";
import { createManualMoveFixture, type ManualMoveFixture } from "./fixture-manual-move";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";
import { SubcontractorService } from "../src/services/subcontractor.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";

const move = new WorkOrderManualMoveService();
const sub = new SubcontractorService();
const kursun = new KursunQcService();
const wos = new WorkOrderService();
const cards = new TravelerCardService();

let pass = 0, fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>, msgPart?: string): Promise<void> {
  let err: string | null = null;
  try { await fn(); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  check(label, err !== null && (!msgPart || err.includes(msgPart)), err ?? "(hata YOK!)");
}

async function resolveAdmin(): Promise<string> {
  const u = await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } });
  if (!u) throw new Error("Seed fixture eksik: admin (önce 'npm run seed')");
  return u.id;
}
async function resolveDyeFirm(): Promise<string> {
  const s = await prisma.subcontractor.findFirst({
    where: { categories: { some: { category: { appliesColor: true } } } },
    select: { id: true },
  });
  if (!s) throw new Error("Seed fixture eksik: appliesColor fason firması");
  return s.id;
}

/** Fixture kart üretmez; saha akışı ACTIVE refakat kartı ister. */
async function makeCard(woId: string, userId: string): Promise<void> {
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, woId, userId));
}

/** Fixture teardown'ı fason kayıtlarını bilmez — bu test kendi kirini toplar. */
async function cleanupFason(woId: string): Promise<void> {
  const born = await prisma.roll.findMany({
    where: { parentReceipt: { workOrderId: woId } },
    select: { id: true },
  });
  const bornIds = born.map((b) => b.id);
  await prisma.subcontractorReceiptItem.deleteMany({ where: { receipt: { workOrderId: woId } } });
  await prisma.subcontractorReceipt.deleteMany({ where: { workOrderId: woId } });
  if (bornIds.length > 0) {
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: bornIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: bornIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: bornIds } } });
    await prisma.systemLog.deleteMany({ where: { recordId: { in: bornIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: bornIds } } });
  }
  await prisma.subcontractorDispatchItem.deleteMany({ where: { dispatch: { workOrderId: woId } } });
  await prisma.subcontractorDispatch.deleteMany({ where: { workOrderId: woId } });
  await prisma.manifest.deleteMany({ where: { workOrderId: woId } });
}

async function main(): Promise<void> {
  const ADMIN = await resolveAdmin();
  const FIRM = await resolveDyeFirm();

  // === A) Fason dönüşü top → GERİ boyahaneye → Sevk + Kabul ===
  console.log("\n=== A) Fason dönüşü top GERİ boyahaneye: sevk + kabul çalışıyor mu ===");
  {
    const fx: ManualMoveFixture = await createManualMoveFixture(1);
    try {
      await makeCard(fx.woId, ADMIN);
      const rollId = fx.rollIds[0]!;
      const boya = fx.stepIdBySeq[2]!;        // BOYA_FASON (renk veren fason adımı)
      const kursunStep = fx.stepIdBySeq[3]!;  // KURSUN_KK2

      // Kurulum: top boyahaneden DÖNMÜŞ (entrySource=SUBCONTRACTOR_RETURN), Kurşun'da bekliyor.
      await prisma.roll.update({
        where: { id: rollId },
        data: {
          status: RollStatus.IN_PRODUCTION,
          currentStepId: kursunStep,
          entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
          colorId: fx.targetColorId,
        },
      });
      await prisma.rollMovement.create({ data: { rollId, workOrderStepId: kursunStep, qtyIn: 100 } });

      // Önizleme fason adımına taşımayı uyarıyla anlatmalı (kabul değil, SEVK gerekir).
      const pv = (await move.getManualMovePreview(fx.woId, { rollIds: [rollId], targetStepId: boya }))
        .data as { warnings: string[]; woBlocked: boolean };
      check("önizleme: fason adımı uyarısı var (sevk ayrıca yapılır)",
        pv.warnings.some((w) => w.includes("Fason Sevk")), pv.warnings.join(" | "));
      check("önizleme: woBlocked=false (canlı iş emri)", pv.woBlocked === false);

      // GERİ taşı: Kurşun → Boyahane
      await move.manualMove(
        fx.woId,
        { rollIds: [rollId], targetStepId: boya, reason: "renk tutmadı, tekrar boyanacak" },
        ADMIN,
      );

      const r1 = await prisma.roll.findUnique({
        where: { id: rollId },
        select: { status: true, currentStepId: true },
      });
      check("top boyahane adımında IN_PRODUCTION (AT_SUBCONTRACTOR DEĞİL)",
        r1?.status === RollStatus.IN_PRODUCTION && r1?.currentStepId === boya, String(r1?.status));
      const st = await prisma.workOrderStep.findUnique({ where: { id: boya }, select: { status: true } });
      check("boyahane adımı ACTIVE (istasyon kuyruğunda görünür)", st?.status === StepStatus.ACTIVE, String(st?.status));
      const card = await prisma.travelerCard.findFirst({ where: { workOrderId: fx.woId }, select: { status: true } });
      check("refakat kartı ACTIVE (operatör okutabilir)", card?.status === "ACTIVE", String(card?.status));

      // Saha adım 1: FASON SEVK
      const d = await sub.dispatch(
        { workOrderId: fx.woId, stepId: boya, subcontractorId: FIRM, rollIds: [rollId], allowRouteSkip: true },
        ADMIN,
      );
      check("Fason Sevk kabul etti", Boolean((d.data as Record<string, unknown>).dispatchNo),
        String((d.data as Record<string, unknown>).dispatchNo));
      const r2 = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true } });
      check("top AT_SUBCONTRACTOR (fiziksel olarak dışarıda)", r2?.status === RollStatus.AT_SUBCONTRACTOR, String(r2?.status));

      // Saha adım 2: FASON KABUL — bekleyen listesinde görünüyor mu
      const pend = await sub.listPendingReturns({ workOrderId: fx.woId });
      check("Fason Kabul bekleyen-dönüş listesinde görünüyor",
        JSON.stringify(pend.data ?? {}).includes(rollId));

      await sub.receive(
        { workOrderId: fx.woId, stepId: boya, subcontractorId: FIRM, returns: [{ rollId }], newRolls: [{ qty: 100 }] } as never,
        ADMIN,
      );
      const r3 = await prisma.roll.findUnique({ where: { id: rollId }, select: { status: true } });
      check("kabulde orijinal top SUBCONTRACTOR_CONSUMED", r3?.status === RollStatus.SUBCONTRACTOR_CONSUMED, String(r3?.status));
      const born = await prisma.roll.count({ where: { parentReceipt: { workOrderId: fx.woId } } });
      check("kabulden yeni açık-kumaş top doğdu", born > 0, `n=${born}`);
    } finally {
      await cleanupFason(fx.woId);
      await fx.teardown();
    }
  }

  // === B) Tambur → GERİ Kurşun/KK2 ===
  console.log("\n=== B) Tambur'daki top GERİ Kurşun'a: açık-kart panelinde görünüyor mu ===");
  {
    const fx = await createManualMoveFixture(1);
    try {
      await makeCard(fx.woId, ADMIN);
      const rollId = fx.rollIds[0]!;
      const kursunStep = fx.stepIdBySeq[3]!;
      const tambur = fx.stepIdBySeq[4]!;
      await prisma.roll.update({
        where: { id: rollId },
        data: { status: RollStatus.IN_PRODUCTION, currentStepId: tambur, colorId: fx.targetColorId },
      });
      await prisma.rollMovement.create({ data: { rollId, workOrderStepId: tambur, qtyIn: 100 } });

      await move.manualMove(
        fx.woId,
        { rollIds: [rollId], targetStepId: kursunStep, reason: "kurşun atlanmış, geri alındı" },
        ADMIN,
      );

      const r = await prisma.roll.findUnique({
        where: { id: rollId },
        select: { status: true, currentStepId: true },
      });
      check("top Kurşun adımında IN_PRODUCTION",
        r?.status === RollStatus.IN_PRODUCTION && r?.currentStepId === kursunStep, String(r?.status));
      const open = await kursun.listOpenCards();
      check("Kurşun/KK2 açık-kart panelinde görünüyor",
        (open.data ?? []).some((c) => c.workOrderId === fx.woId && c.stepId === kursunStep),
        `panelde ${open.data?.length ?? 0} kart`);
    } finally {
      await fx.teardown();
    }
  }

  // === C) Ölü iş emri (iptal) → taşıma reddedilir ===
  console.log("\n=== C) İPTAL edilmiş iş emrinde taşıma reddedilir (çıkmaz önlenir) ===");
  {
    const fx = await createManualMoveFixture(1);
    try {
      await makeCard(fx.woId, ADMIN);
      const rollId = fx.rollIds[0]!;
      const kursunStep = fx.stepIdBySeq[3]!;
      const tambur = fx.stepIdBySeq[4]!;
      await prisma.roll.update({
        where: { id: rollId },
        data: { status: RollStatus.IN_PRODUCTION, currentStepId: kursunStep, colorId: fx.targetColorId },
      });
      await prisma.rollMovement.create({ data: { rollId, workOrderStepId: kursunStep, qtyIn: 100 } });

      await wos.softDelete(fx.woId, ADMIN); // WO CANCELLED + ACTIVE kartlar VOIDED
      const wo = await prisma.workOrder.findUnique({ where: { id: fx.woId }, select: { status: true } });
      const card = await prisma.travelerCard.findFirst({ where: { workOrderId: fx.woId }, select: { status: true } });
      check("kurulum: WO CANCELLED + kart VOIDED",
        wo?.status === WorkOrderStatus.CANCELLED && card?.status === "VOIDED", `${wo?.status}/${card?.status}`);

      // İptal ham topu STOCK'a çekti — taşıma denemesi için üretime geri koy.
      await prisma.roll.update({
        where: { id: rollId },
        data: { status: RollStatus.IN_PRODUCTION, currentStepId: kursunStep },
      });

      const pv = (await move.getManualMovePreview(fx.woId, { rollIds: [rollId], targetStepId: tambur }))
        .data as { woBlocked: boolean; woBlockReason: string | null };
      check("önizleme woBlocked=true", pv.woBlocked === true, String(pv.woBlockReason));

      await expectThrow(
        "manualMove 409 ile reddediyor",
        () => move.manualMove(fx.woId, { rollIds: [rollId], targetStepId: tambur, reason: "iptal WO denemesi" }, ADMIN),
        "İptal edilmiş iş emrinde konum düzeltilemez",
      );
      const after = await prisma.roll.findUnique({ where: { id: rollId }, select: { currentStepId: true } });
      check("top taşınmadı (kaynak adımda kaldı)", after?.currentStepId === kursunStep);

      // SUPERSEDED de aynı korumada olmalı.
      await prisma.workOrder.update({ where: { id: fx.woId }, data: { status: WorkOrderStatus.SUPERSEDED } });
      await expectThrow(
        "devredilmiş (SUPERSEDED) WO da reddediliyor",
        () => move.manualMove(fx.woId, { rollIds: [rollId], targetStepId: tambur, reason: "devredilmiş WO denemesi" }, ADMIN),
        "Devredilmiş iş emrinde konum düzeltilemez",
      );
    } finally {
      await fx.teardown();
    }
  }

  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
}

main()
  .catch((e) => { console.error("HATA:", e); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end(); // havuz kapanmazsa süreç 30s idle bekler
  });
