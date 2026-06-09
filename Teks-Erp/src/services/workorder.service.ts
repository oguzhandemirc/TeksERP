// =============================================================================
// TeksERP - WorkOrder (Parti) Service
// =============================================================================
// Handles Work Order creation, roll attachment, and document generation.
// Business Rules:
//   - A Work Order CAN exist without linked orders (producing for stock).
//   - A Work Order CAN be linked to multiple orders.
//   - WorkOrderSteps are auto-generated from the provided route stations.
//   - Rolls attached to a WO change status from STOCK → IN_PRODUCTION.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { ApiResponse, PaginatedResponse } from "../types/api.types";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
  resolveSortBy,
} from "../utils/query-parser";

// WO listesinde sıralanabilir kolonlar (UI SortableHeader'larıyla eşleşir) + güvenli
// ekler. Whitelist dışı sortBy → createdAt (bilinmeyen kolon 500'ünü + indekssiz sortu engeller).
const WO_SORTABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "plannedEndDate",
  "plannedStartDate",
  "targetQuantity",
  "batchNumber",
  "status",
] as const;

const WORKORDER_DATE_FIELDS = [
  "createdAt",
  "plannedStartDate",
  "plannedEndDate",
] as const;
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import type { CursorPaginatedResponse } from "./base.service";
import { Request } from "express";
import {
  WorkOrder,
  WorkOrderStatus,
  RollStatus,
  RollEntrySource,
  StepStatus,
  Prisma,
} from "@prisma/client";
import {
  ensureWorkOrderInProgress,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";
import { computeWorkOrderLocks } from "./helpers/workorder-locks.helper";
import { TravelerCardService } from "./traveler-card.service";
import { readWorkOrderDefaultPlanDurationDays } from "./system-setting.service";
import { withBarcodeRetry } from "../utils/barcode-retry";

// Prisma.Decimal | number | null | undefined → number | null (karşılaştırma için)
function normNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

const travelerCardService = new TravelerCardService();

/**
 * plannedStartDate / plannedEndDate default'ları:
 *   - Başlangıç verilmediyse şimdi.
 *   - Termin verilmediyse başlangıç + N gün (N tanımlardan
 *     `workorder.defaultPlanDurationDays`; yoksa 7).
 * CREATE ve full-update (replace) akışında çağrılır; partial header update
 * (updatePlanning) bu default'u UYGULAMAZ — operatör explicit null ile temizler.
 */
async function resolvePlanDates(
  startInput: string | Date | null | undefined,
  endInput: string | Date | null | undefined,
): Promise<{ plannedStartDate: Date; plannedEndDate: Date }> {
  const plannedStartDate = startInput ? new Date(startInput) : new Date();
  let plannedEndDate: Date;
  if (endInput) {
    plannedEndDate = new Date(endInput);
  } else {
    const days = await readWorkOrderDefaultPlanDurationDays();
    plannedEndDate = new Date(plannedStartDate);
    plannedEndDate.setDate(plannedEndDate.getDate() + days);
  }
  return { plannedStartDate, plannedEndDate };
}

// Phase 1: WO açılış/iptali artık order status'a dokunmuyor. IN_PRODUCTION
// statü olarak kaldırıldı; "üretim sürüyor mu?" sorusu line.workOrderLinks
// üzerinden runtime hesabı.

export interface WorkOrderCreateInput {
  batchNumber?:       string | null;
  type?:              string;
  width?:             number | null;
  targetQuantity?:    number | null;
  targetWeight?:      number | null;
  parameters?:        Record<string, unknown> | null;
  plannedStartDate?:  string | null;
  plannedEndDate?:    string | null;
  routeTemplateId?:   string | null;
  targetItemId?:      string | null;
  /** Hedef renk — "renk veren" fason adımının (appliesColor=true) Fason
   *  Kabul'ünde Roll.colorId'ye kopyalanır. ORDER_PRODUCTION'da orderLine'dan
   *  auto-pull edilir; STOCK_PRODUCTION'da manuel zorunlu olabilir. */
  targetColorId?:     string | null;
  /** Tambur planlama bilgisi — "2-KAT" / "4-KAT" gibi. Tambur'a bilgi olarak
   *  iletilir; operatör finalize sırasında override edebilir. */
  foldType?:          string | null;
  /** Boyahaneye özel talimat — fason sevkinde dispatch'e default kopyalanır. */
  dyehouseNote?:      string | null;
  /**
   * Üretim çıktısı rulolarda olacak özellikler. "Renk veren" fason adımının
   * Fason Kabul'ünde Roll.properties'e bindirilir. Item.allowedProperties
   * dolu ise bu liste onun alt kümesi olmalı.
   */
  targetPropertyIds?: string[];
  /**
   * Rota adımları — routeTemplateId verilmezse zorunlu.
   * Şablon verilirse bu alan override için kullanılabilir.
   *
   * `id` opsiyonel: replace akışında smart-merge için kullanılır. Mevcut bir
   * step'i güncelletmek istersen id'yi gönder; yeni adım için id boş bırak.
   * (create akışında id yok sayılır.)
   */
  steps?: {
    id?: string;
    stationId: string;
    notes?: string | null;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
  }[];
  /**
   * routeTemplateId ile birlikte verilebilir: şablondan klonlanan adımların fason
   * planlamasını üzerine yazar. `sequence` adımın rotadaki sırası (1-bazlı).
   */
  stepPlanning?: {
    sequence: number;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
    notes?: string | null;
  }[];
  /**
   * Tercih edilen: her satıra tahsis miktarı.
   * Eski API ile uyum için `orderLineIds` da kabul edilir (allocatedQty=0 olur).
   */
  orderLineAllocations?: { orderLineId: string; allocatedQty?: number }[];
  orderLineIds?: string[] | null;
}

// "Hedef özellik değiştir" geri-dönük yazımının dokunabileceği rulo durumları.
// Canlı üretim + depodaki satışa hazır mal. HARİÇ tutulanlar: SHIPPED (müşteride —
// geçmiş çarpıtılmamalı), SCRAP/CANCELLED (ölü), TAMBUR_CONSUMED/
// SUBCONTRACTOR_CONSUMED/KARTELA_CONSUMED (emekli/içi boş parent), AT_KARTELA
// (kartela firmasında, tükenecek). Önizleme (getTargetPropertyChangeImpact) ile
// mutasyon (updateTargetProperties) AYNI kümeyi kullanır → onay = gerçek kapsam.
const TARGET_PROP_FINISHED_STATUSES: RollStatus[] = [
  RollStatus.WAREHOUSE,
  RollStatus.PRODUCED,
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

export class WorkOrderService {
  /**
   * Auto-generate a parti kodu (batchNumber): "P-YYMMDD-NNN".
   * Günlük sıra veritabanındaki mevcut maksimum +1.
   */
  async generateBatchNumber(): Promise<string> {
    const now = new Date();
    const prefix =
      "P-" +
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "-";

    // Retry loop — nadiren de olsa unique çakışma olursa tekrar dene
    for (let attempt = 0; attempt < 5; attempt++) {
      const last = await prisma.workOrder.findFirst({
        where: { batchNumber: { startsWith: prefix } },
        orderBy: { batchNumber: "desc" },
        select: { batchNumber: true },
      });

      const seq = last
        ? parseInt(last.batchNumber.split("-").pop() ?? "0", 10) + 1
        : 1;

      const candidate = `${prefix}${String(seq).padStart(3, "0")}`;

      const exists = await prisma.workOrder.findUnique({ where: { batchNumber: candidate } });
      if (!exists) return candidate;
    }

    throw AppError.internal("Parti numarası üretilemedi, lütfen tekrar deneyin");
  }

  /**
   * Kullanıcının verdiği parti kodu (batchNumber) benzersiz mi? Değilse net
   * Türkçe hata fırlatır. excludeId verilirse o iş emrini hariç tutar (güncelleme).
   * DB @unique kısıtı backstop'tur; bu ön-kontrol generic P2002 yerine anlaşılır
   * mesaj verir (auto modda withBarcodeRetry'ın yanıltıcı "Barkod..." hatasını da önler).
   */
  private async assertBatchNumberUnique(
    batchNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await prisma.workOrder.findUnique({
      where: { batchNumber },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw AppError.conflict(`Bu parti kodu zaten kullanılıyor: ${batchNumber}`);
    }
  }

  /**
   * Verilen parti kodu (batchNumber) kullanılabilir mi? Form alanı blur'unda
   * canlı kontrol için — kaydetmeden önce "bu numara daha önce verilmiş mi"
   * uyarısı. excludeId verilirse o iş emrini hariç tutar (düzenleme modu kendi
   * kodunu çakışma saymaz). Boş kod = kullanılabilir (otomatik üretilecek).
   */
  async checkBatchNumber(
    batchNumber: string,
    excludeId?: string,
  ): Promise<{ batchNumber: string; available: boolean }> {
    const trimmed = batchNumber.trim();
    if (!trimmed) return { batchNumber: trimmed, available: true };
    const existing = await prisma.workOrder.findUnique({
      where: { batchNumber: trimmed },
      select: { id: true },
    });
    return {
      batchNumber: trimmed,
      available: !existing || existing.id === excludeId,
    };
  }

  /**
   * Create a new Work Order.
   *
   * Kurallar:
   *   - routeTemplateId verilirse RouteStep'ler WorkOrderStep'e kopyalanır (copy-on-write snapshot).
   *     Bu durumda `steps` verilmemelidir; verilirse reddedilir.
   *   - routeTemplateId verilmezse `steps` zorunlu.
   *   - sipariş bağı (orderLineIds/orderLineAllocations) link-only; metraj taşımaz.
   *   - type=ORDER_PRODUCTION ise en az bir sipariş bağı zorunlu.
   *   - batchNumber (Parti Kodu) verilmezse otomatik üretilir (P-YYMMDD-NNN);
   *     verilirse benzersizliği doğrulanır.
   */
  async create(
    data: WorkOrderCreateInput,
    userId?: string
  ): Promise<ApiResponse<WorkOrder>> {
    const type = (data.type as WorkOrder["type"]) ?? "ORDER_PRODUCTION";

    // ── Rota adımlarını hazırla (şablondan veya raw'dan) ────────────────────
    let finalSteps: {
      stationId: string;
      notes: string | null;
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
    }[] = [];

    if (data.routeTemplateId) {
      if (data.steps && data.steps.length > 0) {
        throw AppError.badRequest(
          "Aynı anda hem rota şablonu hem özel rota adımları veremezsiniz. Birini seçin."
        );
      }
      const template = await prisma.route.findUnique({
        where: { id: data.routeTemplateId },
        include: { steps: { orderBy: { sequence: "asc" } } },
      });
      if (!template) {
        throw AppError.notFound("Rota şablonu bulunamadı");
      }
      if (!template.isActive) {
        throw AppError.badRequest("Pasif bir rota şablonu kullanılamaz");
      }
      if (template.steps.length === 0) {
        throw AppError.badRequest("Rota şablonunda adım yok");
      }

      // Fason planlama overlay'i: sequence'e göre eşleştir.
      const planBySeq = new Map<number, NonNullable<WorkOrderCreateInput["stepPlanning"]>[number]>();
      for (const p of data.stepPlanning ?? []) planBySeq.set(p.sequence, p);

      finalSteps = template.steps.map((s) => {
        const overlay = planBySeq.get(s.sequence);
        return {
          stationId: s.stationId,
          notes:     overlay?.notes ?? s.defaultNotes ?? null,
          requiredCategoryId:     overlay?.requiredCategoryId ?? null,
          plannedSubcontractorId: overlay?.plannedSubcontractorId ?? null,
        };
      });
    } else {
      if (!data.steps || data.steps.length === 0) {
        throw AppError.badRequest(
          "Rota şablonu seçin veya özel rota adımları tanımlayın."
        );
      }
      finalSteps = data.steps.map((s) => ({
        stationId: s.stationId,
        notes:     s.notes ?? null,
        requiredCategoryId:     s.requiredCategoryId ?? null,
        plannedSubcontractorId: s.plannedSubcontractorId ?? null,
      }));
    }

    // ── Sipariş bağları + tahsis miktarları (3.2) ───────────────────────────
    let allocations: { orderLineId: string; allocatedQty: number }[] = [];
    if (data.orderLineAllocations && data.orderLineAllocations.length > 0) {
      allocations = data.orderLineAllocations.map((a) => ({
        orderLineId: a.orderLineId,
        allocatedQty: a.allocatedQty ?? 0,
      }));
    } else if (data.orderLineIds && data.orderLineIds.length > 0) {
      // Geriye uyumluluk
      allocations = data.orderLineIds.map((id) => ({ orderLineId: id, allocatedQty: 0 }));
    }

    if (type === "ORDER_PRODUCTION" && allocations.length === 0) {
      throw AppError.badRequest(
        "Siparişe özel üretim iş emri en az bir sipariş kalemine bağlanmalıdır."
      );
    }

    // ── Hedef ürün (targetItem) doğrulaması ─────────────────────────────────
    // STOCK_PRODUCTION: zorunlu — planlamacı ne üretiyoruz onu söylemeli.
    // ORDER_PRODUCTION: bağlı sipariş satırlarındaki ürün ile tutarlı olmalı.
    let resolvedTargetItemId: string | null = data.targetItemId ?? null;

    if (type === "STOCK_PRODUCTION" && !resolvedTargetItemId) {
      throw AppError.badRequest(
        "Stoğa üretim iş emri için hedef ürün seçmelisiniz."
      );
    }

    if (resolvedTargetItemId) {
      const targetItem = await prisma.item.findUnique({
        where: { id: resolvedTargetItemId },
        select: { id: true, isActive: true },
      });
      if (!targetItem || !targetItem.isActive) {
        throw AppError.badRequest("Hedef ürün bulunamadı veya pasif");
      }
    }

    // ORDER_PRODUCTION'da hedef ürün+renk+özellikleri orderLine'lardan otomatik
    // türet/doğrula. Tüm bağlı satırların aynı item+color olması beklenir.
    let resolvedTargetColorId: string | null = data.targetColorId ?? null;
    if (type === "ORDER_PRODUCTION" && allocations.length > 0) {
      const orderLineItems = await prisma.orderLine.findMany({
        where: { id: { in: allocations.map((a) => a.orderLineId) } },
        select: { id: true, itemId: true, colorId: true },
      });
      const distinctItems = new Set(orderLineItems.map((l) => l.itemId));
      if (distinctItems.size === 1) {
        const onlyItemId = Array.from(distinctItems)[0];
        if (resolvedTargetItemId && resolvedTargetItemId !== onlyItemId) {
          throw AppError.badRequest(
            "Hedef ürün, sipariş satırlarındaki ürün ile uyuşmuyor"
          );
        }
        resolvedTargetItemId = onlyItemId;
      } else if (distinctItems.size > 1 && !resolvedTargetItemId) {
        throw AppError.badRequest(
          "Sipariş satırları farklı ürünler içeriyor; hedef ürünü açıkça belirtin"
        );
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
        throw AppError.badRequest(
          "Sipariş satırları farklı renkler içeriyor; hedef rengi açıkça belirtin",
        );
      }
    }

    // ── Hedef Item + targetColor + targetProperties doğrulamaları ────────
    // 1) ORDER_PRODUCTION'da targetPropertyIds verilmediyse, bağlı OrderLine'ların
    //    requiredProperties birleşimi otomatik kullanılır (planlamacı override edebilir).
    // 2) Item allowed listeleri dolu ise targetColor/Property o setin alt kümesi olmalı.
    // 3) targetColorId set edilmişse, rotada appliesColor=true en az bir adım olmalı
    //    (yoksa renk asla uygulanmaz → planlama hatası).
    // 4) targetProperties dolu ise, rotada appliesProperty=true en az bir adım olmalı
    //    (simetrik kural — özellik asla uygulanmaz aksi halde).
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

      // Renk allowed list kontrolü
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

      // Özellik allowed list kontrolü
      if (targetPropertyIds.length > 0) {
        const propRows = await prisma.fabricProperty.findMany({
          where: { id: { in: targetPropertyIds }, isActive: true },
          select: { id: true, name: true },
        });
        if (propRows.length !== targetPropertyIds.length) {
          throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
        }

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

      // "Renk veren" / "Özellik veren" adım var mı? (rota uygunluk kontrolü)
      if (resolvedTargetColorId || targetPropertyIds.length > 0) {
        const stepCategoryIds = finalSteps
          .map((s) => s.requiredCategoryId)
          .filter((c): c is string => !!c);
        if (stepCategoryIds.length === 0) {
          throw AppError.badRequest(
            "Hedef renk veya özellik seçildi ama rotada hiç fason kategorisi tanımlı değil. Uygulayabilecek bir adım gerekiyor.",
          );
        }
        const categoryFlags = await prisma.subcontractorCategory.findMany({
          where: { id: { in: stepCategoryIds } },
          select: { appliesColor: true, appliesProperty: true },
        });
        if (resolvedTargetColorId && !categoryFlags.some((c) => c.appliesColor)) {
          throw AppError.badRequest(
            "Rotada 'renk veren' bir fason adımı (örn. boyahane) tanımlı değil. Hedef rengin uygulanabilmesi için böyle bir adım eklenmelidir.",
          );
        }
        if (
          targetPropertyIds.length > 0 &&
          !categoryFlags.some((c) => c.appliesProperty)
        ) {
          throw AppError.badRequest(
            "Rotada 'özellik veren' bir fason adımı tanımlı değil. Hedef özelliklerin uygulanabilmesi için böyle bir adım eklenmelidir.",
          );
        }
      }
    }

    // ── batchNumber / Parti Kodu ────────────────────────────────────────────
    // Kullanıcı verdiyse (manuel veya otomatik-override) benzersizliğini doğrula;
    // vermediyse otomatik üret (P-YYMMDD-NNN).
    let batchNumber: string;
    if (data.batchNumber && data.batchNumber.trim().length > 0) {
      batchNumber = data.batchNumber.trim();
      await this.assertBatchNumberUnique(batchNumber);
    } else {
      batchNumber = await this.generateBatchNumber();
    }

    // Refakat kartı barkodu sequence çakışırsa (P2002) tx'i baştan dene.
    const workOrder = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
      // Gevşek model: per-kalem aşırı-tahsis kontrolü YOK. Sipariş bağı yalnız
      // "bu iş emri hangi siparişler için" niyetidir (metraj taşımaz); fazla
      // üretim Tambur'da stoğa düşer. Yalnız satırların varlığını doğrula.
      if (allocations.length > 0) {
        const found = await tx.orderLine.count({
          where: { id: { in: allocations.map((a) => a.orderLineId) } },
        });
        if (found !== allocations.length) {
          throw AppError.badRequest("Bazı sipariş satırları bulunamadı");
        }
      }

      const planDates = await resolvePlanDates(
        data.plannedStartDate,
        data.plannedEndDate,
      );

      const wo = await tx.workOrder.create({
        data: {
          batchNumber,
          type,
          width:             data.width          ?? null,
          targetQuantity:    data.targetQuantity ?? null,
          targetWeight:      data.targetWeight ?? null,
          parameters:        (data.parameters as Prisma.InputJsonValue) ?? undefined,
          status:            WorkOrderStatus.PLANNED,
          plannedStartDate:  planDates.plannedStartDate,
          plannedEndDate:    planDates.plannedEndDate,
          routeTemplateId:   data.routeTemplateId   ?? null,
          targetItemId:      resolvedTargetItemId,
          targetColorId:     resolvedTargetColorId,
          foldType:          data.foldType          ?? null,
          dyehouseNote:      data.dyehouseNote       ?? null,
          steps: {
            create: finalSteps.map((step, index) => ({
              stationId:              step.stationId,
              stepSequence:           index + 1,
              notes:                  step.notes,
              requiredCategoryId:     step.requiredCategoryId ?? null,
              plannedSubcontractorId: step.plannedSubcontractorId ?? null,
            })),
          },
          ...(allocations.length > 0
            ? {
                orderLinks: {
                  create: allocations.map((a) => ({
                    orderLineId:  a.orderLineId,
                    allocatedQty: a.allocatedQty,
                  })),
                },
              }
            : {}),
          ...(targetPropertyIds.length > 0
            ? {
                targetProperties: {
                  create: targetPropertyIds.map((propertyId) => ({ propertyId })),
                },
              }
            : {}),
        },
        include: {
          steps:      { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: {
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

      // Phase 1: WO açılışı order status'a dokunmuyor. "Üretim sürüyor mu?"
      // sorusu line.workOrderLinks üzerinden runtime hesabı.

      // Refakat kartını WO ile birlikte oluştur — istasyon ekranlarında kart
      // okutulmadan WO görünmüyor (örn. KursunQc by-card / open-cards).
      // Idempotent: aktif kart varsa atlar (yarıda kesilen retry'larda güvenli).
      await travelerCardService.createForWorkOrder(tx, wo.id, userId);

      return wo;
    }));

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: workOrder.id,
      newData: {
        batchNumber:        workOrder.batchNumber,
        type:               workOrder.type,
        width:              workOrder.width,
        status:             workOrder.status,
        stepCount:          finalSteps.length,
        routeTemplateId:    workOrder.routeTemplateId,
        allocationCount:    allocations.length,
        targetItemId:       workOrder.targetItemId,
        targetColorId:      workOrder.targetColorId,
        targetPropertyIds,
      },
    });

    return {
      success: true,
      data: workOrder,
      message: `İş emri oluşturuldu: ${workOrder.batchNumber}`,
    };
  }

  /**
   * Mobil "Hızlı İş Emri" — okutulan stok toplarından tek istekte WO başlatır.
   *
   * Akış:
   *   1) Barkodları ön-doğrula: hepsi var + STOCK + aynı ürün (kural: tek WO = tek
   *      kumaş). targetItemId verilmemişse topların ürününden türetilir (basit mod).
   *   2) create() ile WO oluştur (kendi tx'i + refakat kartı).
   *   3) attachRolls() ile bağla (kendi tx'i; STOCK → IN_PRODUCTION, ilk adım).
   *   4) Hiç top bağlanamazsa (örn. yarış koşulu) WO'yu arşivle — yetim WO bırakma.
   *
   * create/attachRolls kendi transaction'larını sahiplenir; aralarındaki pencere
   * aynı request içinde milisaniyeler olduğundan ön-doğrulama + telafi yaklaşımı,
   * iki metodu tek tx'e zorlayan riskli refactor'a tercih edildi.
   */
  async quickStart(
    data: WorkOrderCreateInput & { rollBarcodes: string[] },
    userId?: string,
  ): Promise<ApiResponse<{ workOrder: WorkOrder; attached: number; errors: string[] }>> {
    const { rollBarcodes, ...woInput } = data;
    const barcodes = [...new Set(rollBarcodes.map((b) => b.trim()).filter(Boolean))];
    if (barcodes.length === 0) {
      throw AppError.badRequest("En az bir top barkodu okutmalısınız.");
    }

    // ── 1) Ön-doğrulama: var + STOCK + aynı ürün ────────────────────────────
    const rolls = await prisma.roll.findMany({
      where: { barcode: { in: barcodes } },
      select: { id: true, barcode: true, status: true, itemId: true },
    });
    const byBarcode = new Map(rolls.map((r) => [r.barcode, r]));

    const missing = barcodes.filter((b) => !byBarcode.has(b));
    if (missing.length > 0) {
      throw AppError.badRequest(`Şu barkodlar bulunamadı: ${missing.join(", ")}`);
    }

    const notStock = rolls.filter((r) => r.status !== RollStatus.STOCK);
    if (notStock.length > 0) {
      throw AppError.badRequest(
        "Sadece stoktaki toplar bağlanabilir. Uygun olmayan: " +
          notStock.map((r) => `${r.barcode} (${r.status})`).join(", "),
      );
    }

    const itemIds = [...new Set(rolls.map((r) => r.itemId))];
    if (itemIds.length > 1) {
      throw AppError.badRequest(
        "Okutulan toplar farklı ürünlere ait. Tek iş emri tek kumaş içindir — aynı üründeki topları okutun.",
      );
    }
    const rollsItemId = itemIds[0];

    // type: explicit verilmemişse sipariş bağına göre türet.
    const hasOrderLink =
      (woInput.orderLineIds?.length ?? 0) > 0 ||
      (woInput.orderLineAllocations?.length ?? 0) > 0;
    const type =
      (woInput.type as WorkOrder["type"]) ??
      (hasOrderLink ? "ORDER_PRODUCTION" : "STOCK_PRODUCTION");

    // targetItemId: verilmemişse topların ürününden türet; verilmişse tutarlılık şart.
    let targetItemId = woInput.targetItemId ?? null;
    if (!targetItemId) {
      targetItemId = rollsItemId;
    } else if (targetItemId !== rollsItemId) {
      throw AppError.badRequest(
        "Okutulan topların ürünü, seçilen hedef ürün ile aynı değil.",
      );
    }

    // ── 2) WO oluştur ───────────────────────────────────────────────────────
    const createRes = await this.create({ ...woInput, type, targetItemId }, userId);
    if (!createRes.success || !createRes.data) {
      throw AppError.badRequest(createRes.message ?? "İş emri oluşturulamadı.");
    }
    const workOrder = createRes.data;

    // ── 3) Topları bağla + 4) telafi (zero-attach → WO'yu arşivle) ──────────
    let attached = 0;
    let errors: string[] = [];
    try {
      const attachRes = await this.attachRolls(workOrder.id, barcodes, userId);
      attached = attachRes.data?.attached ?? 0;
      errors = attachRes.data?.errors ?? [];
    } catch (err) {
      await this.hardDelete(workOrder.id, userId).catch(() => undefined);
      throw err;
    }

    if (attached === 0) {
      await this.hardDelete(workOrder.id, userId).catch(() => undefined);
      throw AppError.conflict(
        `Hiçbir top bağlanamadı; iş emri oluşturulmadı. ${errors.join("; ")}`.trim(),
      );
    }

    return {
      success: true,
      data: { workOrder, attached, errors },
      message:
        `İş emri ${workOrder.batchNumber} başlatıldı — ${attached} top bağlandı` +
        (errors.length ? `, ${errors.length} top bağlanamadı.` : "."),
    };
  }

  /**
   * List work orders with dynamic filtering, sorting, pagination.
   *
   * Query param: `?withOrderDetail=true`
   *   - orderLinks → orderLine + order + customer + item + variant açar
   *   - targetItem (renk/özellikler dahil) join'lenir
   *   - Her WO'ya `dispatchedTotalQty` (iptal edilmemiş fason sevklerinin toplamı) eklenir
   *   - Mobil "Fason Sevk" iş emri picker'ı için tasarlanmıştır; web admin liste hala
   *     hafif projeksiyonla çalışır (geri uyumluluk).
   */
  async findAll(
    req: Request
  ): Promise<PaginatedResponse<unknown> | CursorPaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    // sortBy güvenlik süzgeci — bilinmeyen kolon (500) + indekssiz keyfi sort engellenir.
    params.sortBy = resolveSortBy(params.sortBy, WO_SORTABLE_FIELDS);
    const where = buildWhereClause(
      params.filters,
      ["batchNumber"],
      params.search
    );
    applyDateRange(where, params, WORKORDER_DATE_FIELDS);
    // Arşivli (isActive=false) WO'lar default'ta gizli — ?withArchived=true override
    if (req.query.withArchived !== "true") {
      (where as Record<string, unknown>).isActive = true;
    }
    // Fason Sevk akışında: zaten açık (cancelledAt=null, item'ı henüz kabul
    // edilmemiş) bir sevki olan WO'ları listeden gizle. Operatör müdahale
    // etmeden önce eski sevki iptal etmek veya mal kabul yapmak zorunda.
    if (req.query.excludeWithOpenDispatch === "true") {
      (where as Record<string, unknown>).dispatches = {
        none: {
          cancelledAt: null,
          items: { some: { receiptItems: { none: {} } } },
        },
      };
    }
    // Fason Sevk picker: yalnız fason (EXTERNAL) adımı SEVKE AÇIK olan WO'lar.
    // SKIPPED adım sevke kapalı; COMPLETED EXTERNAL adım uygundur (ek parti için
    // yeniden açılır — bkz. çoklu sevk). StepStatus'ta CANCELLED yok → tek dışlama
    // SKIPPED. Önceden client-side `steps.some(EXTERNAL)` filtresi vardı: server
    // sayfasını daraltıyor, pager'ı yanıltıyor (sayfa say. fason-dışı WO'ları da
    // sayar) ve over-fetch yapıyordu → sunucuya taşındı.
    if (req.query.hasOpenExternalStep === "true") {
      (where as Record<string, unknown>).steps = {
        some: {
          station: { type: "EXTERNAL" },
          status: { not: "SKIPPED" },
        },
      };
    }
    const withOrderDetail = req.query.withOrderDetail === "true";

    const select = {
      id: true,
      batchNumber: true,
      type: true,
      status: true,
      width: true,
      targetQuantity: true,
      targetWeight: true,
      plannedStartDate: true,
      plannedEndDate: true,
      routeTemplateId: true,
      targetItemId: true,
      targetColorId: true,
      createdAt: true,
      updatedAt: true,
      steps: {
        select: {
          id: true,
          stepSequence: true,
          status: true,
          station: { select: { id: true, code: true, name: true, type: true } },
        },
        orderBy: { stepSequence: "asc" },
      },
      ...(withOrderDetail
        ? {
            orderLinks: {
              select: {
                orderLineId: true,
                orderLine: {
                  select: {
                    id: true,
                    item: { select: { id: true, name: true } },
                    color: { select: { id: true, name: true } },
                    order: { select: { id: true, deadline: true } },
                  },
                },
              },
            },
          }
        : {
            orderLinks: { select: { orderLineId: true } },
          }),
    } satisfies Prisma.WorkOrderSelect;

    // CURSOR MODE — sayfa atlama yok, sabit hız; liste sayfası default'u.
    // Dinamik sortBy: cursor'a sortField değeri kodlanır, orderBy aynı yönde
    // id tie-breaker ile kararlı kalır. Detay: utils/cursor.ts dynamic API.
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
      const wantTotal = req.query.withTotal === "true";

      const sortBy = params.sortBy || "createdAt";
      const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, sortBy, sortOrder)] }
        : where;

      const [items, totalEstimate] = await Promise.all([
        prisma.workOrder.findMany({
          where: cursorWhereClause,
          orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }],
          take: limit + 1,
          select,
        }),
        wantTotal ? prisma.workOrder.count({ where }) : Promise.resolve(undefined),
      ]);

      const hasMore = items.length > limit;
      const data = await this.withProductionMeters(hasMore ? items.slice(0, limit) : items);
      const last = data[data.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, sortBy) : null;

      return {
        success: true,
        data,
        pagination: {
          nextCursor,
          hasMore,
          limit,
          ...(totalEstimate !== undefined ? { totalEstimate } : {}),
        },
      };
    }

    // OFFSET MODE — geri uyumluluk için.
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [rawData, total] = await Promise.all([
      prisma.workOrder.findMany({ where, orderBy, skip, take, select }),
      prisma.workOrder.count({ where }),
    ]);
    const data = await this.withProductionMeters(rawData);

    return {
      success: true,
      data,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.ceil(total / params.pageSize),
      },
    };
  }

  /**
   * Liste WO'larına ÜRETİLEN DEPO METRAJINI ekler (ilerleme kolonu için). Detay
   * sayfasının `producedRolls.warehouse.totalMeters` tanımıyla aynı: WO adımlarında
   * üretilmiş (producedInStepId), orijinal Tambur kesimi (parent=SUBCONTRACTOR_RETURN),
   * FIRE/A1 olmayan rulolar; initialQty toplamı. Tek groupBy ile sayfa başına 1 sorgu.
   */
  private async withProductionMeters<
    T extends { id: string; steps: { id: string; stepSequence: number }[] },
  >(wos: T[]): Promise<(T & { producedMeters: number; inputMeters: number })[]> {
    const stepIds = wos.flatMap((w) => w.steps.map((s) => s.id));
    if (stepIds.length === 0) {
      return wos.map((w) => ({ ...w, producedMeters: 0, inputMeters: 0 }));
    }

    // ÇIKAN — üretim çıktısı; detay producedRolls.warehouse ile AYNI tanım
    // (producedInStepId ∈ adımlar, parent=SUBCONTRACTOR_RETURN, FIRE/A1 hariç).
    const producedRows = await prisma.roll.groupBy({
      by: ["producedInStepId"],
      where: {
        producedInStepId: { in: stepIds },
        parent: { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
        qualityGrade: { notIn: ["FIRE", "A1"] },
      },
      _sum: { initialQty: true },
    });
    const producedByStep = new Map<string, number>();
    for (const r of producedRows) {
      if (r.producedInStepId) producedByStep.set(r.producedInStepId, Number(r._sum.initialQty ?? 0));
    }

    // GİREN — her WO'nun İLK adımına (steps stepSequence asc → steps[0]) RollMovement
    // ile giren ayrık topların initialQty toplamı; status≠CANCELLED/STOCK. Detay
    // inputRolls ile AYNI tanım, sayfa başına 2 sorguyla batched.
    const inputByStep = new Map<string, number>();
    const firstStepIds = wos
      .map((w) => w.steps[0]?.id)
      .filter((id): id is string => Boolean(id));
    if (firstStepIds.length > 0) {
      const moves = await prisma.rollMovement.findMany({
        where: { workOrderStepId: { in: firstStepIds } },
        select: { rollId: true, workOrderStepId: true },
        distinct: ["rollId", "workOrderStepId"],
      });
      const rollIds = [...new Set(moves.map((m) => m.rollId))];
      if (rollIds.length > 0) {
        const rolls = await prisma.roll.findMany({
          where: {
            id: { in: rollIds },
            status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] },
          },
          select: { id: true, initialQty: true },
        });
        const qtyByRoll = new Map<string, number>();
        for (const r of rolls) qtyByRoll.set(r.id, Number(r.initialQty ?? 0));
        for (const m of moves) {
          if (!m.workOrderStepId) continue;
          const qty = qtyByRoll.get(m.rollId);
          if (qty == null) continue; // CANCELLED/STOCK elendi
          inputByStep.set(m.workOrderStepId, (inputByStep.get(m.workOrderStepId) ?? 0) + qty);
        }
      }
    }

    return wos.map((w) => ({
      ...w,
      producedMeters: w.steps.reduce((sum, st) => sum + (producedByStep.get(st.id) ?? 0), 0),
      inputMeters: inputByStep.get(w.steps[0]?.id ?? "") ?? 0,
    }));
  }

  /**
   * Get single work order by ID.
   */
  async findById(id: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        targetItem: true,
        targetColor: true,
        targetProperties: { include: { property: true } },
        steps: {
          include: {
            station: true,
            requiredCategory: true,
            plannedSubcontractor: true,
          },
          orderBy: { stepSequence: "asc" },
        },
        orderLinks: {
          include: {
            orderLine: {
              include: {
                order: { include: { customer: true } },
                item: true,
                color: true,
                requiredProperties: { include: { property: true } },
              },
            },
          },
        },
      },
    });

    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    // dispatchedTotalQty: iptal edilmemiş fason sevklerinin toplam metrajı
    // (detay panelinde "Sevk: X / Y mt · kaldı Z" gösterimi için)
    const dispatchSum = await prisma.subcontractorDispatch.aggregate({
      where: { workOrderId: id, cancelledAt: null },
      _sum: { totalQty: true },
    });
    const dispatchedTotalQty = dispatchSum._sum.totalQty ?? 0;

    // Adım bazlı anlık ürün özeti + WO geneli üretilen nihai toplar.
    // currentStepId = şu an o adımda fiziksel olarak bekleyen rulolar (ham/boyalı/açık kumaş).
    // producedInStepId + depo/sevk statüsü = WO'nun ürettiği nihai çıktı.
    const stepIds = wo.steps.map((s) => s.id);
    // Meter alanları Prisma.Decimal — JS float drift'i önlemek için. Response
    // serializer (json-replacer) Decimal → number'a otomatik çevirir, frontend
    // her zaman number görür.
    const stepRollSummaries = new Map<
      string,
      {
        count: number;
        totalMeters: Prisma.Decimal;
        rawCount: number;
        rawMeters: Prisma.Decimal;
        dyedCount: number;
        dyedMeters: Prisma.Decimal;
        openFabricCount: number;
        openFabricMeters: Prisma.Decimal;
      }
    >();
    /** Üretim çıktısının kategori bazlı kırılımı.
     *  Tambur tüm çıktıyı `status=WAREHOUSE` olarak yazar; ayrım `qualityGrade`
     *  üzerinden: "1.KALITE" → warehouse, "A1" → a1, "FIRE" → fire.
     *  Toplam top sayısı warehouse+a1+fire (kartela ayrı); toplam metraj
     *  warehouse+a1 (fire metre kaybı sayılmaz). */
    let producedRolls: {
      count: number;
      totalMeters: Prisma.Decimal;
      warehouse: { count: number; totalMeters: Prisma.Decimal };
      a1: { count: number; totalMeters: Prisma.Decimal };
      fire: { count: number; totalMeters: Prisma.Decimal };
      items: Array<{
        id: string;
        barcode: string | null;
        qualityGrade: string;
        /** Snapshot için production anındaki metraj (initialQty). */
        currentQty: Prisma.Decimal;
        /** Anlık durum — frontend re-cut/iptal rozetlerini buradan basar. */
        status: RollStatus;
        color: { code: string; name: string; hex: string | null } | null;
        createdAt: Date;
      }>;
    } = {
      count: 0,
      totalMeters: new Prisma.Decimal(0),
      warehouse: { count: 0, totalMeters: new Prisma.Decimal(0) },
      a1: { count: 0, totalMeters: new Prisma.Decimal(0) },
      fire: { count: 0, totalMeters: new Prisma.Decimal(0) },
      items: [],
    };

    // Üretime giren ham toplar — WO'nun ilk adımına giren ayrık toplar (aşağıda
    // RollMovement üzerinden, stepIds hesaplandıktan sonra doldurulur).
    let inputRolls: { count: number; totalMeters: Prisma.Decimal } = {
      count: 0,
      totalMeters: new Prisma.Decimal(0),
    };

    // Per-step individual roll listesi — detay panelinde "hangi parça kaç metre"
    // sorusunun cevabı. Aggregate ile aynı sorgudan dolduruyoruz, ek round-trip yok.
    const stepRolls = new Map<
      string,
      Array<{
        id: string;
        barcode: string | null;
        currentQty: number;
        width: number | null;
        qualityGrade: string;
        kind: "raw" | "dyed" | "open";
        item: { id: string; code: string; name: string } | null;
        color: { id: string; code: string; name: string; hex: string | null } | null;
      }>
    >();
    // Per-step fason sevk bilgisi — plaka / sürücü / not detayı için.
    const stepDispatches = new Map<
      string,
      Array<{
        id: string;
        dispatchNo: string;
        dispatchedAt: string;
        totalQty: number;
        plateNumber: string | null;
        driverName: string | null;
        notes: string | null;
        dyehouseNote: string | null;
        /** WO'daki boyahane notu (default) — sevkin kendi notu boşsa frontend buna düşer. */
        woDyehouseNote: string | null;
        subcontractor: { id: string; name: string };
        dispatchedBy: { id: string; fullName: string | null; username: string } | null;
      }>
    >();

    if (stepIds.length > 0) {
      const currentRolls = await prisma.roll.findMany({
        where: { currentStepId: { in: stepIds } },
        select: {
          id: true,
          barcode: true,
          currentStepId: true,
          colorId: true,
          parentReceiptId: true,
          currentQty: true,
          width: true,
          qualityGrade: true,
          item: { select: { id: true, code: true, name: true } },
          color: { select: { id: true, code: true, name: true, hex: true } },
        },
        orderBy: [{ barcode: "asc" }, { createdAt: "asc" }],
      });
      for (const r of currentRolls) {
        const key = r.currentStepId!;
        const s = stepRollSummaries.get(key) ?? {
          count: 0,
          totalMeters: new Prisma.Decimal(0),
          rawCount: 0,
          rawMeters: new Prisma.Decimal(0),
          dyedCount: 0,
          dyedMeters: new Prisma.Decimal(0),
          openFabricCount: 0,
          openFabricMeters: new Prisma.Decimal(0),
        };
        s.count += 1;
        s.totalMeters = s.totalMeters.plus(r.currentQty);
        let kind: "raw" | "dyed" | "open";
        if (r.parentReceiptId) {
          s.openFabricCount += 1;
          s.openFabricMeters = s.openFabricMeters.plus(r.currentQty);
          kind = "open";
        } else if (r.colorId == null) {
          s.rawCount += 1;
          s.rawMeters = s.rawMeters.plus(r.currentQty);
          kind = "raw";
        } else {
          s.dyedCount += 1;
          s.dyedMeters = s.dyedMeters.plus(r.currentQty);
          kind = "dyed";
        }
        stepRollSummaries.set(key, s);

        const list = stepRolls.get(key) ?? [];
        list.push({
          id: r.id,
          barcode: r.barcode,
          currentQty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade,
          kind,
          item: r.item,
          color: r.color,
        });
        stepRolls.set(key, list);
      }

      const dispatches = await prisma.subcontractorDispatch.findMany({
        where: { stepId: { in: stepIds }, cancelledAt: null },
        select: {
          id: true,
          stepId: true,
          dispatchNo: true,
          dispatchedAt: true,
          totalQty: true,
          plateNumber: true,
          driverName: true,
          notes: true,
          dyehouseNote: true,
          subcontractor: { select: { id: true, name: true } },
          dispatchedBy: { select: { id: true, fullName: true, username: true } },
        },
        orderBy: { dispatchedAt: "desc" },
      });
      for (const d of dispatches) {
        const list = stepDispatches.get(d.stepId) ?? [];
        list.push({
          id: d.id,
          dispatchNo: d.dispatchNo,
          dispatchedAt: d.dispatchedAt.toISOString(),
          totalQty: Number(d.totalQty),
          plateNumber: d.plateNumber,
          driverName: d.driverName,
          notes: d.notes,
          dyehouseNote: d.dyehouseNote,
          // Tüm sevkler aynı WO'ya ait — boş not durumunda WO notuna düşülür (option B).
          woDyehouseNote: wo.dyehouseNote,
          subcontractor: d.subcontractor,
          dispatchedBy: d.dispatchedBy,
        });
        stepDispatches.set(d.stepId, list);
      }

      // Üretim çıktısı — SNAPSHOT: Tambur'un açık kumaştan kestiği birinci
      // nesil çocuklar. Status filtresi yok; sonradan re-cut'la TAMBUR_CONSUMED
      // veya CANCELLED olanlar listede kalır (rozetle işaretlenir). Metraj
      // initialQty (production anı), currentQty değil — re-cut sonrası
      // sıfırlanmaz, snapshot sabit.
      // parent.entrySource = SUBCONTRACTOR_RETURN: parent açık kumaş ise
      // bu rulo Tambur'un orijinal kesim çıktısıdır. Sonraki nesiller
      // (re-cut çocukları) parent.entrySource = TAMBUR_SPLIT olur, filtrelenir.
      const producedRollRows = await prisma.roll.findMany({
        where: {
          producedInStepId: { in: stepIds },
          parent: { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
        },
        select: {
          id: true,
          barcode: true,
          initialQty: true,
          status: true,
          qualityGrade: true,
          createdAt: true,
          color: { select: { code: true, name: true, hex: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      for (const r of producedRollRows) {
        const bucket =
          r.qualityGrade === "FIRE"
            ? producedRolls.fire
            : r.qualityGrade === "A1"
              ? producedRolls.a1
              : producedRolls.warehouse;
        bucket.count += 1;
        bucket.totalMeters = bucket.totalMeters.plus(r.initialQty);
      }

      // Headline: tüm rulo çıktıları + üretilen sağlam metraj
      // (fire metresi hariç).
      producedRolls.count =
        producedRolls.warehouse.count +
        producedRolls.a1.count +
        producedRolls.fire.count;
      producedRolls.totalMeters = producedRolls.warehouse.totalMeters.plus(
        producedRolls.a1.totalMeters,
      );

      // Parça parça liste — snapshot. qty = initialQty (production anı), status
      // = mevcut durum (frontend "Bölündü"/"İptal" rozeti basabilsin).
      producedRolls.items = producedRollRows.map((r) => ({
        id: r.id,
        barcode: r.barcode,
        qualityGrade: r.qualityGrade,
        currentQty: r.initialQty,
        status: r.status,
        color: r.color,
        createdAt: r.createdAt,
      }));

      // Üretime giren ham toplar — WO'nun İLK adımına RollMovement ile giren ayrık
      // topların initialQty toplamı. Movement append-only olduğundan top sonradan
      // fasona/tambura geçse de (currentStepId/producedInStepId değişse veya null
      // olsa) sayım kalıcı; EXTERNAL ilk adımda (boyahane, sevkle giriş) de çalışır.
      // Üretilen çıktı (tambur — son adımda doğar) ve fason açık kumaşı (2.+ adıma
      // girer) ilk adıma movement atmaz → doğal olarak hariç. STOCK'a geri çekilen
      // (un-attach / iptal) ve CANCELLED toplar sayılmaz.
      const firstStepId = stepIds[0];
      const entryRollRows = await prisma.rollMovement.findMany({
        where: { workOrderStepId: firstStepId },
        select: { rollId: true },
        distinct: ["rollId"],
      });
      const entryRollIds = entryRollRows.map((m) => m.rollId);
      if (entryRollIds.length > 0) {
        const inputAgg = await prisma.roll.aggregate({
          where: {
            id: { in: entryRollIds },
            status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] },
          },
          _sum: { initialQty: true },
          _count: { _all: true },
        });
        inputRolls = {
          count: inputAgg._count._all,
          totalMeters: inputAgg._sum.initialQty ?? new Prisma.Decimal(0),
        };
      }
    }

    const stepsWithRollSummary = wo.steps.map((step) => ({
      ...step,
      currentRolls:
        stepRollSummaries.get(step.id) ?? {
          count: 0,
          totalMeters: new Prisma.Decimal(0),
          rawCount: 0,
          rawMeters: new Prisma.Decimal(0),
          dyedCount: 0,
          dyedMeters: new Prisma.Decimal(0),
          openFabricCount: 0,
          openFabricMeters: new Prisma.Decimal(0),
        },
      currentRollList: stepRolls.get(step.id) ?? [],
      dispatches: stepDispatches.get(step.id) ?? [],
    }));

    // Düzenleme kilitleri — frontend formu bu bilgi ile input'ları disable
    // eder, kullanıcıya niye değiştirilemediğini gösterir.
    const locks = await computeWorkOrderLocks(prisma, id);

    return {
      success: true,
      data: {
        ...wo,
        steps: stepsWithRollSummary,
        dispatchedTotalQty,
        producedRolls,
        inputRolls,
        locks,
      },
    };
  }

  /**
   * Bir iş emrinin FASON DALLARI (paralel sevk partileri).
   *
   * Aynı WO'da kumaş parça parça fasona gidebilir (çoklu sevk): her
   * `SubcontractorDispatch` bir "dal"dır. Lane görünümü için her dalın durumunu
   * (açık/kısmi/döndü) ve dönüşten doğan açık-kumaş toplarının ŞU ANKİ konumunu
   * çıkarır — böylece "1. parti Kurşun'da, 2. parti hâlâ boyahanede" tek bakışta
   * görünür.
   *
   * Durum: dispatchItem'larından kaçının (iptal edilmemiş) receiptItem'ı var.
   * Konum: o sevki kabul eden receipt'lerin `bornRolls`'unun `currentStep`'i.
   * Not: bir receipt birden çok sevki kapsarsa doğan toplar o sevklerin hepsine
   * atfedilir (pratikte kabul sevk-bazlı; v1 için kabul edilebilir yaklaşım).
   */
  async getBranches(workOrderId: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        // Ayrılma soy bağı — Dallar panelinde iki yönlü iz:
        // splitFrom = "bu WO, P-XXX'ten ayrıldı"; splitChildren = "ayrılan partiler →".
        splitFrom: { select: { id: true, batchNumber: true } },
        splitChildren: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            batchNumber: true,
            status: true,
            createdAt: true,
            targetColor: { select: { id: true, name: true, hex: true } },
          },
        },
      },
    });
    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId },
      orderBy: { dispatchedAt: "asc" },
      select: {
        id: true,
        dispatchNo: true,
        dispatchedAt: true,
        totalQty: true,
        cancelledAt: true,
        step: { select: { station: { select: { name: true } } } },
        subcontractor: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            receiptItems: {
              select: {
                receipt: {
                  select: {
                    id: true,
                    receiptNo: true,
                    receivedAt: true,
                    cancelledAt: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Phase 4: dal kimliği (batchSplitId = dispatch.id) ile her partinin TÜM rota
    // ayak izini topla — born roll'lar + Tambur'da bölünen çocuklar (depo dahil).
    // Tüketilen ara düğümler HARİÇ: orijinaller (SUBCONTRACTOR_CONSUMED, yerini
    // born roll aldı) ve Tambur'da bölünen parent (TAMBUR_CONSUMED, yerini depodaki
    // çocuklar aldı) — çift sayım olmasın. Açık dalın orijinalleri AT_SUBCONTRACTOR
    // → fason adımında görünür (currentStep dolu).
    const dispatchIds = dispatches.map((d) => d.id);
    const lotRolls = dispatchIds.length
      ? await prisma.roll.findMany({
          where: {
            batchSplitId: { in: dispatchIds },
            status: { notIn: ["SUBCONTRACTOR_CONSUMED", "TAMBUR_CONSUMED", "CANCELLED"] },
          },
          select: {
            batchSplitId: true,
            currentQty: true,
            status: true,
            currentStep: { select: { station: { select: { name: true } } } },
          },
        })
      : [];

    const statusLabel = (s: string): string =>
      s === "WAREHOUSE" ? "Depo" : s === "STOCK" ? "Stok" : "—";

    // batchSplitId → konum dağılımı (label = istasyon adı, yoksa statü etiketi).
    const positionsByLot = new Map<
      string,
      Map<string, { label: string; count: number; totalMeters: number }>
    >();
    for (const r of lotRolls) {
      if (!r.batchSplitId) continue;
      const label = r.currentStep?.station?.name ?? statusLabel(r.status);
      const lot = positionsByLot.get(r.batchSplitId) ?? new Map();
      const cur = lot.get(label) ?? { label, count: 0, totalMeters: 0 };
      cur.count += 1;
      cur.totalMeters += Number(r.currentQty);
      lot.set(label, cur);
      positionsByLot.set(r.batchSplitId, lot);
    }

    const branches = dispatches.map((d) => {
      const itemCount = d.items.length;
      const receivedItemCount = d.items.filter((it) =>
        it.receiptItems.some((ri) => ri.receipt && !ri.receipt.cancelledAt),
      ).length;

      // İptal edilmemiş receipt'ler (dal başına benzersiz).
      const receiptMap = new Map<string, { receiptNo: string; receivedAt: Date }>();
      for (const it of d.items) {
        for (const ri of it.receiptItems) {
          const rcpt = ri.receipt;
          if (!rcpt || rcpt.cancelledAt) continue;
          if (!receiptMap.has(rcpt.id)) {
            receiptMap.set(rcpt.id, {
              receiptNo: rcpt.receiptNo,
              receivedAt: rcpt.receivedAt,
            });
          }
        }
      }

      let status: "OPEN" | "PARTIAL" | "RETURNED" | "CANCELLED";
      if (d.cancelledAt) status = "CANCELLED";
      else if (receivedItemCount === 0) status = "OPEN";
      else if (receivedItemCount >= itemCount) status = "RETURNED";
      else status = "PARTIAL";

      const positions = positionsByLot.get(d.id);
      return {
        dispatchId: d.id,
        dispatchNo: d.dispatchNo,
        stepName: d.step?.station?.name ?? null,
        subcontractorName: d.subcontractor.name,
        dispatchedAt: d.dispatchedAt,
        totalQty: Number(d.totalQty),
        rollCount: itemCount,
        receivedItemCount,
        status,
        receipts: [...receiptMap.values()],
        currentPositions: positions ? [...positions.values()] : [],
      };
    });

    return {
      success: true,
      data: {
        branches,
        splitFrom: wo.splitFrom,
        splitChildren: wo.splitChildren.map((c) => ({
          id: c.id,
          batchNumber: c.batchNumber,
          status: c.status,
          createdAt: c.createdAt,
          targetColor: c.targetColor,
        })),
      },
    };
  }

  // ===========================================================================
  // PARTİYİ YENİ İŞ EMRİNE AYIR (Faz B1: boyanmadan)
  // ===========================================================================

  /**
   * Bir partinin (batchSplitId = sevk lane'i) ayrılması için gerekli kaynak
   * verisini yükler + B1 kapsamında ayrılabilirliği doğrular. Preview ve gerçek
   * split aynı validasyonu paylaşsın diye tek noktada.
   *
   * Faz B1 kapsamı: parti HÂLÂ boyahanede (tüm toplar AT_SUBCONTRACTOR, OPEN),
   * adım renk veren bir fason adımı. Yeni renk, parti yeni WO'ya kabul edilirken
   * uygulanır — yeniden boyama (re-dye) yok, geriye sarma yok.
   */
  private async loadSplitContext(workOrderId: string, batchSplitId: string) {
    const sourceWo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true, batchNumber: true, type: true, width: true, foldType: true,
        parameters: true, dyehouseNote: true, routeTemplateId: true,
        targetItemId: true, targetColorId: true, status: true,
        targetItem: { select: { id: true, name: true } },
        targetColor: { select: { id: true, name: true, hex: true } },
        targetProperties: { select: { propertyId: true } },
        orderLinks: { select: { orderLineId: true, allocatedQty: true } },
        steps: {
          orderBy: { stepSequence: "asc" },
          select: {
            id: true, stationId: true, stepSequence: true, notes: true,
            stepData: true, requiredCategoryId: true, plannedSubcontractorId: true,
            station: { select: { name: true } },
            requiredCategory: { select: { appliesColor: true } },
          },
        },
      },
    });
    if (!sourceWo) throw AppError.notFound("İş emri bulunamadı");

    const dispatch = await prisma.subcontractorDispatch.findUnique({
      where: { id: batchSplitId },
      select: { id: true, dispatchNo: true, workOrderId: true, stepId: true, cancelledAt: true },
    });
    if (!dispatch || dispatch.workOrderId !== workOrderId) {
      throw AppError.notFound("Parti (sevk) bu iş emrinde bulunamadı");
    }

    // Renk veren (boyahane) adım — re-dye'da geri sarılacak hedef.
    const colorStep = sourceWo.steps.find((s) => s.requiredCategory?.appliesColor) ?? null;

    const laneRolls = await prisma.roll.findMany({
      where: {
        batchSplitId,
        status: {
          notIn: [
            RollStatus.SUBCONTRACTOR_CONSUMED,
            RollStatus.TAMBUR_CONSUMED,
            RollStatus.CANCELLED,
          ],
        },
      },
      select: {
        id: true, barcode: true, currentQty: true, status: true,
        currentStepId: true, producedInStepId: true,
        item: { select: { id: true, name: true } },
        color: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    // Partinin canlı toplarının bulunduğu adım (tek nokta beklenir).
    const rollStepIds = [
      ...new Set(laneRolls.map((r) => r.currentStepId).filter(Boolean) as string[]),
    ];
    const rollStep =
      rollStepIds.length === 1
        ? sourceWo.steps.find((s) => s.id === rollStepIds[0]) ?? null
        : null;

    // ── Mod + kapsam guard'ı ──
    // continue (B1): toplar AT_SUBCONTRACTOR (boyahanede) → kaldığı yerden devam.
    // redye    (B2): toplar boyandı/döndü (IN_PRODUCTION, boyahane sonrası) →
    //                yeni WO boyahaneye GERİ SARAR, yeni renkle yeniden boyanır.
    let mode: "continue" | "redye" | null = null;
    let reEntryStep: (typeof sourceWo.steps)[number] | null = null;
    let canSplit = true;
    let blockReason: string | null = null;

    if (dispatch.cancelledAt) {
      canSplit = false;
      blockReason = "Bu sevk iptal edilmiş.";
    } else if (laneRolls.length === 0) {
      canSplit = false;
      blockReason = "Bu partide taşınacak aktif top yok.";
    } else if (!colorStep) {
      canSplit = false;
      blockReason = "Rotada renk veren bir fason adımı (boyahane) yok — renk değişimi uygulanamaz.";
    } else if (!rollStep) {
      canSplit = false;
      blockReason = "Parti topları farklı adımlarda — önce hepsi aynı noktada olmalı.";
    } else if (laneRolls.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR)) {
      // Boyanmadan — kaldığı yerden devam. Renk veren adımda olmalı.
      if (rollStep.id !== colorStep.id) {
        canSplit = false;
        blockReason = "Parti renk veren adımda (boyahane) değil.";
      } else {
        mode = "continue";
        reEntryStep = colorStep;
      }
    } else if (
      laneRolls.every((r) => r.status === RollStatus.IN_PRODUCTION || r.status === RollStatus.STOCK)
    ) {
      // Boyandı/döndü — yeniden boyama. Boyahane sonrasında bekliyor olmalı.
      if (rollStep.stepSequence <= colorStep.stepSequence) {
        canSplit = false;
        blockReason = "Parti henüz boyahane adımında/öncesinde — yeniden boyama gerekmez.";
      } else {
        mode = "redye";
        reEntryStep = colorStep;
      }
    } else {
      canSplit = false;
      blockReason =
        "Parti durumu ayırmaya uygun değil — depodaki/sevkli/Tambur sonrası bitmiş top yeniden boyanamaz.";
    }

    return { sourceWo, dispatch, colorStep, rollStep, laneRolls, mode, reEntryStep, canSplit, blockReason };
  }

  /**
   * Partiyi ayırma ÖNİZLEMESİ — hiçbir şeyi değiştirmez. Frontend taşınacak
   * topları (barkod/metraj/durum) somut listeler, yeni renk + sipariş modu seçer.
   */
  async getSplitPreview(
    workOrderId: string,
    batchSplitId: string,
  ): Promise<ApiResponse<unknown>> {
    const ctx = await this.loadSplitContext(workOrderId, batchSplitId);
    return {
      success: true,
      data: {
        canSplit: ctx.canSplit,
        blockReason: ctx.blockReason,
        // 'continue' = boyanmadan kaldığı yerden; 'redye' = boyahaneye geri sar.
        mode: ctx.mode,
        dispatchNo: ctx.dispatch.dispatchNo,
        currentStep: ctx.rollStep
          ? {
              id: ctx.rollStep.id,
              stepSequence: ctx.rollStep.stepSequence,
              stationName: ctx.rollStep.station.name,
            }
          : null,
        reEntryStep: ctx.reEntryStep
          ? {
              id: ctx.reEntryStep.id,
              stepSequence: ctx.reEntryStep.stepSequence,
              stationName: ctx.reEntryStep.station.name,
            }
          : null,
        sourceColor: ctx.sourceWo.targetColor ?? null,
        targetItem: ctx.sourceWo.targetItem ?? null,
        hasOrderLinks: ctx.sourceWo.orderLinks.length > 0,
        rolls: ctx.laneRolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          currentQty: Number(r.currentQty),
          status: r.status,
          itemName: r.item?.name ?? null,
          colorName: r.color?.name ?? null,
        })),
        rollCount: ctx.laneRolls.length,
        totalQty: ctx.laneRolls.reduce((s, r) => s + Number(r.currentQty), 0),
      },
    };
  }

  /**
   * Partiyi (batchSplitId lane'i) YENİ bir iş emrine ayırır. Yeni WO kaynağın
   * BİREBİR rotasını + iş emri özelliklerini taşır, sadece HEDEF RENK değişir.
   * Partinin canlı topları (+ açık sevki, movement/operation izleri) yeni WO'nun
   * AYNI sıradaki adımlarına repoint edilir → "kaldığı yerden devam". Geçmiş
   * (kapalı sevk/kabul) kaynak WO'da kalır.
   *
   * Faz B1: boyanmadan ayırma — yeni renk parti yeni WO'ya kabul edilince uygulanır.
   */
  async splitBranch(
    workOrderId: string,
    data: {
      batchSplitId: string;
      newColorId: string;
      newBatchNumber?: string | null;
      /** 'stock' = stok üretimine dönsün (sipariş bağı kopar); 'keep' = aynı siparişe bağlı kalsın. */
      orderMode: "stock" | "keep";
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const ctx = await this.loadSplitContext(workOrderId, data.batchSplitId);
    if (!ctx.canSplit) {
      throw AppError.badRequest(ctx.blockReason ?? "Bu parti ayrılamaz");
    }

    const color = await prisma.color.findUnique({
      where: { id: data.newColorId },
      select: { id: true, isActive: true },
    });
    if (!color || !color.isActive) {
      throw AppError.badRequest("Yeni renk bulunamadı veya pasif");
    }

    // batchNumber: verildiyse benzersiz doğrula; yoksa otomatik üret.
    let batchNumber: string;
    if (data.newBatchNumber && data.newBatchNumber.trim().length > 0) {
      batchNumber = data.newBatchNumber.trim();
      await this.assertBatchNumberUnique(batchNumber);
    } else {
      batchNumber = await this.generateBatchNumber();
    }

    const planDates = await resolvePlanDates(null, null);
    const { sourceWo } = ctx;
    const reEntryStep = ctx.reEntryStep!;
    const rollStep = ctx.rollStep!;
    const isRedye = ctx.mode === "redye";
    const S = reEntryStep.stepSequence;
    const newType = data.orderMode === "keep" ? sourceWo.type : "STOCK_PRODUCTION";
    const movedTotalQty = ctx.laneRolls.reduce((s, r) => s + Number(r.currentQty), 0);

    const result = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
      // Tx içinde partiyi yeniden kilitle/doğrula — durum değişmiş olabilir.
      const fresh = await tx.roll.findMany({
        where: {
          batchSplitId: data.batchSplitId,
          status: {
            notIn: [
              RollStatus.SUBCONTRACTOR_CONSUMED,
              RollStatus.TAMBUR_CONSUMED,
              RollStatus.CANCELLED,
            ],
          },
        },
        select: { id: true, status: true, currentQty: true, weightKg: true },
      });
      if (fresh.length === 0) {
        throw AppError.conflict("Parti durumu değişti — taşınacak aktif top kalmadı");
      }
      const statusOk = isRedye
        ? fresh.every((r) => r.status === RollStatus.IN_PRODUCTION || r.status === RollStatus.STOCK)
        : fresh.every((r) => r.status === RollStatus.AT_SUBCONTRACTOR);
      if (!statusOk) {
        throw AppError.conflict("Parti durumu değişti — ayırma iptal edildi, sayfayı yenileyin");
      }
      const laneRollIds = fresh.map((r) => r.id);

      // ── Yeni WO: kaynağın birebir rotası + özellikleri, YENİ renk ──
      const newWo = await tx.workOrder.create({
        data: {
          batchNumber,
          type: newType,
          width: sourceWo.width,
          targetQuantity: movedTotalQty,
          parameters: (sourceWo.parameters as Prisma.InputJsonValue) ?? undefined,
          status: WorkOrderStatus.IN_PROGRESS,
          plannedStartDate: planDates.plannedStartDate,
          plannedEndDate: planDates.plannedEndDate,
          routeTemplateId: sourceWo.routeTemplateId,
          targetItemId: sourceWo.targetItemId,
          targetColorId: data.newColorId,
          foldType: sourceWo.foldType,
          dyehouseNote: sourceWo.dyehouseNote,
          // Soy bağı: eski refakat kartı okutulunca kabul bu WO'yu da bulur;
          // kaynak WO'nun Dallar panelinde "ayrıldı →" izi buradan okunur.
          splitFromId: sourceWo.id,
          steps: {
            create: sourceWo.steps.map((s) => ({
              stationId: s.stationId,
              stepSequence: s.stepSequence,
              notes: s.notes,
              stepData: (s.stepData as Prisma.InputJsonValue) ?? undefined,
              requiredCategoryId: s.requiredCategoryId ?? null,
              plannedSubcontractorId: s.plannedSubcontractorId ?? null,
              // "Kaldığı yerden devam": S öncesi adımlar tamamlandı sayılır,
              // S aktif (parti orada), sonrası bekliyor.
              status:
                s.stepSequence < S
                  ? StepStatus.COMPLETED
                  : s.stepSequence === S
                    ? StepStatus.ACTIVE
                    : StepStatus.PENDING,
              startedAt: s.stepSequence === S ? planDates.plannedStartDate : null,
              completedAt: s.stepSequence < S ? new Date() : null,
            })),
          },
          ...(sourceWo.targetProperties.length > 0
            ? {
                targetProperties: {
                  create: sourceWo.targetProperties.map((p) => ({ propertyId: p.propertyId })),
                },
              }
            : {}),
          ...(data.orderMode === "keep" && sourceWo.orderLinks.length > 0
            ? {
                orderLinks: {
                  create: sourceWo.orderLinks.map((l) => ({
                    orderLineId: l.orderLineId,
                    allocatedQty: l.allocatedQty,
                  })),
                },
              }
            : {}),
        },
        include: { steps: { orderBy: { stepSequence: "asc" }, select: { id: true, stepSequence: true } } },
      });

      // Eski adım → yeni adım (aynı stepSequence) eşlemesi
      const newStepBySeq = new Map(newWo.steps.map((s) => [s.stepSequence, s.id] as const));
      const oldToNew = new Map<string, string>();
      for (const s of sourceWo.steps) {
        const nid = newStepBySeq.get(s.stepSequence);
        if (nid) oldToNew.set(s.id, nid);
      }
      const newReEntryStepId = newStepBySeq.get(S)!;

      // Partinin TÜM ayak izini (top konumu + movement + operation) yeni WO'nun
      // aynı sıradaki adımlarına repoint et. recomputeStepStatus WO üyeliğini
      // movement üzerinden okuduğundan movement repoint ŞART.
      for (const [oldId, newId] of oldToNew) {
        await tx.roll.updateMany({
          where: { id: { in: laneRollIds }, currentStepId: oldId },
          data: { currentStepId: newId },
        });
        await tx.roll.updateMany({
          where: { id: { in: laneRollIds }, producedInStepId: oldId },
          data: { producedInStepId: newId },
        });
        await tx.rollMovement.updateMany({
          where: { rollId: { in: laneRollIds }, workOrderStepId: oldId },
          data: { workOrderStepId: newId },
        });
        await tx.rollOperation.updateMany({
          where: { rollId: { in: laneRollIds }, workOrderStepId: oldId },
          data: { workOrderStepId: newId },
        });
      }

      if (isRedye) {
        // YENİDEN BOYAMA: partiyi boyahane adımına GERİ SAR. Açık movement'leri
        // kapat (parti mevcut adımdan fiilen çekiliyor), boyahane adımında taze
        // açık movement aç (sonraki re-dispatch bunu yeniden kullanır), topları
        // IN_PRODUCTION @ boyahane yap ve eski lane'den kopar (batchSplitId=null
        // → yeniden sevkte yeni lane alır).
        await tx.rollMovement.updateMany({
          where: { rollId: { in: laneRollIds }, exitedAt: null },
          data: { exitedAt: new Date(), notes: "REDYE_REWIND" },
        });
        for (const r of fresh) {
          await tx.rollMovement.create({
            data: {
              rollId: r.id,
              workOrderStepId: newReEntryStepId,
              qtyIn: r.currentQty,
              weightIn: r.weightKg ?? null,
              operatorId: userId ?? null,
              notes: "REDYE_REWIND_IN",
            },
          });
        }
        await tx.roll.updateMany({
          where: { id: { in: laneRollIds } },
          data: {
            currentStepId: newReEntryStepId,
            producedInStepId: newReEntryStepId,
            status: RollStatus.IN_PRODUCTION,
            batchSplitId: null,
          },
        });
      } else {
        // BOYANMADAN: açık sevki yeni WO'ya taşı (kabul yeni WO'da düşer;
        // sourceDispatchItem bağı korunur). Toplar AT_SUBCONTRACTOR + lane korunur.
        await tx.subcontractorDispatch.update({
          where: { id: data.batchSplitId },
          data: { workOrderId: newWo.id, stepId: newReEntryStepId },
        });
      }

      // Yeni WO için yeni refakat kartı — parti ayrı WO'da hareket eder,
      // operatör basıp ayrılan demete takar.
      await travelerCardService.createForWorkOrder(tx, newWo.id, userId);

      // Kaynak WO'nun, partinin ÇIKTIĞI adımını yeniden hesapla (başka parti
      // hâlâ orada olabilir → ACTIVE kalır, yoksa PENDING/COMPLETED).
      await recomputeStepStatus(tx, rollStep.id);

      return { newWorkOrderId: newWo.id, batchNumber: newWo.batchNumber, movedRollCount: laneRollIds.length };
    }));

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: sourceWo.id,
      newData: {
        action: "SPLIT_SOURCE",
        mode: ctx.mode,
        batchSplitId: data.batchSplitId,
        newWorkOrderId: result.newWorkOrderId,
        movedRollCount: result.movedRollCount,
        newColorId: data.newColorId,
      },
    });
    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: result.newWorkOrderId,
      newData: {
        action: "SPLIT_TARGET",
        mode: ctx.mode,
        sourceWorkOrderId: sourceWo.id,
        batchNumber: result.batchNumber,
        movedRollCount: result.movedRollCount,
        targetColorId: data.newColorId,
        orderMode: data.orderMode,
      },
    });

    return {
      success: true,
      data: result,
      message:
        ctx.mode === "redye"
          ? `Parti yeni iş emrine ayrıldı: ${result.batchNumber} (${result.movedRollCount} top). Boyahaneye geri sarıldı; yeniden boyamada yeni renk uygulanacak.`
          : `Parti yeni iş emrine ayrıldı: ${result.batchNumber} (${result.movedRollCount} top). Yeni renk kabulde uygulanacak.`,
    };
  }

  /**
   * İptal etkisini ÖNİZLER (yıkıcı işlem onayı için). Hiçbir şeyi değiştirmez.
   * Döner: STOCK'a çekilecek toplar + VOID olacak ACTIVE refakat kartı sayısı.
   */
  async getCancelImpact(id: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: { steps: { select: { id: true } } },
    });
    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    const stepIds = wo.steps.map((s) => s.id);
    const rolls =
      stepIds.length > 0
        ? await prisma.roll.findMany({
            where: {
              OR: [
                { producedInStepId: { in: stepIds } },
                { currentStepId: { in: stepIds } },
              ],
            },
            select: {
              id: true,
              barcode: true,
              status: true,
              currentQty: true,
              colorId: true,
              entrySource: true,
              color: { select: { name: true, hex: true } },
              _count: { select: { properties: true } },
            },
            take: 200,
            orderBy: { createdAt: "asc" },
          })
        : [];
    const travelerCardCount = await prisma.travelerCard.count({
      where: { workOrderId: id, status: "ACTIVE" },
    });

    // Fasonda (boyahanede) işlem gören/görmüş in-flight top sayısı — varsa iptal
    // bloklanır (fason malı ham stoğa dönemez). softDelete'teki guard ile aynı.
    const fasonInFlightCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: {
              AND: [
                {
                  OR: [
                    { currentStepId: { in: stepIds } },
                    { producedInStepId: { in: stepIds } },
                  ],
                },
                {
                  OR: [
                    { status: RollStatus.AT_SUBCONTRACTOR },
                    { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
                    {
                      status: RollStatus.IN_PRODUCTION,
                      entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
                    },
                  ],
                },
              ],
            },
          })
        : 0;

    // Her top için: ham mı işlenmiş mi (boyalı/özellikli/fason-dönüşü) + hâlâ fasonda mı.
    const mappedRolls = rolls.map((r) => ({
      id: r.id,
      barcode: r.barcode,
      status: r.status,
      currentQty: r.currentQty,
      colorName: r.color?.name ?? null,
      colorHex: r.color?.hex ?? null,
      propertyCount: r._count.properties,
      processed:
        Boolean(r.colorId) ||
        r._count.properties > 0 ||
        String(r.entrySource) === "SUBCONTRACTOR_RETURN" ||
        r.status === RollStatus.AT_SUBCONTRACTOR ||
        r.status === RollStatus.RETURNED_FROM_SUBCONTRACTOR,
      atSubcontractor: r.status === RollStatus.AT_SUBCONTRACTOR,
    }));
    const atSubcontractorCount = mappedRolls.filter((r) => r.atSubcontractor).length;
    const processedCount = mappedRolls.filter((r) => r.processed).length;

    let blockReason: string | null = null;
    if (wo.status === WorkOrderStatus.CANCELLED) {
      blockReason = "İş emri zaten iptal edilmiş.";
    } else if (wo.status === WorkOrderStatus.COMPLETED) {
      blockReason = "Tamamlanmış iş emri iptal edilemez.";
    } else if (fasonInFlightCount > 0) {
      blockReason =
        "Fasonda (boyahanede) işlem gören/görmüş toplar var. Fason malı ham " +
        "stoğa dönemez; sipariş iptal olsa bile bu mal stok için üretilmeye " +
        "devam eder, iş emri iptal edilemez.";
    }

    return {
      success: true,
      data: {
        workOrderId: id,
        batchNumber: wo.batchNumber,
        status: wo.status,
        canCancel: blockReason === null,
        blockReason,
        travelerCardCount,
        rollCount: rolls.length,
        processedCount,
        atSubcontractorCount,
        fasonInFlightCount,
        rolls: mappedRolls,
      },
    };
  }

  /**
   * Soft-delete: sets status = CANCELLED (WorkOrder has no isActive field).
   * Veritabanı mantığı:
   * 0. GUARD: Fasonda (boyahanede) işlem gören/görmüş in-flight top varsa iptal
   *    REDDEDİLİR — fason malı ham stoğa dönemez, sipariş kopsa bile stok için
   *    üretilmeye devam eder. (AT_SUBCONTRACTOR, RETURNED_FROM_SUBCONTRACTOR,
   *    veya boyanmış-dönmüş IN_PRODUCTION açık kumaş = SUBCONTRACTOR_RETURN.)
   * 1. İş Emri iptal edilir.
   * 2. Yalnız GERÇEKTEN HAM (entrySource ≠ SUBCONTRACTOR_RETURN), halen üretimdeki
   *    (currentStepId + IN_PRODUCTION) toplar STOCK'a çekilir; producedInStepId
   *    (üretim izi) KORUNUR. Bitmiş depo malları (WAREHOUSE/PRODUCED/
   *    TAMBUR_CONSUMED) dokunulmaz.
   * 3. ACTIVE refakat kartları VOIDED'a düşer.
   * Tüm bu işlemler güvenli bir transaction bloğunda gerçekleşir.
   */
  async softDelete(id: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: true,
        orderLinks: { include: { orderLine: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw AppError.badRequest("İş emri zaten iptal edilmiş");
    }
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict("Tamamlanmış iş emri iptal edilemez");
    }

    const stepIds = existing.steps.map((step) => step.id);

    const { updated } = await prisma.$transaction(async (tx) => {
      // GUARD: Fasonda (boyahanede) işlem gören/görmüş in-flight top varsa iptal
      // edilemez. Fason malı asla ham stoğa dönemez — sipariş kopsa bile bu mal
      // stok için üretilmeye devam eder.
      //   - AT_SUBCONTRACTOR                     → halen boyahanede
      //   - RETURNED_FROM_SUBCONTRACTOR          → fason dönüşü (eski model)
      //   - IN_PRODUCTION + SUBCONTRACTOR_RETURN → boyanmış açık kumaş, KK2'de
      if (stepIds.length > 0) {
        const fasonInFlight = await tx.roll.count({
          where: {
            AND: [
              {
                OR: [
                  { currentStepId: { in: stepIds } },
                  { producedInStepId: { in: stepIds } },
                ],
              },
              {
                OR: [
                  { status: RollStatus.AT_SUBCONTRACTOR },
                  { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
                  {
                    status: RollStatus.IN_PRODUCTION,
                    entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
                  },
                ],
              },
            ],
          },
        });
        if (fasonInFlight > 0) {
          throw AppError.conflict(
            "Bu iş emrinde fasonda (boyahanede) işlem gören/görmüş toplar var. " +
              "Fason malı ham stoğa geri dönemez; sipariş iptal olsa bile bu mal " +
              "stok için üretilmeye devam eder. İş emri iptal edilemez."
          );
        }
      }

      const cancelledWO = await tx.workOrder.update({
        where: { id },
        data: { status: WorkOrderStatus.CANCELLED },
      });

      if (stepIds.length > 0) {
        // Yalnız GERÇEKTEN HAM (entrySource ≠ SUBCONTRACTOR_RETURN), halen
        // üretimdeki topları STOCK'a geri çek. `producedInStepId` (üretim izi)
        // KORUNUR. Bitmiş depo malları (WAREHOUSE/PRODUCED/TAMBUR_CONSUMED) ve
        // fason ürünleri (yukarıda bloklandı) DOKUNULMAZ.
        await tx.roll.updateMany({
          where: {
            currentStepId: { in: stepIds },
            status: RollStatus.IN_PRODUCTION,
            entrySource: { not: RollEntrySource.SUBCONTRACTOR_RETURN },
          },
          data: {
            status: RollStatus.STOCK,
            currentStepId: null,
          },
        });
      }

      // WO iptal olunca tüm ACTIVE refakat kartlarını VOIDED'a çek
      await tx.travelerCard.updateMany({
        where: { workOrderId: id, status: "ACTIVE" },
        data: {
          status: "VOIDED",
          voidedAt: new Date(),
          voidReason: "WO_CANCELLED",
        },
      });

      return { updated: cancelledWO };
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { batchNumber: existing.batchNumber, status: existing.status },
      newData: { status: WorkOrderStatus.CANCELLED },
    });

    return {
      success: true,
      data: updated,
      message: `İş emri iptal edildi, ham toplar STOCK'a çekildi: ${existing.batchNumber}`,
    };
  }

  /**
   * Soft-delete: arşivler — `isActive=false` yapar.
   *
   * Geçmiş (RollOperation, RollMovement, TravelerCard + scan, Manifest, Swatch,
   * SubcontractorDispatch/Receipt, WorkOrderStep, WorkOrderToOrderLine)
   * silinmez — izlenebilirlik ve audit için saklanır. Listeler arşivli WO'yu
   * gizler; detay endpoint (findById) hala görüntüler.
   *
   * Roll kurtarma: bu WO'nun adımlarına bağlı (currentStepId) topları STOCK'a
   * geri çeker ki yeni üretimde tekrar kullanılabilsin. `producedInStepId`
   * lineage olarak korunur (FK hala valid — step silinmedi).
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: { select: { id: true } },
      },
    });

    if (!existing) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (existing.status === WorkOrderStatus.IN_PROGRESS) {
      throw AppError.conflict(
        "Üretimdeki iş emri arşivlenemez. Önce iptal edin."
      );
    }

    if (!existing.isActive) {
      throw AppError.conflict("Bu iş emri zaten arşivli.");
    }

    const stepIds = existing.steps.map((s) => s.id);

    const archived = await prisma.$transaction(async (tx) => {
      if (stepIds.length > 0) {
        // Aktif üretimdeki topları STOCK'a geri çek (currentStepId null,
        // status STOCK). producedInStepId KORUNUR — lineage; step kaydı
        // hala DB'de (soft delete). Bu sayede ileride "bu top hangi WO'dan
        // çıktı?" sorgusu cevap verir.
        await tx.roll.updateMany({
          where: {
            currentStepId: { in: stepIds },
            status: RollStatus.IN_PRODUCTION,
          },
          data: {
            status: RollStatus.STOCK,
            currentStepId: null,
          },
        });
      }

      return tx.workOrder.update({
        where: { id },
        data: { isActive: false },
      });
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: {
        batchNumber: existing.batchNumber,
        type: existing.type,
        status: existing.status,
        stepCount: existing.steps.length,
      },
      newData: { isActive: false, event: "ARCHIVED" },
    });

    return {
      success: true,
      data: archived,
      message: `İş emri arşivlendi: ${existing.batchNumber}`,
    };
  }

  /**
   * Attach rolls to a work order by barcode scan.
   * Business Rule: Rolls must be in STOCK status.
   * Changes status to IN_PRODUCTION and links to first step.
   */
  async attachRolls(
    workOrderId: string,
    barcodes: string[],
    userId?: string
  ): Promise<ApiResponse<{ attached: number; errors: string[] }>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: {
          orderBy: { stepSequence: "asc" },
          include: { station: { select: { type: true } } },
        },
      },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş iş emrine top bağlanamaz.",
      );
    }

    if (wo.steps.length === 0) {
      throw AppError.badRequest("İş emrinde rota adımı tanımlanmamış");
    }

    const firstStep = wo.steps[0];
    const firstStepId = firstStep.id;
    // EXTERNAL ilk step (boyahane/fason): roller commit edilir ama henüz fiziksel
    // olarak orada değiller — sevk belgesi oluşturulduğunda RollMovement açılır.
    // INTERNAL ilk step: roller fabrikada, bağlama anında ilk adıma giriş yaparlar.
    const firstStepIsExternal = firstStep.station.type === "EXTERNAL";

    // R10: Tüm WO tipleri için sadece STOCK statüsündeki rulolar bağlanabilir.
    const acceptedRollStatuses: RollStatus[] = [RollStatus.STOCK];

    const attached: { id: string; barcode: string | null; prevStatus: RollStatus; qtyIn: number }[] = [];
    const errorMessages: string[] = [];

    await prisma.$transaction(async (tx) => {
      // 1) Tüm rulolar tek query'de — N round-trip yerine 1.
      const rolls = await tx.roll.findMany({
        where: { barcode: { in: barcodes } },
      });
      const byBarcode = new Map(rolls.map((r) => [r.barcode, r]));

      // 2) Per-barkod validation — bellek üstünde, query yok.
      const candidates: typeof rolls = [];
      for (const barcode of barcodes) {
        const roll = byBarcode.get(barcode);
        if (!roll) {
          errorMessages.push(`${barcode}: Barkod bulunamadı`);
          continue;
        }
        if (!acceptedRollStatuses.includes(roll.status)) {
          errorMessages.push(
            `${barcode}: Top uygun durumda değil (mevcut: ${roll.status}, beklenen: ${acceptedRollStatuses.join("/")})`
          );
          continue;
        }
        candidates.push(roll);
      }

      if (candidates.length > 0) {
        const candidateIds = candidates.map((r) => r.id);

        // 3) Atomik bulk update — status guard race condition'ı yakalar.
        const updateResult = await tx.roll.updateMany({
          where: {
            id: { in: candidateIds },
            status: { in: acceptedRollStatuses },
          },
          data: {
            status: RollStatus.IN_PRODUCTION,
            producedInStepId: firstStepId,
            currentStepId: firstStepId,
          },
        });

        // 4) Race condition koruması: eğer count beklenenden az,
        //    hangi ruloların gerçekten güncellendiğini bul.
        let succeeded = candidates;
        if (updateResult.count !== candidates.length) {
          const updatedRolls = await tx.roll.findMany({
            where: {
              id: { in: candidateIds },
              status: RollStatus.IN_PRODUCTION,
              producedInStepId: firstStepId,
            },
            select: { id: true },
          });
          const updatedIds = new Set(updatedRolls.map((r) => r.id));
          succeeded = candidates.filter((r) => updatedIds.has(r.id));
          for (const r of candidates) {
            if (!updatedIds.has(r.id)) {
              errorMessages.push(
                `${r.barcode}: Top başka bir işlemde değişti, tekrar deneyin`
              );
            }
          }
        }

        if (succeeded.length > 0) {
          // 5) Bulk movement insert — sadece INTERNAL ilk step için.
          //    EXTERNAL'da fiziksel sevk olmadan step'in ACTIVE olması yanlış
          //    ("Boyahane'de" gibi görünür) → movement dispatch anında açılır.
          if (!firstStepIsExternal) {
            await tx.rollMovement.createMany({
              data: succeeded.map((r) => ({
                rollId: r.id,
                workOrderStepId: firstStepId,
                qtyIn: r.currentQty,
                weightIn: r.weightKg,
                operatorId: userId ?? null,
              })),
            });
          }

          for (const r of succeeded) {
            attached.push({
              id: r.id,
              barcode: r.barcode,
              prevStatus: r.status,
              qtyIn: Number(r.currentQty),
            });
          }
        }
      }

      // INTERNAL ilk step: bağlama = üretim başlangıcı → step ACTIVE + WO IN_PROGRESS.
      // EXTERNAL ilk step: roller henüz fasona gönderilmedi → step PENDING + WO PLANNED
      //                    olarak kalmalı; dispatch oluşturulunca ikisi de güncellenir.
      if (attached.length > 0 && !firstStepIsExternal) {
        await recomputeStepStatus(tx, firstStepId);
        await ensureWorkOrderInProgress(tx, workOrderId);
      }
    });

    // Audit log'lar tx dışında, paralel — her biri ayrı connection alabilir.
    // R8 fix: recordId roll.id (UUID), barcode newData'ya meta olarak gidiyor.
    await Promise.all(
      attached.map((r) =>
        AuditService.log({
          userId,
          action: "UPDATE",
          tableName: "ROLL",
          recordId: r.id,
          oldData: { status: r.prevStatus },
          newData: {
            status: "IN_PRODUCTION",
            workOrderId,
            firstStepId,
            barcode: r.barcode,
            qtyIn: r.qtyIn,
          },
        })
      )
    );

    return {
      success: true,
      data: {
        attached: attached.length,
        errors: errorMessages,
      },
      message: `${attached.length} top iş emrine bağlandı`,
    };
  }

  /**
   * İş emrinin temel alanlarını günceller. Planlamacının kontrolünde — üretim
   * sırasında değişikliklere izin verilir (örn. boyahane mavi yerine kırmızı
   * boyasın denildi → targetColorId değişir; henüz colorId almamış rulolar
   * Fason Kabul'de yeni rengi otomatik alır). Sadece COMPLETED/CANCELLED
   * iş emirlerinde değişiklik yapılamaz (geriye dönük tutarlılık).
   *
   * Steps/orderLinks/targetProperties gibi koleksiyonlar bu endpoint'in
   * scope'unda DEĞİL — onlar için `replace`/`updateStepPlanning`/
   * `updateTargetProperties` kullan.
   */
  async update(
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
      dyehouseNote?: string | null;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş iş emri düzenlenemez.",
      );
    }

    // STOCK_PRODUCTION'da targetItemId zorunlu — null'a çevirme yasak
    if (wo.type === "STOCK_PRODUCTION" && data.targetItemId === null) {
      throw AppError.badRequest(
        "Stoğa üretim iş emrinde hedef ürün boş bırakılamaz."
      );
    }
    if (data.targetItemId) {
      const targetItem = await prisma.item.findUnique({
        where: { id: data.targetItemId },
        select: { id: true, isActive: true },
      });
      if (!targetItem || !targetItem.isActive) {
        throw AppError.badRequest("Hedef ürün bulunamadı veya pasif");
      }
    }
    if (data.targetColorId) {
      const color = await prisma.color.findUnique({
        where: { id: data.targetColorId },
        select: { isActive: true },
      });
      if (!color || !color.isActive) {
        throw AppError.badRequest("Hedef renk bulunamadı veya pasif");
      }
    }

    // Parti kodu değiştiriliyorsa benzersizliğini doğrula (kendini hariç tut).
    if (
      data.batchNumber &&
      data.batchNumber.trim().length > 0 &&
      data.batchNumber.trim() !== wo.batchNumber
    ) {
      await this.assertBatchNumberUnique(data.batchNumber.trim(), id);
    }

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        batchNumber: data.batchNumber?.trim() || undefined,
        width: data.width ?? undefined,
        targetQuantity: data.targetQuantity ?? undefined,
        targetWeight: data.targetWeight ?? undefined,
        plannedStartDate: data.plannedStartDate
          ? new Date(data.plannedStartDate)
          : data.plannedStartDate === null
            ? null
            : undefined,
        plannedEndDate: data.plannedEndDate
          ? new Date(data.plannedEndDate)
          : data.plannedEndDate === null
            ? null
            : undefined,
        targetItemId: data.targetItemId === undefined ? undefined : data.targetItemId,
        targetColorId: data.targetColorId === undefined ? undefined : data.targetColorId,
        foldType: data.foldType === undefined ? undefined : data.foldType,
        dyehouseNote: data.dyehouseNote === undefined ? undefined : data.dyehouseNote,
      },
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: data as Record<string, unknown>,
    });

    return { success: true, data: updated, message: "İş emri güncellendi" };
  }

  /**
   * İş emrini tüm ilişkileri ile birlikte yeniden yazar. Planlamacının
   * kontrolünde — üretim sırasında değişikliklere izin verilir. Sadece
   * COMPLETED/CANCELLED iş emirlerinde yapılamaz.
   *
   * Smart merge stratejisi (rota için):
   * - `steps[i].id` mevcut step'i işaret ediyorsa → güncellenir (notes,
   *   stationId, sequence, requiredCategoryId, plannedSubcontractorId).
   * - `steps[i].id` boşsa → yeni step eklenir.
   * - Mevcut listede olup yeni listede olmayan step → status=PENDING ve
   *   hiçbir bağlı kayıt (rulo, movement, dispatch, vb.) yoksa silinir;
   *   aksi halde "tamamlanmış/aktif/bağlı adım silinemez" hatası.
   *
   * orderLinks ve targetProperties drop-and-recreate.
   */
  async replace(
    id: string,
    data: WorkOrderCreateInput,
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: { targetProperties: { select: { propertyId: true } } },
    });
    if (!existing) throw AppError.notFound("İş emri bulunamadı");
    if (
      existing.status === WorkOrderStatus.COMPLETED ||
      existing.status === WorkOrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş iş emri düzenlenemez.",
      );
    }

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

    const type = (data.type as WorkOrder["type"]) ?? existing.type;

    // ── Rota adımlarını hazırla (şablondan veya raw'dan) — create() ile aynı.
    // `id?` smart-merge için propagasyonla taşınır; routeTemplate'tan gelenler id'siz.
    let finalSteps: {
      id?: string;
      stationId: string;
      notes: string | null;
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
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
      if (!template.isActive) throw AppError.badRequest("Pasif bir rota şablonu kullanılamaz");
      if (template.steps.length === 0) throw AppError.badRequest("Rota şablonunda adım yok");

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
          requiredCategoryId: overlay?.requiredCategoryId ?? null,
          plannedSubcontractorId: overlay?.plannedSubcontractorId ?? null,
        };
      });
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
      }));
    }

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

    if (type === "ORDER_PRODUCTION" && allocations.length === 0) {
      throw AppError.badRequest(
        "Siparişe özel üretim iş emri en az bir sipariş kalemine bağlanmalıdır.",
      );
    }

    // ── Hedef ürün doğrulaması ───────────────────────────────────────────────
    let resolvedTargetItemId: string | null = data.targetItemId ?? null;

    if (type === "STOCK_PRODUCTION" && !resolvedTargetItemId) {
      throw AppError.badRequest(
        "Stoğa üretim iş emri için hedef ürün seçmelisiniz.",
      );
    }

    if (resolvedTargetItemId) {
      const targetItem = await prisma.item.findUnique({
        where: { id: resolvedTargetItemId },
        select: { id: true, isActive: true },
      });
      if (!targetItem || !targetItem.isActive) {
        throw AppError.badRequest("Hedef ürün bulunamadı veya pasif");
      }
    }

    let resolvedTargetColorId: string | null = data.targetColorId ?? null;
    if (type === "ORDER_PRODUCTION" && allocations.length > 0) {
      const orderLineItems = await prisma.orderLine.findMany({
        where: { id: { in: allocations.map((a) => a.orderLineId) } },
        select: { id: true, itemId: true, colorId: true },
      });
      const distinctItems = new Set(orderLineItems.map((l) => l.itemId));
      if (distinctItems.size === 1) {
        const onlyItemId = Array.from(distinctItems)[0];
        if (resolvedTargetItemId && resolvedTargetItemId !== onlyItemId) {
          throw AppError.badRequest(
            "Hedef ürün, sipariş satırlarındaki ürün ile uyuşmuyor",
          );
        }
        resolvedTargetItemId = onlyItemId;
      } else if (distinctItems.size > 1 && !resolvedTargetItemId) {
        throw AppError.badRequest(
          "Sipariş satırları farklı ürünler içeriyor; hedef ürünü açıkça belirtin",
        );
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
        throw AppError.badRequest(
          "Sipariş satırları farklı renkler içeriyor; hedef rengi açıkça belirtin",
        );
      }
    }

    // ── targetProperties doğrulaması ─────────────────────────────────────────
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
        const stepCategoryIds = finalSteps
          .map((s) => s.requiredCategoryId)
          .filter((c): c is string => !!c);
        if (stepCategoryIds.length === 0) {
          throw AppError.badRequest(
            "Hedef renk veya özellik seçildi ama rotada hiç fason kategorisi tanımlı değil. Uygulayabilecek bir adım gerekiyor.",
          );
        }
        const categoryFlags = await prisma.subcontractorCategory.findMany({
          where: { id: { in: stepCategoryIds } },
          select: { appliesColor: true, appliesProperty: true },
        });
        if (resolvedTargetColorId && !categoryFlags.some((c) => c.appliesColor)) {
          throw AppError.badRequest(
            "Rotada 'renk veren' bir fason adımı (örn. boyahane) tanımlı değil. Hedef rengin uygulanabilmesi için böyle bir adım eklenmelidir.",
          );
        }
        if (
          targetPropertyIds.length > 0 &&
          !categoryFlags.some((c) => c.appliesProperty)
        ) {
          throw AppError.badRequest(
            "Rotada 'özellik veren' bir fason adımı tanımlı değil. Hedef özelliklerin uygulanabilmesi için böyle bir adım eklenmelidir.",
          );
        }
      }
    }

    // Parti kodu değiştiriliyorsa benzersizliğini doğrula (kendini hariç tut).
    if (
      data.batchNumber &&
      data.batchNumber.trim().length > 0 &&
      data.batchNumber.trim() !== existing.batchNumber
    ) {
      await this.assertBatchNumberUnique(data.batchNumber.trim(), id);
    }

    const batchNumber =
      data.batchNumber && data.batchNumber.trim().length > 0
        ? data.batchNumber.trim()
        : existing.batchNumber;

    // ── Transaction: smart merge (steps id-bazlı diff) ───────────────────────
    const updated = await prisma.$transaction(async (tx) => {
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
        if (locks.materialCommitted) {
          // Sadece **yeni** bağlanan satırları kontrol et — mevcut bağlar zaten
          // geçmişten geliyor (en/kumaş kilitli, değişmiyorlar).
          const previousLinkIds = new Set(
            (
              await tx.workOrderToOrderLine.findMany({
                where: { workOrderId: id },
                select: { orderLineId: true },
              })
            ).map((l) => l.orderLineId),
          );
          for (const line of orderLines) {
            if (previousLinkIds.has(line.id)) continue;
            if (line.itemId !== existing.targetItemId) {
              throw AppError.conflict(
                "Sevk yapılmış iş emrine farklı kumaş içeren sipariş bağlanamaz.",
              );
            }
            if (normNum(line.width) !== normNum(existing.width)) {
              throw AppError.conflict(
                "Sevk yapılmış iş emrine farklı eninde sipariş bağlanamaz.",
              );
            }
          }
        }
      }

      // ── Step diff (smart merge) ─────────────────────────────────────────
      // Mevcut step'leri çek + bağlı kayıt sayılarını topla.
      const existingStepRows = await tx.workOrderStep.findMany({
        where: { workOrderId: id },
        select: {
          id: true,
          stepSequence: true,
          status: true,
          _count: {
            select: {
              movements: true,
              cardScans: true,
              dispatches: true,
              receipts: true,
              operations: true,
              currentRolls: true,
              producedRolls: true,
              detectedErrors: true,
              processedErrors: true,
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
            `${old.stepSequence}. adım silinemez — bu adıma bağlı rulo, hareket veya sevk kaydı var.`,
          );
        }
        await tx.workOrderStep.delete({ where: { id: old.id } });
      }

      // 2) Step'leri güncelle veya ekle. stepSequence yeni listedeki indeks
      //    bazlı yeniden numaralandırılır. (workOrderId, stepSequence)
      //    üzerinde unique kısıtı olmadığı için iki-aşamalı güncelleme gerekmez.
      for (const [index, incoming] of finalSteps.entries()) {
        const stepSequence = index + 1;
        if (incoming.id && existingStepById.has(incoming.id)) {
          await tx.workOrderStep.update({
            where: { id: incoming.id },
            data: {
              stationId: incoming.stationId,
              stepSequence,
              notes: incoming.notes,
              requiredCategoryId: incoming.requiredCategoryId ?? null,
              plannedSubcontractorId: incoming.plannedSubcontractorId ?? null,
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
            },
          });
        }
      }

      // ── orderLinks ve targetProperties drop-and-recreate ────────────────
      // Bunlar başka tablolardan FK ile referanslanmaz — güvenli.
      await tx.workOrderToOrderLine.deleteMany({ where: { workOrderId: id } });
      await tx.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } });

      const planDates = await resolvePlanDates(
        data.plannedStartDate,
        data.plannedEndDate,
      );

      const wo = await tx.workOrder.update({
        where: { id },
        data: {
          batchNumber,
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
          dyehouseNote: data.dyehouseNote ?? null,
          ...(allocations.length > 0
            ? {
                orderLinks: {
                  create: allocations.map((a) => ({
                    orderLineId: a.orderLineId,
                    allocatedQty: a.allocatedQty,
                  })),
                },
              }
            : {}),
          ...(targetPropertyIds.length > 0
            ? {
                targetProperties: {
                  create: targetPropertyIds.map((propertyId) => ({ propertyId })),
                },
              }
            : {}),
        },
        include: {
          steps: { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: {
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

      return wo;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: {
        replace: true,
        batchNumber: updated.batchNumber,
        type: updated.type,
        stepCount: finalSteps.length,
        routeTemplateId: updated.routeTemplateId,
        allocationCount: allocations.length,
        targetItemId: updated.targetItemId,
        targetColorId: updated.targetColorId,
        targetPropertyIds,
      },
    });

    return {
      success: true,
      data: updated,
      message: `İş emri güncellendi: ${updated.batchNumber}`,
    };
  }

  /**
   * WO targetProperties güncelle. Status farketmez (PLANNED de IN_PROGRESS de
   * COMPLETED de). Bağlı tüm Roll'ların properties'i senkronize edilir.
   *
   * Frontend bu çağrıdan ÖNCE getRollImpact ile etkilenecek rulo sayısını
   * göstermeli ve onay almalıdır.
   */
  async updateTargetProperties(
    id: string,
    propertyIds: string[],
    userId?: string,
  ): Promise<ApiResponse<{ workOrderId: string; affectedRollCount: number }>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      select: {
        id: true,
        targetItemId: true,
        targetItem: {
          select: {
            allowedProperties: { select: { propertyId: true } },
          },
        },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const dedupedIds = [...new Set(propertyIds)];

    if (dedupedIds.length > 0) {
      const propRows = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedIds }, isActive: true },
        select: { id: true, name: true },
      });
      if (propRows.length !== dedupedIds.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }

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
      // 1) WO targetProperties replace
      await tx.workOrderTargetProperty.deleteMany({ where: { workOrderId: id } });
      if (dedupedIds.length > 0) {
        await tx.workOrderTargetProperty.createMany({
          data: dedupedIds.map((propertyId) => ({ workOrderId: id, propertyId })),
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

      // 3) Roll.properties replace
      if (rollIds.length > 0) {
        await tx.rollProperty.deleteMany({ where: { rollId: { in: rollIds } } });
        if (dedupedIds.length > 0) {
          const data = rollIds.flatMap((rollId) =>
            dedupedIds.map((propertyId) => ({ rollId, propertyId })),
          );
          await tx.rollProperty.createMany({ data });
        }
      }

      return { affectedRollCount: rollIds.length };
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: {
        targetPropertyIds: dedupedIds,
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

  /**
   * Frontend "değişiklik X rulo etkileyecek, devam mı?" uyarısı için.
   * WO'ya bağlı + henüz Tambur'dan geçmemiş ve geçmiş rulo sayılarını döner.
   */
  async getTargetPropertyChangeImpact(
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

  /**
   * EXTERNAL adım planlaması — gerekli kategori ve planlanan firma seçimi.
   * Adım hangi durumda olursa olsun (PENDING/ACTIVE/COMPLETED/SKIPPED/CANCELLED)
   * planlamacı kategori veya firma değiştirebilir. Tek istisna: WO COMPLETED
   * veya CANCELLED ise hiçbir değişiklik yapılamaz.
   *
   * Subcontractor seçilirse kategoriye uygun olmalıdır.
   */
  async updateStepPlanning(
    workOrderId: string,
    stepId: string,
    data: {
      requiredCategoryId?: string | null;
      plannedSubcontractorId?: string | null;
    },
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, status: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        `Tamamlanmış/iptal edilmiş iş emrinde adım planlaması değiştirilemez (durum: ${wo.status}).`,
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
      throw AppError.badRequest("Adım bu iş emrine ait değil");
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

    const updated = await prisma.workOrderStep.update({
      where: { id: stepId },
      data: {
        requiredCategoryId: data.requiredCategoryId,
        plannedSubcontractorId: data.plannedSubcontractorId,
      },
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

  /**
   * Topları İş Emrinden (Sepetten) Çıkarma
   * Sepet mantığı için eklendi: Yanlış bağlanan stok topların rotasını ve durumunu temizler.
   */
  async detachRolls(workOrderId: string, rollIds: string[], userId?: string): Promise<ApiResponse<any>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { steps: true },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    // Tamamlanmış/iptal edilmiş WO'da değişiklik yapılamaz; diğer durumlarda
    // planlamacının kontrolünde top çıkarılabilir (örn. yanlış bağlanmış top
    // boyahaneye gönderildikten sonra fark edildi → çıkar, sevki iptal et).
    if (
      wo.status === WorkOrderStatus.COMPLETED ||
      wo.status === WorkOrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        `Tamamlanmış/iptal edilmiş iş emrinden top çıkarılamaz (durum: ${wo.status}).`,
      );
    }

    const stepIds = wo.steps.map(s => s.id);
    if (stepIds.length === 0) {
      throw AppError.badRequest("İş emrinin adımları bulunamadı.");
    }

    const detached: { id: string; barcode: string | null }[] = [];

    await prisma.$transaction(async (tx) => {
      // TOPLU (eski kod top başına findUnique+update+updateMany = N+1).
      const found = await tx.roll.findMany({
        where: { id: { in: rollIds } },
        select: { id: true, barcode: true },
      });
      const foundIds = found.map((r) => r.id);
      if (foundIds.length === 0) return;

      // 1) Toplar → STOCK + pointer temizle (currentQty'ye dokunulmaz).
      await tx.roll.updateMany({
        where: { id: { in: foundIds } },
        data: {
          status: RollStatus.STOCK,
          producedInStepId: null,
          currentStepId: null,
        },
      });

      // 2) Açık RollMovement'ları DETACH notuyla kapat. qtyOut/weightOut her top
      //    için KENDİ currentQty/weightKg'sinden (join) gelir — satır-bazlı farklı
      //    değer olduğu için tek raw UPDATE (Prisma updateMany tek değer yazardı).
      //    Tek sorgu = O(1) (eski per-roll updateMany yerine).
      await tx.$executeRaw`
        UPDATE roll_movements m
        SET "exitedAt" = now(),
            "qtyOut" = r."currentQty",
            "weightOut" = r."weightKg",
            notes = 'DETACHED_FROM_WO'
        FROM rolls r
        WHERE m."rollId" = r.id
          AND m."rollId" IN (${Prisma.join(foundIds)})
          AND m."workOrderStepId" IN (${Prisma.join(stepIds)})
          AND m."exitedAt" IS NULL
      `;

      detached.push(...found.map((r) => ({ id: r.id, barcode: r.barcode })));
    });

    // R8 fix: audit recordId = UUID
    for (const r of detached) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: r.id,
        oldData: { status: "IN_PRODUCTION", workOrderId },
        newData: { status: "STOCK", workOrderId: null, barcode: r.barcode },
      });
    }

    return {
      success: true,
      data: { detached: detached.length },
      message: `${detached.length} top iş emrinden başarıyla çıkarıldı.`,
    };
  }

  /**
   * İş Emrini Kilitle (Üretime Al)
   * Sepetteki (PLANNED) siparişi onaylayıp IN_PROGRESS durumuna sokar, top eklemeye/çıkarmaya kapatır.
   */
  async lockWorkOrder(workOrderId: string, userId?: string): Promise<ApiResponse<WorkOrder>> {
    const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }
    if (wo.status !== WorkOrderStatus.PLANNED) {
      throw AppError.badRequest("Sadece 'Planlandı' durumundaki iş emirleri kilitlenebilir/başlatılabilir.");
    }

    const updated = await prisma.workOrder.update({
      where: { id: workOrderId },
      data: { status: WorkOrderStatus.IN_PROGRESS },
    });

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
      data: updated,
      message: "İş emri kilitlendi ve üretime (IN_PROGRESS) alındı.",
    };
  }

  /**
   * Sepetteki (Bağlanmış) Topları Getir
   */
  async getAttachedRolls(workOrderId: string): Promise<ApiResponse<any[]>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { steps: true },
    });

    if (!wo) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    const stepIds = wo.steps.map((s) => s.id);
    if (stepIds.length === 0) {
      return { success: true, data: [] };
    }

    const rolls = await prisma.roll.findMany({
      where: {
        OR: [
          { producedInStepId: { in: stepIds } },
          { currentStepId: { in: stepIds } },
        ],
      },
      include: { item: true, color: true },
      orderBy: { createdAt: "desc" },
    });

    return { success: true, data: rolls };
  }

  /**
   * Generate Traveler Card (Refakat Kartı) data for a work order.
   * Contains work order info, route steps, and linked order info.
   */
  async getTravelCard(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        targetColor: true,
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
        orderLinks: {
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
      },
    });

    if (!wo) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }

    const travelCard = {
      batchNumber: wo.batchNumber,
      type: wo.type,
      width: wo.width,
      targetColor: wo.targetColor
        ? { id: wo.targetColor.id, code: wo.targetColor.code, name: wo.targetColor.name }
        : null,
      status: wo.status,
      parameters: wo.parameters,
      route: wo.steps.map((step) => ({
        sequence: step.stepSequence,
        stationCode: step.station.code,
        stationName: step.station.name,
        stationType: step.station.type,
        status: step.status,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
      })),
      linkedOrders: wo.orderLinks.map((link) => ({
        orderNumber: link.orderLine.order.orderNumber,
        customerName: link.orderLine.order.customer.name,
        itemName: link.orderLine.item.name,
        colorName: link.orderLine.color?.name ?? null,
        requestedQty: link.orderLine.quantity,
      })),
      createdAt: wo.createdAt,
    };

    return { success: true, data: travelCard };
  }

  /**
   * Canlı önizleme — snapshot'a bakmaz, mevcut roll durumunu hesaplar.
   * `createManifest` (yeni belge basma) ve henüz Manifest kaydı bulunmayan
   * `getManifest` çağrıları bu yardımcıyı kullanır.
   */
  private async computeLiveManifest(
    workOrderId: string
  ): Promise<Record<string, unknown> | null> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: {
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
        },
      },
    });
    if (!wo) return null;

    const rolls = await prisma.roll.findMany({
      where: {
        parentRollId: null,
        status: { notIn: [RollStatus.CANCELLED] },
        OR: [
          { producedInStepId: { in: wo.steps.map((s) => s.id) } },
          { currentStepId: { in: wo.steps.map((s) => s.id) } },
        ],
      },
      include: { item: true },
    });

    // Hedef adım (rota'nın ilk istasyonu) — dyehouse alanı kaldırıldığı için
    // destination her zaman ilk istasyon üzerinden türetilir. Bir EXTERNAL adım
    // varsa fason firma bilgisi WorkOrderStep.plannedSubcontractor üzerinden
    // ileride buraya eklenebilir (ayrı bir task).
    const destination = wo.steps[0]
      ? {
          kind: "STATION" as const,
          stationCode: wo.steps[0].station.code,
          stationName: wo.steps[0].station.name,
        }
      : null;

    return {
      batchNumber: wo.batchNumber,
      type: wo.type,
      width: wo.width,
      totalRolls: rolls.length,
      // Decimal aritmetik — float drift'i önler. Serializer Decimal'i number'a çevirir.
      totalMeterage: rolls.reduce(
        (sum, r) => sum.plus(r.currentQty),
        new Prisma.Decimal(0)
      ),
      totalWeight: rolls.reduce(
        (sum, r) => sum.plus(r.weightKg ?? 0),
        new Prisma.Decimal(0)
      ),
      rolls: rolls.map((r) => ({
        barcode: r.barcode,
        itemName: r.item.name,
        currentQty: r.currentQty,
        weightKg: r.weightKg,
        status: r.status,
      })),
      destination,
    };
  }

  /**
   * Generate Manifest / Çeki Listesi data.
   *
   * Davranış:
   *   - Eğer bu WO için daha önce Manifest basılmışsa, SON snapshot döner
   *     (dondurulmuş belge — Tambur'da kesilen çocuk toplar vs. artık listeyi
   *     değiştiremez). Frontend `isSnapshot: true` ile bunu ayırt edebilir.
   *   - Snapshot yoksa canlı önizleme döner; ama sadece orijinal (split olmayan)
   *     toplar listeye girer — SCRAP/A1_STOCK çocukları hariç.
   *   - Listeyi değiştirmek isteyen operatör yeni bir `createManifest` çağrısı
   *     yapmalı (reprint = yeni belge).
   */
  async getManifest(workOrderId: string): Promise<ApiResponse<Record<string, unknown> | null>> {
    const latestManifest = await prisma.manifest.findFirst({
      where: { workOrderId },
      orderBy: { printedAt: "desc" },
      include: {
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (latestManifest) {
      const snapshot = (latestManifest.snapshot ?? {}) as Record<string, unknown>;
      return {
        success: true,
        data: {
          ...snapshot,
          isSnapshot: true,
          manifestNo: latestManifest.manifestNo,
          printedAt: latestManifest.printedAt,
          printedBy: latestManifest.printedBy,
          notes: latestManifest.notes,
        },
      };
    }

    const live = await this.computeLiveManifest(workOrderId);
    if (!live) {
      return { success: false, data: null, message: "İş emri bulunamadı" };
    }
    return { success: true, data: { ...live, isSnapshot: false } };
  }

  /**
   * 3.5 — Çeki Listesi kalıcı belge (Manifest) oluştur.
   * Mevcut WO'nun anlık durumunu snapshot'layıp Manifest tablosuna yazar.
   * Aynı WO için birden fazla manifest basılabilir (reprint mantığı — eski belgeler korunur).
   */
  async createManifest(
    workOrderId: string,
    userId?: string,
    notes?: string
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    const live = await this.computeLiveManifest(workOrderId);
    if (!live) {
      throw AppError.notFound("İş emri bulunamadı");
    }

    // Manifest no: M-YYMMDD-NNN
    const now = new Date();
    const prefix =
      "M-" +
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0") +
      "-";

    const last = await prisma.manifest.findFirst({
      where: { manifestNo: { startsWith: prefix } },
      orderBy: { manifestNo: "desc" },
      select: { manifestNo: true },
    });
    const seq = last
      ? parseInt(last.manifestNo.split("-").pop() ?? "0", 10) + 1
      : 1;
    const manifestNo = `${prefix}${String(seq).padStart(3, "0")}`;

    const manifest = await prisma.manifest.create({
      data: {
        manifestNo,
        workOrderId,
        printedById: userId ?? null,
        snapshot: live as Prisma.InputJsonValue,
        notes: notes ?? null,
      },
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "MANIFEST",
      recordId: manifest.id,
      newData: { manifestNo, workOrderId },
    });

    return {
      success: true,
      data: {
        id: manifest.id,
        manifestNo: manifest.manifestNo,
        printedAt: manifest.printedAt,
        snapshot: manifest.snapshot,
      },
      message: `Çeki listesi oluşturuldu: ${manifestNo}`,
    };
  }

  /**
   * 3.5 — İş emrinin geçmiş tüm manifest belgeleri.
   */
  async listManifests(workOrderId: string): Promise<ApiResponse<unknown>> {
    const manifests = await prisma.manifest.findMany({
      where: { workOrderId },
      orderBy: { printedAt: "desc" },
      // snapshot (JSON) liste görünümünde yüklenmez; sadece detail/print endpoint'i çeker
      select: {
        id: true,
        manifestNo: true,
        workOrderId: true,
        printedAt: true,
        notes: true,
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });
    return { success: true, data: manifests };
  }

  /**
   * Tek bir manifest'i ID ile getir — kayıtlı snapshot'ı döner (yeniden hesaplama yok).
   * Liste endpoint'i snapshot'ı çekmiyor (over-fetch); print/detail için bu kullanılır.
   */
  async getManifestById(manifestId: string): Promise<ApiResponse<unknown>> {
    const manifest = await prisma.manifest.findUnique({
      where: { id: manifestId },
      select: {
        id: true,
        manifestNo: true,
        workOrderId: true,
        printedAt: true,
        notes: true,
        snapshot: true,
        printedBy: { select: { id: true, username: true, fullName: true } },
      },
    });

    if (!manifest) {
      throw AppError.notFound("Çeki listesi bulunamadı");
    }

    return { success: true, data: manifest };
  }

  /**
   * List work orders that are PLANNED and ready for roll attachment.
   * These are work orders created by planning but not yet started.
   */
  async findAvailableForAttach(): Promise<ApiResponse<WorkOrder[]>> {
    const workOrders = await prisma.workOrder.findMany({
      where: {
        status: "PLANNED",
        isActive: true,
      },
      include: {
        steps: {
          include: { station: true },
          orderBy: { stepSequence: "asc" },
          take: 1,
        },
        orderLinks: {
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
      },
      orderBy: { createdAt: "desc" },
    });

    return {
      success: true,
      data: workOrders,
    };
  }
}
