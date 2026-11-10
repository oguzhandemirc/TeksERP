// =============================================================================
// Inventory Service / kursun
// =============================================================================
// Kurşun/KK2 bitirme (kursunFinish).
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { applyMeasuredWidthTx, assertStationCapturesWidth, type MeasuredWidthTrace } from "../helpers/measured-width.helper";
import { ACTIVE_OPERATION, prepareWidthTracedStepOpTx } from "../helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { recordRollDefectsTx } from "../helpers/roll-defect.helper";
import { ApiResponse } from "../../types/api.types";
import {
  Prisma,
  RollStatus,
  RollOperationType,
} from "@prisma/client";
import {
  ensureWorkOrderInProgress,
  openMovementForNextStep,
  recomputeStepStatus,
  completeWorkOrderIfStepsDone,
} from "../helpers/roll-step.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { hasBypassClosureOnQualityStepTx } from "../helpers/kursun-bypass-guard.helper";
import { assertKursunTabletMayWrite } from "../helpers/kursun-bypass-eligibility.helper";
import {
  assertPropertySelectionsValid,
  type PropertySelection,
  copyStationCapabilitiesToRoll,
  loadStationPropertyCaps,
  resolveKursunApplication,
} from "../helpers/station-capability-transfer.helper";
import { applyKursunOperationTx } from "../helpers/kursun-operation.helper";
import { stepCanApplyColor } from "../helpers/step-capability.helper";
import {
  STEP_FLOW_WHERE,
  STEP_FLOW_ERROR,
  STEP_FLOW_SELECT,
  stepRunsStepFlow,
} from "../helpers/quality-station.helper";
import { finalizeRollsAtLastStep } from "../helpers/roll-finalize.helper";

export async function kursunFinish(
    rollId: string,
    data: {
      /**
       * Opsiyonel. Yeni model: açık kumaş Roll fason kabulden zaten metrajlı
       * doğar (irsaliye değeri). KK2'de ölçüm yapılmadığı için `totalMeters`
       * verilmezse mevcut `currentQty` kullanılır. Boya'da fire/çekme varsa
       * operatör bunu manuel girebilir.
       */
      totalMeters?: number;
      /**
       * Opsiyonel batch hata kaydı. Yeni akışta operatör hataları KK2 ekranında
       * "Hata Ekle" ile tek tek girer (reportError endpoint'i); burası genelde
       * boş gönderilir. Verilirse RollError olarak eklenir.
       */
      errors?: Array<{
        startMeter: number;
        defectTypeId?: string | null;
      }>;
      notes?: string | null;
      /**
       * Operatörün cevapları (2026-08-10 mod + 2026-08-11 değer sözleşmesi).
       * AUTO satırlar gönderilmese de yazılır; eski APK bu alanı hiç göndermez
       * → yalnız AUTO uygulanır (bugünkü sonuç). SEÇİM tipli özellikte
       * `valueCode` ZORUNLUDUR.
       *
       * Sözleşme `kursun-qc.completeQc2` ile BİREBİR — iki tablet yolu aynı
       * özelliği farklı kurallarla uygularsa aynı top iki yoldan iki farklı
       * özellik kümesi kazanır.
       */
      properties?: PropertySelection[] | null;
      /** D4-E2a ölçülen en (cm) — completeQc2 ile BİREBİR; yalnız `Station.capturesWidth` istasyonunda. */
      measuredWidthCm?: number | null;
    },
    userId?: string,
    /** PROCESS_QC makine atfı — aktif çalışma oturumundan (controller çözer).
     *  QC2/KURSUN op'larına + kapanan movement'a damgalanır. */
    machineId?: string | null,
  ): Promise<ApiResponse<{ rollId: string; totalMeters: number; nextStepId: string | null }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      include: {
        currentStep: {
          include: {
            // `appliesColor` + `requiredCategory`: adım renk verebiliyor mu (tek yüklem
            // stepCanApplyColor) — bitişte renksiz topa WO hedef rengi yazılır (3c).
            station: { select: { ...STEP_FLOW_SELECT, appliesColor: true } },
            requiredCategory: { select: { appliesColor: true } },
            workOrder: {
              include: {
                steps: {
                  orderBy: { stepSequence: "asc" },
                  select: { id: true, stepSequence: true, status: true },
                },
              },
            },
          },
        },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.barcode) {
      throw AppError.badRequest(
        "Bu Roll açık kumaş değil (barkodlu top); kursun-finish sadece açık kumaş Roll'larında çağrılır",
      );
    }
    // Idempotency: aynı çağrı offline sync replay'inde 2. kez gelirse roll
    // PROCESS_QC'yi çoktan bırakmış olur. Geçmiş bir PROCESS_QC step'inde
    // QC2_COMPLETED RollOperation'ı varsa "zaten yapıldı" diye success dön
    // (duplicate movement/RollError yaratma riski yok — bu noktada zaten
    // ileri taşınmış).
    if (!roll.currentStep || !stepRunsStepFlow(roll.currentStep.station)) {
      const priorFinish = await prisma.rollOperation.findFirst({
        where: { ...ACTIVE_OPERATION,
          rollId,
          operationType: RollOperationType.QC2_COMPLETED,
          step: { station: { ...STEP_FLOW_WHERE } },
        },
        select: { id: true, workOrderStepId: true },
      });
      if (priorFinish) {
        return {
          success: true,
          data: {
            rollId,
            totalMeters: Number(roll.currentQty),
            nextStepId: roll.currentStepId,
          },
          message:
            "Roll PROCESS_QC adımını zaten bitirmiş (idempotent retry).",
        };
      }
      // KURŞUN BYPASS ikinci sondası: bypass kapanışı QC2_COMPLETED YAZMAZ, bu
      // yüzden yukarıdaki sonda onu göremez. İş dağıtılıp Tambur'da kapandıysa
      // adım GERÇEKTEN tamamlanmıştır — tabletin offline kuyruğundan geç gelen
      // istek teknik bir 400 değil, idempotent başarı almalı.
      if (await hasBypassClosureOnQualityStepTx(prisma, rollId)) {
        return {
          success: true,
          data: {
            rollId,
            totalMeters: Number(roll.currentQty),
            nextStepId: roll.currentStepId,
          },
          message:
            "Kurşun adımı dağıtım (bypass) ile kapatılmış — bu istek yok sayıldı (idempotent retry).",
        };
      }
      if (!roll.currentStep) {
        throw AppError.badRequest("Roll bir step'te değil");
      }
      // ⚠️ Metin yüklemle AYNI dili konuşur: yukarıdaki koşul artık yeteneğe
      // bakıyor, mesaj "tür" derse yeteneği kapalı ama türü PROCESS_QC olan bir
      // adımda operatör yanlış teşhis okur. Mevcut istasyon adı/tür bağlam
      // olarak kalır.
      throw AppError.badRequest(
        `${STEP_FLOW_ERROR} (topun bulunduğu adım: ${roll.currentStep.station.kind})`,
      );
    }

    // totalMeters opsiyonel — verilmezse mevcut currentQty (fason kabulden gelen
    // irsaliye değeri) kullanılır. Verilirse pozitif olmalı.
    if (data.totalMeters !== undefined && !(data.totalMeters > 0)) {
      throw AppError.badRequest("Toplam metraj pozitif olmalı");
    }
    const totalMeters = data.totalMeters ?? Number(roll.currentQty);
    if (totalMeters <= 0) {
      throw AppError.badRequest(
        "Roll metrajı sıfır — fason kabulde açık kumaş metresi girilmedi mi?",
      );
    }

    // Hata listesi: kapı (muayene yeteneği, bilinçli fark K2), metre, varsayılan/pasif
    // tip ve mükerrer kuralları TEK boğazda (`recordRollDefectsTx`, KQ-D7) — tx içinde.
    const rawErrors = data.errors ?? [];

    const allSteps = roll.currentStep.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === roll.currentStepId);
    const nextStep = currentIndex < allSteps.length - 1 ? allSteps[currentIndex + 1] : null;

    const stepId = roll.currentStep.id;
    const stationId = roll.currentStep.stationId;
    const woId = roll.currentStep.workOrderId;
    // 3c için: adım renk verebiliyor mu + WO hedef rengi (tx closure'ında narrowing
    // kaybolduğu için burada, null-guard SONRASI çözülür).
    const stepAppliesColor = stepCanApplyColor(roll.currentStep.station, roll.currentStep.requiredCategory);
    const woTargetColorId = roll.currentStep.workOrder.targetColorId;

    // Kurşun yeteneği per-station + MOD (2026-08-10): KURSUN_APPLIED log'u ile
    // RollProperty(KURSUN) yazımı AYNI karardan beslenir — AUTO ise her zaman,
    // OPTIONAL/REQUIRED ise ancak operatör işaretlediyse. Ayrışırlarsa log
    // "kurşun geçildi" derken topun özelliği boş kalırdı.
    const stationCaps = await loadStationPropertyCaps(prisma, stationId);
    assertPropertySelectionsValid(stationCaps, data.properties);
    // KQ-D4: tek karar (`resolveKursunApplication`) — completeQc2 ile AYNI fonksiyon.
    const kursun = resolveKursunApplication(stationCaps, data.properties);
    const measuredWidthCm = data.measuredWidthCm ?? null;
    if (measuredWidthCm != null) await assertStationCapturesWidth(prisma, stationId);

    // Eşzamanlı çift çağrıda kaybeden tx movement kapatmada 0 satır eşler →
    // tüm tx (mükerrer RollError'lar dahil) geri sarılır, idempotent cevap döner.
    let raceLost = false;
    let widthTrace: MeasuredWidthTrace | null = null;
    try {
    await prisma.$transaction(async (tx) => {
      // F162: O-2 write-skew guard (finishStep paritesi) — son-adım WO oto-tamamlama
      // sayımını eşzamanlı fason receive/cancel/finalize ile serileştir.
      await touchWorkOrderTx(tx, woId);

      // Kurşun bypass: ÜÇÜNCÜ tablet yazma yolu (kursun-qc finishStep/completeQc2
      // ile aynı işi tek çağrıda yapar — metraj + QC2/KURSUN op + movement kapama
      // + Tambur'a ilerletme). Adım dağıtılmışsa hepsi yasak: bypass rejiminde
      // KK2 kaydı YAZILMAZ ve kapanış marker'ı KURSUN_BYPASS_FINISHED olmalıdır.
      // WO kilidinin altında — `assign` de aynı kilidi alır, yarış serileşir.
      // İdempotent erken dönüş (roll PROCESS_QC'yi çoktan bırakmış + geçmiş
      // QC2_COMPLETED var → `priorFinish` dalı) tx'e hiç girmeden çalışır, yani
      // zaten bitmiş işin retry'ı 409 gürültüsü yapmaz.
      await assertKursunTabletMayWrite(tx, stepId, "kurşun bitirme");

      // D4-E2a: iş emri kilidinden sonra top FOR UPDATE → en atomik yazım; iz QC2 satırına.
      // Aynı enle örtüşen çift çağrı (zaman aşımı sonrası yeniden deneme) completeQc2 gibi idempotent.
      if (measuredWidthCm != null) {
        const mode = await prepareWidthTracedStepOpTx(tx, { rollId, stepId, measuredWidthCm, userId: userId ?? null });
        if (mode === "SAME") {
          raceLost = true;
          throw new Error("KURSUN_FINISH_RACE_LOST");
        }
        widthTrace = await applyMeasuredWidthTx(tx, { rollId, measuredWidthCm });
      }

      // 1) Roll metraj güncelle
      await tx.roll.update({
        where: { id: rollId },
        data: {
          initialQty: totalMeters,
          currentQty: totalMeters,
        },
      });

      // 2) RollError'lar toplu — tek yazma boğazı (KK2/Tambur ile aynı kurallar).
      await recordRollDefectsTx(tx, {
        rollId,
        stepId,
        userId,
        stationGate: "FLOW",
        defects: rawErrors,
        maxMeter: totalMeters,
      });

      // 3) RollOperation: QC2_COMPLETED (her zaman) + KURSUN_APPLIED (istasyonda
      //    KURSUN özelliği yetenek olarak atanmışsa). Eskiden ikisi de koşulsuzdu;
      //    per-roll Kurşun toggle'ı kaldırıldı, kurşun artık istasyon yeteneği.
      const ops: Prisma.RollOperationCreateManyInput[] = [
        {
          rollId,
          workOrderStepId: stepId,
          operationType: RollOperationType.QC2_COMPLETED,
          operatorId: userId ?? null,
          machineId: machineId ?? null,
          metadata: {
            totalMeters: totalMeters,
            errorCount: rawErrors.length,
            notes: data.notes ?? null,
            ...(widthTrace ?? {}),
          } as Prisma.InputJsonValue,
        },
      ];
      const createdOps = await tx.rollOperation.createMany({ data: ops, skipDuplicates: true });
      // En izi satırla birlikte doğmalı; prepareWidthTracedStepOpTx aktif satırı ayıkladı — buraya düşmek beklenmez.
      if (widthTrace && createdOps.count === 0) {
        throw AppError.conflict("Bu topun KK2 kaydı zaten var — eni değiştirmek için adımı yeniden açın", { code: "WIDTH_ALREADY_RECORDED" });
      }
      // Kurşun satırı (gramaj değeriyle) tek yazardan — düzeltme = damga + yeni satır.
      if (kursun.applied) {
        await applyKursunOperationTx(tx, {
          rollId,
          stepId,
          valueId: kursun.valueId,
          userId: userId ?? null,
          machineId: machineId ?? null,
          metadata: { totalMeters: totalMeters } as Prisma.InputJsonValue,
        });
      }

      // 3b) İstasyon yetenekleri Roll'a kopyalanır — AUTO satırlar + operatörün
      //     işaretledikleri (mod sözleşmesi, station-capability-transfer.helper).
      await copyStationCapabilitiesToRoll(tx, {
        stationId,
        rollId,
        selections: data.properties,
        caps: stationCaps,
      });

      // 3c) RENK (2026-08-21): adım renk verebiliyorsa (istasyon bayrağı / fason
      //     hizmeti — tek yüklem `stepCanApplyColor`, kilit helper'ı ile aynı) ve
      //     top renksizse iş emrinin hedef rengi yazılır. Fason kabulün iç istasyon
      //     aynası: kilit "bu adım renk verir" sayıyorsa bitişi de rengi vermeli —
      //     yoksa top renksiz kalır ve Tambur kapısı her topu durdurur. Bugün
      //     prod'da iç boyahane yok; tanımlandığı gün kendiliğinden çalışır.
      if (roll.colorId == null && woTargetColorId && stepAppliesColor) {
        await tx.roll.update({
          where: { id: rollId },
          data: { colorId: woTargetColorId },
        });
      }

      // 4) Kurşun/KK2 movement'ı kapat (qtyOut = ölçülen toplam metre)
      //    ATOMİK CLAIM (BL-3 kardeşi): idempotency guard'ı tx DIŞINDA — iki
      //    eşzamanlı çağrı ikisi de geçer ve Tambur'da İKİNCİ açık movement +
      //    mükerrer RollError üretirdi. 0 satır = kaybeden → tx geri sar.
      const closedMove = await tx.rollMovement.updateMany({
        where: {
          ...ACTIVE_MOVEMENT,
          rollId,
          workOrderStepId: stepId,
          exitedAt: null,
        },
        data: {
          qtyOut: totalMeters,
          exitedAt: new Date(),
          // İşin YAPILDIĞI makine kapanışta damgalanır (açılışta makine belirsiz —
          // movement bir SONRAKİ istasyon için açılır, oradaki makine henüz bilinmez).
          ...(machineId ? { machineId } : {}),
        },
      });
      if (closedMove.count === 0) {
        raceLost = true;
        throw new Error("KURSUN_FINISH_RACE_LOST");
      }

      // 5) Sonraki step (Tambur) için movement aç + Roll.currentStepId.
      // Status IN_PRODUCTION — Tambur cutOpenFabric bunu zorunlu kılar.
      if (nextStep) {
        await openMovementForNextStep(tx, {
          rollId,
          nextStepId: nextStep.id,
          qty: totalMeters,
          weight: null,
          userId: userId ?? null,
          notes: `KURSUN_FINISHED:${stepId}`,
          rollStatus: RollStatus.IN_PRODUCTION,
        });
      } else {
        // Sonraki step yok — rota bu (Tambur-dışı) açık-kumaş adımıyla bitiyor. Artık
        // MEŞRU: top FİNAL'e çekilir (kaliteye göre WAREHOUSE; finalizeRollsAtLastStep),
        // currentStepId=null, form=ACIK, barkodsuz açık kumaşa barkod üretilir. PRODUCED YOK.
        await finalizeRollsAtLastStep(tx, [rollId], { stageStepId: stepId });
      }

      await recomputeStepStatus(tx, stepId);
      await ensureWorkOrderInProgress(tx, woId);
      // F162: rota PROCESS_QC ile bitiyorsa (nextStep yok) ve tüm adımlar bittiyse
      // WO + refakat kartı COMPLETED'a çekilir — 'sonsuza-dek IN_PROGRESS' bug'ı kapanır.
      if (!nextStep) {
        await completeWorkOrderIfStepsDone(tx, woId, { trigger: "KURSUN_FINISH" });
      }
    });
    } catch (e) {
      if (raceLost) {
        return {
          success: true,
          data: {
            rollId,
            totalMeters: totalMeters,
            nextStepId: nextStep?.id ?? null,
          },
          message: "Bu top için Kurşun/KK2 zaten tamamlanmış (eşzamanlı çift istek — idempotent).",
        };
      }
      throw e;
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: {
        kursunFinished: true,
        totalMeters: totalMeters,
        errorCount: rawErrors.length,
        nextStepId: nextStep?.id ?? null,
        // Operatörün elle işaretledikleri (SEÇİM tipinde valueCode ile) —
        // completeQc2 audit'i ile aynı iz; AUTO'lar bu listede olmayabilir (F2).
        selections: data.properties ?? [],
        // KQ-D4: basılan kurşun gramajı (çeşit bağı yoksa / seçilmediyse null).
        kursunApplied: kursun.applied,
        valueCode: kursun.valueCode,
        // D4-E2a: ölçülen en (iz QC2 satırında da).
        ...(widthTrace ?? {}),
      },
    });

    return {
      success: true,
      data: {
        rollId,
        totalMeters: totalMeters,
        nextStepId: nextStep?.id ?? null,
      },
      message: nextStep
        ? `Kurşun/KK2 tamamlandı (${totalMeters} mt). Roll Tambur step'ine ilerletildi.`
        : `Kurşun/KK2 tamamlandı (${totalMeters} mt). Sonraki step yok — Roll final (depoya alındı).`,
    };
  }
