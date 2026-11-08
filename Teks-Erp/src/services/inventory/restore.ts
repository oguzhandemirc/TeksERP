// =============================================================================
// Inventory Service / restore
// =============================================================================
// İptal edilen topu geri alma (restoreCancelledRoll) ve hardDelete.
// `inventory.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../inventory.service`) okunur.
// =============================================================================

import { auditCutReadings, reinstateCancelledCutReadingsTx } from "../helpers/meter-reading.helper";
import { ACTIVE_OPERATION } from "../helpers/roll-operation.helper";
import { ACTIVE_MOVEMENT } from "../helpers/roll-movement.helper";
import prisma from "../../lib/prisma";
import { reconsumeForRollTx } from "../warp-beam-auto-consume.service";
import { AuditService } from "../audit.service";
import { warehouseStampManyTx } from "../helpers/warehouse.helper";
import { reverseLatestScopedStockMove } from "../helpers/warehouse-ledger-reverse.helper";
import { WAREHOUSE_STOCK_STATUSES } from "../helpers/warehouse-stock.helper";
import { STOCK_MOVE_REASON } from "../../constants/stock-move-reasons";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  resolveRollRestoreBlockReason,
  resolveRestoreTargetStatus,
} from "../helpers/roll-cancel-restore.helper";
import {
  Roll,
  RollStatus,
  RollEntrySource,
  StepStatus,
} from "@prisma/client";
import {
  recomputeStepStatus,
} from "../helpers/roll-step.helper";
import { collectRollStepScopeTx } from "../helpers/roll-step-scope.helper";
import { touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { assertRollsRevivable } from "../helpers/item-usage.helper";
import { noteStatusOf } from "./shared";

export async function restoreCancelledRoll(
    id: string,
    userId?: string,
    opts?: { reason?: string },
  ): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true,
        barcode: true,
        status: true,
        // Mesajda "ham stokta" mı "yarı mamul stoğunda" mı denileceğini belirler.
        entrySource: true,
        preCancelStatus: true,
        batchId: true,
        sackId: true,
        shipmentId: true,
        currentStepId: true,
        cancelReason: true,
        cancelReasonCode: true,
      },
    });
    if (!existing) throw AppError.notFound("Top bulunamadı");
    // Dirilme: kart Pasif olamaz (S5) — DB seddinin uygulama ikizi, çıkış yolunu söyler.
    await assertRollsRevivable(prisma, [id]);

    // Sinyaller tek turda toplanır; yüklem hiçbir şey okumaz.
    const [movementCount, operationCount, childCount, dispatchItemCount, kartelaItemCount, deliveryNoteStatus] =
      await Promise.all([
        prisma.rollMovement.count({ where: { ...ACTIVE_MOVEMENT, rollId: id } }),
        prisma.rollOperation.count({ where: { ...ACTIVE_OPERATION, rollId: id } }),
        prisma.roll.count({ where: { parentRollId: id } }),
        prisma.subcontractorDispatchItem.count({ where: { rollId: id } }),
        prisma.kartelaDispatchItem.count({ where: { rollId: id } }),
        noteStatusOf(id),
      ]);

    const blockReason = resolveRollRestoreBlockReason({
      status: existing.status,
      preCancelStatus: existing.preCancelStatus,
      batchId: existing.batchId,
      sackId: existing.sackId,
      shipmentId: existing.shipmentId,
      currentStepId: existing.currentStepId,
      cancelReasonCode: existing.cancelReasonCode,
      movementCount,
      operationCount,
      childCount,
      dispatchItemCount,
      kartelaItemCount,
      deliveryNoteStatus,
    });
    if (blockReason) {
      throw AppError.conflict(blockReason, { code: "RESTORE_BLOCKED" });
    }

    const target = resolveRestoreTargetStatus(existing.preCancelStatus);

    // ATOMİK CLAIM: guard'lar tx dışında okundu; pencerede başka bir işlem topu
    // değiştirdiyse (ör. arşivleme, yeniden iptal) kaybeden 409 alır.
    //
    // ⚠️ BU YOL ARTIK TRANSACTION AÇIYOR (eskiden hiç açmıyordu): claim ile ters
    // kayıt AYNI işlemde olmak ZORUNDA. Ayrı olsalardı claim commit olup ters
    // satır düşebilir ve top rafa dönerken defter dönmediğini söylerdi — ölçüldü
    // (2026-09-12): bu yol defter satırı hiç yazmadığı için iptali geri alma
    // depo defterini KALICI olarak 75 m eksik bırakıyordu.
    //
    // ⚠️ Claim kaybedilirse tx İÇİNDE fırlatılmaz: dönen 0 ile dışarıda 409
    // atılır, böylece "kaybeden" ile "gerçek hata" ayrı yollardan geçer.
    const { claimCount, ledger, cutReadings } = await prisma.$transaction(async (tx) => {
      // Hedef STOK KÜMESİNDEYSE depo damgası terfinin parçası (claim'den ÖNCE —
      // sonra `status` değişmiş olur ve yüklem eşleşmez). İptal edilmiş bir topun
      // deposu NULL olabilir; damgasız hâlde top "depoda ama hangi depoda belli
      // değil" olarak dirilirdi. Damga mevcut depoyu EZMEZ.
      if (WAREHOUSE_STOCK_STATUSES.includes(target)) {
        await warehouseStampManyTx(tx, [id]);
      }
      const c = await tx.roll.updateMany({
        where: { id, status: RollStatus.CANCELLED },
        data: {
          status: target,
          // İz TEMİZLENİR: top artık iptal değil. Sebep audit'te kalır (aşağıda),
          // yani "bir zamanlar iptal edilmişti" bilgisi kaybolmaz — ama satır
          // "şu an iptal" demeyi bırakır, çünkü değil.
          cancelledAt: null,
          cancelledById: null,
          cancelReason: null,
          cancelReasonCode: null,
          preCancelStatus: null,
        },
      });
      if (c.count === 0) return { claimCount: 0, ledger: null, cutReadings: [] };
      // D4-B1b: iptalin CUT damgası terslenir (yeni satır; damgalı satır kalır) — dirilen top okumasız kalmasın.
      const cr = await reinstateCancelledCutReadingsTx(tx, { rollId: id, userId: userId ?? null });
      // DEPO DEFTERİ — iptalin ÇIKIŞ satırı terslenir. Kapsam ZORUNLU ve bu yol
      // bir ADIMA AİT DEĞİL, o yüzden `workOrderStepId: null` AÇIKÇA geçilir:
      // "unutuldu" ile "adımı yok" ayrımı kaybolursa kapsamsız ters kayıt sınıfı
      // geri döner. Satır bulunamazsa (0 metrajlı ya da stok dışı iptal) sayı
      // döner ve audit yüküne yazılır — sessizce geçilmez.
      const l = await reverseLatestScopedStockMove(
        tx,
        [id],
        { reasonCode: STOCK_MOVE_REASON.ROLL_CANCEL, workOrderStepId: null },
        {
          reasonCode: STOCK_MOVE_REASON.CANCEL_RESTORE,
          userId: userId ?? null,
          notes: opts?.reason?.trim() || null,
        },
      );
      // LEVENT TÜKETİMİ (Faz 4) yeniden ileri yol: top dirildi, çözgü yine düşer (bayrak kapalıysa satır yok).
      const restoredRow = await tx.roll.findUniqueOrThrow({ where: { id }, select: { id: true, doffEventId: true, initialQty: true } });
      await reconsumeForRollTx(tx, restoredRow, userId ?? null);
      return { claimCount: c.count, ledger: l, cutReadings: cr };
    });
    if (claimCount === 0) {
      throw AppError.conflict(
        "Top bu sırada başka bir işleme girdi — listeyi yenileyip tekrar deneyin.",
      );
    }

    const restored = await prisma.roll.findUniqueOrThrow({ where: { id } });
    await auditCutReadings(userId, cutReadings);

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: id,
      oldData: {
        status: RollStatus.CANCELLED,
        cancelReason: existing.cancelReason,
        cancelReasonCode: existing.cancelReasonCode,
      },
      newData: {
        status: target,
        event: "CANCEL_RESTORED",
        reason: opts?.reason?.trim() || null,
        // Terslenen/atlanan satır sayıları: "defterde olması gereken çıkış yok"
        // (bulunamayan) ve "ucu kurulamayan eski satır" (statüsüz) sessiz kalmaz.
        ...(ledger ? { defter: ledger } : {}),
      },
    });

    return {
      success: true,
      data: restored,
      // ⚠️ "ham stokta" YALNIZ gerçekten ham olan mal için doğru. Yarı mamul topu
      // da STOCK'a döner ama Envanter'de "Yarı Mamul" sekmesinde durur — mesaj
      // onu ham stokta arattırırdı (2026-08-27).
      message: `İptal geri alındı — top ${existing.barcode ?? ""} tekrar ${
        target !== RollStatus.STOCK
          ? "envanterde"
          : existing.entrySource === RollEntrySource.SEMI_FINISHED
            ? "yarı mamul stoğunda"
            : "ham stokta"
      }.`.trim(),
    };
  }

export async function hardDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({ where: { id } });

    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (
      existing.status !== RollStatus.STOCK &&
      existing.status !== RollStatus.SCRAP &&
      existing.status !== RollStatus.CANCELLED
    ) {
      throw AppError.badRequest(
        "Sadece STOCK / SCRAP / CANCELLED durumundaki toplar arşivlenebilir",
      );
    }

    // Zaten arşivli — idempotent
    if (
      existing.status === RollStatus.SCRAP ||
      existing.status === RollStatus.CANCELLED
    ) {
      return {
        success: true,
        data: existing,
        message: `Top zaten arşivli: ${existing.barcode}`,
      };
    }

    // STOCK → CANCELLED (F113/O-1). Atomik claim: hâlâ STOCK iken çek —
    // eşzamanlı prepareRawForSale/fason sevk topu
    // STOCK'tan çıkardıysa count===0 → 409 (koşulsuz update dangling CANCELLED
    // üretiyordu). CANCELLED top hiçbir istasyon/sevk/çuval referansı taşımamalı.
    const updated = await prisma.$transaction(async (tx) => {
      // ── ETKİ ALANI (2026-08-15 düzeltmesi) ───────────────────────────────
      // Buradaki boşluk `softDelete`'inkinin AYNISI, ama daha kötüsüydü: recompute
      // `if (existing.currentStepId)` dalının İÇİNDEYDİ ve arşivleme yalnız STOCK
      // topa uygulandığı için o alan tanımı gereği NULL'dur → recompute NORMAL
      // YOLDA HİÇ KOŞMUYORDU. Eski yorum bunu "anomali/defansif" diye niteliyordu;
      // yanlıştı: STOCK top pekâlâ KAPALI hareket taşır (detach → renksiz top
      // STOCK'a döner) ve arşivleme onu adım sayımından düşürür. Canlı ölçüm
      // (2026-08-15): 4 STOCK top hareket kaydı taşıyor.
      const scope = await collectRollStepScopeTx(tx, [id], [existing.currentStepId]);
      for (const woId of scope.workOrderIds) await touchWorkOrderTx(tx, woId);

      const claim = await tx.roll.updateMany({
        where: { id, status: RollStatus.STOCK },
        data: {
          status: RollStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId ?? null,
          currentStepId: null,
          shipmentId: null,
          sackId: null,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Top az önce başka bir akışa girdi (durumu değişti) — tekrar deneyin",
        );
      }

      // Açık movement'ları kapat — qtyOut = 0 (storno; `softDelete` ile aynı semantik).
      //
      // ⚠️ NOT EZİLMİYOR: burada `notes` körlemesine "ARCHIVED" yazılıyordu ve bu,
      // `softDelete`'te 2026-08-04'te düzeltilen not-ezme hatasının hâlâ açık
      // kopyasıydı (elle eklenen topun "TAMBUR_MANUAL_ROLL: <sebep>" izi siliniyordu).
      const openMovements = await tx.rollMovement.findMany({
        where: { ...ACTIVE_MOVEMENT, rollId: id, exitedAt: null },
        select: { id: true, notes: true },
      });
      for (const m of openMovements) {
        await tx.rollMovement.update({
          where: { id: m.id, ...ACTIVE_MOVEMENT },
          data: {
            exitedAt: new Date(),
            qtyOut: 0,
            weightOut: 0,
            notes: m.notes?.trim() ? `ARCHIVED (${m.notes.trim()})`.slice(0, 500) : "ARCHIVED",
          },
        });
      }

      // Claim'den SONRA (sayaçlar topun statüsünü okur — bkz. softDelete notu).
      //
      // ⚠️ `completedAt` VERİ KAYBI, `softDelete` ile AYNI: COMPLETED'tan düşen
      // adım damgasını geri dönülemez kaybeder. Bu yüzden iz de aynı şekilde
      // audit'e yazılır — 2026-08-15 denetiminde bu dal atlanmıştı ve "arşivleme"
      // tam da recompute'un ESKİDEN HİÇ KOŞMADIĞI yol, yani kaybın YENİ doğduğu
      // yerdi (softDelete'te iz kalıyor, burada kalmıyordu).
      const stepChanges: Array<{
        stepId: string;
        from: StepStatus;
        to: StepStatus;
        /** ISO metin — audit JSON'ına Date koymak sessiz serileştirme sürprizi doğurur. */
        previousCompletedAt: string | null;
      }> = [];
      for (const st of scope.steps) {
        const next = await recomputeStepStatus(tx, st.id);
        if (next !== st.status) {
          stepChanges.push({
            stepId: st.id,
            from: st.status,
            to: next,
            previousCompletedAt: st.completedAt ? st.completedAt.toISOString() : null,
          });
        }
      }
      return { roll: await tx.roll.findUniqueOrThrow({ where: { id } }), stepChanges };
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "ROLL",
      recordId: id,
      oldData: {
        barcode: existing.barcode,
        status: existing.status,
        currentQty: existing.currentQty,
      },
      newData: {
        status: RollStatus.CANCELLED,
        event: "ARCHIVED",
        stepStatusChanges: updated.stepChanges.length ? updated.stepChanges : undefined,
      },
    });

    return {
      success: true,
      data: updated.roll,
      message: `Top arşivlendi: ${existing.barcode}`,
    };
  }
