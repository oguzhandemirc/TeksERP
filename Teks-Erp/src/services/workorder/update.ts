// =============================================================================
// TeksERP - WorkOrder (Parti) Service / update
// =============================================================================
// İş emri başlık güncellemesi (update).
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { isOrderlessWorkOrderType } from "../helpers/workorder-customer-goods.helper";
import {
  WorkOrderStatus,
  type MaterialProvider,
} from "@prisma/client";
import {
  recordWorkOrderFieldDiffTx,
} from "../helpers/workorder-field-diff.helper";
import { computeWorkOrderLocks, touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { assertTargetColorChange } from "../helpers/workorder-target-color.helper";
import { applyFoldTypeForWriteInPlace } from "../helpers/fold-type";
import { markTravelerCardDirtyTx } from "../helpers/traveler-card-dirty.helper";
import { diffFields } from "../helpers/audit-diff.helper";
import { assertItemUsable, assertItemUsableTx } from "../helpers/item-usage.helper";
import { TERIM } from "../../constants/terim";
import { assertStartedEditAllowed, assertWorkOrderNumberUnchanged, normNum } from "./shared";

interface PlannedFieldsPatch {
  width?: number | null;
  targetQuantity?: number | null;
  targetWeight?: number | null;
  plannedStartDate?: Date | null;
  plannedEndDate?: Date | null;
  targetItemId?: string | null;
  targetColorId?: string | null;
  foldType?: string | null;
  materialProvidedBy?: MaterialProvider | null;
}

/** Gövdedeki plan alanları yazım biçiminde: gönderilmeyen = undefined, null = temizle. */
function plannedFieldsFromPatch(data: {
  width?: number | null; targetQuantity?: number | null; targetWeight?: number | null;
  plannedStartDate?: string | null; plannedEndDate?: string | null;
  targetItemId?: string | null; targetColorId?: string | null; foldType?: string | null;
  materialProvidedBy?: MaterialProvider | null;
}): PlannedFieldsPatch {
  const date = (v: string | null | undefined) => (v ? new Date(v) : v === null ? null : undefined);
  return {
    width: data.width,
    targetQuantity: data.targetQuantity,
    targetWeight: data.targetWeight,
    plannedStartDate: date(data.plannedStartDate),
    plannedEndDate: date(data.plannedEndDate),
    targetItemId: data.targetItemId,
    targetColorId: data.targetColorId,
    foldType: data.foldType,
    materialProvidedBy: data.materialProvidedBy,
  };
}

export async function update(
    id: string,
    data: {
      batchNumber?: string;
      width?: number | null;
      targetQuantity?: number | null;
      targetWeight?: number | null;
      plannedStartDate?: string | null;
      plannedEndDate?: string | null;
      targetItemId?: string | null;
      targetColorId?: string | null;
      foldType?: string | null;
      materialProvidedBy?: MaterialProvider | null;
    },
    userId?: string,
    /** Renk değişikliğinde kısmi-boya onayı (409 `COLOR_PARTIAL_CONFIRM` sonrası tekrar). */
    opts: { confirmPartial?: boolean } = {},
  ): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        `Tamamlanmış veya iptal edilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} düzenlenemez.`,
      );
    }
    assertWorkOrderNumberUnchanged(wo.workOrderNumber, data.batchNumber);
    assertStartedEditAllowed(wo.status, {
      color: data.targetColorId !== undefined && (wo.targetColorId ?? null) !== (data.targetColorId ?? null),
      width: data.width !== undefined && normNum(wo.width) !== normNum(data.width),
    });
    // Renk gerçekten değişiyor mu — TEK BEKÇİ yalnız gerçek değişiklikte koşar
    // (PATCH kısmi semantiği: aynı değeri yeniden göndermek serbesttir).
    const colorChanging =
      data.targetColorId !== undefined &&
      (wo.targetColorId ?? null) !== (data.targetColorId ?? null);
    const colorWarnings: string[] = [];

    // Kat katalog doğrulaması — kilit karşılaştırmalarından ÖNCE kanonikleştir.
    // Sonra yapılsaydı "tüp" gönderen istemci, WO'da "TÜP" dururken alanı
    // DEĞİŞMİŞ sayılır ve hiç dokunmadığı bir alandan kilit hatası alırdı.
    await applyFoldTypeForWriteInPlace(data as Record<string, unknown>);

    // ── Fiziksel taahhüt kilitleri (replace() ile AYNI kurallar — PUT/PATCH
    // drift'i kapatıldı: bu yol mobil düzenlemede aktif kullanılıyor). PATCH
    // kısmi semantik: yalnız GÖNDERİLEN ve fiilen DEĞİŞEN alan kilide çarpar;
    // değişmeyen alanın yeniden gönderilmesi serbesttir (bayat form zararsız).
    const locks = await computeWorkOrderLocks(prisma, id);
    if (
      // F59: null'a çekme de kilide çarpmalı (width artık NULL yazılabildiğinden);
      // `!= null` kilitli en'in NULL'lanmasını kaçırıyordu → `!== undefined`.
      data.width !== undefined &&
      normNum(wo.width) !== normNum(data.width) &&
      locks.width
    ) {
      throw AppError.conflict(locks.reasons.width ?? "En kilitli.");
    }
    if (
      data.targetItemId !== undefined &&
      (wo.targetItemId ?? null) !== (data.targetItemId ?? null) &&
      locks.targetItem
    ) {
      throw AppError.conflict(locks.reasons.targetItem ?? "Hedef ürün kilitli.");
    }
    // Renk: TEK BEKÇİ (2026-08-21, `workorder-target-color.helper`) — terminal
    // statü + renk aktif + izinli renk listesi + boya-bitti kilidi + kısmi-boya
    // onayı + rota kapsaması uyarısı. "Rengi Değiştir" ucu da aynı bekçiden geçer;
    // eskiden kilit yalnız buradaydı ve öbür kapı onu atlıyordu.
    if (colorChanging) {
      const gate = await assertTargetColorChange(prisma, wo, data.targetColorId ?? null, {
        confirmPartial: opts.confirmPartial,
      });
      colorWarnings.push(...gate.warnings);
    }
    if (
      data.foldType !== undefined &&
      (wo.foldType ?? null) !== (data.foldType ?? null) &&
      locks.foldType
    ) {
      throw AppError.conflict(locks.reasons.foldType ?? "Kat tipi kilitli.");
    }

    // STOCK_PRODUCTION'da targetItemId zorunlu — null'a çevirme yasak
    if (isOrderlessWorkOrderType(wo.type) && data.targetItemId === null) {
      throw AppError.badRequest(
        `Stoğa üretim ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} hedef ürün boş bırakılamaz.`
      );
    }
    // Hedef ürünü bu karta ÇEVİRMEK yeni üretim planıdır (A3); değişmeyen hedef kontrol edilmez.
    const retargetItemId =
      data.targetItemId && data.targetItemId !== (wo.targetItemId ?? null) ? data.targetItemId : null;
    if (retargetItemId) await assertItemUsable(prisma, retargetItemId, "NEW_PLAN");
    if (data.targetColorId) {
      const color = await prisma.color.findUnique({
        where: { id: data.targetColorId },
        select: { isActive: true },
      });
      if (!color || !color.isActive) {
        throw AppError.badRequest("Hedef renk bulunamadı veya pasif");
      }
    }

    // Hedef ürün/renk değişiyorsa ürünün izinli renk listesi doğrulanır
    // (dolu = bu listeden; boş = sınırsız — create/replace ile aynı kural).
    const finalItemId =
      data.targetItemId === undefined ? wo.targetItemId : data.targetItemId;
    const finalColorId =
      data.targetColorId === undefined ? wo.targetColorId : data.targetColorId;
    const targetPairChanged =
      (data.targetItemId !== undefined &&
        (wo.targetItemId ?? null) !== (data.targetItemId ?? null)) ||
      (data.targetColorId !== undefined &&
        (wo.targetColorId ?? null) !== (data.targetColorId ?? null));
    if (targetPairChanged && finalItemId && finalColorId) {
      const itemFull = await prisma.item.findUnique({
        where: { id: finalItemId },
        select: { allowedColors: { select: { colorId: true } } },
      });
      const allowedColorSet = new Set(
        (itemFull?.allowedColors ?? []).map((c) => c.colorId),
      );
      if (allowedColorSet.size > 0 && !allowedColorSet.has(finalColorId)) {
        throw AppError.badRequest(
          "Hedef renk bu ürünün izinli renk listesinde değil",
        );
      }
    }

    const patch = plannedFieldsFromPatch(data);
    // ATOMİK CLAIM (check-then-act DEĞİL): terminal-durum reddini yazmanın WHERE'ine
    // koy; eşzamanlı finalize WO'yu COMPLETED yaparsa count===0 → 409.
    await prisma.$transaction(async (tx) => {
      // İLK ifade (WO satır kilidinden ÖNCE — birleştirme 8030 EXCL tutup WO satırı ister).
      if (retargetItemId) await assertItemUsableTx(tx, retargetItemId, "NEW_PLAN");
      // F58: WO satırını kilitle → locks'u kilit ALTINDA taze hesapla ve kilit
      // guard'larını yeniden doğrula. 3085'teki tx-DIŞI locks eşzamanlı adım-tamamlama/
      // sevkle bayatlayabilir; bu turda finishStep/finalize/createOpenFabric/cutOpenFabric
      // WO satırını kilitlediğinden ara-adım geçişleri de bu kilitle serileşir.
      await touchWorkOrderTx(tx, id);
      const before = await tx.workOrder.findUnique({ where: { id } });
      if (before) {
        assertStartedEditAllowed(before.status, {
          color: data.targetColorId !== undefined && (before.targetColorId ?? null) !== (data.targetColorId ?? null),
          width: data.width !== undefined && normNum(before.width) !== normNum(data.width),
        });
      }
      const freshLocks = await computeWorkOrderLocks(tx, id);
      // F59: tx-içi taze kilit kontrolü de `!== undefined` (NULL'a çekme kilide çarpsın).
      if (data.width !== undefined && normNum(wo.width) !== normNum(data.width) && freshLocks.width) {
        throw AppError.conflict(freshLocks.reasons.width ?? "En kilitli.");
      }
      if (
        data.targetItemId !== undefined &&
        (wo.targetItemId ?? null) !== (data.targetItemId ?? null) &&
        freshLocks.targetItem
      ) {
        throw AppError.conflict(freshLocks.reasons.targetItem ?? "Hedef ürün kilitli.");
      }
      if (colorChanging) {
        // Kilit ALTINDA taze bekçi: arada fason kabul / adım bitişi olduysa kilit ya da
        // kısmi-boya kararı değişmiş olabilir (F58 deseni). Onay pre-tx ile aynı.
        await assertTargetColorChange(tx, wo, data.targetColorId ?? null, {
          confirmPartial: opts.confirmPartial,
        });
      }
      if (
        data.foldType !== undefined &&
        (wo.foldType ?? null) !== (data.foldType ?? null) &&
        freshLocks.foldType
      ) {
        throw AppError.conflict(freshLocks.reasons.foldType ?? "Kat tipi kilitli.");
      }
      // ATOMİK CLAIM: terminal-durum reddini yazmanın WHERE'ine koy (kilit altında).
      const updateClaim = await tx.workOrder.updateMany({
        where: {
          id,
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
        },
        data: {
          width: patch.width,
          targetQuantity: patch.targetQuantity,
          targetWeight: patch.targetWeight,
          plannedStartDate: patch.plannedStartDate,
          plannedEndDate: patch.plannedEndDate,
          targetItemId: patch.targetItemId,
          targetColorId: patch.targetColorId,
          foldType: patch.foldType,
          materialProvidedBy: patch.materialProvidedBy,
        },
      });
      if (updateClaim.count === 0 || !before) {
        throw AppError.conflict(
          `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada tamamlandı veya iptal edildi, düzenlenemez. Sayfayı yenileyin.`
        );
      }
      await recordWorkOrderFieldDiffTx(tx, id, { before, after: patch }, { trigger: "WO_UPDATE", userId });
      // Kart snapshot'ı bu alanları DONDURUYOR (ürün/renk/en/miktar/kat/tarihler) —
      // WO değişince eldeki kâğıt yanlışlanır. Snapshot yalnız `reprint` ile tazelenir.
      await markTravelerCardDirtyTx(tx, id);
    });
    const updated = await prisma.workOrder.findUnique({ where: { id } });

    // ── ALAN-BAZLI DEĞİŞİKLİK (Faz B2) ────────────────────────────────────
    // İş emri, "kim ne değiştirdi" sorusunun EN ÇOK sorulduğu kayıt. Eskiden
    // yalnız `newData` yazılıyordu (eski değer YOK) → "500 metre demiştik"
    // tartışmasında hangi değerin ne zaman değiştiği gösterilemiyordu.
    const woChanges = diffFields(wo as Record<string, unknown> | null, data as Record<string, unknown>);
    if (woChanges.length > 0) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "WORK_ORDER",
        recordId: id,
        oldData: wo as Record<string, unknown> | null,
        newData: data as Record<string, unknown>,
        changes: woChanges,
      });
    }

    return {
      success: true,
      data: updated!,
      message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} güncellendi`,
      // Engel olmayan notlar (örn. "rotada renk veren adım yok") — istemci toast basar.
      ...(colorWarnings.length > 0 ? { warnings: colorWarnings } : {}),
    };
  }
