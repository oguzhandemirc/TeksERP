// =============================================================================
// TeksERP - Roll-Step Helper
// =============================================================================
// Step durumunu (WorkOrderStep.status) artık iş-emri seviyesinde değil,
// o step'e ait rollerin RollMovement hareketleri üzerinden hesaplıyoruz.
//
// Kurallar:
//   - PENDING   → Step için hiç RollMovement açılmamış
//   - ACTIVE    → En az bir RollMovement açık (exitedAt = null)
//   - COMPLETED → Hiç açık movement yok, en az bir kapalı movement var,
//                 ve bu step'te ilerleyen roll sayısı iş emrindeki
//                 üretim içindeki rol sayısıyla eşit
//   - SKIPPED   → recompute değiştirmez; SKIPPED terminaldir, öyle kalır.
//
// Bu modül tüm çağrıcılar için ortak transaction client (Prisma.TransactionClient)
// kabul eder; atomik işlemler bozulmaz.
// =============================================================================
import { Prisma, RollStatus, StationKind, StepStatus, WorkOrderStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { AppError } from "../../utils/app-error";
import { setWorkOrderCardStatuses } from "./traveler-card-fanout.helper";

export type TxClient = Prisma.TransactionClient;

/**
 * Step'e ait RollMovement kayıtlarına göre status'ü yeniden hesaplar ve
 * gerekirse günceller. SKIPPED step'lere dokunmaz.
 */
export async function recomputeStepStatus(
  tx: TxClient,
  stepId: string
): Promise<StepStatus> {
  const step = await tx.workOrderStep.findUnique({
    where: { id: stepId },
    select: {
      id: true,
      status: true,
      workOrderId: true,
      startedAt: true,
    },
  });
  if (!step) return StepStatus.PENDING;

  // SKIPPED ise terminal kabul edelim, değiştirmeyiz.
  if (step.status === StepStatus.SKIPPED) return StepStatus.SKIPPED;

  // Tx içinde paralel sorgu atmak illüzyondur: aynı pg bağlantısı onları
  // zaten sıralar ve pg@9'da hard-error olur. Sıralı await zorunludur.
  //
  // CANCELLED roller "hiç olmamış" semantiği — movement'ları step status
  // hesabına dahil edilmez (operatör iptal ettiyse step PENDING'e döner).
  // SCRAP (gerçek fire — Tambur kalite reddi vb.) sayılır: o top istasyondan
  // gerçekten geçmiş, audit kalır.
  const openCount = await tx.rollMovement.count({
    where: {
      workOrderStepId: stepId,
      exitedAt: null,
      roll: { status: { not: RollStatus.CANCELLED } },
    },
  });
  const closedCount = await tx.rollMovement.count({
    where: {
      workOrderStepId: stepId,
      exitedAt: { not: null },
      roll: { status: { not: RollStatus.CANCELLED } },
    },
  });

  // Bu step'e henüz girmemiş ama iş emrinin üretimine dahil olan roller var mı?
  //   - currentStepId bu step'ten farklı ve
  //   - bu step için hiç movement kaydı yok (ne açık ne kapalı)
  // Böyle roller varsa step henüz bitmemiş, ACTIVE/PENDING'te kalmalı.
  //
  // ⚠️ FASON DÖNÜŞÜ ÇOCUĞU İSTİSNASI (2026-08-03, `test_consistency` §20 ile bulundu):
  // Fason kabulünde orijinal top SUBCONTRACTOR_CONSUMED ile emekliye ayrılır ve
  // makbuzdan YENİ açık-kumaş toplar doğar. Bu çocuklar fason adımının ÇIKTISIDIR —
  // o adıma hiç girmezler ve giremezler, dolayısıyla "bu step için movement yok"
  // koşulunu SONSUZA DEK sağlarlar. İstisna olmadan sonuç şuydu: kabul biten fason
  // adımı `closedCount>0 && pendingRolls>0` dalına düşüp COMPLETED'tan **ACTIVE'e geri
  // dönüyor**, `ensureWorkOrderInProgress` iş emrini IN_PROGRESS'e çekiyor ve
  // `completeWorkOrderIfStepsDone` o WO'yu bir daha ASLA kapatamıyordu — hata da log
  // da yok, iş emri sessizce açık kalıyordu. (Kabul anında ortaya çıkmıyor: recompute
  // çocuklar bağlanmadan önce koşuyor. Sonraki HERHANGİ bir recompute — manuel taşıma,
  // kabul iptali, aşağı adım kapanışı — tetikliyordu.)
  //
  // Dışlama DAR tutuldu: yalnız **bu adımın** makbuzundan doğan çocuk sayılmaz.
  // Aynı çocuk, henüz ulaşmadığı AŞAĞI adımlar için hâlâ "bekleyen"dir (orada
  // gerçekten beklemektedir) — `parentReceipt.stepId` eşitliği bunu ayırır.
  const pendingRolls = await tx.roll.count({
    where: {
      // İş emrine bağlı = en az bir movement'i bu iş emrinin adımlarından birinde olmalı
      movements: { some: { step: { workOrderId: step.workOrderId } } },
      NOT: [
        // Bu step için movement yok
        { movements: { some: { workOrderStepId: stepId } } },
        // ...ve bu step'in fason makbuzundan doğmuş bir çocuk değil (yukarıdaki istisna).
        // parentReceiptId null olan toplar bu negasyondan ETKİLENMEZ (ilişki yoksa
        // koşul zaten sağlanmaz) — normal üretim topları eskisi gibi sayılır.
        { parentReceipt: { stepId } },
      ],
      // Hala aktif üretimdeyse
      status: {
        in: [
          RollStatus.IN_PRODUCTION,
          RollStatus.AT_SUBCONTRACTOR,
          RollStatus.RETURNED_FROM_SUBCONTRACTOR,
        ],
      },
    },
  });

  let nextStatus: StepStatus = step.status;

  if (openCount > 0) {
    nextStatus = StepStatus.ACTIVE;
  } else if (closedCount === 0 && pendingRolls === 0) {
    nextStatus = StepStatus.PENDING;
  } else if (closedCount > 0 && pendingRolls === 0) {
    // Tüm aktif roller bu step'i ya geçmiş ya atlamış
    nextStatus = StepStatus.COMPLETED;
  } else {
    // closedCount > 0 ama pendingRolls > 0 → hala bekleniyor → ACTIVE tut
    // veya closedCount === 0 ama pendingRolls > 0 → PENDING'ten çıkmadık
    nextStatus = closedCount > 0 ? StepStatus.ACTIVE : StepStatus.PENDING;
  }

  if (nextStatus !== step.status) {
    await tx.workOrderStep.update({
      where: { id: stepId },
      data: {
        status: nextStatus,
        startedAt:
          nextStatus === StepStatus.ACTIVE && !step.startedAt
            ? new Date()
            : undefined,
        completedAt:
          nextStatus === StepStatus.COMPLETED ? new Date() : null,
      },
    });
  }

  // Step ACTIVE ise iş emri PLANNED'dan IN_PROGRESS'e çekilmeli — idempotent.
  // (step.status zaten ACTIVE olsa bile WO henüz güncellenmemiş olabilir.)
  if (nextStatus === StepStatus.ACTIVE) {
    await ensureWorkOrderInProgress(tx, step.workOrderId);
  }

  return nextStatus;
}

/**
 * İş emrini PLANNED → IN_PROGRESS'e çeker. Idempotent:
 *   - WO zaten IN_PROGRESS/COMPLETED/CANCELLED ise hiçbir şey olmaz.
 *   - updateMany + filter kullanır, status dışı durumlar bozulmaz.
 *
 * Rolleri attach etmek, bir step'i aktive etmek, fason intake yapmak vs. gibi
 * "üretim başladı" sinyalleri olan her yerden güvenle çağrılabilir.
 */
export async function ensureWorkOrderInProgress(
  tx: TxClient,
  workOrderId: string
): Promise<void> {
  await tx.workOrder.updateMany({
    where: { id: workOrderId, status: WorkOrderStatus.PLANNED },
    data: { status: WorkOrderStatus.IN_PROGRESS },
  });
}

/**
 * F162: Son üretim adımı bitince WO'yu (ve ACTIVE refakat kartını) COMPLETED yap —
 * ama YALNIZ kalan (COMPLETED/SKIPPED-dışı) adım kalmadıysa. finishStep (kursun-qc)
 * ve kursunFinish (inventory) son-adım dallarının ORTAK yardımcısı (drift önlenir).
 * Çağıran tx başında touchWorkOrderTx ile WO'yu write-kilitlemeli (remainingSteps
 * sayımı eşzamanlı finish/fason/finalize ile serileşsin).
 */
export async function completeWorkOrderIfStepsDone(
  tx: TxClient,
  workOrderId: string
): Promise<void> {
  const remaining = await tx.workOrderStep.count({
    where: {
      workOrderId,
      status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
    },
  });
  if (remaining !== 0) return;
  await tx.workOrder.updateMany({
    where: {
      id: workOrderId,
      // SUPERSEDED (tebdil ile devredilmiş) de terminal — recompute onu COMPLETED'e çevirmesin.
      status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
    },
    data: { status: WorkOrderStatus.COMPLETED },
  });
  await setWorkOrderCardStatuses(tx, workOrderId, "ACTIVE", "COMPLETED");
}

/**
 * Bir roll için sonraki step'i açar:
 *   - Roll.currentStepId güncellenir
 *   - RollMovement.create (qtyIn, weightIn)
 *   - Next step PENDING ise recompute ile ACTIVE'e çekilir
 *
 * status ve rollStatus parametreleri çağıran tarafından verilir
 * (örneğin EXTERNAL step'e girişte durum farklı olabilir).
 */
export async function openMovementForNextStep(
  tx: TxClient,
  params: {
    rollId: string;
    nextStepId: string;
    qty: number;
    weight?: number | null;
    userId?: string | null;
    notes?: string | null;
    rollStatus?: RollStatus; // opsiyonel: yeni step'teki roll durumu
  }
): Promise<void> {
  const {
    rollId,
    nextStepId,
    qty,
    weight = null,
    userId = null,
    notes = null,
    rollStatus,
  } = params;

  await tx.rollMovement.create({
    data: {
      rollId,
      workOrderStepId: nextStepId,
      qtyIn: qty,
      weightIn: weight,
      operatorId: userId,
      notes,
    },
  });

  const rollData: Prisma.RollUncheckedUpdateInput = {
    currentStepId: nextStepId,
  };
  if (rollStatus) {
    rollData.status = rollStatus;
  }

  await tx.roll.update({
    where: { id: rollId },
    data: rollData,
  });

  await recomputeStepStatus(tx, nextStepId);
}

/**
 * Bir rulonun mevcut adımındaki işlemini "geri alabilir miyiz?" kontrolü.
 *
 * Kural: sonraki adımda bu rulo için **ileri taşınma izi** varsa geri
 * alamayız. İz:
 *   - Sonraki step'te kapalı (`exitedAt != null`) RollMovement → bitmiş
 *   - Sonraki step'te RollOperation (Kurşun/QC2/Tambur/Sevk vb.) → işlem yapıldı
 *   - Sonraki step için SubcontractorDispatch (fason'a gönderildi)
 *
 * Sadece **açık** (henüz başlamamış / movement açık olup hiçbir karar
 * verilmemiş) durum reopen'a izindir.
 *
 * nextStepId null ise (mevcut adım rotanın son üretim adımı) geri alma
 * her zaman serbest — sonraki adım yok.
 */
export async function canRollGoBackFromStep(
  tx: TxClient,
  rollId: string,
  nextStepId: string | null,
): Promise<{ canGoBack: boolean; reason: string | null }> {
  if (!nextStepId) {
    return { canGoBack: true, reason: null };
  }

  const closedMovement = await tx.rollMovement.findFirst({
    where: { rollId, workOrderStepId: nextStepId, exitedAt: { not: null } },
    select: { id: true },
  });
  if (closedMovement) {
    return {
      canGoBack: false,
      reason: "Sonraki adım için bu rulo zaten tamamlanmış — geri alınamaz",
    };
  }

  const operation = await tx.rollOperation.findFirst({
    where: { rollId, workOrderStepId: nextStepId },
    select: { id: true, operationType: true },
  });
  if (operation) {
    return {
      canGoBack: false,
      reason: `Sonraki adımda işlem yapılmış (${operation.operationType}) — önce o işlemi geri al`,
    };
  }

  const dispatch = await tx.subcontractorDispatch.findFirst({
    where: {
      stepId: nextStepId,
      cancelledAt: null,
      items: { some: { rollId } },
    },
    select: { id: true, dispatchNo: true },
  });
  if (dispatch) {
    return {
      canGoBack: false,
      reason: `Sonraki adımda fason sevki yapılmış (${dispatch.dispatchNo}) — önce sevki iptal et`,
    };
  }

  return { canGoBack: true, reason: null };
}

/**
 * Bir iş emrinin **hedef kind step'ini** çöz ve kart-okuma akışı için
 * doğrula. Operatör Kurşun veya Tambur tabletinde kart okuttuğunda
 * çağrılır.
 *
 * Davranış:
 *   - Hedef kind'da step yoksa → 404 ("Bu iş emrinde X adımı yok")
 *   - Step var + açık movement var → { stepId, openRollCount } döner.
 *   - Step var + açık movement yok → multi-batch destekli net 400:
 *     "Bu iş emrinde X adımında açık top yok. Mevcut konum: Boyahane (4),
 *      Tambur (4)" gibi. Operatör hangi tableti açması gerektiğini görür.
 *
 * Multi-batch senaryosu: aynı WO'nun rulları farklı zamanlarda akabilir
 * (örn. 12 rulodan 4'ü Tambur'da, 4'ü Kurşun'da, 4'ü Boyahane'de).
 * `currentRolls` üzerinden gerçek dağılımı raporlar.
 */
export async function assertWoAtStepKind(
  workOrderId: string,
  expectedKind: StationKind,
): Promise<{ stepId: string; openRollCount: number }> {
  const targetStep = await prisma.workOrderStep.findFirst({
    where: { workOrderId, station: { kind: expectedKind } },
    select: { id: true, station: { select: { name: true } } },
    orderBy: { stepSequence: "asc" },
  });
  if (!targetStep) {
    throw AppError.notFound(
      `Bu iş emrinde ${expectedKind} adımı tanımlı değil`,
    );
  }

  const openRollCount = await prisma.rollMovement.count({
    where: { workOrderStepId: targetStep.id, exitedAt: null },
  });

  if (openRollCount > 0) {
    return { stepId: targetStep.id, openRollCount };
  }

  // Açık movement yok — WO'nun rulları gerçekte hangi adımlarda?
  const stepsWithRolls = await prisma.workOrderStep.findMany({
    where: { workOrderId, currentRolls: { some: {} } },
    select: {
      id: true,
      station: { select: { name: true } },
      _count: { select: { currentRolls: true } },
    },
    orderBy: { stepSequence: "asc" },
  });

  if (stepsWithRolls.length === 0) {
    throw AppError.badRequest(
      `Bu iş emrinin "${targetStep.station.name}" adımında işlenecek top yok ve şu an aktif başka bir adım da yok. (Üretim henüz başlamamış veya bitmiş.)`,
    );
  }

  const stepNames = stepsWithRolls
    .map((s) => `${s.station.name} (${s._count.currentRolls} rulo)`)
    .join(", ");
  throw AppError.badRequest(
    `Bu iş emrinin "${targetStep.station.name}" adımında şu an açık top yok. Mevcut konum: ${stepNames}. Tabletinizi yanlış istasyonda okutmuş olabilirsiniz.`,
  );
}
