// =============================================================================
// TeksERP - WorkOrder (Parti) Service / target-planning
// =============================================================================
// Hedef özellik değişimi + etki önizlemesi, adım planlama, iş emri kilitleme.
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================
/* eslint-disable max-lines -- devralınan gövde kelimesi kelimesine taşındı; ailenin max-lines katkısı bölme öncesi gibi TEK (workorder/replace.ts sayılır) */

import {
  ACTIVE_TARGET_PROPERTY,
  revokeRollProperties,
  revokeTargetProperties,
} from "../helpers/property-revoke.helper";
import prisma from "../../lib/prisma";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import {
  WorkOrder,
  WorkOrderStatus,
  RollStatus,
} from "@prisma/client";
import {
  claimWorkOrderStatusTx,
} from "../helpers/workorder-event.helper";
import {
  readStepSnapshotsTx,
  recordStepDiffTx,
} from "../helpers/workorder-field-diff.helper";
import { computeWorkOrderLocks, touchWorkOrderTx } from "../helpers/workorder-locks.helper";
import { assertTargetablePropertyIds } from "../helpers/targetable-property.helper";
import { markTravelerCardDirtyTx } from "../helpers/traveler-card-dirty.helper";
import { TERIM } from "../../constants/terim";

// "Hedef özellik değiştir" geri-dönük yazımının dokunabileceği rulo durumları.
// Canlı üretim + depodaki satışa hazır mal. HARİÇ tutulanlar: SHIPPED (müşteride —
// geçmiş çarpıtılmamalı), SCRAP/CANCELLED (ölü), TAMBUR_CONSUMED/
// SUBCONTRACTOR_CONSUMED/KARTELA_CONSUMED (emekli/içi boş parent), AT_KARTELA
// (kartela firmasında, tükenecek). Önizleme (getTargetPropertyChangeImpact) ile
// mutasyon (updateTargetProperties) AYNI kümeyi kullanır → onay = gerçek kapsam.
const TARGET_PROP_FINISHED_STATUSES: RollStatus[] = [
  RollStatus.WAREHOUSE,
];
const TARGET_PROP_INPROD_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
  RollStatus.STOCK,
];
const TARGET_PROP_MUTABLE_STATUSES: RollStatus[] = [
  ...TARGET_PROP_FINISHED_STATUSES,
  ...TARGET_PROP_INPROD_STATUSES,
];

export async function updateTargetProperties(
    id: string,
    propertyIds: string[],
    userId?: string,
  ): Promise<ApiResponse<{ workOrderId: string; affectedRollCount: number }>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: {
        id: true,
        targetItemId: true,
        targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true } },
        targetItem: {
          select: {
            allowedProperties: { select: { propertyId: true } },
          },
        },
      },
    });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);

    const dedupedIds = [...new Set(propertyIds)];

    // ── Fiziksel taahhüt kilitleri (replace()'teki özellik diff'inin aynısı —
    // bu endpoint eskiden kilitsizdi ve COMPLETED adımda uygulanmış özelliği
    // hem WO'dan hem toplardan silebiliyordu).
    const locks = await computeWorkOrderLocks(prisma, id);
    const existingPropIds = new Set(wo.targetProperties.map((p) => p.propertyId));
    const incomingSet = new Set(dedupedIds);
    for (const lockedId of locks.lockedPropertyIds) {
      if (existingPropIds.has(lockedId) && !incomingSet.has(lockedId)) {
        throw AppError.conflict(
          locks.reasons.properties?.[lockedId] ?? "Bu özellik artık kaldırılamaz.",
        );
      }
    }
    const applicableSet = new Set(locks.applicablePropertyIds);
    for (const newId of dedupedIds) {
      if (existingPropIds.has(newId)) continue;
      if (!applicableSet.has(newId)) {
        throw AppError.conflict(
          "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
        );
      }
    }

    if (dedupedIds.length > 0) {
      const propRows = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedIds }, isActive: true },
        select: { id: true, name: true },
      });
      if (propRows.length !== dedupedIds.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
      // SEÇİM tipli özellik HEDEF olamaz — isTargetableProperty'nin sunucu
      // karşılığı (denetim Q2). Buradaki istemci aktif seçim yapıyor → 400 doğru.
      await assertTargetablePropertyIds(dedupedIds, `${TERIM.terbiyeIsEmri.tekilKucuk} hedef özelliği`);

      const allowedSet = new Set(
        (wo.targetItem?.allowedProperties ?? []).map((p) => p.propertyId),
      );
      if (allowedSet.size > 0) {
        const disallowed = propRows.find((p) => !allowedSet.has(p.id));
        if (disallowed) {
          throw AppError.badRequest(
            `'${disallowed.name}' özelliği bu ürün için tanımlı değil`,
          );
        }
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // 0) WO satır kilidi tx'in İLK ifadesi (Y8, F58 deseni): eskiden bu uç kilitsizdi,
      //    kilit/kapsama yalnız tx DIŞINDA hesaplanıyordu. Kilit altında TAZE aktif hedef
      //    kümesi ve taze kilitler okunur; kapı §3.2 ile aynı üç parça (kilitli mevcut
      //    hedef listeye birleştirilir · kapsama yalnız DELTA'ya · fark bazlı damga).
      await touchWorkOrderTx(tx, id);
      const freshLocks = await computeWorkOrderLocks(tx, id);
      const freshTargets = await tx.workOrderTargetProperty.findMany({
        where: { workOrderId: id, ...ACTIVE_TARGET_PROPERTY },
        select: { propertyId: true },
      });
      const freshTargetIds = new Set(freshTargets.map((p) => p.propertyId));
      const lockedKept = freshLocks.lockedPropertyIds.filter((pid) => freshTargetIds.has(pid));
      for (const lockedId of lockedKept) {
        if (!incomingSet.has(lockedId)) {
          throw AppError.conflict(
            freshLocks.reasons.properties?.[lockedId] ?? "Bu özellik artık kaldırılamaz.",
          );
        }
      }
      const resolvedIds = new Set([...dedupedIds, ...lockedKept]);
      const enteringIds = [...resolvedIds].filter((pid) => !freshTargetIds.has(pid));
      const leavingIds = [...freshTargetIds].filter((pid) => !resolvedIds.has(pid));
      {
        const freshApplicable = new Set(freshLocks.applicablePropertyIds);
        for (const newId of enteringIds) {
          if (!freshApplicable.has(newId)) {
            throw AppError.conflict(
              "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
            );
          }
        }
      }

      // 1) WO targetProperties FARK bazlı + damgalı (③a, Y8): silme YOK
      if (leavingIds.length > 0) {
        await revokeTargetProperties(tx, { workOrderId: id, propertyIds: leavingIds, reason: "WO_TARGET_UPDATE", userId: userId ?? null });
      }
      if (enteringIds.length > 0) {
        await tx.workOrderTargetProperty.createMany({
          data: enteringIds.map((propertyId) => ({ workOrderId: id, propertyId })),
          skipDuplicates: true,
        });
      }

      // 2) Bağlı + DEĞİŞTİRİLEBİLİR durumdaki Roll'ları bul. SHIPPED (müşteride),
      //    SCRAP/CANCELLED (ölü), *_CONSUMED (emekli parent), AT_KARTELA hariç —
      //    geçmiş/sevk edilmiş malın özelliği geri-dönük çarpıtılmaz. Önizleme
      //    (getTargetPropertyChangeImpact) ile birebir aynı küme.
      const affectedRolls = await tx.roll.findMany({
        where: {
          producedInStep: { workOrderId: id },
          status: { in: TARGET_PROP_MUTABLE_STATUSES },
        },
        select: { id: true },
      });
      const rollIds = affectedRolls.map((r) => r.id);

      // 3) Bağlı topların özelliği — YALNIZ BAYRAK EVRENİ ve YALNIZ DELTA (Y9, 2026-09-14):
      //    damgalanan küme `(eski hedef − yeni hedef)`, topun tüm FLAG evreni DEĞİL — aynı
      //    fonksiyon SEÇİM satırlarına tam bu sebeple dokunmuyor ("SEÇİM satırlarını
      //    İSTASYON OPERATÖRÜ yazar, hedef listesi değil", denetim F4). Bilinen sınır (plan
      //    §8.4): kaynak kolonu olmadığından hem hedef hem istasyon-AUTO olan özellik
      //    (KURSUN) hedeften çıkarılınca topta yine damgalanır. Girenler damgasız yazılır,
      //    değişmeyen satıra dokunulmaz. Sıralı döngü: `tx.*` + `Promise.all` YASAK.
      if (rollIds.length > 0) {
        if (leavingIds.length > 0) {
          await revokeRollProperties(tx, {
            rollIds,
            propertyIds: leavingIds,
            valueType: "FLAG",
            reason: "WO_TARGET_UPDATE",
            userId: userId ?? null,
          });
        }
        if (enteringIds.length > 0) {
          await tx.rollProperty.createMany({
            data: rollIds.flatMap((rollId) => enteringIds.map((propertyId) => ({ rollId, propertyId }))),
            skipDuplicates: true,
          });
        }
      }

      // Hedef özellikler kartın "İSTENEN ÖZELLİKLER" bloğunda basılı.
      await markTravelerCardDirtyTx(tx, id);

      return { affectedRollCount: rollIds.length, leavingIds, enteringIds };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: {
        targetPropertyIds: dedupedIds,
        revokedPropertyIds: result.leavingIds,
        addedPropertyIds: result.enteringIds,
        affectedRollCount: result.affectedRollCount,
      },
    });

    return {
      success: true,
      data: { workOrderId: id, affectedRollCount: result.affectedRollCount },
      message:
        result.affectedRollCount > 0
          ? `Hedef özellikler güncellendi. ${result.affectedRollCount} rulo etkilendi.`
          : "Hedef özellikler güncellendi.",
    };
  }

export async function getTargetPropertyChangeImpact(
    id: string,
  ): Promise<ApiResponse<{ tamburPassedCount: number; inProductionCount: number }>> {
    // Önizleme kümeleri = mutasyonun (updateTargetProperties) dokunduğu küme.
    // İki bucket'ın toplamı = gerçek etkilenecek rulo sayısı (onay = gerçek kapsam).
    const [tamburPassed, inProduction] = await Promise.all([
      prisma.roll.count({
        where: {
          producedInStep: { workOrderId: id },
          status: { in: TARGET_PROP_FINISHED_STATUSES },
        },
      }),
      prisma.roll.count({
        where: {
          producedInStep: { workOrderId: id },
          status: { in: TARGET_PROP_INPROD_STATUSES },
        },
      }),
    ]);
    return {
      success: true,
      data: { tamburPassedCount: tamburPassed, inProductionCount: inProduction },
    };
  }

export async function updateStepPlanning(
    workOrderId: string,
    stepId: string,
    data: {
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
      /** 2026-08-17 — adım fasona renksiz gitsin ("ekru" kuralı). */
      dispatchWithoutColor?: boolean;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, status: true },
    });
    if (!wo) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        `Tamamlanmış/iptal edilmiş ${TERIM.terbiyeIsEmri.cekimKucuk.bulunma} adım planlaması değiştirilemez (durum: ${wo.status}).`,
      );
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: { select: { type: true, name: true } },
        requiredCategory: true,
      },
    });
    if (!step) throw AppError.notFound("Adım bulunamadı");
    if (step.workOrderId !== workOrderId) {
      throw AppError.badRequest(`Adım bu ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} ait değil`);
    }
    if (step.station.type !== "EXTERNAL") {
      throw AppError.badRequest(
        `Sadece fason (EXTERNAL) adımlar planlanabilir. Mevcut: ${step.station.type}`
      );
    }

    // Kategori validasyonu
    if (data.requiredCategoryId) {
      const cat = await prisma.subcontractorCategory.findUnique({
        where: { id: data.requiredCategoryId },
      });
      if (!cat) throw AppError.notFound("Kategori bulunamadı");
      if (!cat.isActive) throw AppError.badRequest("Pasif kategori atanamaz");
    }

    // Subcontractor validasyonu — kategori uyumu kontrolü
    if (data.plannedSubcontractorId) {
      const sub = await prisma.subcontractor.findUnique({
        where: { id: data.plannedSubcontractorId },
        include: { categories: true },
      });
      if (!sub) throw AppError.notFound("Fason firma bulunamadı");
      if (!sub.isActive) throw AppError.badRequest("Pasif firma atanamaz");

      const effectiveCategoryId =
        data.requiredCategoryId !== undefined
          ? data.requiredCategoryId
          : step.requiredCategoryId;

      if (effectiveCategoryId) {
        const hasCategory = sub.categories.some(
          (c) => c.categoryId === effectiveCategoryId
        );
        if (!hasCategory) {
          throw AppError.badRequest(
            "Seçilen firma bu kategoride hizmet vermiyor"
          );
        }
      }
    }

    // F66: ATOMİK CLAIM (check-then-act DEĞİL) — WO terminal-durum kontrolünü yazmanın
    // WHERE'ine koy; eşzamanlı finalize WO'yu COMPLETED yaptıktan sonra planlama sızmasın.
    await prisma.$transaction(async (tx) => {
      const before = await readStepSnapshotsTx(tx, workOrderId, stepId);
      const claim = await tx.workOrderStep.updateMany({
        where: {
          id: stepId,
          workOrder: { status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } },
        },
        data: {
          requiredCategoryId: data.requiredCategoryId,
          plannedSubcontractorId: data.plannedSubcontractorId,
          dispatchWithoutColor: data.dispatchWithoutColor,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada tamamlandı/iptal edildi — adım planlaması güncellenemedi. Sayfayı yenileyin.`,
        );
      }
      // Planlanan fasoncu kartın OPERASYON tablosunda basılı ("Boyahane (Fason) — Yıldız Boyahane").
      await markTravelerCardDirtyTx(tx, workOrderId);
      const after = await readStepSnapshotsTx(tx, workOrderId, stepId);
      await recordStepDiffTx(tx, workOrderId, { before, after }, { trigger: "STEP_PLAN", userId });
    });

    const updated = await prisma.workOrderStep.findUnique({
      where: { id: stepId },
      include: {
        station: true,
        requiredCategory: true,
        plannedSubcontractor: true,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER_STEP",
      recordId: stepId,
      newData: {
        requiredCategoryId: data.requiredCategoryId,
        plannedSubcontractorId: data.plannedSubcontractorId,
      },
    });

    return { success: true, data: updated, message: "Adım planlaması güncellendi" };
  }

export async function lockWorkOrder(workOrderId: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) {
      throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    }
    if (wo.status !== WorkOrderStatus.PLANNED) {
      throw AppError.badRequest(`Sadece 'Planlandı' durumundaki ${TERIM.terbiyeIsEmri.cogulKucuk} kilitlenebilir/başlatılabilir.`);
    }

    // ATOMİK CLAIM (check-then-act DEĞİL): PLANNED→IN_PROGRESS geçişini status-koşullu
    // updateMany ile sahiplen. İki paralel kilitle / kilitle+iptal yarışında yalnız biri
    // kazanır; üst ön-kontrol (4082) UX, asıl koruma bu claim.
    const claimed = await prisma.$transaction((tx) =>
      claimWorkOrderStatusTx(tx, workOrderId, {
        from: [WorkOrderStatus.PLANNED],
        to: WorkOrderStatus.IN_PROGRESS,
        ctx: { trigger: "WO_LOCK", userId },
      }),
    );
    if (!claimed) {
      const fresh = await prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: { status: true },
      });
      throw AppError.conflict(
        `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada ${fresh?.status} durumuna geçti — kilitlenemedi. Sayfayı yenileyin.`
      );
    }
    const updated = await prisma.workOrder.findUnique({ where: { id: workOrderId } });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: workOrderId,
      oldData: { status: wo.status },
      newData: { status: WorkOrderStatus.IN_PROGRESS },
    });

    return {
      success: true,
      data: updated!,
      message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} kilitlendi ve üretime (IN_PROGRESS) alındı.`,
    };
  }
