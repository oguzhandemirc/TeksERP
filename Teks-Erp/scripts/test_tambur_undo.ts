// =============================================================================
// Test: Tambur GERİ AL (undo) — SINGLE + FULL (2026-07-31 özelliği)
// Çalıştır: npx tsx scripts/test_tambur_undo.ts
// Doğrulananlar:
//   FULL:   finalize sonrası tümden geri alma — parent Tambur adımına döner
//           (metraj restore), TÜM çocuklar CANCELLED, TAMBUR_PROCESSED silinir
//           (finalize YENİDEN yapılabilir), kapatılan RollError yeniden açılır,
//           COMPLETED WO IN_PROGRESS'e dirilir, movement yeniden açılır
//   Guard:  metrajı değişmiş çocuk FULL'ü bloklar (canApply=false)
//   SINGLE: cutOpenFabric parçası iptali → parent currentQty geri
//   SINGLE: cutWarehouseRoll parçası iptali → parent currentQty + initialQty geri
//   Negatif: kesim çocuğu olmayan top → 400
// =============================================================================
import { randomUUID } from "crypto";
import prisma from "../src/lib/prisma";
import { TamburService } from "../src/services/tambur.service";
import { TamburUndoService } from "../src/services/tambur-undo.service";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${extra ? ` — ${extra}` : ""}`);
  }
}
const TS = Date.now().toString(36);
const tambur = new TamburService();
const undo = new TamburUndoService();

async function expectConflictOr400(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "";
  } catch (e) {
    const sc = (e as { statusCode?: number }).statusCode;
    return sc === 409 || sc === 400 ? String((e as Error).message) : `beklenmeyen: ${String(e)}`;
  }
}

async function main() {
  const made = {
    itemId: "", woId: "", stepId: "", defectTypeId: "",
    rollIds: [] as string[],
  };
  try {
    const station = await prisma.station.findFirst({
      where: { kind: "TAMBUR", isActive: true },
      select: { id: true },
    });
    if (!station) throw new Error("Seed TAMBUR istasyonu yok (npm run seed)");
    const grade = await prisma.qualityGrade.findFirst({
      where: { isActive: true },
      select: { code: true },
    });
    if (!grade) throw new Error("Seed kalite kaydı yok");

    const item = await prisma.item.create({
      data: { code: `TEST-TU-${TS}`, name: `TEST TamburUndo ${TS}`, itemType: "FABRIC" },
      select: { id: true },
    });
    made.itemId = item.id;
    const defect = await prisma.defectType.create({
      data: { code: `TEST-TU-D-${TS}`.slice(0, 32), name: `TEST Hata ${TS}` },
      select: { id: true },
    });
    made.defectTypeId = defect.id;

    const wo = await prisma.workOrder.create({
      data: {
        workOrderNumber: `TEST-TU-WO-${TS}`,
        type: "ORDER_PRODUCTION",
        status: "IN_PROGRESS",
        steps: { create: [{ stationId: station.id, stepSequence: 1, status: "ACTIVE" }] },
      },
      select: { id: true, steps: { select: { id: true } } },
    });
    made.woId = wo.id;
    const stepId = wo.steps[0].id;
    made.stepId = stepId;

    const mkRoll = async (n: string, data: Record<string, unknown>) => {
      const r = await prisma.roll.create({
        data: {
          barcode: `TEST-TU-${n}-${TS}`,
          itemId: item.id,
          initialQty: 100,
          currentQty: 100,
          ...data,
        },
        select: { id: true },
      });
      made.rollIds.push(r.id);
      return r.id;
    };

    // ── FULL senaryo ────────────────────────────────────────────────────────
    const r1 = await mkRoll("R1", { status: "IN_PRODUCTION", currentStepId: stepId });
    await prisma.rollMovement.create({ data: { rollId: r1, workOrderStepId: stepId, qtyIn: 100 } });
    const err = await prisma.rollError.create({
      data: { rollId: r1, startMeter: 10, defectTypeId: defect.id },
      select: { id: true },
    });

    await tambur.finalize(
      {
        rollId: r1,
        cuts: [{ length: 40, qualityGrade: grade.code, relatedErrorIds: [err.id] }],
        decisions: [{ errorId: err.id, decision: "CUT" }],
      },
      undefined,
    );
    const afterFin = await prisma.roll.findUniqueOrThrow({ where: { id: r1 }, select: { status: true } });
    const kids1 = await prisma.roll.findMany({ where: { parentRollId: r1 }, select: { id: true } });
    made.rollIds.push(...kids1.map((k) => k.id));
    check("fixture: finalize → parent TAMBUR_CONSUMED + 2 çocuk", afterFin.status === "TAMBUR_CONSUMED" && kids1.length === 2);
    const woAfterFin = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { status: true } });
    check("fixture: tek adımlı WO finalize'la COMPLETED", woAfterFin.status === "COMPLETED");

    const prev = (await undo.getUndoPreview(kids1[0].id)).data as {
      mode: string; canApply: boolean; restoredQty: number; children: unknown[]; workOrder: { willRevive: boolean } | null;
    };
    check("FULL preview: çocuktan çözüldü, mode=FULL + canApply", prev.mode === "FULL" && prev.canApply);
    check("FULL preview: restoredQty=100, 2 çocuk listeli", prev.restoredQty === 100 && prev.children.length === 2);
    check("FULL preview: WO diriltileceği söyleniyor", prev.workOrder?.willRevive === true);

    const applied = (await undo.applyUndo(kids1[0].id, undefined)).data as { mode: string; reopenedErrors: number; woRevived: boolean };
    check("FULL apply: mode=FULL + hata yeniden açıldı + WO dirildi", applied.mode === "FULL" && applied.reopenedErrors === 1 && applied.woRevived);

    const parentBack = await prisma.roll.findUniqueOrThrow({
      where: { id: r1 },
      select: { status: true, currentStepId: true, currentQty: true },
    });
    check(
      "FULL: parent IN_PRODUCTION + Tambur adımında + 100 m",
      parentBack.status === "IN_PRODUCTION" && parentBack.currentStepId === stepId && Number(parentBack.currentQty) === 100,
    );
    const kidsAfter = await prisma.roll.findMany({ where: { parentRollId: r1 }, select: { status: true } });
    check("FULL: tüm çocuklar CANCELLED", kidsAfter.every((k) => k.status === "CANCELLED"));
    const opGone = await prisma.rollOperation.count({ where: { rollId: r1, operationType: "TAMBUR_PROCESSED" } });
    check("FULL: TAMBUR_PROCESSED izi silindi", opGone === 0);
    const errBack = await prisma.rollError.findUniqueOrThrow({ where: { id: err.id }, select: { isProcessed: true, actionTaken: true } });
    check("FULL: RollError yeniden açık", errBack.isProcessed === false && errBack.actionTaken === null);
    const moveOpen = await prisma.rollMovement.count({ where: { rollId: r1, workOrderStepId: stepId, exitedAt: null } });
    check("FULL: movement yeniden açık", moveOpen === 1);
    const woBack = await prisma.workOrder.findUniqueOrThrow({ where: { id: wo.id }, select: { status: true } });
    check("FULL: WO IN_PROGRESS'e dirildi", woBack.status === "IN_PROGRESS");

    // ── Re-finalize (idempotency sıfırlandı kanıtı) + guard ────────────────
    await tambur.finalize({ rollId: r1, cuts: [], decisions: [] }, undefined);
    const kids2 = await prisma.roll.findMany({
      where: { parentRollId: r1, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    made.rollIds.push(...kids2.map((k) => k.id));
    check("re-finalize çalıştı (yeni çocuk doğdu)", kids2.length === 1);

    await prisma.roll.update({ where: { id: kids2[0].id }, data: { currentQty: 95 } });
    const prevBlocked = (await undo.getUndoPreview(kids2[0].id)).data as { canApply: boolean; blockReason: string | null };
    check("guard: metrajı değişen çocuk FULL'ü bloklar", !prevBlocked.canApply && /Metrajı değişmiş/.test(prevBlocked.blockReason ?? ""));
    const applyErr = await expectConflictOr400(undo.applyUndo(kids2[0].id, undefined));
    check("guard: apply de reddediyor (409)", /Metrajı değişmiş|geri alınamaz/i.test(applyErr), applyErr);

    // ── SINGLE: cutOpenFabric parçası ──────────────────────────────────────
    const r2 = await mkRoll("R2", { status: "IN_PRODUCTION", currentStepId: stepId });
    await tambur.cutOpenFabric(r2, { lengthMeters: 30, status: "WAREHOUSE", clientToken: randomUUID() }, undefined);
    const cutKid = await prisma.roll.findFirstOrThrow({ where: { parentRollId: r2 }, select: { id: true } });
    made.rollIds.push(cutKid.id);
    const p2 = (await undo.getUndoPreview(cutKid.id)).data as { mode: string; canApply: boolean };
    check("SINGLE preview: parent yaşıyor → mode=SINGLE", p2.mode === "SINGLE" && p2.canApply);
    await undo.applyUndo(cutKid.id, undefined);
    const r2back = await prisma.roll.findUniqueOrThrow({ where: { id: r2 }, select: { currentQty: true, initialQty: true } });
    const cutKidBack = await prisma.roll.findUniqueOrThrow({ where: { id: cutKid.id }, select: { status: true } });
    check(
      "SINGLE (üretim): parça CANCELLED + parent 100/100",
      cutKidBack.status === "CANCELLED" && Number(r2back.currentQty) === 100 && Number(r2back.initialQty) === 100,
    );

    // ── SINGLE: cutWarehouseRoll parçası (initialQty de geri) ──────────────
    const r3 = await mkRoll("R3", { status: "WAREHOUSE" });
    await tambur.cutWarehouseRoll(r3, { cutLength: 30, clientToken: randomUUID() }, undefined);
    const whKid = await prisma.roll.findFirstOrThrow({ where: { parentRollId: r3 }, select: { id: true } });
    made.rollIds.push(whKid.id);
    const r3mid = await prisma.roll.findUniqueOrThrow({ where: { id: r3 }, select: { currentQty: true, initialQty: true } });
    check("fixture: depo kesimi current VE initial düştü (70/70)", Number(r3mid.currentQty) === 70 && Number(r3mid.initialQty) === 70);
    await undo.applyUndo(whKid.id, undefined);
    const r3back = await prisma.roll.findUniqueOrThrow({ where: { id: r3 }, select: { currentQty: true, initialQty: true } });
    check("SINGLE (depo): parent 100/100'e döndü", Number(r3back.currentQty) === 100 && Number(r3back.initialQty) === 100);

    // ── Negatif ────────────────────────────────────────────────────────────
    const negErr = await expectConflictOr400(undo.getUndoPreview(r3));
    check("negatif: kesim parçası olmayan serbest top → 400", /Tambur kesim|parçası değil/.test(negErr), negErr);
  } finally {
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: made.rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: made.rollIds } } }).catch(() => {});
    await prisma.rollError.deleteMany({ where: { rollId: { in: made.rollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: made.rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { parentRollId: { in: made.rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: made.rollIds } } }).catch(() => {});
    if (made.stepId) await prisma.workOrderStep.deleteMany({ where: { id: made.stepId } }).catch(() => {});
    if (made.woId) await prisma.workOrder.deleteMany({ where: { id: made.woId } }).catch(() => {});
    if (made.defectTypeId) await prisma.defectType.deleteMany({ where: { id: made.defectTypeId } }).catch(() => {});
    if (made.itemId) await prisma.item.deleteMany({ where: { id: made.itemId } }).catch(() => {});
    await prisma.$disconnect();
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
