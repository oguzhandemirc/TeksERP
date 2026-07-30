// =============================================================================
// TEST: İş emri MANUEL KAPATMA + KAPANIŞ DİSPOZİSYONU — completeWorkOrder + preview.
// Çalıştır: npx tsx scripts/test_wo_manual_complete.ts
// =============================================================================
//   A) TEMİZ KAPAT: WIP yok → canComplete=true, WO COMPLETED, adımlar SKIPPED.
//   B) DİSPOZİSYON ZORUNLU: top işlemde + karar gönderilmedi → 400, WO IN_PROGRESS.
//   C) BEŞ STATÜ: STOCK/WAREHOUSE/A1_STOCK/SCRAP/CANCELLED uygulanır; satılabilirde
//      barkod üretilir, ham stokta üretilmez; movement WO_CLOSE_* ile kapanır.
//   D) FASON BLOK: AT_SUBCONTRACTOR top → 409, WO IN_PROGRESS kalır (rollback).
//   E) FASON DÖNÜŞÜ + STOCK → 400 (fason malı ham stoğa dönemez).
//   F) DEVİR: TRANSFER → yeni WO doğar, top orada IN_PRODUCTION; kaynak COMPLETED
//      (SUPERSEDED DEĞİL), boşalan kaynak parti silinir.
//   G) KALİTE: WAREHOUSE + qualityGradeId → qualityGrade kodu senkron yazılır.
// =============================================================================

import prisma from "../src/lib/prisma";
import { WorkOrderService } from "../src/services/workorder.service";
import { TravelerCardService } from "../src/services/traveler-card.service";
import {
  RollEntrySource,
  RollStatus,
  StepStatus,
  WorkOrderStatus,
} from "@prisma/client";

const svc = new WorkOrderService();
const cards = new TravelerCardService();

let pass = 0, fail = 0;
function check(label: string, cond: boolean, extra = ""): void {
  if (cond) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ""}`); }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ""}`); }
}
async function expectThrow(label: string, fn: () => Promise<unknown>, msgPart?: string): Promise<void> {
  let err: string | null = null;
  try { await fn(); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  check(label, err !== null && (!msgPart || err.includes(msgPart)), err ?? "(hata YOK!)");
}

let ITEM = "", GRADE = "", GRADE_CODE = "", ADMIN = "", ST_KURSUN = "", ST_TAMBUR = "";
const WIDTH = 250;
const woIds: string[] = [];
const createdRollIds: string[] = [];
let bc = 0;
function barcode(): string { bc++; return `TST-MCL-${Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase()}${bc}`; }

async function resolveFixtures(): Promise<void> {
  const need = (v: { id: string } | null, label: string): string => {
    if (!v) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
    return v.id;
  };
  ITEM = need(await prisma.item.findFirst({ where: { code: "PATOS" }, select: { id: true } }), "Item PATOS");
  const grade = await prisma.qualityGrade.findFirst({ where: { code: "1.KALITE" }, select: { id: true, code: true } });
  GRADE = need(grade, "QualityGrade");
  GRADE_CODE = grade!.code;
  ADMIN = need(await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }), "admin");
  ST_KURSUN = need(await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }), "KURSUN_KK2");
  ST_TAMBUR = need(await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }), "TAMBUR_1");
}

async function makeWo(): Promise<{ woId: string; stepIds: string[] }> {
  const stamp = `${Date.now()}`.slice(-6) + Math.floor(Math.random() * 1000);
  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: `TST-MCL-${stamp}`, type: "STOCK_PRODUCTION", status: "IN_PROGRESS",
      width: WIDTH, targetQuantity: 1000, targetItemId: ITEM,
      steps: { create: [
        { stationId: ST_KURSUN, stepSequence: 1, status: "PENDING" as const },
        { stationId: ST_TAMBUR, stepSequence: 2, status: "PENDING" as const },
      ] },
    },
    include: { steps: { orderBy: { stepSequence: "asc" } } },
  });
  await prisma.$transaction((tx) => cards.createForWorkOrder(tx, wo.id, ADMIN));
  woIds.push(wo.id);
  return { woId: wo.id, stepIds: wo.steps.map((s) => s.id) };
}

/** Ham stok topu — kaliteli (dispozisyon kalite testinde kasten temizlenir). */
async function stockRoll(qty: number): Promise<{ id: string; barcode: string }> {
  const code = barcode();
  const r = await prisma.roll.create({
    data: {
      barcode: code, itemId: ITEM, initialQty: qty, currentQty: qty,
      status: RollStatus.STOCK, qualityGrade: "1.KALITE", qualityGradeId: GRADE,
      width: WIDTH, createdById: ADMIN,
    },
    select: { id: true },
  });
  createdRollIds.push(r.id);
  return { id: r.id, barcode: code };
}

/** Topu WO'ya bağla (IN_PRODUCTION @ ilk adım) ve id'sini döndür. */
async function attachedRoll(woId: string, qty: number): Promise<string> {
  const roll = await stockRoll(qty);
  await svc.attachRolls(woId, [roll.barcode], ADMIN);
  return roll.id;
}

interface PreviewRoll { id: string; barcode: string | null; canReturnToStock: boolean }
interface Preview {
  canComplete: boolean;
  blockReason: string | null;
  requiresDisposition: boolean;
  remainingSteps: unknown[];
  inFlight: { count: number };
  dispositionRolls: PreviewRoll[];
  blockedRolls: (PreviewRoll & { blockReason: string })[];
}
async function previewOf(woId: string): Promise<Preview> {
  return (await svc.getCompletePreview(woId)).data as unknown as Preview;
}

async function main(): Promise<void> {
  await resolveFixtures();
  try {
    // === A) TEMİZ KAPAT (WIP yok) ===
    console.log("\n=== A) Temiz kapat: WIP yok → COMPLETED, kalan adımlar SKIPPED ===");
    {
      const { woId, stepIds } = await makeWo();
      const roll = await stockRoll(300);
      await svc.attachRolls(woId, [roll.barcode], ADMIN); // roll IN_PRODUCTION @ step1
      // Topu depoya çöz (finalize simülasyonu) → artık in-flight değil.
      await prisma.roll.update({
        where: { id: roll.id },
        data: { status: RollStatus.WAREHOUSE, currentStepId: null, producedInStepId: stepIds[0] },
      });

      const pv = await previewOf(woId);
      check("preview.canComplete=true (WIP yok)", pv.canComplete === true, `block=${pv.blockReason}`);
      check("preview.requiresDisposition=false", pv.requiresDisposition === false);
      check("preview.remainingSteps=2", pv.remainingSteps.length === 2, `n=${pv.remainingSteps.length}`);

      await svc.completeWorkOrder(woId, {}, ADMIN);
      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("WO COMPLETED", wo?.status === WorkOrderStatus.COMPLETED, String(wo?.status));
      const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: woId }, select: { status: true, skipReason: true } });
      check("kalan adımlar SKIPPED(MANUAL_COMPLETE)",
        steps.every((s) => s.status === StepStatus.SKIPPED && s.skipReason === "MANUAL_COMPLETE"),
        steps.map((s) => `${s.status}/${s.skipReason}`).join(", "));
    }

    // === B) DİSPOZİSYON ZORUNLU ===
    console.log("\n=== B) İşlemde top + karar yok → 400, WO IN_PROGRESS kalır ===");
    {
      const { woId } = await makeWo();
      await attachedRoll(woId, 200); // IN_PRODUCTION @ step1 (in-flight)

      const pv = await previewOf(woId);
      check("preview.canComplete=true (WIP artık engel DEĞİL)", pv.canComplete === true, `block=${pv.blockReason}`);
      check("preview.requiresDisposition=true", pv.requiresDisposition === true);
      check("preview.dispositionRolls=1", pv.dispositionRolls.length === 1, `n=${pv.dispositionRolls.length}`);
      check("preview.blockedRolls=0", pv.blockedRolls.length === 0);

      await expectThrow("kararsız kapatma → 400", () => svc.completeWorkOrder(woId, {}, ADMIN), "dispozisyon");
      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("WO hâlâ IN_PROGRESS (guard rollback)", wo?.status === WorkOrderStatus.IN_PROGRESS, String(wo?.status));

      // Eksik liste de reddedilir (bayat istemci): 1 top var, 0 karar + reason dolu.
      await expectThrow(
        "eksik/uyumsuz liste → 400",
        () => svc.completeWorkOrder(woId, {
          reason: "test",
          dispositions: [{ rollId: "00000000-0000-0000-0000-000000000000", action: "STOCK" }],
        }, ADMIN),
        "değişti",
      );
    }

    // === C) BEŞ STATÜ DİSPOZİSYONU ===
    console.log("\n=== C) Beş statü: STOCK/WAREHOUSE/A1_STOCK/SCRAP/CANCELLED ===");
    {
      const { woId } = await makeWo();
      const rStock = await attachedRoll(woId, 110);
      const rWare = await attachedRoll(woId, 120);
      const rA1 = await attachedRoll(woId, 130);
      const rScrap = await attachedRoll(woId, 140);
      const rCancel = await attachedRoll(woId, 150);
      // "Her kumaşa etiket" dalını test et: depoya inecek top barkodsuz olsun.
      await prisma.roll.update({ where: { id: rWare }, data: { barcode: null } });

      const res = await svc.completeWorkOrder(woId, {
        reason: "sipariş iptal — kalan mal dağıtıldı",
        dispositions: [
          { rollId: rStock, action: "STOCK" },
          { rollId: rWare, action: "WAREHOUSE" },
          { rollId: rA1, action: "A1_STOCK" },
          { rollId: rScrap, action: "SCRAP" },
          { rollId: rCancel, action: "CANCELLED" },
        ],
      }, ADMIN);
      check("kapatma başarılı", res.success === true, res.message);

      const rows = await prisma.roll.findMany({
        where: { id: { in: [rStock, rWare, rA1, rScrap, rCancel] } },
        select: { id: true, status: true, currentStepId: true, barcode: true },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      check("STOCK uygulandı", byId.get(rStock)?.status === RollStatus.STOCK, String(byId.get(rStock)?.status));
      check("WAREHOUSE uygulandı", byId.get(rWare)?.status === RollStatus.WAREHOUSE, String(byId.get(rWare)?.status));
      check("A1_STOCK uygulandı", byId.get(rA1)?.status === RollStatus.A1_STOCK, String(byId.get(rA1)?.status));
      check("SCRAP uygulandı", byId.get(rScrap)?.status === RollStatus.SCRAP, String(byId.get(rScrap)?.status));
      check("CANCELLED uygulandı", byId.get(rCancel)?.status === RollStatus.CANCELLED, String(byId.get(rCancel)?.status));
      check("hepsi istasyondan çıktı (currentStepId=null)", rows.every((r) => r.currentStepId === null));
      check("depoya inen barkodsuz top barkod aldı (F4)", byId.get(rWare)?.barcode != null, String(byId.get(rWare)?.barcode));
      check("ham stoğa dönen topa barkod ÜRETİLMEDİ (kendi barkodu)",
        byId.get(rStock)?.barcode?.startsWith("TST-MCL-") === true, String(byId.get(rStock)?.barcode));

      const moves = await prisma.rollMovement.findMany({
        where: { rollId: { in: [rStock, rWare, rScrap] } },
        select: { rollId: true, exitedAt: true, notes: true, qtyOut: true },
      });
      check("movement'lar kapandı", moves.length > 0 && moves.every((m) => m.exitedAt !== null), `n=${moves.length}`);
      check("movement notu WO_CLOSE_* sebep kodu taşıyor",
        moves.every((m) => (m.notes ?? "").startsWith("WO_CLOSE_")),
        moves.map((m) => m.notes).join(" | "));
      check("qtyOut fiziksel çıkışla dolduruldu", moves.every((m) => m.qtyOut !== null));

      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("WO COMPLETED", wo?.status === WorkOrderStatus.COMPLETED, String(wo?.status));

      const audits = await prisma.systemLog.count({
        where: { tableName: "ROLL", recordId: { in: [rStock, rWare, rA1, rScrap, rCancel] } },
      });
      check("her top için audit izi yazıldı", audits >= 5, `n=${audits}`);
    }

    // === D) FASON BLOK ===
    console.log("\n=== D) Fasonda top → 409, WO IN_PROGRESS kalır ===");
    {
      const { woId } = await makeWo();
      const rId = await attachedRoll(woId, 180);
      await prisma.roll.update({ where: { id: rId }, data: { status: RollStatus.AT_SUBCONTRACTOR } });

      const pv = await previewOf(woId);
      check("preview.canComplete=false", pv.canComplete === false, `block=${pv.blockReason}`);
      check("preview.blockedRolls=1", pv.blockedRolls.length === 1, `n=${pv.blockedRolls.length}`);
      check("preview.dispositionRolls=0", pv.dispositionRolls.length === 0);

      await expectThrow(
        "fasondaki topla kapatma → 409",
        () => svc.completeWorkOrder(woId, { reason: "denemek", dispositions: [{ rollId: rId, action: "WAREHOUSE" }] }, ADMIN),
        "fasonda",
      );
      const wo = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("WO hâlâ IN_PROGRESS (claim rollback)", wo?.status === WorkOrderStatus.IN_PROGRESS, String(wo?.status));
      // Testin kalanı için topu geri al (cleanup kolaylığı).
      await prisma.roll.update({ where: { id: rId }, data: { status: RollStatus.IN_PRODUCTION } });
    }

    // === E) FASON DÖNÜŞÜ TOP → STOCK YASAK ===
    console.log("\n=== E) Fason dönüşü top ham stoğa çekilemez → 400 ===");
    {
      const { woId } = await makeWo();
      const rId = await attachedRoll(woId, 160);
      await prisma.roll.update({
        where: { id: rId },
        data: { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
      });

      const pv = await previewOf(woId);
      check("preview.canReturnToStock=false", pv.dispositionRolls[0]?.canReturnToStock === false);

      await expectThrow(
        "fason dönüşü + STOCK → 400",
        () => svc.completeWorkOrder(woId, { reason: "denemek", dispositions: [{ rollId: rId, action: "STOCK" }] }, ADMIN),
        "ham stoğa çekilemez",
      );
      // Depoya alınabilir (aynı top, doğru karar).
      await svc.completeWorkOrder(woId, { reason: "fason dönüşü depoya alındı", dispositions: [{ rollId: rId, action: "WAREHOUSE" }] }, ADMIN);
      const roll = await prisma.roll.findUnique({ where: { id: rId }, select: { status: true } });
      check("aynı top WAREHOUSE'a alınabildi", roll?.status === RollStatus.WAREHOUSE, String(roll?.status));
    }

    // === F) DEVİR (TRANSFER) ===
    console.log("\n=== F) Devir: yeni WO doğar, kaynak COMPLETED (SUPERSEDED değil) ===");
    {
      const { woId } = await makeWo();
      const rId = await attachedRoll(woId, 240);
      const srcBatchId = (await prisma.roll.findUnique({ where: { id: rId }, select: { batchId: true } }))?.batchId ?? null;

      const res = await svc.completeWorkOrder(woId, {
        reason: "iş emri kapandı, üretim yeni emirde sürecek",
        dispositions: [{ rollId: rId, action: "TRANSFER" }],
        transferOrderMode: "stock",
      }, ADMIN);
      check("kapatma başarılı", res.success === true, res.message);

      const newWo = await prisma.workOrder.findFirst({
        where: { splitFromId: woId },
        select: { id: true, workOrderNumber: true, status: true },
      });
      check("yeni (devam) iş emri doğdu", newWo != null, newWo?.workOrderNumber ?? "(yok)");
      check("mesaj yeni iş emri numarasını taşıyor",
        newWo != null && (res.message ?? "").includes(newWo.workOrderNumber), res.message);

      const roll = await prisma.roll.findUnique({
        where: { id: rId },
        select: { status: true, currentStepId: true, batchId: true },
      });
      check("devredilen top IN_PRODUCTION kaldı", roll?.status === RollStatus.IN_PRODUCTION, String(roll?.status));
      const newStepIds = newWo
        ? (await prisma.workOrderStep.findMany({ where: { workOrderId: newWo.id }, select: { id: true } })).map((s) => s.id)
        : [];
      check("top yeni WO'nun bir adımında", roll?.currentStepId != null && newStepIds.includes(roll.currentStepId));
      check("top yeni WO'nun partisinde",
        roll?.batchId != null && roll.batchId !== srcBatchId,
        `src=${srcBatchId} new=${roll?.batchId}`);

      const src = await prisma.workOrder.findUnique({ where: { id: woId }, select: { status: true } });
      check("kaynak WO COMPLETED (SUPERSEDED DEĞİL)", src?.status === WorkOrderStatus.COMPLETED, String(src?.status));

      // Kaynak parti KORUNUR: yeni parti ona splitFromId ile bağlı, yani
      // deleteIfEmptyAndTraceless için "izsiz" değil — ayrılma izi kaybolmasın.
      if (srcBatchId) {
        const srcBatch = await prisma.batch.findUnique({
          where: { id: srcBatchId },
          select: { id: true, _count: { select: { rolls: true } } },
        });
        check("kaynak parti soy izi olarak korundu", srcBatch != null);
        check("kaynak parti boşaldı", srcBatch?._count.rolls === 0, `n=${srcBatch?._count.rolls}`);
        const newBatch = roll?.batchId
          ? await prisma.batch.findUnique({ where: { id: roll.batchId }, select: { splitFromId: true } })
          : null;
        check("yeni parti kaynağa splitFrom ile bağlı", newBatch?.splitFromId === srcBatchId, String(newBatch?.splitFromId));
      }

      // Movement AÇIK kalmalı — üretim sürüyor, kapanış onu kapatmamalı.
      const openMoves = await prisma.rollMovement.count({ where: { rollId: rId, exitedAt: null } });
      check("devredilen topun movement'ı AÇIK kaldı", openMoves > 0, `n=${openMoves}`);
    }

    // === G) KALİTE SENKRONU ===
    console.log("\n=== G) WAREHOUSE + kalite → qualityGrade kodu senkron yazılır ===");
    {
      const { woId } = await makeWo();
      const rId = await attachedRoll(woId, 175);
      // Kalitesiz top (Kurşun sırasındaki gerçek durum).
      await prisma.roll.update({ where: { id: rId }, data: { qualityGrade: null, qualityGradeId: null } });

      await svc.completeWorkOrder(woId, {
        reason: "depoya alındı, kalite atandı",
        dispositions: [{ rollId: rId, action: "WAREHOUSE", qualityGradeId: GRADE }],
      }, ADMIN);

      const roll = await prisma.roll.findUnique({
        where: { id: rId },
        select: { status: true, qualityGrade: true, qualityGradeId: true },
      });
      check("WAREHOUSE + kalite yazıldı",
        roll?.status === RollStatus.WAREHOUSE && roll?.qualityGradeId === GRADE && roll?.qualityGrade === GRADE_CODE,
        `${roll?.status}/${roll?.qualityGrade}`);

      // Kalite yalnız satılabilir dispozisyonda verilebilir.
      const { woId: woId2 } = await makeWo();
      const r2 = await attachedRoll(woId2, 100);
      await expectThrow(
        "SCRAP + kalite → 400",
        () => svc.completeWorkOrder(woId2, {
          reason: "denemek", dispositions: [{ rollId: r2, action: "SCRAP", qualityGradeId: GRADE }],
        }, ADMIN),
        "yalnız depo",
      );
    }
  } finally {
    await cleanup();
  }
  console.log("──────────────────────────────────────────");
  console.log(`=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

async function cleanup(): Promise<void> {
  try {
    // Devirle doğan çocuk WO'ları da topla (splitFromId zinciri).
    const children = await prisma.workOrder.findMany({
      where: { splitFromId: { in: woIds } },
      select: { id: true },
    });
    const allWoIds = [...woIds, ...children.map((c) => c.id)];

    const steps = await prisma.workOrderStep.findMany({ where: { workOrderId: { in: allWoIds } }, select: { id: true } });
    const stepIds = steps.map((s) => s.id);
    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { id: { in: createdRollIds } },
          { currentStepId: { in: stepIds } },
          { producedInStepId: { in: stepIds } },
          { barcode: { startsWith: "TST-MCL-" } },
        ],
      },
      select: { id: true },
    });
    const rollIds = rolls.map((r) => r.id);
    await prisma.systemLog.deleteMany({ where: { tableName: "ROLL", recordId: { in: rollIds } } });
    await prisma.systemLog.deleteMany({ where: { tableName: "WORK_ORDER", recordId: { in: allWoIds } } });
    await prisma.rollOperation.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.rollMovement.deleteMany({ where: { OR: [{ rollId: { in: rollIds } }, { workOrderStepId: { in: stepIds } }] } });
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } });
    const cardRows = await prisma.travelerCard.findMany({ where: { workOrderId: { in: allWoIds } }, select: { id: true } });
    const cardIds = cardRows.map((c) => c.id);
    await prisma.travelerCardScan.deleteMany({ where: { cardId: { in: cardIds } } });
    await prisma.travelerCard.deleteMany({ where: { id: { in: cardIds } } });
    // Parti soy bağı: çocuk partileri önce çöz (splitFromId FK).
    await prisma.batch.updateMany({ where: { workOrderId: { in: allWoIds } }, data: { splitFromId: null } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: allWoIds } } });
    await prisma.workOrderToOrderLine.deleteMany({ where: { workOrderId: { in: allWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: allWoIds } } });
    // Çocuk WO'lar önce (splitFromId FK kaynağa bakar).
    await prisma.workOrder.deleteMany({ where: { id: { in: children.map((c) => c.id) } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } });
    console.log("(test verisi temizlendi)");
  } catch (e) {
    console.error("cleanup hata:", e instanceof Error ? e.message : e);
  }
}

main().catch(async (e) => { console.error("HATA:", e); await cleanup(); await prisma.$disconnect(); process.exit(1); });
