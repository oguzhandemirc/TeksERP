// =============================================================================
// TeksERP - WorkOrder (Parti) Service / replace
// =============================================================================
// İş emri tam düzenleme (replace — rota/kalem/bağ yeniden yazımı).
// `workorder.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../workorder.service`) okunur.
// =============================================================================

import { sequentialTx } from "../helpers/tx-sequential-relations.helper";
import { randomUUID } from "crypto";
import { assertPlannedMachines, filterTemplatePlannedMachines } from "../helpers/planned-machine.helper";
import {
  ACTIVE_ROLL_PROPERTY,
  ACTIVE_TARGET_PROPERTY,
  revokeTargetProperties,
} from "../helpers/property-revoke.helper";
import { ACTIVE_ORDER_LINK, unlinkOrderLinesTx } from "../helpers/order-link.helper";
import prisma from "../../lib/prisma";
import { collectWorkOrderDecisionWarnings } from "../helpers/defect-decision.helper";
import { AuditService } from "../audit.service";
import { AppError } from "../../utils/app-error";
import { ApiResponse } from "../../types/api.types";
import { assertCustomerGoodsHasNoOrderLines, assertCustomerGoodsTypeFrozen, customerGoodsMaterialWarning, isOrderlessWorkOrderType } from "../helpers/workorder-customer-goods.helper";
import {
  WorkOrder,
  WorkOrderStatus,
  Prisma,
  type RollStage,
} from "@prisma/client";
import {
  readStepSnapshotsTx,
  recordStepDiffTx,
  recordWorkOrderFieldDiffTx,
} from "../helpers/workorder-field-diff.helper";
import { computeWorkOrderLocks } from "../helpers/workorder-locks.helper";
import { assertTargetColorChange } from "../helpers/workorder-target-color.helper";
import { applyFoldTypeForWriteInPlace } from "../helpers/fold-type";
import { assertTargetablePropertyIds } from "../helpers/targetable-property.helper";
import { markTravelerCardDirtyTx } from "../helpers/traveler-card-dirty.helper";
import { routeTemplateProblem } from "../helpers/route-template-usable.helper";
import { assertItemUsable, assertItemUsableTx, type ItemUsage } from "../helpers/item-usage.helper";
import { TERIM } from "../../constants/terim";
import { assertWorkOrderLinesSingleSpec } from "../helpers/workorder-line-spec.helper";
import { assertOrderLinesLinkable, assertRouteRefsActive, assertStartedEditAllowed, assertWorkOrderNumberUnchanged, collectRouteCoverageWarnings, normNum, resolvePlanDates, toSpecLine, type WorkOrderCreateInput } from "./shared";

export async function replace(
    id: string,
    data: WorkOrderCreateInput,
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: { targetProperties: { where: ACTIVE_TARGET_PROPERTY, select: { propertyId: true } } },
    });
    if (!existing) throw AppError.notFound(`${TERIM.terbiyeIsEmri.cumleBasi.yalin} bulunamadı`);
    if (
      existing.status === WorkOrderStatus.COMPLETED ||
      existing.status === WorkOrderStatus.CANCELLED ||
      existing.status === WorkOrderStatus.SUPERSEDED
    ) {
      throw AppError.conflict(
        `Tamamlanmış veya iptal edilmiş ${TERIM.terbiyeIsEmri.tekilKucuk} düzenlenemez.`,
      );
    }

    // Kat katalog doğrulaması — kilit karşılaştırmalarından ÖNCE (update ile
    // aynı gerekçe: kanonikleştirme sonra yapılırsa değişmemiş alan kilide çarpar).
    await applyFoldTypeForWriteInPlace(data as Record<string, unknown>);

    // ── Fiziksel taahhüt kilitleri ──────────────────────────────────────────
    // Sevk gittiyse / herhangi adım başladıysa kumaş/en/metraj artık değişmez.
    // Renk/özellik/kat tipi her birinin istasyonu adımı bitmediyse editable.
    const locks = await computeWorkOrderLocks(prisma, id);

    if (
      normNum(existing.width) !== normNum(data.width) &&
      locks.width
    ) {
      throw AppError.conflict(locks.reasons.width ?? "En kilitli.");
    }
    // targetQuantity bilinçli "fazla gönderdik / az kaldı" durumlarında
    // değişebilir; fazla mal Tambur'da stok kalır, eksik kalan yeni sevkle
    // tamamlanır. Backend yalnızca uyumsuz sipariş bağlamayı engeller.
    if (
      (existing.targetItemId ?? null) !== (data.targetItemId ?? null) &&
      locks.targetItem
    ) {
      throw AppError.conflict(
        locks.reasons.targetItem ?? "Hedef ürün kilitli.",
      );
    }
    if (
      (existing.targetColorId ?? null) !== (data.targetColorId ?? null) &&
      locks.targetColor
    ) {
      throw AppError.conflict(
        locks.reasons.targetColor ?? "Hedef renk kilitli.",
      );
    }
    if (
      (existing.foldType ?? null) !== (data.foldType ?? null) &&
      locks.foldType
    ) {
      throw AppError.conflict(locks.reasons.foldType ?? "Kat tipi kilitli.");
    }

    // Özellik diff: kilitli özelliği kaldırma yasak; eklenen özelliğin
    // applicable (route'ta + COMPLETED olmayan istasyon var) olması zorunlu.
    if (data.targetPropertyIds) {
      const existingPropIds = new Set(
        existing.targetProperties.map((p) => p.propertyId),
      );
      const incomingSet = new Set(data.targetPropertyIds);
      for (const lockedId of locks.lockedPropertyIds) {
        if (existingPropIds.has(lockedId) && !incomingSet.has(lockedId)) {
          throw AppError.conflict(
            locks.reasons.properties?.[lockedId] ??
              "Bu özellik artık kaldırılamaz.",
          );
        }
      }
      const applicableSet = new Set(locks.applicablePropertyIds);
      for (const newId of data.targetPropertyIds) {
        if (existingPropIds.has(newId)) continue;
        if (!applicableSet.has(newId)) {
          throw AppError.conflict(
            "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
          );
        }
      }
    }

    assertCustomerGoodsTypeFrozen(existing.type, data.type);
    let type = (data.type as WorkOrder["type"]) ?? existing.type;

    // ── Rota adımlarını hazırla (şablondan veya raw'dan) — create() ile aynı.
    // `id?` smart-merge için propagasyonla taşınır; routeTemplate'tan gelenler id'siz.
    let finalSteps: {
      id?: string;
      stationId: string;
      notes: string | null;
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
      dispatchWithoutColor?: boolean;
      /** Açık verilen öneri; undefined = mevcut adımda KORU (planlamacının sonradan seçimi ezilmez). */
      plannedMachineId?: string | null;
      /** Yalnız YENİ doğan adımda kullanılan şablon önerisi. */
      templateMachineId?: string | null;
      /** Çıktı aşaması; undefined = mevcut adımda KORU (alanı bilmeyen eski istemci silmesin). */
      outputStage?: RollStage | null;
      /** Yalnız YENİ doğan adımda kullanılan şablon çıktı aşaması. */
      templateOutputStage?: RollStage | null;
    }[] = [];

    if (data.routeTemplateId) {
      if (data.steps && data.steps.length > 0) {
        throw AppError.badRequest(
          "Aynı anda hem routeTemplateId hem steps veremezsiniz. Birini seçin.",
        );
      }
      const template = await prisma.route.findUnique({
        where: { id: data.routeTemplateId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!template) throw AppError.notFound("Rota şablonu bulunamadı");
      const templateProblem = routeTemplateProblem({ isActive: template.isActive, stepCount: template.steps.length });
      if (templateProblem) throw AppError.badRequest(templateProblem);

      const planBySeq = new Map<number, NonNullable<WorkOrderCreateInput["stepPlanning"]>[number]>();
      for (const p of data.stepPlanning ?? []) planBySeq.set(p.sequence, p);

      // Rota şablonu değişmiyorsa mevcut step ID'lerini sequence eşleşmesiyle
      // taşı — aksi halde smart-merge bütün step'leri "yeni" sayıp siler,
      // ACTIVE/COMPLETED step varsa düşer. Kullanıcı sadece tip/sipariş gibi
      // alanları değiştirmek istediğinde de bu yol bug üretiyordu.
      let existingStepIdBySeq = new Map<number, string>();
      if (data.routeTemplateId === existing.routeTemplateId) {
        const rows = await prisma.workOrderStep.findMany({
          where: { workOrderId: id },
          select: { id: true, stepSequence: true },
        });
        existingStepIdBySeq = new Map(rows.map((r) => [r.stepSequence, r.id]));
      }

      finalSteps = template.steps.map((s) => {
        const overlay = planBySeq.get(s.sequence);
        return {
          id: existingStepIdBySeq.get(s.sequence),
          stationId: s.stationId,
          notes: overlay?.notes ?? s.defaultNotes ?? null,
          // Saha #14: şablondaki fason planlaması replace'te de default klonlanır.
          requiredCategoryId: overlay?.requiredCategoryId ?? s.requiredCategoryId ?? null,
          plannedSubcontractorId: overlay?.plannedSubcontractorId ?? s.plannedSubcontractorId ?? null,
          dispatchWithoutColor: overlay?.dispatchWithoutColor ?? s.dispatchWithoutColor ?? false,
          plannedMachineId: overlay?.plannedMachineId,
          templateMachineId: s.plannedMachineId ?? null,
          outputStage: overlay?.outputStage,
          templateOutputStage: s.outputStage ?? null,
        };
      });
      const tplFiltered = await filterTemplatePlannedMachines(
        prisma,
        finalSteps.map((st) => ({ stationId: st.stationId, plannedMachineId: st.templateMachineId })),
      );
      finalSteps = finalSteps.map((st, i) => ({ ...st, templateMachineId: tplFiltered.steps[i].plannedMachineId ?? null }));
    } else {
      if (!data.steps || data.steps.length === 0) {
        throw AppError.badRequest(
          "En az bir rota adımı (steps) veya bir routeTemplateId gerekli",
        );
      }
      finalSteps = data.steps.map((s) => ({
        id: s.id,
        stationId: s.stationId,
        notes: s.notes ?? null,
        requiredCategoryId: s.requiredCategoryId ?? null,
        plannedSubcontractorId: s.plannedSubcontractorId ?? null,
        dispatchWithoutColor: s.dispatchWithoutColor ?? false,
        plannedMachineId: s.plannedMachineId,
        outputStage: s.outputStage,
      }));
    }

    await assertPlannedMachines(prisma, finalSteps);

    // ── Soft-delete guard (SEC-3, create() ile ortak helper) ────────────────
    await assertRouteRefsActive(finalSteps);

    // ── Sipariş bağları + tahsis miktarları ─────────────────────────────────
    let allocations: { orderLineId: string; allocatedQty: number }[] = [];
    if (data.orderLineAllocations && data.orderLineAllocations.length > 0) {
      allocations = data.orderLineAllocations.map((a) => ({
        orderLineId: a.orderLineId,
        allocatedQty: a.allocatedQty ?? 0,
      }));
    } else if (data.orderLineIds && data.orderLineIds.length > 0) {
      allocations = data.orderLineIds.map((lid) => ({ orderLineId: lid, allocatedQty: 0 }));
    }

    // TİP = BAĞIN AYNASI (2026-08-21) — create() ile aynı kural: satır geldiyse
    // tip STOK olamaz, sunucu çevirir (istemci `type`'ı atlasa da).
    if (allocations.length > 0 && type === "STOCK_PRODUCTION") {
      type = "ORDER_PRODUCTION";
    }

    if (type === "ORDER_PRODUCTION" && allocations.length === 0) {
      throw AppError.badRequest(
        `Siparişe özel üretim ${TERIM.terbiyeIsEmri.tekilKucuk} en az bir sipariş kalemine bağlanmalıdır.`,
      );
    }
    assertCustomerGoodsHasNoOrderLines(type, allocations.length);

    // ── Hedef ürün doğrulaması ───────────────────────────────────────────────
    let resolvedTargetItemId: string | null = data.targetItemId ?? null;

    if (isOrderlessWorkOrderType(type) && !resolvedTargetItemId) {
      throw AppError.badRequest(
        `Stoğa üretim ${TERIM.terbiyeIsEmri.tekilKucuk} için hedef ürün seçmelisiniz.`,
      );
    }

    // Değişmeyen hedef mevcut işi yürütür (E); yeni hedef create ile aynı kural.
    const replaceItemUsage: ItemUsage =
      resolvedTargetItemId === (existing.targetItemId ?? null) || allocations.length > 0
        ? "EXISTING_GOODS"
        : "NEW_PLAN";
    if (resolvedTargetItemId) await assertItemUsable(prisma, resolvedTargetItemId, replaceItemUsage);

    let resolvedTargetColorId: string | null = data.targetColorId ?? null;
    if (type === "ORDER_PRODUCTION" && allocations.length > 0) {
      const orderLineItems = await prisma.orderLine.findMany({
        where: { id: { in: allocations.map((a) => a.orderLineId) } },
        select: {
          id: true, itemId: true, colorId: true,
          item: { select: { name: true } },
          color: { select: { name: true } },
          order: { select: { status: true, orderNumber: true } },
        },
      });
      assertOrderLinesLinkable(allocations.map((a) => a.orderLineId), orderLineItems);
      // Tek kumaş + tek renk: hedef (undefined/null/değer) ne olursa olsun karışık kalem 400.
      assertWorkOrderLinesSingleSpec(orderLineItems.map(toSpecLine));
      const distinctItems = new Set(orderLineItems.map((l) => l.itemId));
      if (distinctItems.size === 1) {
        const onlyItemId = Array.from(distinctItems)[0];
        if (resolvedTargetItemId && resolvedTargetItemId !== onlyItemId) {
          throw AppError.badRequest(
            "Hedef ürün, sipariş satırlarındaki ürün ile uyuşmuyor",
          );
        }
        resolvedTargetItemId = onlyItemId;
      }

      const distinctColors = new Set(orderLineItems.map((l) => l.colorId));
      if (distinctColors.size === 1) {
        const onlyColorId = Array.from(distinctColors)[0];
        if (
          data.targetColorId !== undefined &&
          data.targetColorId !== onlyColorId
        ) {
          throw AppError.badRequest(
            "Hedef renk, sipariş satırlarındaki renk ile uyuşmuyor",
          );
        }
        resolvedTargetColorId = onlyColorId;
      } else if (distinctColors.size > 1 && data.targetColorId === undefined) {
        // Buraya yalnız "renksiz + tek renk" karışımı düşer (iki renk yukarıda 400).
        throw AppError.badRequest(
          "Sipariş satırları renkli ve renksiz kalem içeriyor; hedef rengi açıkça belirtin",
        );
      }
    }

    // ── targetProperties doğrulaması ─────────────────────────────────────────
    /** Engel olmayan planlama notları — yanıtta `warnings` olarak döner. */
    const replaceWarnings: string[] = [];
    const materialWarning = customerGoodsMaterialWarning(type, data.materialProvidedBy);
    if (materialWarning) replaceWarnings.push(materialWarning);
    let targetPropertyIds = [...new Set(data.targetPropertyIds ?? [])];
    if (
      targetPropertyIds.length === 0 &&
      type === "ORDER_PRODUCTION" &&
      allocations.length > 0 &&
      data.targetPropertyIds === undefined
    ) {
      const required = await prisma.orderLineRequiredProperty.findMany({
        where: { orderLineId: { in: allocations.map((a) => a.orderLineId) } },
        select: { propertyId: true },
      });
      targetPropertyIds = [...new Set(required.map((r) => r.propertyId))];
    }

    if (resolvedTargetItemId) {
      const targetItemFull = await prisma.item.findUnique({
        where: { id: resolvedTargetItemId },
        select: {
          allowedColors: { select: { colorId: true } },
          allowedProperties: { select: { propertyId: true } },
        },
      });

      if (resolvedTargetColorId) {
        const colorRow = await prisma.color.findUnique({
          where: { id: resolvedTargetColorId },
          select: { isActive: true, name: true },
        });
        if (!colorRow || !colorRow.isActive) {
          throw AppError.badRequest("Hedef renk bulunamadı veya pasif");
        }
        const allowedColorSet = new Set(
          (targetItemFull?.allowedColors ?? []).map((c) => c.colorId),
        );
        if (allowedColorSet.size > 0 && !allowedColorSet.has(resolvedTargetColorId)) {
          throw AppError.badRequest(
            `'${colorRow.name}' rengi bu ürüne uygulanabilir renk listesinde değil`,
          );
        }
      }

      if (targetPropertyIds.length > 0) {
        const propRows = await prisma.fabricProperty.findMany({
          where: { id: { in: targetPropertyIds }, isActive: true },
          select: { id: true, name: true },
        });
        if (propRows.length !== targetPropertyIds.length) {
          throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
        }

        // SEÇİM tipli özellik HEDEF olamaz — isTargetableProperty sunucu karşılığı
        // (denetim Q2): değerini istasyonda operatör verir, hedef listesi taşımaz.
        await assertTargetablePropertyIds(targetPropertyIds, `${TERIM.terbiyeIsEmri.tekilKucuk} hedef özelliği`);
        const allowedSet = new Set(
          (targetItemFull?.allowedProperties ?? []).map((p) => p.propertyId),
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

      if (resolvedTargetColorId || targetPropertyIds.length > 0) {
        // `replace` de UYARIR, reddetmez — "tek kural" (2026-08-27). Bu yol
        // üçüncü bir kapıydı: create 400 veriyordu, "Rengi Değiştir" uyarıyordu,
        // replace de 400 veriyordu. Üçü de aynı soruyu soruyor.
        //
        // Mal bilgisi BURADA canlıdan okunur (create'te çağıran verir): iş emrine
        // bağlı toplar zaten hedef rengi taşıyorsa uyarı YANLIŞ olurdu.
        const attachedRolls = await prisma.roll.findMany({
          where: { currentStep: { workOrderId: id } },
          select: { colorId: true, properties: { where: ACTIVE_ROLL_PROPERTY, select: { propertyId: true } } },
        });
        const colorOnGoods =
          attachedRolls.length > 0 &&
          !!resolvedTargetColorId &&
          attachedRolls.every((r) => r.colorId === resolvedTargetColorId);
        const uncoveredProps =
          attachedRolls.length > 0
            ? targetPropertyIds.filter(
                (pid) => !attachedRolls.every((r) => r.properties.some((p) => p.propertyId === pid)),
              )
            : targetPropertyIds;
        replaceWarnings.push(
          ...(await collectRouteCoverageWarnings(finalSteps, {
            color: !!resolvedTargetColorId && !colorOnGoods,
            property: uncoveredProps.length > 0,
          })),
        );
      }
    }

    assertWorkOrderNumberUnchanged(existing.workOrderNumber, data.batchNumber);
    // Renk değişiyorsa "Rengi Değiştir" ile AYNI bekçi (mal–plan uyumu, kısmi boya).
    const colorChanging = (existing.targetColorId ?? null) !== resolvedTargetColorId;
    assertStartedEditAllowed(existing.status, {
      color: colorChanging,
      width: normNum(existing.width) !== normNum(data.width ?? null),
    });
    if (colorChanging) await assertTargetColorChange(prisma, existing, resolvedTargetColorId);

    // ── Transaction: smart merge (steps id-bazlı diff) ───────────────────────
    const updated = await prisma.$transaction(async (tx) => {
      // İLK ifade: 8030 SHARED → kart FOR SHARE (WO satır claim'inden önce, kilit sırası).
      if (resolvedTargetItemId) await assertItemUsableTx(tx, resolvedTargetItemId, replaceItemUsage);
      // ATOMİK CLAIM: tx başında (yıkıcı drop-and-recreate'ten ÖNCE) WO satırını
      // write-kilitle + COMPLETED/CANCELLED'e geçmediğini iddia et. tx-DIŞI
      // ön-kontrol (2978-2985) UX; eşzamanlı son-top finalize bu satırı tx süresince
      // güncelleyemez, önce commit ettiyse count===0 → 409 (terminal WO'nun rotası/
      // bağları ezilmez). Asıl alan yazımı aşağıdaki tx.workOrder.update'te kalır.
      const replaceClaim = await tx.workOrder.updateMany({
        where: {
          id,
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
        },
        data: { updatedAt: new Date() },
      });
      const before = await tx.workOrder.findUnique({ where: { id } });
      if (replaceClaim.count === 0 || !before) {
        throw AppError.conflict(
          `${TERIM.terbiyeIsEmri.cumleBasi.yalin} bu sırada ${
            before?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, düzenlenemez. Sayfayı yenileyin.`
        );
      }
      assertStartedEditAllowed(before.status, {
        color: (before.targetColorId ?? null) !== resolvedTargetColorId,
        width: normNum(before.width) !== normNum(data.width ?? null),
      });
      // Kilit altında taze bekçi: arada fason kabul / adım bitişi olduysa karar değişmiş olabilir.
      if (colorChanging) await assertTargetColorChange(tx, before, resolvedTargetColorId);

      // F58: locks'u WO satır kilidi (replaceClaim) ALTINDA taze hesapla ve kilit
      // guard'larını yeniden doğrula — 3295'teki tx-DIŞI locks eşzamanlı adım-
      // tamamlama/sevkle bayatlayabilir (tx-dışı guard'lar 3297+ yalnız UX fast-fail).
      const freshLocks = await computeWorkOrderLocks(tx, id);
      if (normNum(existing.width) !== normNum(data.width) && freshLocks.width) {
        throw AppError.conflict(freshLocks.reasons.width ?? "En kilitli.");
      }
      if (
        (existing.targetItemId ?? null) !== (data.targetItemId ?? null) &&
        freshLocks.targetItem
      ) {
        throw AppError.conflict(freshLocks.reasons.targetItem ?? "Hedef ürün kilitli.");
      }
      if (
        (existing.targetColorId ?? null) !== (data.targetColorId ?? null) &&
        freshLocks.targetColor
      ) {
        throw AppError.conflict(freshLocks.reasons.targetColor ?? "Hedef renk kilitli.");
      }
      if (
        (existing.foldType ?? null) !== (data.foldType ?? null) &&
        freshLocks.foldType
      ) {
        throw AppError.conflict(freshLocks.reasons.foldType ?? "Kat tipi kilitli.");
      }
      // ── Hedef özellik kapısı — tx İÇİNDE TAZE aktif küme (plan §3.2, 2026-09-14) ──
      // ① KİLİTLİ mevcut hedef çözülmüş listeye DAİMA BİRLEŞTİRİLİR: istemci alanı
      //    göndermese (`undefined` → STOCK'ta boş / ORDER'da sipariş satırından türer)
      //    bile kilitli hedef sessizce DÜŞMEZ (eski sessiz silme yolu) ve türetilmiş
      //    listede kilit kapısı hiç ateşlenemez (kalıcı 409 üretmez).
      // ② Kapsama (applicable) kapısı yalnız DELTA'ya: zaten yazılı satır için 409 yok.
      // ③ Fark bazlı + damgalı yazım (Y7): çıkan `WO_REPLACE` ile damgalanır, giren
      //    yazılır, değişmeyen satıra dokunulmaz.
      const freshTargets = await tx.workOrderTargetProperty.findMany({
        where: { workOrderId: id, ...ACTIVE_TARGET_PROPERTY },
        select: { propertyId: true },
      });
      const freshTargetIds = new Set(freshTargets.map((p) => p.propertyId));
      const lockedKept = freshLocks.lockedPropertyIds.filter((pid) => freshTargetIds.has(pid));
      if (data.targetPropertyIds) {
        const incomingSet = new Set(data.targetPropertyIds);
        for (const lockedId of lockedKept) {
          if (!incomingSet.has(lockedId)) {
            throw AppError.conflict(
              freshLocks.reasons.properties?.[lockedId] ??
                "Bu özellik artık kaldırılamaz.",
            );
          }
        }
      }
      const resolvedTargetIds = new Set([...targetPropertyIds, ...lockedKept]);
      const enteringTargetIds = [...resolvedTargetIds].filter((pid) => !freshTargetIds.has(pid));
      const leavingTargetIds = [...freshTargetIds].filter((pid) => !resolvedTargetIds.has(pid));
      {
        const applicableSet = new Set(freshLocks.applicablePropertyIds);
        for (const newId of enteringTargetIds) {
          if (!applicableSet.has(newId)) {
            throw AppError.conflict(
              "Eklenen özelliği uygulayabilecek istasyon bu rotada yok veya adımı tamamlanmış.",
            );
          }
        }
      }

      // Gevşek model: per-kalem aşırı-tahsis kontrolü YOK (fazla üretim → stok).
      // Yalnız (a) satır varlığı, (b) material committed iken kumaş + en uyumu.
      if (allocations.length > 0) {
        const orderLines = await tx.orderLine.findMany({
          where: { id: { in: allocations.map((a) => a.orderLineId) } },
          select: { id: true, itemId: true, width: true },
        });
        if (orderLines.length !== allocations.length) {
          throw AppError.badRequest("Bazı sipariş satırları bulunamadı");
        }

        // Material committed iken yeni sipariş bağlamada kumaş + en uyumluluğu
        // zorunlu — boyahaneye gönderdiğimiz kumaşı uyumsuz siparişe yamamak yasak.
        // F58: kilit altında taze hesaplanan freshLocks kullan (bayat locks değil).
        if (freshLocks.materialCommitted) {
          // Sadece **yeni** bağlanan satırları kontrol et — mevcut bağlar zaten
          // geçmişten geliyor (en/kumaş kilitli, değişmiyorlar).
          const previousLinkIds = new Set(
            (
              await tx.workOrderToOrderLine.findMany({
                where: { workOrderId: id, ...ACTIVE_ORDER_LINK },
                select: { orderLineId: true },
              })
            ).map((l) => l.orderLineId),
          );
          for (const line of orderLines) {
            if (previousLinkIds.has(line.id)) continue;
            if (line.itemId !== existing.targetItemId) {
              throw AppError.conflict(
                `Sevk yapılmış ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} farklı kumaş içeren sipariş bağlanamaz.`,
              );
            }
            if (normNum(line.width) !== normNum(existing.width)) {
              throw AppError.conflict(
                `Sevk yapılmış ${TERIM.terbiyeIsEmri.cekimKucuk.yonelme} farklı eninde sipariş bağlanamaz.`,
              );
            }
          }
        }
      }

      // ── Step diff (smart merge) ─────────────────────────────────────────
      const stepsBefore = await readStepSnapshotsTx(tx, id);
      // Mevcut step'leri çek + bağlı kayıt sayılarını topla.
      const existingStepRows = await tx.workOrderStep.findMany({
        where: { workOrderId: id },
        select: {
          id: true,
          stepSequence: true,
          status: true,
          stationId: true,
          outputStage: true,
          _count: {
            select: {
              // ⚠️ `revokedAt` SÜZÜLMEZ (bilinçli): geri alınmış hareket ve operasyon da
              // adımın defter geçmişidir — istasyonu/sırası değişirse "ne oldu" yalan
              // söyler; silmeyi de RESTRICT FK'ları engeller.
              movements: true,
              operations: true,
              cardScans: true,
              dispatches: true,
              receipts: true,
              currentRolls: true,
              producedRolls: true,
              detectedErrors: true,
              processedErrors: true,
              // Kurşun bypass atamaları (append-only, iptal edilse bile satır kalır):
              // sayılmazsa PENDING görünen bir kurşun adımı silinmeye çalışılır ve
              // FK ihlali ham P2003/500 olarak dışarı sızardı. Burada sayılınca
              // aşağıdaki "bağlı kayıt var" 409'una düşer.
              kursunBypasses: true,
            },
          },
        },
      });
      const existingStepById = new Map(existingStepRows.map((s) => [s.id, s]));
      const incomingExistingIds = new Set(
        finalSteps
          .map((s) => s.id)
          .filter((sid): sid is string => !!sid && existingStepById.has(sid)),
      );

      // 1) Yeni listede olmayan eski step'leri sil — sadece PENDING + bağlısız.
      for (const old of existingStepRows) {
        if (incomingExistingIds.has(old.id)) continue;
        if (old.status !== "PENDING") {
          throw AppError.conflict(
            `${old.stepSequence}. adım silinemez — sadece henüz başlamamış (bekleyen) adımlar silinebilir.`,
          );
        }
        const refCount = Object.values(old._count).reduce((a, b) => a + (b as number), 0);
        if (refCount > 0) {
          throw AppError.conflict(
            `${old.stepSequence}. adım silinemez — bu adıma bağlı rulo, hareket (geri alınmışlar dahil), sevk veya kurşun dağıtım kaydı var.`,
          );
        }
        await tx.workOrderStep.delete({ where: { id: old.id } });
      }

      // ⚠️ "BAŞLAMIŞ ADIM" = statü PENDING değil **VEYA** üzerinde hareket var
      // (2026-08-15 denetim düzeltmesi). Eskiden yalnız statüye bakılıyordu ve
      // statü TÜRETİLEN bir alandır: `recomputeStepStatus` bir adımı COMPLETED'tan
      // PENDING'e düşürebilir (o adımdan geçmiş son topun iptali / kapanış
      // dispozisyonu). Adımın `roll_movements` satırları YERİNDE DURUR; guard
      // yalnız statüye baksaydı, üzerinde geçmiş kayıt olan bir adımın İSTASYONU
      // değiştirilebilir ve o adım yeniden sıralanabilir hâle gelirdi → `GET
      // /rolls/:id/history` ve istasyon iş-hacmi raporu, topun HİÇ uğramadığı bir
      // istasyondan geçtiğini söylerdi (hata yok, log yok). Guard'ın kendi
      // gerekçesi zaten "üzerinde açık movement/geçmiş kayıt var" diyordu —
      // yüklem artık o cümleyle birebir aynı şeyi ölçüyor. Silme guard'ı bu sınıfı
      // `refCount`(=_count toplamı) ile zaten kapatıyordu.
      const stepHasStarted = (s: (typeof existingStepRows)[number]): boolean =>
        s.status !== "PENDING" || s._count.movements > 0;

      // 1b) Başlamış adımların GÖRELİ SIRASI değişemez —
      //     COMPLETED bir adım ACTIVE'in arkasına taşınırsa kart okutma ve
      //     "sonraki adım" hesabı (stepSequence) bozulur. Silme zaten guard'lı;
      //     bu kontrol yeniden sıralamayı yakalar. (Araya yeni PENDING adım
      //     eklemek serbesttir — göreli sıra korunur.)
      const startedOldOrder = existingStepRows
        .filter(stepHasStarted)
        .sort((a, b) => a.stepSequence - b.stepSequence)
        .map((s) => s.id);
      const startedNewOrder = finalSteps
        .map((s) => s.id)
        .filter(
          (sid): sid is string =>
            !!sid && existingStepById.has(sid) && stepHasStarted(existingStepById.get(sid)!),
        );
      if (startedOldOrder.join("|") !== startedNewOrder.join("|")) {
        throw AppError.conflict(
          "Başlamış (aktif/tamamlanmış) adımların sırası değiştirilemez.",
        );
      }

      // 2) Step'leri güncelle veya ekle. stepSequence yeni listedeki indeks
      //    bazlı yeniden numaralandırılır. (workOrderId, stepSequence) TEKİL
      //    (ertelenemez) — kalan adımlar önce negatif sıraya park edilir, yoksa
      //    araya adım eklemek ya da bekleyen adımları sıralamak P2002 verir.
      await tx.workOrderStep.updateMany({ where: { workOrderId: id }, data: { stepSequence: { multiply: -1 } } });
      for (const [index, incoming] of finalSteps.entries()) {
        const stepSequence = index + 1;
        if (incoming.id && existingStepById.has(incoming.id)) {
          // Başlamış adımın İSTASYONU değişemez (üzerinde açık movement/geçmiş
          // kayıt var — silme guard'ının güncelleme simetriği). Not/kategori/
          // planlanan firma serbest kalır.
          //
          // KURŞUN BYPASS ETKİLEŞİMİ (2026-07-31 — atama MAKİNE bazına geçti):
          // dağıtım artık adımın `stationId`'sini DEĞİŞTİRMEZ. Tek bir PROCESS_QC
          // istasyonu (KURŞUN+KK2) vardır ve atama o istasyonun altındaki fiziksel
          // MAKİNEYE yapılır (`KursunBypassAssignment.machineId`) — istasyon repoint'i
          // ve geri-yükleme zinciri tamamen kalktı. Yani bu guard'ın kurşun bypass'a
          // özel bir görevi KALMADI; kendi gerekçesiyle (başlamış adımın üzerinde açık
          // movement/geçmiş kayıt var) ayakta duruyor. Rota düzenlemesi bir atamayı
          // sessizce bozamaz, çünkü atama adımın istasyonunda değil kendi satırında yaşar.
          const old = existingStepById.get(incoming.id)!;
          if (stepHasStarted(old) && old.stationId !== incoming.stationId) {
            throw AppError.conflict(
              `${old.stepSequence}. adım başlamış — istasyonu değiştirilemez (yalnız not/kategori/planlanan firma güncellenebilir).`,
            );
          }
          await tx.workOrderStep.update({
            where: { id: incoming.id },
            data: {
              stationId: incoming.stationId,
              stepSequence,
              notes: incoming.notes,
              requiredCategoryId: incoming.requiredCategoryId ?? null,
              plannedSubcontractorId: incoming.plannedSubcontractorId ?? null,
              dispatchWithoutColor: incoming.dispatchWithoutColor ?? false,
              // Öneri verilmediyse korunur; istasyon değiştiyse eski istasyonun makinesi anlamsız → düşer.
              ...(incoming.plannedMachineId !== undefined
                ? { plannedMachineId: incoming.plannedMachineId }
                : old.stationId !== incoming.stationId ? { plannedMachineId: null } : {}),
              // Çıktı aşaması verilmediyse (eski istemci) korunur.
              ...(incoming.outputStage !== undefined ? { outputStage: incoming.outputStage } : {}),
            },
          });
        } else {
          await tx.workOrderStep.create({
            data: {
              workOrderId: id,
              stationId: incoming.stationId,
              stepSequence,
              notes: incoming.notes,
              requiredCategoryId: incoming.requiredCategoryId ?? null,
              plannedSubcontractorId: incoming.plannedSubcontractorId ?? null,
              dispatchWithoutColor: incoming.dispatchWithoutColor ?? false,
              plannedMachineId: incoming.plannedMachineId ?? incoming.templateMachineId ?? null,
              // Açık değer > şablon > (id'siz eski istemci) aynı sıra + istasyondaki eski değer.
              outputStage: incoming.outputStage !== undefined
                ? incoming.outputStage
                : incoming.templateOutputStage !== undefined
                  ? incoming.templateOutputStage
                  : (existingStepRows.find((o) => o.stepSequence === stepSequence && o.stationId === incoming.stationId)?.outputStage ?? null),
            },
          });
        }
      }

      const eventCtx = { trigger: "WO_REPLACE", userId, groupId: randomUUID() };
      await recordStepDiffTx(tx, id, { before: stepsBefore, after: await readStepSnapshotsTx(tx, id) }, eventCtx);

      // ── orderLinks FARK bazlı + damgalı (③a, WOTOL-BAG-DAMGA-PLAN S2): bağ SİLİNMEZ ──
      //    Çıkan bağ `WO_REPLACE` ile damgalanır, giren yeni satır, kalanın `allocatedQty`si
      //    yerinde güncellenir (bağın kimliği ve `createdAt`i = "ne zaman bağlandı" korunur).
      const freshLinks = await tx.workOrderToOrderLine.findMany({
        where: { workOrderId: id, ...ACTIVE_ORDER_LINK },
        select: { id: true, orderLineId: true },
      });
      const wantedAlloc = new Map(allocations.map((a) => [a.orderLineId, a.allocatedQty]));
      const leavingLinks = freshLinks.filter((l) => !wantedAlloc.has(l.orderLineId));
      const keptLinks = freshLinks.filter((l) => wantedAlloc.has(l.orderLineId));
      const enteringAlloc = allocations.filter((a) => !freshLinks.some((l) => l.orderLineId === a.orderLineId));
      assertStartedEditAllowed(before.status, { orderLinks: leavingLinks.length > 0 || enteringAlloc.length > 0 });
      if (leavingLinks.length > 0) {
        await unlinkOrderLinesTx(tx, {
          pairs: leavingLinks.map((l) => ({ workOrderId: id, orderLineId: l.orderLineId })),
          reason: "WO_REPLACE",
          userId: userId ?? null,
        });
      }
      for (const l of keptLinks) {
        await tx.workOrderToOrderLine.updateMany({
          where: { id: l.id, ...ACTIVE_ORDER_LINK },
          data: { allocatedQty: wantedAlloc.get(l.orderLineId) ?? 0 },
        });
      }
      if (enteringAlloc.length > 0) {
        await tx.workOrderToOrderLine.createMany({
          data: enteringAlloc.map((a) => ({ workOrderId: id, orderLineId: a.orderLineId, allocatedQty: a.allocatedQty })),
          skipDuplicates: true,
        });
      }
      // ── targetProperties FARK bazlı + damgalı (③a, Y7): silme YOK ──
      if (leavingTargetIds.length > 0) {
        await revokeTargetProperties(tx, {
          workOrderId: id,
          propertyIds: leavingTargetIds,
          reason: "WO_REPLACE",
          userId: userId ?? null,
        });
      }
      if (enteringTargetIds.length > 0) {
        await tx.workOrderTargetProperty.createMany({
          data: enteringTargetIds.map((propertyId) => ({ workOrderId: id, propertyId })),
          skipDuplicates: true,
        });
      }

      const planDates = await resolvePlanDates(
        data.plannedStartDate,
        data.plannedEndDate,
      );

      const wo = await sequentialTx(tx).workOrder.update({
        where: { id },
        data: {
          type,
          width: data.width ?? null,
          targetQuantity: data.targetQuantity ?? null,
          targetWeight: data.targetWeight ?? null,
          parameters: (data.parameters as Prisma.InputJsonValue) ?? undefined,
          plannedStartDate: planDates.plannedStartDate,
          plannedEndDate: planDates.plannedEndDate,
          routeTemplateId: data.routeTemplateId ?? null,
          targetItemId: resolvedTargetItemId,
          targetColorId: resolvedTargetColorId,
          foldType: data.foldType ?? null,
          // Tam replace'in TEK istisnası: gönderilmeyen (eski istemci) alan silinmez; null açıkça temizler.
          materialProvidedBy: data.materialProvidedBy,
        },
        include: {
          steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: {
            where: ACTIVE_ORDER_LINK, orderBy: { createdAt: "asc" },
            include: {
              orderLine: {
                include: {
                  order: { include: { customer: true } },
                  item: true,
                  color: true,
                },
              },
            },
          },
          routeTemplate: true,
        },
      });

      // `replace` rotayı, sipariş bağlarını ve hedef özellikleri baştan yazar —
      // kart snapshot'ındaki adım listesi/sipariş tablosu topluca yanlışlanır.
      await markTravelerCardDirtyTx(tx, id);
      await recordWorkOrderFieldDiffTx(tx, id, { before, after: wo }, eventCtx);

      return wo;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: {
        replace: true,
        batchNumber: updated.workOrderNumber,
        type: updated.type,
        stepCount: finalSteps.length,
        routeTemplateId: updated.routeTemplateId,
        allocationCount: allocations.length,
        targetItemId: updated.targetItemId,
        targetColorId: updated.targetColorId,
        materialProvidedBy: updated.materialProvidedBy,
        targetPropertyIds,
      },
    });

    // Rota değişince karar boşluğu yeniden ölçülür (KQ-D8) — SKIPPED Tambur karar saymaz.
    replaceWarnings.push(...(await collectWorkOrderDecisionWarnings(id)));
    return {
      success: true,
      data: updated,
      message: `${TERIM.terbiyeIsEmri.cumleBasi.yalin} güncellendi: ${updated.workOrderNumber}`,
      ...(replaceWarnings.length > 0 ? { warnings: replaceWarnings } : {}),
    };
  }
