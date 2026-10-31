// =============================================================================
// BEKÇİ — D4-E2a en ölçen istasyon yeteneği (Station.capturesWidth) · DALGA4 §6.4–6.5, K10
// Çalıştır: npx tsx scripts/test_en_olcen_istasyon.ts
// =============================================================================
// §1 ⭐ alan yok → en değişmez, QC2 satırında en izi yok (bayt-aynı: metadata eski biçim).
// §2 ⭐ yeteneksiz istasyona en → 400 WIDTH_CAPTURE_DISABLED; en ve satır değişmez.
// §3 ⭐ eşik dışı (> mevcut + eşik, ≤ 0) → 400 WIDTH_OUT_OF_RANGE; en değişmez.
// §4 ⭐ yetenekli istasyonda 300 → 280: Roll.width 280 + iz widthBefore/widthAfter; replay aynı
//    değer no-op, farklı değer 409 WIDTH_ALREADY_RECORDED.
// §5 ⭐ Tambur kapısı yeni enle: 300'lük iş emri + 280 en → eşik 10'da PLAN_MISMATCH, 25'te geçer.
// §6 ⭐ adım yeniden açma (reopenStep) eni geri koyar, en izli QC2 satırı WIDTH_REOPEN ile damgalanır.
// §7 ⭐ Düzelt sonrası ters yol: ölçümden sonra Düzelt eni değiştirdiyse ters yol ROLL_CHANGED verir, en ezilmez.
// §8 kursunFinish (açık kumaş) yolu aynı sözleşme: en yazılır + iz QC2 satırında.
// §9 ⭐ ensiz KK2 → bitir → yeniden aç → enli KK2: izsiz satır WIDTH_REMEASURE ile damgalanır, en yazılır
//    (çıkışsız 409 döngüsü yok).
// §10 ⭐ kursunFinish örtüşen çift çağrı aynı enle: ikisi de başarılı, tek izli aktif satır (idempotent).
// §11 ⭐ adım özeti (getStep) capturesWidth yalnız yetenekli istasyonda taşır (tablet alanı buna bağlı);
//     §11c–e top başına widthLimit (D4-KUC3b; tablet eşik dışı eni istek göndermeden uyarır).
// Negatif sonda (2026-10-30, elle; PR gövdesinde): restoreMeasuredWidthsTx WHERE'inden
// `width: trace.widthAfter` çıkarılınca §7a/§7b ❌. (2026-10-31) izsiz satırda damga yerine 409 → §9a/§9b ❌;
// kursunFinish SAME dalı kapatılınca §10a ❌ (WIDTH_ALREADY_RECORDED).
// =============================================================================
import { Prisma, RollOperationType, RollStatus, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { InventoryService } from "../src/services/inventory.service";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { assertRollMatchesPlan } from "../src/services/helpers/tambur-plan-gate.helper";
import { revokeRollOperations } from "../src/services/helpers/roll-operation.helper";
import { AppError } from "../src/utils/app-error";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

const svc = new KursunQcService();
const inv = new InventoryService();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

const KEYS = [
  SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM,
  SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK,
  SETTING_KEYS.KURSUN_METER_CAPTURE,
  SETTING_KEYS.KURSUN_BYPASS_ENABLED,
  SETTING_KEYS.PRODUCTION_ENABLED,
];

async function setFlag(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never, description: "TEST en_olcen_istasyon" },
    update: { value: value as never },
  });
}

/** Hata kodu (`details.code`) + HTTP durumu; hata yoksa null. */
async function errOf(p: Promise<unknown>): Promise<{ status: number; code: unknown } | null> {
  try { await p; return null; } catch (e) {
    if (e instanceof AppError) return { status: e.statusCode, code: e.details?.code };
    return { status: -1, code: (e as Error).message.slice(0, 160) };
  }
}

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  const STAMP = Date.now().toString(36);
  const admin = { id: await testActorId() };
  const mkStation = (suffix: string, capturesWidth: boolean) =>
    prisma.station.create({
      data: { code: `TEST-EOI-${suffix}-${STAMP}`.slice(0, 32), name: `TEST ENOLCER ${suffix} ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true, appliesQuality: true, capturesWidth },
      select: { id: true },
    });
  const stCap = await mkStation("C", true);
  const stPlain = await mkStation("P", false);
  const stNext = await mkStation("N", false);
  const stationIds = [stCap.id, stPlain.id, stNext.id];
  const item = await prisma.item.create({ data: { code: `TEST-EOI-ITM-${STAMP}`, name: `TEST ENOLCER kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });
  const saved = await prisma.systemSetting.findMany({ where: { key: { in: KEYS } } });
  const tag = `TEST-EOI-${STAMP}`.toUpperCase();
  const woIds: string[] = [];
  const rollIds: string[] = [];

  /** Akışta tek top (en 300): ölçüm adımı + sonraki adım; `barcode=false` açık kumaş. */
  const mkRoll = async (stationId: string, opts: { barcode?: boolean } = {}) => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${tag}-WO-${woIds.length}`, status: WorkOrderStatus.IN_PROGRESS, width: new Prisma.Decimal(300) },
      select: { id: true },
    });
    woIds.push(wo.id);
    const step = await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId, stepSequence: 1, status: StepStatus.ACTIVE }, select: { id: true } });
    await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: stNext.id, stepSequence: 2, status: StepStatus.PENDING } });
    const r = await prisma.roll.create({
      data: {
        barcode: opts.barcode === false ? null : `${tag}-R-${rollIds.length}`, itemId: item.id, initialQty: 100, currentQty: 100,
        width: new Prisma.Decimal(300),
        status: RollStatus.IN_PRODUCTION, entrySource: "SUPPLIER_RECEIPT", createdById: admin.id, currentStepId: step.id,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: step.id, qtyIn: 100, operatorId: admin.id } });
    return { woId: wo.id, stepId: step.id, rollId: r.id };
  };
  const widthOf = async (id: string): Promise<number | null> => {
    const r = await prisma.roll.findUniqueOrThrow({ where: { id }, select: { width: true } });
    return r.width == null ? null : Number(r.width);
  };
  const qc2Ops = (rollId: string, stepId: string) =>
    prisma.rollOperation.findMany({ where: { rollId, workOrderStepId: stepId, operationType: RollOperationType.QC2_COMPLETED }, orderBy: { createdAt: "asc" } });
  const meta = (m: unknown) => (m ?? {}) as Record<string, unknown>;

  try {
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.KURSUN_BYPASS_ENABLED, false);
    await setFlag(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_CHECK, "ENFORCE");
    await setFlag(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, 10);
    await prisma.systemSetting.deleteMany({ where: { key: SETTING_KEYS.KURSUN_METER_CAPTURE } });

    // §1 alan yok — yetenekli istasyonda bile en değişmez, iz yok.
    {
      const a = await mkRoll(stCap.id);
      await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, notes: "n1" }, admin.id, null);
      const ops = await qc2Ops(a.rollId, a.stepId);
      check("§1a ⭐ alan yok: en 300 kalır", (await widthOf(a.rollId)) === 300);
      check("§1b ⭐ alan yok: QC2 metadata eski biçim ({notes}) — en izi yok", ops.length === 1 && JSON.stringify(ops[0].metadata) === JSON.stringify({ notes: "n1" }), JSON.stringify(ops[0]?.metadata));
    }

    // §2 yeteneksiz istasyon
    {
      const a = await mkRoll(stPlain.id);
      const e = await errOf(svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, measuredWidthCm: 280 }, admin.id, null));
      check("§2a ⭐ yeteneksiz istasyon → 400 WIDTH_CAPTURE_DISABLED", e?.status === 400 && e.code === "WIDTH_CAPTURE_DISABLED", JSON.stringify(e));
      check("§2b en değişmedi, QC2 satırı doğmadı", (await widthOf(a.rollId)) === 300 && (await qc2Ops(a.rollId, a.stepId)).length === 0);
    }

    // §3 eşik dışı
    {
      const a = await mkRoll(stCap.id);
      const hi = await errOf(svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, measuredWidthCm: 311 }, admin.id, null));
      check("§3a ⭐ 311 > 300 + 10 → 400 WIDTH_OUT_OF_RANGE", hi?.status === 400 && hi.code === "WIDTH_OUT_OF_RANGE", JSON.stringify(hi));
      const zero = await errOf(svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, measuredWidthCm: 0 }, admin.id, null));
      check("§3b 0 → 400 WIDTH_OUT_OF_RANGE", zero?.status === 400 && zero.code === "WIDTH_OUT_OF_RANGE", JSON.stringify(zero));
      check("§3c en değişmedi, QC2 satırı doğmadı", (await widthOf(a.rollId)) === 300 && (await qc2Ops(a.rollId, a.stepId)).length === 0);
      await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, measuredWidthCm: 310 }, admin.id, null);
      check("§3d sınır (300 + 10 = 310) geçer", (await widthOf(a.rollId)) === 310);
    }

    // §4 300 → 280 + iz; replay
    const m = await mkRoll(stCap.id);
    {
      await svc.completeQc2({ rollId: m.rollId, stepId: m.stepId, measuredWidthCm: 280 }, admin.id, null);
      const ops = await qc2Ops(m.rollId, m.stepId);
      const md = meta(ops[0]?.metadata);
      check("§4a ⭐ Roll.width 300 → 280", (await widthOf(m.rollId)) === 280);
      check("§4b ⭐ iz: widthBefore 300 · widthAfter 280", ops.length === 1 && md.widthBefore === 300 && md.widthAfter === 280, JSON.stringify(md));
      await svc.completeQc2({ rollId: m.rollId, stepId: m.stepId, measuredWidthCm: 280 }, admin.id, null);
      check("§4c replay (aynı değer) no-op: tek satır, en 280", (await qc2Ops(m.rollId, m.stepId)).length === 1 && (await widthOf(m.rollId)) === 280);
      const diff = await errOf(svc.completeQc2({ rollId: m.rollId, stepId: m.stepId, measuredWidthCm: 270 }, admin.id, null));
      check("§4d farklı değer → 409 WIDTH_ALREADY_RECORDED, en 280 kalır", diff?.status === 409 && diff.code === "WIDTH_ALREADY_RECORDED" && (await widthOf(m.rollId)) === 280, JSON.stringify(diff));
    }

    // §5 Tambur kapısı yeni enle
    {
      const roll = await prisma.roll.findUniqueOrThrow({ where: { id: m.rollId }, select: { id: true, barcode: true, colorId: true, width: true } });
      const wo = await prisma.workOrder.findUniqueOrThrow({ where: { id: m.woId }, select: { id: true, targetColorId: true, width: true } });
      const plan = { workOrderId: wo.id, targetColorId: wo.targetColorId, width: wo.width };
      const e10 = await errOf(assertRollMatchesPlan(roll, plan, false, admin.id, "test"));
      check("§5a ⭐ eşik 10: 300'lük iş emri + 280 en → 409 PLAN_MISMATCH", e10?.status === 409 && e10.code === "PLAN_MISMATCH", JSON.stringify(e10));
      await setFlag(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, 25);
      const ok25 = await assertRollMatchesPlan(roll, plan, false, admin.id, "test").then((x) => x.length === 0).catch(() => false);
      check("§5b ⭐ eşik 25: geçer (sapma yok)", ok25);
      await setFlag(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, 10);
    }

    // §6 reopenStep eni geri koyar
    {
      await svc.finishStep({ stepId: m.stepId }, admin.id, null);
      await svc.reopenStep({ stepId: m.stepId }, admin.id);
      const ops = await qc2Ops(m.rollId, m.stepId);
      check("§6a ⭐ reopen: en 280 → 300 geri", (await widthOf(m.rollId)) === 300);
      check("§6b ⭐ en izli QC2 satırı damgalandı (WIDTH_REOPEN), silinmedi", ops.length === 1 && ops[0].revokedAt != null && ops[0].revokeReason === "WIDTH_REOPEN");
      await svc.completeQc2({ rollId: m.rollId, stepId: m.stepId, measuredWidthCm: 285 }, admin.id, null);
      const after = await qc2Ops(m.rollId, m.stepId);
      check("§6c yeniden ölçüm yeni satır doğurur (300 → 285)", after.length === 2 && (await widthOf(m.rollId)) === 285 && meta(after[1].metadata).widthBefore === 300);
    }

    // §7 Düzelt sonrası ters yol
    {
      const a = await mkRoll(stCap.id);
      await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, measuredWidthCm: 280 }, admin.id, null);
      await prisma.roll.update({ where: { id: a.rollId }, data: { width: new Prisma.Decimal(290) } }); // araya giren Düzelt
      const e = await errOf(prisma.$transaction((tx) => revokeRollOperations(tx, { rollIds: [a.rollId], reason: "TEST_VOID", userId: admin.id })));
      check("§7a ⭐ ters yol → 409 ROLL_CHANGED", e?.status === 409 && e.code === "ROLL_CHANGED", JSON.stringify(e));
      const ops = await qc2Ops(a.rollId, a.stepId);
      check("§7b ⭐ Düzelt'in eni (290) ezilmedi, satır damgalanmadı (tx geri sarıldı)", (await widthOf(a.rollId)) === 290 && ops[0]?.revokedAt == null);
      // Düzelt geri alınınca (en = widthAfter) ters yol geçer.
      await prisma.roll.update({ where: { id: a.rollId }, data: { width: new Prisma.Decimal(280) } });
      const n = await prisma.$transaction((tx) => revokeRollOperations(tx, { rollIds: [a.rollId], reason: "TEST_VOID", userId: admin.id }));
      check("§7c en = widthAfter iken ters yol eni 300'e koyar + satırı damgalar", n === 1 && (await widthOf(a.rollId)) === 300);
    }

    // §8 kursunFinish (açık kumaş) aynı sözleşme
    {
      const a = await mkRoll(stCap.id, { barcode: false });
      await inv.kursunFinish(a.rollId, { measuredWidthCm: 275 }, admin.id, null);
      const ops = await qc2Ops(a.rollId, a.stepId);
      const md = meta(ops[0]?.metadata);
      check("§8a ⭐ kursunFinish: en 300 → 275 + iz QC2 satırında", (await widthOf(a.rollId)) === 275 && md.widthBefore === 300 && md.widthAfter === 275, JSON.stringify(md));
      const b = await mkRoll(stPlain.id, { barcode: false });
      const e = await errOf(inv.kursunFinish(b.rollId, { measuredWidthCm: 275 }, admin.id, null));
      check("§8b kursunFinish yeteneksiz istasyon → 400 WIDTH_CAPTURE_DISABLED", e?.status === 400 && e.code === "WIDTH_CAPTURE_DISABLED", JSON.stringify(e));
    }

    // §9 ensiz KK2 → reopen → enli KK2 (çıkışsız döngü olmamalı)
    {
      const a = await mkRoll(stCap.id);
      await svc.completeQc2({ rollId: a.rollId, stepId: a.stepId }, admin.id, null);
      await svc.finishStep({ stepId: a.stepId }, admin.id, null);
      await svc.reopenStep({ stepId: a.stepId }, admin.id);
      const e = await errOf(svc.completeQc2({ rollId: a.rollId, stepId: a.stepId, measuredWidthCm: 280 }, admin.id, null));
      const ops = await qc2Ops(a.rollId, a.stepId);
      const active = ops.filter((o) => o.revokedAt == null);
      check("§9a ⭐ ensiz kapanmış adımda yeniden açınca enli KK2 geçer (409 yok), en 280", e == null && (await widthOf(a.rollId)) === 280, JSON.stringify(e));
      check(
        "§9b ⭐ izsiz satır WIDTH_REMEASURE ile damgalandı (silinmedi), tek aktif satır izli",
        ops.length === 2 && ops[0].revokeReason === "WIDTH_REMEASURE" && active.length === 1 && meta(active[0].metadata).widthAfter === 280,
        JSON.stringify(ops.map((o) => [o.revokeReason, o.metadata])),
      );
    }

    // §11 D4-E2b: adım özeti tablete yeteneği söyler; kapalı istasyonda anahtar YOK (bayt-aynı).
    {
      const c = await mkRoll(stCap.id);
      const p = await mkRoll(stPlain.id);
      const capSum = (await svc.getStep(c.stepId)).data as unknown as Record<string, unknown>;
      const plainSum = (await svc.getStep(p.stepId)).data as unknown as Record<string, unknown>;
      check("§11a ⭐ en ölçen istasyon adımı: capturesWidth=true", capSum.capturesWidth === true, String(capSum.capturesWidth));
      check("§11b ⭐ en ölçmeyen istasyon adımı: capturesWidth anahtarı YOK", !("capturesWidth" in plainSum), String(plainSum.capturesWidth));
      // D4-KUC3b: tablet ön-denetimi sınırı sunucudan alır — yazım kapısıyla aynı hesap (mevcut en + ayar eşiği).
      const capRoll = (capSum.rolls as Record<string, unknown>[]).find((r) => r.rollId === c.rollId);
      const plainRoll = (plainSum.rolls as Record<string, unknown>[]).find((r) => r.rollId === p.rollId);
      check(
        "§11c ⭐ en ölçen adımda top widthLimit = {300, eşik 10, üst 310}",
        JSON.stringify(capRoll?.widthLimit) === JSON.stringify({ widthBefore: 300, toleranceCm: 10, maxCm: 310 }),
        JSON.stringify(capRoll?.widthLimit),
      );
      check("§11d ⭐ en ölçmeyen adımda widthLimit anahtarı YOK (bayt-aynı)", !!plainRoll && !("widthLimit" in plainRoll), JSON.stringify(plainRoll));
      await setFlag(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, 25);
      const capSum25 = (await svc.getStep(c.stepId)).data as unknown as Record<string, unknown>;
      await setFlag(SETTING_KEYS.TAMBUR_PLAN_GATE_WIDTH_TOLERANCE_CM, 10);
      const capRoll25 = (capSum25.rolls as Record<string, unknown>[]).find((r) => r.rollId === c.rollId);
      check("§11e ⭐ eşik ayarı 25 → üst sınır 325 (sınır ayardan, kopya eşik yok)", (capRoll25?.widthLimit as { maxCm?: number } | undefined)?.maxCm === 325, JSON.stringify(capRoll25?.widthLimit));
    }

    // §10 kursunFinish örtüşen çift çağrı (zaman aşımı sonrası yeniden deneme) aynı enle
    {
      const a = await mkRoll(stCap.id, { barcode: false });
      const both = await Promise.allSettled([
        inv.kursunFinish(a.rollId, { measuredWidthCm: 275 }, admin.id, null),
        inv.kursunFinish(a.rollId, { measuredWidthCm: 275 }, admin.id, null),
      ]);
      const rejected = both.filter((x) => x.status === "rejected").map((x) => String((x as PromiseRejectedResult).reason?.details?.code ?? (x as PromiseRejectedResult).reason));
      const active = (await qc2Ops(a.rollId, a.stepId)).filter((o) => o.revokedAt == null);
      check("§10a ⭐ ikisi de başarılı (ikincisi idempotent, 409 yok)", rejected.length === 0, JSON.stringify(rejected));
      check("§10b ⭐ tek izli aktif QC2 satırı, en 275", active.length === 1 && meta(active[0].metadata).widthAfter === 275 && (await widthOf(a.rollId)) === 275);
    }
  } finally {
    await prisma.rollPlanDeviation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollError.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...rollIds] } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: stationIds } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    await prisma.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
    for (const x of saved) {
      await prisma.systemSetting.create({ data: { key: x.key, value: x.value as never, description: x.description } });
    }
  }
}

main()
  .then(async () => {
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = fail > 0 ? 1 : 0;
  })
  .catch(async (err) => {
    console.error("HATA:", err);
    console.log(`\n=== Sonuç: ${pass} geçti, ${fail + 1} başarısız ===`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
