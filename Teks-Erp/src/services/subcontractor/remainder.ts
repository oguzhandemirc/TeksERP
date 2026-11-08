// =============================================================================
// TeksERP - Subcontractor (Fason) Service / remainder
// =============================================================================
// Kalan kapama: "kalan gelmeyecek" (`closeRemainder`) ve geri alması (`reopenRemainder`).
// `subcontractor.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../subcontractor.service`) okunur.
// =============================================================================

/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (dispatch.ts sayılır) */
import { reopenClosedMovementsTx } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { RollStatus, RollVarianceKind, StationType, StepStatus, TravelerCardStatus, WorkOrderStatus, ScanType } from "@prisma/client";
import {
  recomputeStepStatus,
  ensureWorkOrderInProgress,
  // WO kapanışı YALNIZ bu helper'la yapılır — terminal guard (CANCELLED/SUPERSEDED
  // asla COMPLETED'a dirilmez) orada yaşıyor. Bu dosya eskiden aynı kuralı ÜÇ yerde
  // elle yazıyordu ve üçünde de guard yoktu (denetim 2026-08-09, F-FAS-ESZ-001).
  completeWorkOrderIfStepsDone,
} from "../helpers/roll-step.helper";
import { reopenWorkOrderTx } from "../helpers/workorder-event.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { setWorkOrderCardStatusesTx } from "../helpers/traveler-card-fanout.helper";
import { recordVarianceTx } from "../helpers/roll-variance.helper";
import { VARIANCE_SOURCES, validateVarianceReason } from "../../constants/variance-reasons";
import { assertWorkOrderBound } from "../helpers/dispatch-header.helper";
import { assertRollsRevivable } from "../helpers/item-usage.helper";
import { TERIM } from "../../constants/terim";
import { logTravelerScan } from "./receive";

export async function reopenRemainder(
    data: { stepId: string; rollId: string },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; restoredQty: number }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: { id: true, barcode: true, status: true, currentQty: true, directShipmentId: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    // Mal müşteride: geri alma "kararı" değil, olmayan malı fasona yazmak olurdu.
    if (roll.directShipmentId !== null) {
      throw AppError.conflict(
        "Bu top fasondan doğrudan müşteriye sevk edilmiş — fasona geri alınamaz.",
        { code: "ROLL_DIRECT_SHIPPED" },
      );
    }
    if (roll.status !== RollStatus.SUBCONTRACTOR_CONSUMED) {
      throw AppError.conflict(
        "Bu topun kalanı 'gelmeyecek' olarak kapatılmamış (ya da kapama zaten geri alınmış).",
        { code: "REMAINDER_NOT_CLOSED" },
      );
    }
    // ⚠️ DURUM TEK KANIT DEĞİLDİR: `SUBCONTRACTOR_CONSUMED` topun TAM KABULLE de
    // tüketilmiş olabileceğini söyler ve `stepId` gövdeden gelir. Geri alınacak
    // karar, bu adımın kapama DAMGASIDIR — yoksa geri alınacak bir şey de yoktur
    // (eski kapı bu yüzden kabul görmüş topu da fasona diriltiyordu).
    const closedItem = await prisma.subcontractorDispatchItem.findFirst({
      where: {
        rollId: data.rollId,
        remainderClosedAt: { not: null },
        // ⚠️ `directShippedAt` SÜZGECİ YOK ve bu bilinçli: kardeş top müşteriye
        // gidince sevk damgalanır, damgayı kapıya koymak MEŞRU bir kapamanın geri
        // alınmasını sonsuza dek imkânsız kılardı. "Mal müşteriye gitti" vakasını
        // topun KENDİ geçmişi tutuyor (yukarıdaki `directShipmentId` kapısı).
        dispatch: { stepId: data.stepId, cancelledAt: null },
      },
      select: {
        id: true,
        dispatch: {
          select: {
            workOrderId: true,
            step: { select: { stationId: true } },
            workOrder: { select: { status: true } },
          },
        },
      },
    });
    if (!closedItem) {
      throw AppError.conflict(
        "Bu adımda bu topun 'kalan gelmeyecek' kapaması yok — geri alınacak bir karar bulunamadı.",
        { code: "REMAINDER_NOT_CLOSED_AT_STEP" },
      );
    }
    const closedDispatch = closedItem.dispatch;
    assertWorkOrderBound(closedDispatch, "Kalan kapaması sevki"); // const bağ: daraltma tx kapanışına taşınır

    // İŞ EMRİ TERMİNALSE FAIL-CLOSED: iptal/superseded WO'nun adımına canlı top
    // geri konarsa çıkış yolu kalmaz (kart diriltilmez, iz yazılmaz, ikinci sevk
    // ve kabul iptali 409). DSK kilidi operatörü "WO iptal + kalan kapaması"
    // yoluna ittiği için bu şekle kolayca düşülüyordu.
    const woStatus = closedDispatch.workOrder.status;
    if (woStatus === WorkOrderStatus.CANCELLED || woStatus === WorkOrderStatus.SUPERSEDED) {
      throw AppError.conflict(
        `${TERIM.terbiyeIsEmri.cumleBasi.yalin} ${woStatus === WorkOrderStatus.CANCELLED ? "iptal edilmiş" : "yenisiyle değiştirilmiş"} — kalan kapaması geri alınamaz; top yeni bir ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} alınmalı.`,
        { code: "WORK_ORDER_TERMINAL" },
      );
    }

    await prisma.$transaction(async (tx) => {
      // Kilit closeRemainder ile AYNI (fason completion yarışı) ve tx'in İLK ifadesi.
      await touchWorkOrderTx(tx, closedDispatch.workOrderId);

      // Damganın kaldırılması atomik claim'dir: iki eşzamanlı geri almadan yalnız
      // biri kazanır (eski kod `updateMany` sayısını okumuyordu, ikisi de "başarılı").
      const unstamped = await tx.subcontractorDispatchItem.updateMany({
        where: { id: closedItem.id, remainderClosedAt: { not: null } },
        data: { remainderClosedAt: null },
      });
      if (unstamped.count !== 1) {
        throw AppError.conflict(
          "Kalan kapaması bu sırada başka bir işlemle geri alınmış. Listeyi yenileyin.",
          { code: "REMAINDER_ALREADY_REOPENED" },
        );
      }

      // Dirilme: kart Pasif olamaz (S5) — DB seddinin uygulama ikizi, çıkış yolunu söyler.
      await assertRollsRevivable(tx, [data.rollId]);
      const claimed = await tx.roll.updateMany({
        where: {
          id: data.rollId,
          status: RollStatus.SUBCONTRACTOR_CONSUMED,
          directShipmentId: null,
        },
        data: { status: RollStatus.AT_SUBCONTRACTOR, currentStepId: data.stepId },
      });
      if (claimed.count !== 1) {
        throw AppError.conflict(
          "Top bu sırada başka bir işlemle değişmiş. Listeyi yenileyip tekrar deneyin.",
        );
      }

      // Sapma satırını TERSLE (silme — append-only defter).
      await tx.rollVariance.updateMany({
        where: {
          rollId: data.rollId,
          workOrderStepId: data.stepId,
          source: VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER,
          reversedAt: null,
        },
        data: { reversedAt: new Date(), reversedById: userId ?? null },
      });

      // (Kapama damgası YUKARIDA kaldırıldı — claim'in kendisi o.)

      // Movement'ı yeniden AÇ — mal tekrar bu istasyonda bekliyor.
      await reopenClosedMovementsTx(tx, {
        where: {
          workOrderStepId: data.stepId,
          rollId: data.rollId,
          notes: { startsWith: "REMAINDER_CLOSED" },
        },
        reason: "FASON_REOPEN_REMAINDER",
        notes: "REMAINDER_REOPENED",
        userId: userId ?? null,
      });

      // Adım + İŞ EMRİ + REFAKAT KARTI diriltme sözleşmesi (emsal: manuel taşıma
      // `tambur-manual` / `manualMove`). Elle adım flip'i YETMEZ: son adımı fason
      // olan rotada `closeRemainder` WO'yu COMPLETED, kartı COMPLETED yapar; yalnız
      // adımı açmak "mal fasonda ama iş emri kapalı" durumu bırakır (ikinci sevk ve
      // kabul iptali 409 verir, kart okutulamaz).
      await recomputeStepStatus(tx, data.stepId);
      await ensureWorkOrderInProgress(tx, closedDispatch.workOrderId);
      if (await reopenWorkOrderTx(tx, closedDispatch.workOrderId, { trigger: "FASON_REOPEN_REMAINDER" })) {
        await setWorkOrderCardStatusesTx(
          tx,
          closedDispatch.workOrderId,
          TravelerCardStatus.COMPLETED,
          TravelerCardStatus.ACTIVE,
        );
      }

      // Refakat kartı izi — geri alma kartta görünmüyordu (denetim DÜŞÜK bulgusu).
      await logTravelerScan(
        tx,
        closedDispatch.workOrderId,
        closedDispatch.step.stationId,
        data.stepId,
        ScanType.INFO,
        userId,
        `Fason kalan kapaması geri alındı: ${roll.barcode ?? "barkodsuz top"} · ${Number(roll.currentQty)} m yeniden fasonda`,
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: data.rollId,
      newData: {
        event: "SUBCONTRACTOR_REMAINDER_REOPENED",
        stepId: data.stepId,
        barcode: roll.barcode,
        restoredQty: Number(roll.currentQty),
      },
    });

    return {
      success: true,
      data: { rollId: data.rollId, restoredQty: Number(roll.currentQty) },
      message: `Kalan kapaması geri alındı — top yeniden fasonda bekliyor.`,
    };
  }

export async function closeRemainder(
    data: {
      stepId: string;
      rollId: string;
      reasonCode: string;
      reasonText?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<{ rollId: string; closedQty: number }>> {
    const roll = await prisma.roll.findUnique({
      where: { id: data.rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentQty: true,
        currentStepId: true,
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status !== RollStatus.AT_SUBCONTRACTOR || roll.currentStepId !== data.stepId) {
      throw AppError.conflict(
        "Top bu adımda fasonda beklemiyor (kabul edilmiş ya da taşınmış olabilir). Listeyi yenileyin.",
      );
    }
    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: { select: { id: true, type: true } },
        workOrder: {
          select: {
            id: true,
            steps: { orderBy: { stepSequence: "asc" }, select: { id: true, status: true, stepSequence: true } },
          },
        },
      },
    });
    if (!step) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} adımı bulunamadı`);
    if (step.station.type !== StationType.EXTERNAL) {
      throw AppError.badRequest("Kalan kapama yalnızca fason adımlarında yapılabilir");
    }

    // Sebep ÖN doğrulaması — tx'e girmeden. Asıl yazma yine recordVarianceTx
    // içinden aynı kapıdan geçer; buradaki kontrol yalnız hatayı transaction
    // açılmadan ÖNCE çıkarır. (2026-08-26: `validateVarianceReason` artık kendisi
    // AppError 400 atıyor — eskiden düz Error'dı ve sarılmazsa 500 görünüyordu.
    // Sarmalayıcı kaldırıldı ki `details.code` kaybolmasın.)
    validateVarianceReason(RollVarianceKind.SCRAP, {
      reasonCode: data.reasonCode,
      reasonText: data.reasonText ?? null,
    });

    let closedQty = 0;
    await prisma.$transaction(async (tx) => {
      // Fason completion yarışı: receive/dispatch/cancel ile aynı WO kilidi.
      await touchWorkOrderTx(tx, step.workOrderId);

      // Kilit altında TAZE metraj — sapma defterine yazılacak miktar budur.
      const fresh = await tx.roll.findUnique({
        where: { id: data.rollId },
        select: { currentQty: true, status: true, currentStepId: true },
      });
      if (
        !fresh ||
        fresh.status !== RollStatus.AT_SUBCONTRACTOR ||
        fresh.currentStepId !== data.stepId
      ) {
        throw AppError.conflict(
          "Top bu sırada başka bir işlemle değişmiş. Listeyi yenileyip tekrar deneyin.",
        );
      }
      closedQty = Number(fresh.currentQty);
      // ÇIKIŞSIZ KAPAMA YASAK: `recordVarianceTx` 0 metrajda satır YAZMAZ
      // (helper başlığı: sapmanın tanımı gereği) — kalan 0 iken kapama yapılırsa
      // DURUM bayrağı basılır ama defterde satır olmaz, yani geri alınacak bir
      // defter kaydı da kalmaz. Kapama bir FİRE kararıdır; sıfır metrede karar yok.
      if (!(closedQty > 0)) {
        throw AppError.conflict(
          "Bu topun fasonda bekleyen kalanı yok (0 m) — kapatılacak bir şey bulunamadı.",
          { code: "REMAINDER_NOTHING_TO_CLOSE" },
        );
      }

      // ATOMİK CLAIM — receive'daki consume ile aynı desen.
      const claimed = await tx.roll.updateMany({
        where: { id: data.rollId, status: RollStatus.AT_SUBCONTRACTOR },
        data: { status: RollStatus.SUBCONTRACTOR_CONSUMED, currentStepId: null },
      });
      if (claimed.count !== 1) {
        throw AppError.conflict(
          "Top bu sırada başka bir işlemle değişmiş. Listeyi yenileyip tekrar deneyin.",
        );
      }

      // SAPMA DEFTERİ — fire kararı sebep zorunlu; geçersiz kod fail-closed
      // (validateVarianceReason). Kalan 0 ise satır yazılmaz (helper atlar).
      await recordVarianceTx(tx, {
        rollId: data.rollId,
        workOrderStepId: data.stepId,
        kind: RollVarianceKind.SCRAP,
        qty: fresh.currentQty,
        source: VARIANCE_SOURCES.SUBCONTRACTOR_REMAINDER,
        reasonCode: data.reasonCode,
        reasonText: data.reasonText ?? null,
        userId: userId ?? null,
      });

      // Açık sevk kalem(ler)ini damgala — outstanding filtreleri "kapandı" okur.
      await tx.subcontractorDispatchItem.updateMany({
        where: {
          rollId: data.rollId,
          remainderClosedAt: null,
          dispatch: { stepId: data.stepId, cancelledAt: null, directShippedAt: null },
        },
        data: { remainderClosedAt: new Date() },
      });

      // Açık movement'ı kapat (receive ile aynı sözleşme: qtyOut = qtyIn — sevk
      // edilen toplam bu istasyondan geçti; kayıp sapma defterinde).
      await tx.$executeRaw`
        UPDATE "roll_movements" rm
        SET "qtyOut"   = COALESCE(rm."qtyIn", r."currentQty"),
            "weightOut" = r."weightKg",
            -- tz-ok: "exitedAt" timestamptz — düz now() doğru anı yazar (eski sarmal yazım doğruluğu oturum tz'sine bağlıyordu).
            "exitedAt"  = now(),
            "notes"     = ${`REMAINDER_CLOSED:${data.reasonCode}`}
        FROM "rolls" r
        WHERE rm."rollId" = r."id"
          AND rm."workOrderStepId" = ${data.stepId}::uuid
          AND rm."exitedAt" IS NULL
          AND rm."revokedAt" IS NULL
          AND rm."rollId" = ${data.rollId}::uuid
      `;

      // Adım/WO kapanışı — receive ile aynı kurallar.
      const stillAtSubcontractor = await tx.roll.count({
        where: { currentStepId: data.stepId, status: RollStatus.AT_SUBCONTRACTOR },
      });
      if (stillAtSubcontractor === 0) {
        await tx.workOrderStep.update({
          where: { id: data.stepId },
          data: { status: StepStatus.COMPLETED, completedAt: new Date() },
        });
        const allSteps = step.workOrder.steps;
        const idx = allSteps.findIndex((s) => s.id === data.stepId);
        const nextStep =
          idx >= 0
            ? allSteps.slice(idx + 1).find((s) => s.status !== StepStatus.SKIPPED) ?? null
            : null;
        if (!nextStep) {
          await completeWorkOrderIfStepsDone(tx, step.workOrderId, { trigger: "FASON_CLOSE_REMAINDER" });
        }
      }

      // Refakat kartı izi.
      await logTravelerScan(
        tx,
        step.workOrderId,
        step.station.id,
        data.stepId,
        ScanType.INFO,
        userId,
        `Fason kalan kapatıldı (gelmeyecek): ${roll.barcode ?? "barkodsuz top"} · ${closedQty} m · sebep: ${data.reasonCode}`,
      );
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: data.rollId,
      newData: {
        event: "SUBCONTRACTOR_REMAINDER_CLOSED",
        stepId: data.stepId,
        closedQty,
        reasonCode: data.reasonCode,
        reasonText: data.reasonText ?? null,
      },
    });

    return {
      success: true,
      data: { rollId: data.rollId, closedQty },
      message: `Fasondaki kalan kapatıldı: ${roll.barcode ?? "barkodsuz top"} · ${closedQty} m fire olarak deftere yazıldı.`,
    };
  }
