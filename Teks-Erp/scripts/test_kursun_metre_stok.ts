// =============================================================================
// BEKÇİ — H1b kurşun çıkış metresi stok kipi (`kursun.meterStockMode`) · DALGA2 §3-5, §8 H1b
// Çalıştır: npx tsx scripts/run-all-tests.ts kursun_metre_stok
// =============================================================================
// §1 RECORD (varsayılan): okuma stoğa dokunmaz — currentQty 100, sapma satırı 0, kopya RECORD.
// §2 ⭐ APPLY 100→98,5 ⇒ currentQty 98,5 + RECORD_CORRECTION 1,5 (sourceRefId = okuma).
// §3 ⭐ düzeltme okuması (99) önceki APPLY'ı tersler (reversedAt) ve yenisini uygular ⇒ 99.
// §4 ⭐ APPLY 100→101 ⇒ OVERAGE 1 + initialQty 101 + initialQtyRaise 1; §13 (currentQty > initialQty) 0 satır.
// §4b ⭐ DECLARED_IN tabanı doğuş metresidir (initialQty − Σ aktif initialQtyRaise); initialQty'den okunursa ❌.
// §5 ⭐ sonraki adım qtyIn = aktif OUT; reopenStep ⇒ reversedAt + currentQty 100 (+ initialQty geri).
// §6 ⭐ OFFICE onayı bekleyen okuma stoğa dokunmaz; imza anında uygulanır.
// §7 ⭐ son adım: depo girişi uygulanmış metrajla, stok defteri Σ = durum; yeniden açma ⇒ Σ 0, metraj 100.
// §8 ⭐ elle geri taşıma (Konumu Düzelt) okumayı damgalar ve APPLY'ı tersler; hedef hareketi 100 ile açılır.
// §9 DB seddi: initialQtyRaise OVERAGE dışı satırda reddedilir.
// §10 ayar: geçersiz değer 400 (Türkçe), APPLY/RECORD yazılır; okuma kopyası ayar değişiminden etkilenmez.
// Negatif sondalar (elle, PR gövdesinde): initialQty yükseltmesi kaldırılınca §4 ❌ · ters çağrısı
// (`reverseExitMeterStockTx`) kaldırılınca §3/§5/§7/§8 ❌ (defter ≠ durum).
// =============================================================================
import { randomUUID } from "node:crypto";
import { MachineDataSource, MeterPhase, RollStatus, RollVarianceKind, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { WorkOrderManualMoveService } from "../src/services/workorder-manual-move.service";
import { SETTING_KEYS, systemSettingService } from "../src/services/system-setting.service";
import { VARIANCE_SOURCES } from "../src/constants/variance-reasons";
import { loadDeclaredInTx, loadRollMeterBases } from "../src/services/helpers/kursun-meter-variance-sql.helper";
import { hedefDbEngeli } from "./lib/hedef-db-kapisi";
import { testActorId } from "./fixture-test-user";

const svc = new KursunQcService();
const moveSvc = new WorkOrderManualMoveService();
let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, extra = ""): void {
  if (ok) { pass++; console.log(`✅ ${label}${extra ? " — " + extra : ""}`); }
  else { fail++; console.log(`❌ ${label}${extra ? " — " + extra : ""}`); }
}

async function hata(p: Promise<unknown>): Promise<{ status: number | null; code: unknown; msg: string }> {
  try {
    await p;
    return { status: null, code: null, msg: "" };
  } catch (e) {
    const err = e as { statusCode?: number; details?: { code?: unknown }; message?: string };
    return { status: err.statusCode ?? -1, code: err.details?.code ?? null, msg: err.message ?? String(e) };
  }
}

const KEYS = [
  SETTING_KEYS.KURSUN_METER_CAPTURE,
  SETTING_KEYS.KURSUN_METER_STOCK_MODE,
  SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED,
  SETTING_KEYS.KURSUN_BYPASS_ENABLED,
  SETTING_KEYS.PRODUCTION_ENABLED,
  SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M,
  SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT,
  SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL,
  SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS,
];

async function setFlag(key: string, value: unknown): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key },
    create: { key, value: value as never, description: "TEST kursun_metre_stok" },
    update: { value: value as never },
  });
}

const n = (d: unknown): number => Number(d);

async function main(): Promise<void> {
  const engel = hedefDbEngeli();
  if (engel) throw new Error(engel);

  const STAMP = Date.now().toString(36);
  const admin = { id: await testActorId() };
  const mkStation = (suffix: string) =>
    prisma.station.create({
      data: { code: `TEST-KMS-${suffix}-${STAMP}`.slice(0, 32), name: `TEST KMSTOK ${suffix} ${STAMP}`, type: "INTERNAL", kind: "PROCESS_QC", appliesProperty: true, inspectionEnabled: true },
      select: { id: true },
    });
  const station = await mkStation("K");
  const stationPrev = await mkStation("A");
  const stationNext = await mkStation("N");
  const item = await prisma.item.create({ data: { code: `TEST-KMS-ITM-${STAMP}`, name: `TEST KMSTOK kumaş ${STAMP}`, itemType: "FABRIC" }, select: { id: true } });

  const saved = await prisma.systemSetting.findMany({ where: { key: { in: KEYS } } });
  const tag = `TEST-KMSTOK-${Date.now()}`;
  const woIds: string[] = [];
  const rollIds: string[] = [];

  /**
   * Akışta bir top. `shape`: "single" = yalnız kurşun adımı (son adım) · "next" = kurşun + sonraki adım ·
   * "three" = önceki + kurşun + sonraki (top kurşunda).
   */
  const mkActive = async (shape: "single" | "next" | "three" = "single", qty = 100) => {
    const wo = await prisma.workOrder.create({
      data: { workOrderNumber: `${tag}-WO-${woIds.length}`, status: WorkOrderStatus.IN_PROGRESS },
      select: { id: true },
    });
    woIds.push(wo.id);
    let seq = 1;
    let prevStepId: string | null = null;
    if (shape === "three") {
      prevStepId = (await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: stationPrev.id, stepSequence: seq++, status: StepStatus.COMPLETED }, select: { id: true } })).id;
    }
    const step = await prisma.workOrderStep.create({
      data: { workOrderId: wo.id, stationId: station.id, stepSequence: seq++, status: StepStatus.ACTIVE },
      select: { id: true },
    });
    const nextStepId = shape === "single"
      ? null
      : (await prisma.workOrderStep.create({ data: { workOrderId: wo.id, stationId: stationNext.id, stepSequence: seq++, status: StepStatus.PENDING }, select: { id: true } })).id;
    const r = await prisma.roll.create({
      data: {
        barcode: `${tag}-R-${rollIds.length}`, itemId: item.id, initialQty: qty, currentQty: qty,
        status: RollStatus.IN_PRODUCTION, entrySource: "SUPPLIER_RECEIPT", createdById: admin.id, currentStepId: step.id,
      },
      select: { id: true },
    });
    rollIds.push(r.id);
    await prisma.rollMovement.create({ data: { rollId: r.id, workOrderStepId: step.id, qtyIn: qty, operatorId: admin.id } });
    return { woId: wo.id, stepId: step.id, rollId: r.id, nextStepId, prevStepId };
  };

  const meter = (meters: number, clientToken = randomUUID()) =>
    ({ meters, source: MachineDataSource.MACHINE, clientToken, rawCounter: null, peripheralId: null, cardSampleId: null });
  const qc2 = (rollId: string, stepId: string, meters: number) =>
    svc.completeQc2({ rollId, stepId, meterOut: meter(meters) } as never, admin.id, null);
  const rollOf = (id: string) => prisma.roll.findUniqueOrThrow({ where: { id }, select: { currentQty: true, initialQty: true, status: true } });
  const variances = (rollId: string) =>
    prisma.rollVariance.findMany({ where: { rollId, source: VARIANCE_SOURCES.KURSUN_EXIT_MEASURE }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const activeOut = (rollId: string, stepId: string) =>
    prisma.rollMeterReading.findFirst({ where: { rollId, workOrderStepId: stepId, phase: MeterPhase.OUT, revokedAt: null } });
  const ledgerNet = async (rollId: string): Promise<number> => {
    const rows = await prisma.warehouseMovement.findMany({ where: { rollId }, select: { qty: true, toWarehouseId: true, fromWarehouseId: true } });
    return rows.reduce((s, m) => s + (m.toWarehouseId ? n(m.qty) : 0) - (m.fromWarehouseId ? n(m.qty) : 0), 0);
  };

  try {
    await setFlag(SETTING_KEYS.PRODUCTION_ENABLED, true);
    await setFlag(SETTING_KEYS.KURSUN_BYPASS_ENABLED, false);
    await setFlag(SETTING_KEYS.KURSUN_SIMULATED_METER_ENABLED, false);
    await setFlag(SETTING_KEYS.KURSUN_METER_CAPTURE, "OUT");
    await prisma.systemSetting.deleteMany({
      where: { key: { in: [SETTING_KEYS.KURSUN_METER_STOCK_MODE, SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_PCT, SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, SETTING_KEYS.KURSUN_METER_VARIANCE_BASIS] } },
    });

    // ── §1 RECORD (varsayılan) ────────────────────────────────────────────────
    {
      const a = await mkActive();
      await qc2(a.rollId, a.stepId, 98.5);
      const r = await rollOf(a.rollId);
      const out = await activeOut(a.rollId, a.stepId);
      const v = await variances(a.rollId);
      check("§1 RECORD (varsayılan): okuma stoğa dokunmaz — metraj 100, sapma 0, kopya RECORD",
        n(r.currentQty) === 100 && v.length === 0 && out?.stockMode === "RECORD", `qty=${n(r.currentQty)} sapma=${v.length} kip=${out?.stockMode}`);
    }

    await setFlag(SETTING_KEYS.KURSUN_METER_STOCK_MODE, "APPLY");

    // ── §2/§3 APPLY eksi + düzeltme ───────────────────────────────────────────
    {
      const a = await mkActive();
      await qc2(a.rollId, a.stepId, 98.5);
      const r = await rollOf(a.rollId);
      const out = await activeOut(a.rollId, a.stepId);
      const v = await variances(a.rollId);
      check("§2 ⭐ APPLY 100→98,5 ⇒ metraj 98,5 + RECORD_CORRECTION 1,5 (sourceRefId = okuma)",
        n(r.currentQty) === 98.5 && n(r.initialQty) === 100 && v.length === 1 && v[0]!.kind === RollVarianceKind.RECORD_CORRECTION && n(v[0]!.qty) === 1.5 && v[0]!.sourceRefId === out?.id && v[0]!.workOrderStepId === a.stepId,
        `qty=${n(r.currentQty)} sapma=${v.map((x) => `${x.kind}:${n(x.qty)}`).join(",")}`);

      await svc.recordMeterReading({ rollId: a.rollId, stepId: a.stepId, phase: MeterPhase.OUT, input: meter(99) }, admin.id, null);
      const r2 = await rollOf(a.rollId);
      const v2 = await variances(a.rollId);
      const out2 = await activeOut(a.rollId, a.stepId);
      check("§3 ⭐ düzeltme okuması önceki APPLY'ı tersler, yenisini uygular ⇒ metraj 99",
        n(r2.currentQty) === 99 && v2.length === 2 && v2[0]!.reversedAt != null && v2[1]!.reversedAt == null && n(v2[1]!.qty) === 1 && v2[1]!.sourceRefId === out2?.id,
        `qty=${n(r2.currentQty)} sapma=${v2.map((x) => `${x.kind}:${n(x.qty)}:${x.reversedAt ? "T" : "A"}`).join(",")}`);
    }

    // ── §4 APPLY artı ─────────────────────────────────────────────────────────
    {
      const a = await mkActive();
      const e = await hata(qc2(a.rollId, a.stepId, 101));
      const r = await rollOf(a.rollId);
      const v = await variances(a.rollId);
      const s13 = await prisma.roll.count({ where: { id: { in: rollIds } } }) > 0
        ? (await prisma.$queryRaw<{ c: bigint }[]>`SELECT count(*) AS c FROM rolls WHERE id = ANY(${rollIds}::uuid[]) AND "currentQty" > "initialQty"`)[0]!.c
        : -1n;
      check("§4 ⭐ APPLY 100→101 ⇒ OVERAGE 1 + initialQty 101 + initialQtyRaise 1; §13 (currentQty > initialQty) 0 satır",
        e.status === null && n(r.currentQty) === 101 && n(r.initialQty) === 101 && v.length === 1 && v[0]!.kind === RollVarianceKind.OVERAGE && n(v[0]!.qty) === 1 && n(v[0]!.initialQtyRaise) === 1 && s13 === 0n,
        `hata=${e.msg.slice(0, 120)} qty=${n(r.currentQty)}/${n(r.initialQty)} §13=${s13}`);
      const declTs = await loadDeclaredInTx(prisma, a.rollId);
      const declList = (await loadRollMeterBases(prisma, a.stepId, [a.rollId])).get(a.rollId)?.declaredIn ?? null;
      check("§4b ⭐ DECLARED_IN tabanı doğuş metresinden (belge satırı yok): initialQty 101 iken taban 100 (TS + SQL ikizi)",
        n(declTs) === 100 && declList === 100, `ts=${n(declTs)} sql=${declList}`);
    }

    // ── §5 sonraki adım qtyIn + reopen ────────────────────────────────────────
    {
      const a = await mkActive("next");
      await qc2(a.rollId, a.stepId, 98.5);
      await svc.finishStep({ stepId: a.stepId }, admin.id, null);
      const nextMv = await prisma.rollMovement.findFirst({ where: { rollId: a.rollId, workOrderStepId: a.nextStepId!, revokedAt: null, exitedAt: null } });
      const thisMv = await prisma.rollMovement.findFirst({ where: { rollId: a.rollId, workOrderStepId: a.stepId, revokedAt: null } });
      check("§5a ⭐ sonraki adım qtyIn = aktif OUT (98,5); bu adımın qtyOut = qtyIn (100)",
        n(nextMv?.qtyIn) === 98.5 && n(thisMv?.qtyOut) === 100 && n(thisMv?.qtyIn) === 100, `next.qtyIn=${n(nextMv?.qtyIn)} qtyOut=${n(thisMv?.qtyOut)}`);
      const e = await hata(svc.reopenStep({ stepId: a.stepId }, admin.id));
      const r = await rollOf(a.rollId);
      const v = await variances(a.rollId);
      const out = await activeOut(a.rollId, a.stepId);
      check("§5b ⭐ reopen ⇒ okuma damgalı + sapma reversedAt + metraj 100",
        e.status === null && out == null && v.length === 1 && v[0]!.reversedAt != null && n(r.currentQty) === 100,
        `hata=${e.msg.slice(0, 120)} qty=${n(r.currentQty)} sapma=${v.map((x) => (x.reversedAt ? "T" : "A")).join(",")}`);
    }
    {
      const a = await mkActive("next");
      await qc2(a.rollId, a.stepId, 101);
      await svc.finishStep({ stepId: a.stepId }, admin.id, null);
      await svc.reopenStep({ stepId: a.stepId }, admin.id);
      const r = await rollOf(a.rollId);
      check("§5c ⭐ artı yönde reopen ⇒ metraj 100 ve initialQty 100 (yükseltme geri iner)", n(r.currentQty) === 100 && n(r.initialQty) === 100, `${n(r.currentQty)}/${n(r.initialQty)}`);
    }

    // ── §6 OFFICE onayı bekleyen okuma ────────────────────────────────────────
    {
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, 1);
      await setFlag(SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL, "OFFICE");
      const a = await mkActive();
      await qc2(a.rollId, a.stepId, 95);
      const r = await rollOf(a.rollId);
      const v = await variances(a.rollId);
      check("§6a ⭐ onay bekleyen okuma stoğa dokunmaz (metraj 100, sapma 0)", n(r.currentQty) === 100 && v.length === 0, `qty=${n(r.currentQty)} sapma=${v.length}`);
      const out = await activeOut(a.rollId, a.stepId);
      await svc.ackMeterReading({ readingId: out!.id, mode: "OFFICE", reason: { reasonText: "TEST onay" } }, admin.id);
      const r2 = await rollOf(a.rollId);
      const v2 = await variances(a.rollId);
      check("§6b ⭐ ofis imzası anında uygulanır ⇒ metraj 95 + RECORD_CORRECTION 5", n(r2.currentQty) === 95 && v2.length === 1 && n(v2[0]!.qty) === 5, `qty=${n(r2.currentQty)}`);
      await prisma.systemSetting.deleteMany({ where: { key: { in: [SETTING_KEYS.KURSUN_METER_VARIANCE_THRESHOLD_M, SETTING_KEYS.KURSUN_METER_VARIANCE_APPROVAL] } } });
    }

    // ── §7 son adım: depo girişi + stok defteri = durum ───────────────────────
    {
      const a = await mkActive("single");
      await qc2(a.rollId, a.stepId, 98.5);
      await svc.finishStep({ stepId: a.stepId }, admin.id, null);
      const r = await rollOf(a.rollId);
      const net = await ledgerNet(a.rollId);
      check("§7a ⭐ son adım kapanışı: depoya uygulanmış metrajla girer, stok defteri Σ = durum (98,5)",
        r.status !== RollStatus.IN_PRODUCTION && n(r.currentQty) === 98.5 && net === 98.5, `durum=${r.status} qty=${n(r.currentQty)} Σ=${net}`);
      await svc.reopenStep({ stepId: a.stepId }, admin.id);
      const r2 = await rollOf(a.rollId);
      const net2 = await ledgerNet(a.rollId);
      check("§7b ⭐ yeniden açma: üretimde, metraj 100, stok defteri Σ 0", r2.status === RollStatus.IN_PRODUCTION && n(r2.currentQty) === 100 && net2 === 0, `durum=${r2.status} qty=${n(r2.currentQty)} Σ=${net2}`);
    }

    // ── §8 elle geri taşıma ───────────────────────────────────────────────────
    {
      const a = await mkActive("three");
      await qc2(a.rollId, a.stepId, 98.5);
      await svc.finishStep({ stepId: a.stepId }, admin.id, null);
      const e = await hata(moveSvc.manualMove(a.woId, { rollIds: [a.rollId], targetStepId: a.prevStepId!, reason: "TEST geri taşıma" }, admin.id));
      const r = await rollOf(a.rollId);
      const v = await variances(a.rollId);
      const out = await activeOut(a.rollId, a.stepId);
      const tgt = await prisma.rollMovement.findFirst({ where: { rollId: a.rollId, workOrderStepId: a.prevStepId!, revokedAt: null, exitedAt: null } });
      check("§8 ⭐ elle geri taşıma: okuma damgalı + APPLY terslendi (metraj 100) + hedef hareketi 100 ile açıldı",
        e.status === null && out == null && v.length === 1 && v[0]!.reversedAt != null && n(r.currentQty) === 100 && n(tgt?.qtyIn) === 100,
        `hata=${e.msg.slice(0, 160)} qty=${n(r.currentQty)} hedef.qtyIn=${n(tgt?.qtyIn)}`);
    }

    // ── §9 DB seddi ───────────────────────────────────────────────────────────
    {
      const e = await hata(prisma.$executeRaw`
        INSERT INTO roll_variances (id, "rollId", kind, qty, source, "initialQtyRaise")
        VALUES (gen_random_uuid(), ${rollIds[0]}::uuid, 'SCRAP', 1, 'TEST', 1)`);
      check("§9 DB seddi: initialQtyRaise OVERAGE dışı satırda reddedilir", e.status !== null && /roll_variances_initial_qty_raise_ck/.test(e.msg), e.msg.slice(0, 120));
    }

    // ── §10 ayar ucu ──────────────────────────────────────────────────────────
    {
      const e = await hata(systemSettingService.setFeatureFlags({ kursunMeterStockMode: "HEPSI" } as never, admin.id));
      check("§10a geçersiz kip 400 (Türkçe mesaj)", e.status === 400 && /şunlardan biri olmalı/.test(e.msg), `${e.status} ${e.msg}`);
      await systemSettingService.setFeatureFlags({ kursunMeterStockMode: "RECORD" } as never, admin.id);
      const ff = (await systemSettingService.getFeatureFlags()).data as unknown as Record<string, unknown>;
      check("§10b RECORD yazılır ve okunur", ff.kursunMeterStockMode === "RECORD", String(ff.kursunMeterStockMode));
      const prior = await prisma.rollMeterReading.findFirst({ where: { rollId: { in: rollIds }, stockMode: "APPLY" }, select: { id: true } });
      check("§10c okuma kopyası ayar değişiminden etkilenmez (APPLY satırı APPLY kalır)", prior != null);
    }
  } finally {
    await prisma.rollMeterAck.deleteMany({ where: { reading: { rollId: { in: rollIds } } } }).catch(() => {});
    await prisma.rollMeterReading.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds }, reversesMovementId: { not: null } } }).catch(() => {});
    await prisma.warehouseMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollVariance.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: rollIds } } }).catch(() => {});
    await prisma.roll.deleteMany({ where: { id: { in: rollIds } } }).catch(() => {});
    await prisma.batch.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: woIds } } }).catch(() => {});
    await prisma.systemLog.deleteMany({ where: { recordId: { in: [...woIds, ...rollIds] } } }).catch(() => {});
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => {});
    await prisma.station.deleteMany({ where: { id: { in: [station.id, stationPrev.id, stationNext.id] } } }).catch(() => {});
    await prisma.item.deleteMany({ where: { id: item.id } }).catch(() => {});
    await prisma.systemSetting.deleteMany({ where: { key: { in: KEYS } } });
    for (const s of saved) {
      await prisma.systemSetting.create({ data: { key: s.key, value: s.value as never, description: s.description } });
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
