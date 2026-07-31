// =============================================================================
// Kurşun Dağıtım (Kurşun Bypass) — kapsamlı entegrasyon testi
// =============================================================================
// Fabrika kurşun istasyonlarına TABLET KOYMUYOR: kurşun fiziksel olarak yapılır
// ama dijital izlenmez (hatalar kâğıtta). Yetkili personel kurşun adımını
// fiziksel bir istasyona ATAR; adım ya Tambur'da refakat kartı okutmasıyla
// (TAMBUR_SCAN) ya da kurşun rotanın SON adımıysa dağıtım ekranındaki
// "İşi Bitir" ile (DISTRIBUTION_LAST_STEP) kapanır.
//
// ⚠️ BU "SKIPPED" DEĞİLDİR — movement'lar normal şekilde kapanır ve adım
// COMPLETED olur; fark `RollOperation` yazılmaması + `RollError` açılmamasıdır.
//
// Kapsanan senaryolar:
//   1  Bayrak kapalı → assign 400; bayrak açık → assign OK + adım REPOINT
//   2  Re-assign (originalStationId sabit) + iptal (istasyon geri yüklenir)
//   3  Yarım-başlama redleri (QC2 op / RollError / bypass-dışı kapanış / qtyIn=0)
//   4  Tablet guard'ları (finishStep · completeQc2 · reportError · kursunFinish)
//   5  getTamburContext 400 ATMIYOR + `bypassPending` dolu
//   8  Kapsam uyuşmazlığı (fazladan/eksik rollId) → 409 + tam rollback
//   6  Happy path completeFromTambur (marker, yetenek, kalite NULL, COMPLETED)
//   7  İdempotency (tekrar çağrı → alreadyDone, mükerrer movement YOK)
//  11  Çok-tur: 2. parti geldiğinde aynı adım YENİDEN dağıtılabilir
//  12  Bayrak tamamlamayı kapılamıyor (dağıtım sonrası kapatılsa da biter)
//   9  Son-adım rotası: completeFromDistribution → WAREHOUSE + barkod + WO COMPLETED
//  10  Eşzamanlılık: paralel assign tek satır bırakır + partial unique seddi
//
// Fixture'ı TEST KENDİ YARATIR (master data business-key ile çözülür, hardcoded
// UUID yok); `TEST-` prefix'li her şey finally'de sökülür. Global ayar
// (`production.kursunBypassEnabled`) test başında yedeklenip sonunda ESKİ HÂLİNE
// döndürülür — dev DB'sinin konfigürasyonu bozulmaz.
//
// Koşum: npx tsx scripts/test_kursun_bypass.ts
// =============================================================================

import {
  KursunBypassCompletionSource,
  Prisma,
  RollForm,
  RollOperationType,
  RollStatus,
  StationKind,
  StepStatus,
  TravelerCardStatus,
  WorkOrderStatus,
} from "@prisma/client";
import prisma, { pool } from "../src/lib/prisma";
import {
  KursunBypassService,
  KURSUN_BYPASS_MARKER_PREFIX,
} from "../src/services/kursun-bypass.service";
import { KursunQcService } from "../src/services/kursun-qc.service";
import { InventoryService } from "../src/services/inventory.service";
import { TamburService } from "../src/services/tambur.service";
import { recomputeStepStatus } from "../src/services/helpers/roll-step.helper";
import { SETTING_KEYS } from "../src/services/system-setting.service";
import { AppError } from "../src/utils/app-error";

const bypassSvc = new KursunBypassService();
const qcSvc = new KursunQcService();
const invSvc = new InventoryService();
const tamburSvc = new TamburService();

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, extra = ""): void {
  if (ok) {
    pass++;
    console.log(`✅ ${label}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`❌ ${label}${extra ? " — " + extra : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n── ${title} ──`);
}

/** Beklenen HTTP statüsüyle (AppError) reddi doğrular; geçerse FAIL. */
async function expectError(
  label: string,
  status: number,
  fn: () => Promise<unknown>,
  msgRe?: RegExp,
): Promise<void> {
  try {
    await fn();
    check(label, false, `${status} bekleniyordu ama çağrı BAŞARILI oldu`);
  } catch (e) {
    if (!(e instanceof AppError)) {
      check(label, false, `AppError değil: ${(e as Error).message?.slice(0, 90)}`);
      return;
    }
    const okStatus = e.statusCode === status;
    const okMsg = !msgRe || msgRe.test(e.message);
    check(label, okStatus && okMsg, `${e.statusCode} "${e.message.slice(0, 70)}"`);
  }
}

async function need<T>(row: T | null | undefined, label: string): Promise<T> {
  if (!row) throw new Error(`Seed fixture eksik: ${label} (önce 'npm run seed')`);
  return row;
}

// -----------------------------------------------------------------------------
// Fixture kurucusu
// -----------------------------------------------------------------------------

const STAMP = `${process.pid}${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
let woSeq = 0;

/** Test boyunca yaratılan her şeyin izi (teardown bunları söker). */
const createdWoIds: string[] = [];
const createdRollIds: string[] = [];
const createdStationIds: string[] = [];

interface Fixture {
  woId: string;
  woNumber: string;
  cardBarcode: string;
  kursunStepId: string;
  /** Son-adım rotasında null. */
  tamburStepId: string | null;
  batchId: string;
  rollIds: string[];
}

interface MasterData {
  itemId: string;
  seedKursunStationId: string;
  tamburStationId: string;
  kursunPropertyId: string;
  defectTypeId: string;
  adminUserId: string;
}

/**
 * Bir WO fixture'ı kurar:
 *   route = [PROCESS_QC] (lastStep) veya [PROCESS_QC, TAMBUR]
 *   toplar = BARKODSUZ açık kumaş (fason dönüşü emsali), kurşun adımında AÇIK
 *   movement'lı, kalite NULL. Refakat kartı ACTIVE.
 */
async function makeFixture(
  md: MasterData,
  opts: { lastStep?: boolean; qtys?: number[] } = {},
): Promise<Fixture> {
  const qtys = opts.qtys ?? [100, 200];
  const woNumber = `TEST-KB-${STAMP}-${++woSeq}`;

  const wo = await prisma.workOrder.create({
    data: {
      workOrderNumber: woNumber,
      type: "STOCK_PRODUCTION",
      status: WorkOrderStatus.IN_PROGRESS,
      targetItemId: md.itemId,
      steps: {
        create: opts.lastStep
          ? [{ stationId: md.seedKursunStationId, stepSequence: 1, status: StepStatus.ACTIVE }]
          : [
              { stationId: md.seedKursunStationId, stepSequence: 1, status: StepStatus.ACTIVE },
              { stationId: md.tamburStationId, stepSequence: 2, status: StepStatus.PENDING },
            ],
      },
    },
    select: { id: true, steps: { select: { id: true, stepSequence: true } } },
  });
  createdWoIds.push(wo.id);

  const stepIdBySeq = new Map(wo.steps.map((s) => [s.stepSequence, s.id]));
  const kursunStepId = stepIdBySeq.get(1)!;
  const tamburStepId = opts.lastStep ? null : stepIdBySeq.get(2)!;

  const batch = await prisma.batch.create({
    data: { batchNumber: `TEST-KBP-${STAMP}-${woSeq}`, workOrderId: wo.id },
    select: { id: true },
  });

  await prisma.travelerCard.create({
    data: {
      cardNumber: woNumber,
      barcode: woNumber,
      workOrderId: wo.id,
      status: TravelerCardStatus.ACTIVE,
    },
  });

  const rollIds: string[] = [];
  for (const qty of qtys) {
    const roll = await addRollToStep(md, {
      woId: wo.id,
      batchId: batch.id,
      stepId: kursunStepId,
      qty,
    });
    rollIds.push(roll);
  }

  return { woId: wo.id, woNumber, cardBarcode: woNumber, kursunStepId, tamburStepId, batchId: batch.id, rollIds };
}

/** Adıma AÇIK movement'lı yeni barkodsuz açık kumaş topu ekler (fason kabul emsali). */
async function addRollToStep(
  md: MasterData,
  args: { woId: string; batchId: string; stepId: string; qty: number },
): Promise<string> {
  const roll = await prisma.roll.create({
    data: {
      barcode: null,
      itemId: md.itemId,
      batchId: args.batchId,
      initialQty: args.qty,
      currentQty: args.qty,
      status: RollStatus.IN_PRODUCTION,
      currentStepId: args.stepId,
      entrySource: "SUBCONTRACTOR_RETURN",
      form: RollForm.ACIK,
    },
    select: { id: true },
  });
  createdRollIds.push(roll.id);
  await prisma.rollMovement.create({
    data: { rollId: roll.id, workOrderStepId: args.stepId, qtyIn: args.qty },
  });
  return roll.id;
}

/** Bayrağı doğrudan DB'ye yazar (readKursunBypassEnabled cache'siz okur). */
async function setFlag(enabled: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    create: {
      key: SETTING_KEYS.KURSUN_BYPASS_ENABLED,
      value: enabled,
      description: "TEST — kurşun bypass bayrağı",
    },
    update: { value: enabled },
  });
}

/** Adımın AÇIK atamasını döner (partial unique en fazla bir satır bırakır). */
async function pendingAssignment(stepId: string) {
  return prisma.kursunBypassAssignment.findFirst({
    where: { workOrderStepId: stepId, completedAt: null, cancelledAt: null },
  });
}

// -----------------------------------------------------------------------------

async function main(): Promise<void> {
  // ── Master data (business-key; hardcoded UUID YOK) ─────────────────────────
  const item = await need(
    await prisma.item.findFirst({ where: { isActive: true }, select: { id: true } }),
    "aktif Item",
  );
  const seedKursun = await need(
    await prisma.station.findFirst({ where: { code: "KURSUN_KK2" }, select: { id: true } }),
    "Station KURSUN_KK2",
  );
  const tamburStation = await need(
    await prisma.station.findFirst({ where: { code: "TAMBUR_1" }, select: { id: true } }),
    "Station TAMBUR_1",
  );
  const kursunProperty = await need(
    await prisma.fabricProperty.findFirst({ where: { code: "KURSUN" }, select: { id: true } }),
    "FabricProperty KURSUN",
  );
  const defect = await need(
    await prisma.defectType.findFirst({ where: { code: "GENEL" }, select: { id: true } }),
    "DefectType GENEL",
  );
  const admin = await need(
    await prisma.user.findFirst({ where: { username: "admin" }, select: { id: true } }),
    "admin kullanıcısı",
  );

  const md: MasterData = {
    itemId: item.id,
    seedKursunStationId: seedKursun.id,
    tamburStationId: tamburStation.id,
    kursunPropertyId: kursunProperty.id,
    defectTypeId: defect.id,
    adminUserId: admin.id,
  };

  // Test'e ait FİZİKSEL kurşun istasyonları (seed'de tek PROCESS_QC var; re-assign
  // senaryosu ikincisini gerektiriyor). A istasyonu KURSUN yeteneğini taşır →
  // bypass kapanışında topa RollProperty olarak geçmeli.
  const stationA = await prisma.station.create({
    data: {
      code: `TEST-KB-A-${STAMP}`.slice(0, 32),
      name: "TEST Kurşun İstasyonu A",
      type: "INTERNAL",
      kind: StationKind.PROCESS_QC,
      department: "KALITE",
    },
    select: { id: true },
  });
  createdStationIds.push(stationA.id);
  await prisma.stationProperty.create({
    data: { stationId: stationA.id, propertyId: md.kursunPropertyId },
  });
  const stationB = await prisma.station.create({
    data: {
      code: `TEST-KB-B-${STAMP}`.slice(0, 32),
      name: "TEST Kurşun İstasyonu B",
      type: "INTERNAL",
      kind: StationKind.PROCESS_QC,
      department: "KALITE",
    },
    select: { id: true },
  });
  createdStationIds.push(stationB.id);

  // ===========================================================================
  // 1) BAYRAK KAPALI → assign 400 · BAYRAK AÇIK → assign OK + REPOINT
  // ===========================================================================
  section("1) Bayrak kapısı + atama + adım repoint");
  await setFlag(false);
  const fx1 = await makeFixture(md);

  await expectError(
    "1a Bayrak KAPALI iken assign 400",
    400,
    () => bypassSvc.assign({ workOrderId: fx1.woId, stationId: stationA.id }, md.adminUserId),
    /kapalı/i,
  );
  check(
    "1a Reddedilen atama satır bırakmadı",
    (await prisma.kursunBypassAssignment.count({ where: { workOrderId: fx1.woId } })) === 0,
  );

  await setFlag(true);
  const assign1 = await bypassSvc.assign(
    { workOrderId: fx1.woId, stationId: stationA.id, notes: "TEST dağıtım notu" },
    md.adminUserId,
  );
  check("1b Bayrak AÇIK iken assign başarılı", assign1.success === true);
  check("1b isLastStep=false (rota Tambur'a çıkıyor)", assign1.data.isLastStep === false);
  check("1b reassigned=false (ilk atama)", assign1.data.reassigned === false);

  const step1 = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: fx1.kursunStepId },
    select: { stationId: true },
  });
  check("1c Adımın istasyonu ATANAN istasyona REPOINT edildi", step1.stationId === stationA.id);

  const a1 = await need(await pendingAssignment(fx1.kursunStepId), "atama satırı");
  check("1c originalStationId = atama ÖNCESİ istasyon", a1.originalStationId === md.seedKursunStationId);
  check("1c stationId = atanan istasyon", a1.stationId === stationA.id);
  check("1c assignedById dolduruldu", a1.assignedById === md.adminUserId);
  check("1c notes kaydedildi", a1.notes === "TEST dağıtım notu");
  check("1c completedAt/cancelledAt boş (açık atama)", a1.completedAt === null && a1.cancelledAt === null);

  const auditAssign = await prisma.systemLog.findFirst({
    where: { tableName: "KURSUN_BYPASS_ASSIGNMENT", recordId: a1.id },
    orderBy: { createdAt: "desc" },
    select: { newData: true },
  });
  check(
    "1d Audit izi yazıldı (KURSUN_BYPASS_ASSIGN)",
    (auditAssign?.newData as Record<string, unknown> | null)?.event === "KURSUN_BYPASS_ASSIGN",
  );

  // EK) Dağıtım ekranı payload'ı bu işi "dağıtılmış" olarak gösteriyor mu?
  const listed = await bypassSvc.listDistribution();
  check("1e listDistribution flagEnabled=true", listed.data.flagEnabled === true);
  const assignedRow = listed.data.assigned.find((r) => r.workOrderStepId === fx1.kursunStepId);
  check("1e Dağıtılmış satır `assigned` listesinde", !!assignedRow, assignedRow?.stationName ?? "yok");
  check(
    "1e Dağıtılmış satır `waiting` listesinde YOK",
    !listed.data.waiting.some((r) => r.workOrderStepId === fx1.kursunStepId),
  );
  check(
    "1e Satır metrajı doğru (100+200)",
    assignedRow?.totalMeters === 300 && assignedRow?.openRollCount === 2,
    `${assignedRow?.totalMeters} m / ${assignedRow?.openRollCount} top`,
  );

  // ===========================================================================
  // 2) RE-ASSIGN + İPTAL
  // ===========================================================================
  section("2) Re-assign + iptal (istasyon geri yükleme)");
  const assign2 = await bypassSvc.assign(
    { workOrderId: fx1.woId, stationId: stationB.id },
    md.adminUserId,
  );
  check("2a Re-assign başarılı (reassigned=true)", assign2.data.reassigned === true);
  check("2a Aynı atama satırı güncellendi (yeni satır YOK)", assign2.data.assignmentId === a1.id);

  const step2 = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: fx1.kursunStepId },
    select: { stationId: true },
  });
  check("2a Adım 2. istasyona REPOINT edildi", step2.stationId === stationB.id);

  const a2 = await need(await pendingAssignment(fx1.kursunStepId), "atama satırı (re-assign)");
  check("2a originalStationId DEĞİŞMEDİ", a2.originalStationId === md.seedKursunStationId);
  check("2a stationId = 2. istasyon", a2.stationId === stationB.id);
  check(
    "2a Adımda hâlâ TEK atama satırı var",
    (await prisma.kursunBypassAssignment.count({ where: { workOrderStepId: fx1.kursunStepId } })) === 1,
  );

  const cancelled = await bypassSvc.cancelAssignment(a2.id, { reason: "TEST iptal" }, md.adminUserId);
  check("2b İptal başarılı + istasyon geri yüklendi", cancelled.data.stationRestored === true);
  const step2b = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: fx1.kursunStepId },
    select: { stationId: true },
  });
  check("2b Adımın istasyonu ORİJİNALE döndü", step2b.stationId === md.seedKursunStationId);

  const a2b = await prisma.kursunBypassAssignment.findUniqueOrThrow({ where: { id: a2.id } });
  check("2b Satır SİLİNMEDİ (soft-cancel)", a2b.cancelledAt !== null);
  check("2b cancelReason yazıldı", a2b.cancelReason === "TEST iptal");
  check("2b cancelledById yazıldı", a2b.cancelledById === md.adminUserId);
  check("2b Adımda AÇIK atama kalmadı", (await pendingAssignment(fx1.kursunStepId)) === null);

  await expectError(
    "2c Aynı atamayı tekrar iptal → 409",
    409,
    () => bypassSvc.cancelAssignment(a2.id, {}, md.adminUserId),
    /iptal edilmiş/i,
  );

  // ===========================================================================
  // 3) YARIM-BAŞLAMA REDLERİ (her biri AYRI fixture)
  // ===========================================================================
  section("3) Yarım-başlama redleri");

  // 3a — adımda FİİLEN yapılmış QC2 kaydı var
  const fx3a = await makeFixture(md);
  await prisma.rollOperation.create({
    data: {
      rollId: fx3a.rollIds[0],
      workOrderStepId: fx3a.kursunStepId,
      operationType: RollOperationType.QC2_COMPLETED,
    },
  });
  await expectError(
    "3a QC2_COMPLETED kaydı olan adım → 409",
    409,
    () => bypassSvc.assign({ workOrderId: fx3a.woId, stationId: stationA.id }, md.adminUserId),
    /KK2 kaydı/i,
  );

  // 3b — adımda açılmış hata kaydı var
  const fx3b = await makeFixture(md);
  await prisma.rollError.create({
    data: {
      rollId: fx3b.rollIds[0],
      startMeter: 12,
      defectTypeId: md.defectTypeId,
      errorType: "Genel Hata",
      detectedAtStepId: fx3b.kursunStepId,
    },
  });
  await expectError(
    "3b RollError açılmış adım → 409",
    409,
    () => bypassSvc.assign({ workOrderId: fx3b.woId, stationId: stationA.id }, md.adminUserId),
    /hata kaydı/i,
  );

  // 3c — bypass DIŞI kapanmış movement (KK2 kapatma / manuel taşıma izi)
  const fx3c = await makeFixture(md);
  await prisma.rollMovement.create({
    data: {
      rollId: fx3c.rollIds[0],
      workOrderStepId: fx3c.kursunStepId,
      qtyIn: 50,
      qtyOut: 50,
      exitedAt: new Date(),
      notes: `QC2_STEP_FINISHED:${STAMP}`,
    },
  });
  await expectError(
    "3c Bypass DIŞI kapanmış movement → 409",
    409,
    () => bypassSvc.assign({ workOrderId: fx3c.woId, stationId: stationA.id }, md.adminUserId),
    /bypass dışı/i,
  );

  // 3d — ölçümsüz (qtyIn=0) açık kumaş
  const fx3d = await makeFixture(md, { qtys: [100, 0] });
  await expectError(
    "3d qtyIn=0 açık movement → 400",
    400,
    () => bypassSvc.assign({ workOrderId: fx3d.woId, stationId: stationA.id }, md.adminUserId),
    /ölçümsüz/i,
  );

  check(
    "3e Reddedilen dört adımın hiçbirinde atama satırı yok",
    (await prisma.kursunBypassAssignment.count({
      where: { workOrderId: { in: [fx3a.woId, fx3b.woId, fx3c.woId, fx3d.woId] } },
    })) === 0,
  );

  // ===========================================================================
  // 4) TABLET GUARD'LARI (dağıtılmış adımda normal akış YASAK)
  // ===========================================================================
  section("4) Tablet yazma yolları dağıtılmış adımda reddediliyor");
  const fx4 = await makeFixture(md, { qtys: [120] });
  await bypassSvc.assign({ workOrderId: fx4.woId, stationId: stationA.id }, md.adminUserId);

  await expectError(
    "4a completeQc2 → 409",
    409,
    () => qcSvc.completeQc2({ rollId: fx4.rollIds[0], stepId: fx4.kursunStepId }, md.adminUserId),
    /dağıtılmış/i,
  );
  await expectError(
    "4b reportError → 409",
    409,
    () =>
      qcSvc.reportError(
        {
          rollId: fx4.rollIds[0],
          stepId: fx4.kursunStepId,
          startMeter: 10,
          defectTypeId: md.defectTypeId,
        },
        md.adminUserId,
      ),
    /dağıtılmış/i,
  );
  await expectError(
    "4c finishStep → 409",
    409,
    () => qcSvc.finishStep({ stepId: fx4.kursunStepId }, md.adminUserId),
    /dağıtılmış/i,
  );
  await expectError(
    "4d kursunFinish → 409",
    409,
    () => invSvc.kursunFinish(fx4.rollIds[0], {}, md.adminUserId),
    /dağıtılmış/i,
  );

  check(
    "4e Guard'lar hiçbir yan etki bırakmadı (QC2 op / hata / kapanmış movement yok)",
    (await prisma.rollOperation.count({ where: { workOrderStepId: fx4.kursunStepId } })) === 0 &&
      (await prisma.rollError.count({ where: { detectedAtStepId: fx4.kursunStepId } })) === 0 &&
      (await prisma.rollMovement.count({
        where: { workOrderStepId: fx4.kursunStepId, exitedAt: { not: null } },
      })) === 0,
  );

  // Dağıtılmış adım tablet seçim listesinde GÖRÜNMEZ ama kuyrukta rozetli KALIR.
  const openCards = await qcSvc.listOpenCards();
  check(
    "4f listOpenCards dağıtılmış adımı GÖSTERMİYOR",
    !openCards.data.some((c) => c.stepId === fx4.kursunStepId),
  );
  const queue = await qcSvc.listQueue();
  const queueRow = queue.data.find((q) => q.workOrderStepId === fx4.kursunStepId);
  check("4f listQueue satırı KALIYOR + bypassAssigned=true", queueRow?.bypassAssigned === true);

  const stepSummary = await qcSvc.getByCardBarcode(fx4.cardBarcode);
  check(
    "4g getByCardBarcode bypassAssignment bilgisini taşıyor",
    stepSummary.data.bypassAssignment?.stationName === "TEST Kurşun İstasyonu A",
    stepSummary.data.bypassAssignment?.stationName ?? "null",
  );

  // ===========================================================================
  // 5) TAMBUR BAĞLAMI — 400 ATMIYOR, bypassPending DOLU
  // ===========================================================================
  section("5) getTamburContext bypass bağlamı");
  const ctx = await tamburSvc.getTamburContext(fx4.cardBarcode);
  check("5a getTamburContext 400 ATMADI", ctx.success === true);
  check("5a stepId Tambur adımı", ctx.data.stepId === fx4.tamburStepId);
  check("5b bypassPending dolu", ctx.data.bypassPending != null);
  check("5b bypassPending.rollCount = 1", ctx.data.bypassPending?.rollCount === 1);
  check(
    "5b bypassPending.totalMeters = 120",
    ctx.data.bypassPending?.totalMeters === 120,
    String(ctx.data.bypassPending?.totalMeters),
  );
  check(
    "5b bypassPending.rolls kapsamı doğru",
    ctx.data.bypassPending?.rolls.length === 1 &&
      ctx.data.bypassPending.rolls[0].rollId === fx4.rollIds[0],
  );
  check(
    "5c bypassPending.stationName = atanan istasyon",
    ctx.data.bypassPending?.stationName === "TEST Kurşun İstasyonu A",
  );
  check("5c Tambur adımında henüz açık kumaş YOK", ctx.data.openFabricRolls.length === 0);

  // ===========================================================================
  // 8) KAPSAM UYUŞMAZLIĞI (happy path'ten ÖNCE — rollback'i kanıtlar)
  // ===========================================================================
  section("8) Kapsam uyuşmazlığı → 409 + tam rollback");
  const fx6 = await makeFixture(md, { qtys: [150, 250] });
  const assign6 = await bypassSvc.assign(
    { workOrderId: fx6.woId, stationId: stationA.id },
    md.adminUserId,
  );

  await expectError(
    "8a FAZLADAN rollId (başka WO'nun topu) → 409",
    409,
    () =>
      bypassSvc.completeFromTambur(
        { cardBarcode: fx6.cardBarcode, rollIds: [...fx6.rollIds, fx1.rollIds[0]] },
        md.adminUserId,
      ),
    /kapatılabildi/i,
  );
  await expectError(
    "8b EKSİK rollId (adımda kapatılmamış top kalıyor) → 409",
    409,
    () =>
      bypassSvc.completeFromTambur(
        { cardBarcode: fx6.cardBarcode, rollIds: [fx6.rollIds[0]] },
        md.adminUserId,
      ),
    /yeni top girdi|önizlemeyi yenileyin/i,
  );

  const a6AfterFail = await prisma.kursunBypassAssignment.findUniqueOrThrow({
    where: { id: assign6.data.assignmentId },
  });
  check("8c Atama HÂLÂ açık (rollback)", a6AfterFail.completedAt === null);
  check(
    "8c Kurşun movement'ları HÂLÂ açık (rollback)",
    (await prisma.rollMovement.count({
      where: { workOrderStepId: fx6.kursunStepId, exitedAt: null },
    })) === 2,
  );
  check(
    "8c Tambur adımında movement doğmadı (rollback)",
    (await prisma.rollMovement.count({ where: { workOrderStepId: fx6.tamburStepId! } })) === 0,
  );

  // ===========================================================================
  // 6) HAPPY PATH — completeFromTambur
  // ===========================================================================
  section("6) Happy path: Tambur okutmasıyla kurşun adımını kapat");
  const done6 = await bypassSvc.completeFromTambur(
    { cardBarcode: fx6.cardBarcode, rollIds: fx6.rollIds },
    md.adminUserId,
  );
  check("6a Tamamlandı (alreadyDone=false)", done6.data.alreadyDone === false);
  check("6a 2 top Tambur'a taşındı", done6.data.movedRollCount === 2);
  check("6a tamburStepId doğru", done6.data.tamburStepId === fx6.tamburStepId);

  const closed6 = await prisma.rollMovement.findMany({
    where: { workOrderStepId: fx6.kursunStepId },
    select: { rollId: true, qtyIn: true, qtyOut: true, weightIn: true, weightOut: true, exitedAt: true, notes: true },
  });
  check("6b Kurşun movement'larının hepsi kapandı", closed6.length === 2 && closed6.every((m) => m.exitedAt !== null));
  check(
    "6b qtyOut = qtyIn (bypass'ta kesim/fire kararı yok)",
    closed6.every((m) => m.qtyOut !== null && m.qtyOut.equals(m.qtyIn)),
  );
  check(
    "6b notes marker'ı KURSUN_BYPASS_FINISHED: ile başlıyor",
    closed6.every((m) => m.notes?.startsWith(`${KURSUN_BYPASS_MARKER_PREFIX}:`)),
    closed6[0]?.notes ?? "null",
  );
  check(
    "6b Tek TUR = tek marker uuid'si (satır başına farklı uuid YOK)",
    new Set(closed6.map((m) => m.notes)).size === 1,
  );

  const kursunStep6 = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: fx6.kursunStepId },
    select: { stationId: true, status: true },
  });
  check("6c Kapanan movement'ın adımı ATANAN istasyona ait", kursunStep6.stationId === stationA.id);
  check("6c Kurşun adımı COMPLETED (SKIPPED DEĞİL)", kursunStep6.status === StepStatus.COMPLETED);

  const tamburOpen6 = await prisma.rollMovement.findMany({
    where: { workOrderStepId: fx6.tamburStepId!, exitedAt: null },
    select: { rollId: true, qtyIn: true, machineId: true },
  });
  check("6d Toplar Tambur adımında AÇIK movement'lı", tamburOpen6.length === 2);
  check(
    "6d Tambur giriş metrajı kurşun girişiyle aynı",
    tamburOpen6.every((m) => closed6.some((c) => c.rollId === m.rollId && c.qtyIn.equals(m.qtyIn))),
  );
  check(
    "6d Kapanan kurşun movement'ına makine damgası YAZILMADI",
    tamburOpen6.every((m) => m.machineId === null),
  );

  const rolls6 = await prisma.roll.findMany({
    where: { id: { in: fx6.rollIds } },
    select: { id: true, currentStepId: true, qualityGrade: true, qualityGradeId: true, status: true },
  });
  check("6e roll.currentStepId = Tambur adımı", rolls6.every((r) => r.currentStepId === fx6.tamburStepId));
  check("6e Toplar IN_PRODUCTION kaldı", rolls6.every((r) => r.status === RollStatus.IN_PRODUCTION));
  check(
    "6e KALİTE HÂLÂ NULL (kaliteyi Tambur belirler)",
    rolls6.every((r) => r.qualityGradeId === null && r.qualityGrade === null),
  );

  const props6 = await prisma.rollProperty.findMany({
    where: { rollId: { in: fx6.rollIds }, propertyId: md.kursunPropertyId },
    select: { rollId: true },
  });
  check("6f KURSUN istasyon yeteneği toplara GEÇTİ", props6.length === 2);

  check(
    "6g Bu adımda YENİ RollOperation YOK (QC2/KURSUN op yazılmaz)",
    (await prisma.rollOperation.count({ where: { workOrderStepId: fx6.kursunStepId } })) === 0,
  );
  check(
    "6g RollError açılmadı",
    (await prisma.rollError.count({ where: { detectedAtStepId: fx6.kursunStepId } })) === 0,
  );

  const a6Done = await prisma.kursunBypassAssignment.findUniqueOrThrow({
    where: { id: assign6.data.assignmentId },
  });
  check("6h completedVia = TAMBUR_SCAN", a6Done.completedVia === KursunBypassCompletionSource.TAMBUR_SCAN);
  check("6h completedAt + completedById damgalandı", a6Done.completedAt !== null && a6Done.completedById === md.adminUserId);
  check("6h Atama satırı SİLİNMEDİ (append-only)", a6Done.cancelledAt === null);

  const audit6 = await prisma.systemLog.findFirst({
    where: { tableName: "KURSUN_BYPASS_ASSIGNMENT", recordId: a6Done.id },
    orderBy: { createdAt: "desc" },
    select: { newData: true },
  });
  check(
    "6i Audit: KURSUN_BYPASS_TAMBUR_COMPLETE",
    (audit6?.newData as Record<string, unknown> | null)?.event === "KURSUN_BYPASS_TAMBUR_COMPLETE",
  );

  // ===========================================================================
  // 7) İDEMPOTENCY
  // ===========================================================================
  section("7) İdempotent tekrar");
  const again7 = await bypassSvc.completeFromTambur(
    { cardBarcode: fx6.cardBarcode, rollIds: fx6.rollIds },
    md.adminUserId,
  );
  check("7a Tekrar çağrı alreadyDone=true", again7.data.alreadyDone === true);
  check("7a movedRollCount = 0", again7.data.movedRollCount === 0);
  check(
    "7b Tambur'da MÜKERRER movement YOK (hâlâ 2)",
    (await prisma.rollMovement.count({ where: { workOrderStepId: fx6.tamburStepId! } })) === 2,
  );
  check(
    "7b Kurşun adımı movement sayısı değişmedi (hâlâ 2)",
    (await prisma.rollMovement.count({ where: { workOrderStepId: fx6.kursunStepId } })) === 2,
  );
  check(
    "7b Yeni atama satırı doğmadı",
    (await prisma.kursunBypassAssignment.count({ where: { workOrderStepId: fx6.kursunStepId } })) === 1,
  );

  // 7c — TABLETİN OFFLINE KUYRUĞU. Kurşun tabletinde bekleyen bir `kursun-finish`
  // isteği, iş bu arada dağıtılıp Tambur'da kapandıktan SONRA ağa çıkabilir.
  // Bypass QC2_COMPLETED yazmadığı için `kursunFinish`'in birinci idempotency
  // sondası bunu göremez; ikinci sonda (movement'ın KURSUN_BYPASS_FINISHED
  // marker'ı) devreye girmezse operatör "Roll PROCESS_QC step'inde değil
  // (mevcut: TAMBUR)" gibi teknik bir 400 alır. Doğru cevap: idempotent başarı.
  const beforeQty7c = await prisma.roll.findUniqueOrThrow({
    where: { id: fx6.rollIds[0] },
    select: { currentQty: true },
  });
  const replay7 = await invSvc.kursunFinish(fx6.rollIds[0], {}, md.adminUserId);
  check("7c Geç gelen kursun-finish idempotent BAŞARI döndü", replay7.success === true);
  check(
    "7c Mesaj bypass kapanışını söylüyor",
    /bypass/i.test(replay7.message ?? ""),
    replay7.message ?? "null",
  );
  check(
    "7c Mükerrer movement/RollError doğmadı",
    (await prisma.rollMovement.count({ where: { workOrderStepId: fx6.kursunStepId } })) === 2 &&
      (await prisma.rollError.count({ where: { detectedAtStepId: fx6.kursunStepId } })) === 0,
  );
  check(
    "7c Topun metrajı ve adımı değişmedi",
    (
      await prisma.roll.findUniqueOrThrow({
        where: { id: fx6.rollIds[0] },
        select: { currentQty: true, currentStepId: true },
      })
    ).currentQty.equals(beforeQty7c.currentQty),
  );

  // ===========================================================================
  // 11) ÇOK-TUR — 2. parti aynı adıma geldiğinde yeniden dağıtılabilir
  // ===========================================================================
  section("11) Çok-tur (fason 2. partisi) — adım YENİDEN dağıtılabilir");
  const roll11 = await addRollToStep(md, {
    woId: fx6.woId,
    batchId: fx6.batchId,
    stepId: fx6.kursunStepId,
    qty: 90,
  });
  await prisma.$transaction(async (tx) => {
    await recomputeStepStatus(tx, fx6.kursunStepId);
  });
  const step11 = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: fx6.kursunStepId },
    select: { status: true },
  });
  check("11a Yeni parti gelince adım ACTIVE'e döndü", step11.status === StepStatus.ACTIVE);

  const assign11 = await bypassSvc.assign(
    { workOrderId: fx6.woId, stationId: stationA.id },
    md.adminUserId,
  );
  check("11b 2. tur assign BAŞARILI (bypass marker muafiyeti)", assign11.success === true);
  check("11b YENİ atama satırı doğdu", assign11.data.assignmentId !== assign6.data.assignmentId);
  check("11b reassigned=false (yeni satır, güncelleme değil)", assign11.data.reassigned === false);
  check(
    "11c Adımda toplam 2 atama satırı (1 tamamlanmış + 1 açık)",
    (await prisma.kursunBypassAssignment.count({ where: { workOrderStepId: fx6.kursunStepId } })) === 2,
  );
  check(
    "11c Açık atama TEK (partial unique seddi)",
    (await prisma.kursunBypassAssignment.count({
      where: { workOrderStepId: fx6.kursunStepId, completedAt: null, cancelledAt: null },
    })) === 1,
  );

  // ===========================================================================
  // 12) BAYRAK TAMAMLAMAYI KAPILAMIYOR
  // ===========================================================================
  section("12) Bayrak kapatılsa da dağıtılmış iş biter");
  await setFlag(false);
  const done12 = await bypassSvc.completeFromTambur(
    { cardBarcode: fx6.cardBarcode, rollIds: [roll11] },
    md.adminUserId,
  );
  check("12a Bayrak KAPALI iken completeFromTambur ÇALIŞTI", done12.data.alreadyDone === false);
  check("12a 2. tur topu Tambur'a taşındı", done12.data.movedRollCount === 1);
  check(
    "12b Tambur adımında toplam 3 movement (2 + 1)",
    (await prisma.rollMovement.count({ where: { workOrderStepId: fx6.tamburStepId! } })) === 3,
  );
  const step12 = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: fx6.kursunStepId },
    select: { status: true },
  });
  check("12b Kurşun adımı yeniden COMPLETED", step12.status === StepStatus.COMPLETED);
  await expectError(
    "12c Bayrak KAPALI iken YENİ dağıtım hâlâ 400",
    400,
    () => bypassSvc.assign({ workOrderId: fx1.woId, stationId: stationA.id }, md.adminUserId),
    /kapalı/i,
  );

  // ===========================================================================
  // 9) SON-ADIM ROTASI — completeFromDistribution
  // ===========================================================================
  section("9) Son-adım rotası (route = [PROCESS_QC]) → İşi Bitir");
  await setFlag(true);
  const fx9 = await makeFixture(md, { lastStep: true, qtys: [80, 60] });
  const assign9 = await bypassSvc.assign(
    { workOrderId: fx9.woId, stationId: stationA.id },
    md.adminUserId,
  );
  check("9a isLastStep=true", assign9.data.isLastStep === true);

  const preview9 = await bypassSvc.getCompletePreview(assign9.data.assignmentId);
  check("9b Önizleme canComplete=true", preview9.data.canComplete === true);
  check("9b Önizleme isLastStep=true", preview9.data.isLastStep === true);
  check("9b Önizleme 2 top / 140 m", preview9.data.rollCount === 2 && preview9.data.totalMeters === 140);
  check("9b Üretilecek barkod adedi = 2", preview9.data.willFinalize.barcodesToGenerate === 2);
  check("9b workOrderWillComplete=true", preview9.data.workOrderWillComplete === true);

  await expectError(
    "9c Son-adım rotasında Tambur okutması REDDEDİLİR",
    409,
    () =>
      bypassSvc.completeFromTambur(
        { cardBarcode: fx9.cardBarcode, rollIds: fx9.rollIds },
        md.adminUserId,
      ),
    /son adımı/i,
  );

  const done9 = await bypassSvc.completeFromDistribution(
    assign9.data.assignmentId,
    { rollIds: fx9.rollIds },
    md.adminUserId,
  );
  check("9d İşi Bitir başarılı", done9.data.alreadyDone === false && done9.data.finalizedRollCount === 2);
  check("9d 2 barkod üretildi", done9.data.barcodesGenerated === 2);

  const rolls9 = await prisma.roll.findMany({
    where: { id: { in: fx9.rollIds } },
    select: { status: true, barcode: true, qualityGrade: true, qualityGradeId: true, currentStepId: true, form: true },
  });
  check("9e Toplar WAREHOUSE", rolls9.every((r) => r.status === RollStatus.WAREHOUSE));
  check("9e Barkod ÜRETİLDİ ('F' tipi)", rolls9.every((r) => !!r.barcode && /F\d{4}$/.test(r.barcode!)), rolls9.map((r) => r.barcode).join(", "));
  check("9e Kalite NULL kaldı", rolls9.every((r) => r.qualityGradeId === null && r.qualityGrade === null));
  check("9e currentStepId temizlendi", rolls9.every((r) => r.currentStepId === null));
  check("9e form = ACIK", rolls9.every((r) => r.form === RollForm.ACIK));

  const wo9 = await prisma.workOrder.findUniqueOrThrow({
    where: { id: fx9.woId },
    select: { status: true, steps: { select: { status: true } } },
  });
  check("9f İş emri COMPLETED", wo9.status === WorkOrderStatus.COMPLETED);
  check("9f Kurşun adımı COMPLETED", wo9.steps.every((s) => s.status === StepStatus.COMPLETED));
  const card9 = await prisma.travelerCard.findFirstOrThrow({
    where: { workOrderId: fx9.woId },
    select: { status: true },
  });
  check("9f Refakat kartı COMPLETED", card9.status === TravelerCardStatus.COMPLETED);

  const a9 = await prisma.kursunBypassAssignment.findUniqueOrThrow({
    where: { id: assign9.data.assignmentId },
  });
  check(
    "9g completedVia = DISTRIBUTION_LAST_STEP",
    a9.completedVia === KursunBypassCompletionSource.DISTRIBUTION_LAST_STEP,
  );

  const again9 = await bypassSvc.completeFromDistribution(
    assign9.data.assignmentId,
    { rollIds: fx9.rollIds },
    md.adminUserId,
  );
  check("9h Tekrar 'İşi Bitir' idempotent (alreadyDone)", again9.data.alreadyDone === true);
  check(
    "9h Mükerrer barkod/finalize yok",
    (await prisma.roll.count({ where: { id: { in: fx9.rollIds }, status: RollStatus.WAREHOUSE } })) === 2,
  );

  // ===========================================================================
  // 10) EŞZAMANLILIK
  // ===========================================================================
  section("10) Eşzamanlılık");
  const fx10 = await makeFixture(md, { qtys: [70] });

  const parallel = await Promise.allSettled([
    bypassSvc.assign({ workOrderId: fx10.woId, stationId: stationA.id }, md.adminUserId),
    bypassSvc.assign({ workOrderId: fx10.woId, stationId: stationB.id }, md.adminUserId),
  ]);
  const fulfilled = parallel.filter((r) => r.status === "fulfilled");
  const created = fulfilled.filter(
    (r) => (r as PromiseFulfilledResult<{ data: { reassigned: boolean } }>).value.data.reassigned === false,
  );
  console.log(
    `   (paralel sonuç: ${fulfilled.length} başarılı — ${created.length} yeni atama, ` +
      `${fulfilled.length - created.length} taşıma, ${parallel.length - fulfilled.length} red)`,
  );
  check(
    "10a Paralel assign TEK atama satırı bıraktı",
    (await prisma.kursunBypassAssignment.count({ where: { workOrderStepId: fx10.kursunStepId } })) === 1,
  );
  check(
    "10a Açık atama TEKİL",
    (await prisma.kursunBypassAssignment.count({
      where: { workOrderStepId: fx10.kursunStepId, completedAt: null, cancelledAt: null },
    })) === 1,
  );
  check("10a Yalnız BİR satır YARATILDI (diğeri taşıma ya da 409)", created.length === 1);
  const a10 = await need(await pendingAssignment(fx10.kursunStepId), "10a atama");
  const step10 = await prisma.workOrderStep.findUniqueOrThrow({
    where: { id: fx10.kursunStepId },
    select: { stationId: true },
  });
  check("10a Adımın istasyonu kazanan atamayla TUTARLI", step10.stationId === a10.stationId);
  check("10a originalStationId hâlâ seed istasyonu", a10.originalStationId === md.seedKursunStationId);

  // 10b — DB SEDDİ: partial unique iki eşzamanlı AÇIK atamayı geçirmez.
  await bypassSvc.cancelAssignment(a10.id, { reason: "TEST 10b hazırlık" }, md.adminUserId);
  const rawInsert = () =>
    prisma.kursunBypassAssignment.create({
      data: {
        workOrderId: fx10.woId,
        workOrderStepId: fx10.kursunStepId,
        stationId: stationA.id,
        originalStationId: md.seedKursunStationId,
        assignedById: md.adminUserId,
      },
      select: { id: true },
    });
  const raced = await Promise.allSettled([rawInsert(), rawInsert()]);
  const rawOk = raced.filter((r) => r.status === "fulfilled").length;
  const rawErr = raced.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  check("10b Paralel INSERT'ten yalnız BİRİ geçti", rawOk === 1, `${rawOk}/2`);
  check(
    "10b Kaybeden P2002 (kursun_bypass_one_pending_per_step_uq) aldı",
    rawErr instanceof Object &&
      rawErr?.reason instanceof Prisma.PrismaClientKnownRequestError &&
      rawErr.reason.code === "P2002",
    (rawErr?.reason as Error | undefined)?.message?.slice(0, 60) ?? "hata yok",
  );
}

// -----------------------------------------------------------------------------
// Teardown — test kendi yarattığını söker (FK sırası: atama → iz → top → WO)
// -----------------------------------------------------------------------------
async function teardown(originalFlag: Prisma.JsonValue | null): Promise<void> {
  try {
    const assignments = await prisma.kursunBypassAssignment.findMany({
      where: { workOrderId: { in: createdWoIds } },
      select: { id: true },
    });
    const assignmentIds = assignments.map((a) => a.id);

    const children = await prisma.roll.findMany({
      where: { parentRollId: { in: createdRollIds } },
      select: { id: true },
    });
    const allRollIds = [...createdRollIds, ...children.map((c) => c.id)];

    await prisma.kursunBypassAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
    await prisma.rollError.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollOperation.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollProperty.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.rollMovement.deleteMany({ where: { rollId: { in: allRollIds } } });
    await prisma.roll.deleteMany({ where: { id: { in: allRollIds } } });
    await prisma.travelerCard.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.batch.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrderStep.deleteMany({ where: { workOrderId: { in: createdWoIds } } });
    await prisma.workOrder.deleteMany({ where: { id: { in: createdWoIds } } });
    await prisma.systemLog.deleteMany({
      where: { recordId: { in: [...createdWoIds, ...allRollIds, ...assignmentIds] } },
    });
    await prisma.stationProperty.deleteMany({ where: { stationId: { in: createdStationIds } } });
    await prisma.station.deleteMany({ where: { id: { in: createdStationIds } } });

    // Global ayarı ESKİ HÂLİNE getir (dev DB konfigürasyonu bozulmasın).
    if (originalFlag === null) {
      await prisma.systemSetting
        .delete({ where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED } })
        .catch(() => {});
    } else {
      await prisma.systemSetting.update({
        where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
        data: { value: originalFlag as Prisma.InputJsonValue },
      });
    }
    console.log("\n(temizlendi — TEST- iş emirleri / toplar / istasyonlar silindi, bayrak geri alındı)");
  } catch (e) {
    console.error("TEMİZLİK HATASI:", e instanceof Error ? e.message : e);
  }
}

(async () => {
  const existingFlag = await prisma.systemSetting.findUnique({
    where: { key: SETTING_KEYS.KURSUN_BYPASS_ENABLED },
    select: { value: true },
  });
  const originalFlag = existingFlag ? existingFlag.value : null;

  try {
    await main();
  } catch (e) {
    fail++;
    console.error("HATA:", e instanceof Error ? (e.stack ?? e.message) : e);
  } finally {
    await teardown(originalFlag);
  }

  console.log(`\n=== Sonuç: ${pass} geçti, ${fail} başarısız ===`);
  // Uzun rapor basıyoruz → process.exit stdout'u kırpabilir (CLAUDE.md).
  process.exitCode = fail > 0 ? 1 : 0;
  await prisma.$disconnect();
  await pool.end();
})();
