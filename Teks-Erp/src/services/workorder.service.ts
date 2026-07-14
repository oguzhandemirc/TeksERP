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
  "workOrderNumber",
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
  OrderStatus,
  Prisma,
} from "@prisma/client";
import {
  ensureWorkOrderInProgress,
  recomputeStepStatus,
} from "./helpers/roll-step.helper";
import { computeWorkOrderLocks, touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { setWorkOrderCardStatuses } from "./helpers/traveler-card-fanout.helper";
import { createBatchTx, type CreateBatchResult } from "./batch.service";
import { WorkOrderSplitService } from "./workorder-split.service";
import { loadQualityTargetMaps, resolveFinalStatus } from "./helpers/roll-finalize.helper";
import { TravelerCardService } from "./traveler-card.service";
import { readWorkOrderDefaultPlanDurationDays } from "./system-setting.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
// Per-roll split'te taşınan toplar için yeni SD dispatch numarası (aynı sequence).
import { nextPrefixedSequence, SubcontractorService } from "./subcontractor.service";

// Prisma.Decimal | number | null | undefined → number | null (karşılaştırma için)
function normNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

const workOrderSplitService = new WorkOrderSplitService();
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

/**
 * Rota adımlarındaki istasyon/kategori/firma referanslarının var + aktif olduğunu
 * doğrular (soft-delete guard, SEC-3). create() ve replace() ortak kullanır —
 * pasife alınmış (isActive=false) kayıt DB FK kontrolünü geçer ama WorkOrderStep
 * emekli istasyona işaret etmemeli. Var-olmayan UUID zaten P2003→400 ile yakalanır.
 */
async function assertRouteRefsActive(
  steps: Array<{
    stationId: string;
    requiredCategoryId?: string | null;
    plannedSubcontractorId?: string | null;
  }>,
): Promise<void> {
  const stationIds = [...new Set(steps.map((s) => s.stationId).filter(Boolean))];
  if (stationIds.length > 0) {
    const live = await prisma.station.findMany({
      where: { id: { in: stationIds }, isActive: true },
      select: { id: true },
    });
    if (live.length !== stationIds.length) {
      throw AppError.badRequest("Rotada bulunmayan veya pasif istasyon var");
    }
  }
  const categoryIds = [
    ...new Set(steps.map((s) => s.requiredCategoryId).filter((x): x is string => !!x)),
  ];
  if (categoryIds.length > 0) {
    const live = await prisma.subcontractorCategory.findMany({
      where: { id: { in: categoryIds }, isActive: true },
      select: { id: true },
    });
    if (live.length !== categoryIds.length) {
      throw AppError.badRequest("Rotada bulunmayan veya pasif fason kategorisi var");
    }
  }
  const subIds = [
    ...new Set(steps.map((s) => s.plannedSubcontractorId).filter((x): x is string => !!x)),
  ];
  if (subIds.length > 0) {
    const live = await prisma.subcontractor.findMany({
      where: { id: { in: subIds }, isActive: true },
      select: { id: true },
    });
    if (live.length !== subIds.length) {
      throw AppError.badRequest("Rotada bulunmayan veya pasif fason firma var");
    }
  }
}

/**
 * L (düşük bulgu): WO'ya bağlanacak sipariş satırları için giriş guard'ı —
 * var olmayan satır ve İPTAL edilmiş siparişin satırı reddedilir (eskiden
 * iptal siparişe sessizce yeni üretim bağlanabiliyordu). create + replace ortak.
 */
function assertOrderLinesLinkable(
  requestedIds: string[],
  found: Array<{ id: string; order: { status: OrderStatus; orderNumber: string } }>,
): void {
  if (found.length !== new Set(requestedIds).size) {
    throw AppError.badRequest("Bazı sipariş satırları bulunamadı");
  }
  const cancelled = [
    ...new Set(
      found
        .filter((l) => l.order.status === OrderStatus.CANCELLED)
        .map((l) => l.order.orderNumber),
    ),
  ];
  if (cancelled.length > 0) {
    throw AppError.badRequest(
      `İptal edilmiş siparişe iş emri bağlanamaz: ${cancelled.join(", ")}`,
    );
  }
}

export class WorkOrderService {
  /**
   * Auto-generate an iş emri numarası (workOrderNumber): "IE" + GGAAYY + NNNN
   * (örn IE1207260001). Günlük sıra work_orders'taki mevcut maksimum +1.
   * (Parti no P… AYRI kimliktir — `batch.service.generateBatchNumberTx` üretir.)
   */
  async generateWorkOrderNumber(): Promise<string> {
    const now = new Date();
    const prefix = dailyCodePrefix("IE", now);

    // Retry loop — nadiren de olsa unique çakışma olursa tekrar dene
    for (let attempt = 0; attempt < 5; attempt++) {
      // O-4: collation-güvenli (gte index seek + startsWith tam-prefix) + NUMERIC
      // max — lexicographic "999">"1000" taşmasını (seq kalıcı 1000'de sıkışırdı) ve
      // manuel harf-kuyruklu workOrderNumber'ın parseInt→NaN zehirlenmesini (Number.isFinite
      // ile) önler. findFirst+orderBy desc ikisine de açıktı.
      const todays = await prisma.workOrder.findMany({
        where: { workOrderNumber: { gte: prefix, startsWith: prefix } },
        select: { workOrderNumber: true },
      });
      const seq = nextDailySeq(
        todays.map((w) => w.workOrderNumber),
        prefix,
      );

      const candidate = `${prefix}${String(seq).padStart(4, "0")}`;

      const exists = await prisma.workOrder.findUnique({ where: { workOrderNumber: candidate } });
      if (!exists) return candidate;
    }

    throw AppError.internal("İş emri numarası üretilemedi, lütfen tekrar deneyin");
  }

  /**
   * Kullanıcının verdiği iş emri numarası (workOrderNumber) benzersiz mi? Değilse net
   * Türkçe hata fırlatır. excludeId verilirse o iş emrini hariç tutar (güncelleme).
   * DB @unique kısıtı backstop'tur; bu ön-kontrol generic P2002 yerine anlaşılır
   * mesaj verir (auto modda withBarcodeRetry'ın yanıltıcı "Barkod..." hatasını da önler).
   */
  private async assertWorkOrderNumberUnique(
    workOrderNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await prisma.workOrder.findUnique({
      where: { workOrderNumber },
      select: { id: true },
    });
    if (existing && existing.id !== excludeId) {
      throw AppError.conflict(`Bu iş emri numarası zaten kullanılıyor: ${workOrderNumber}`);
    }
  }

  /**
   * Verilen iş emri numarası (workOrderNumber) kullanılabilir mi? Form alanı blur'unda
   * canlı kontrol için — kaydetmeden önce "bu numara daha önce verilmiş mi"
   * uyarısı. excludeId verilirse o iş emrini hariç tutar (düzenleme modu kendi
   * kodunu çakışma saymaz). Boş kod = kullanılabilir (otomatik üretilecek).
   */
  async checkWorkOrderNumber(
    workOrderNumber: string,
    excludeId?: string,
  ): Promise<{ workOrderNumber: string; available: boolean }> {
    const trimmed = workOrderNumber.trim();
    if (!trimmed) return { workOrderNumber: trimmed, available: true };
    const existing = await prisma.workOrder.findUnique({
      where: { workOrderNumber: trimmed },
      select: { id: true },
    });
    return {
      workOrderNumber: trimmed,
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
   *   - batchNumber (Parti Kodu) verilmezse otomatik üretilir (P+GGAAYY+NNNN);
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
          // Saha #14: şablonda kayıtlı fason planlaması artık default olarak
          // klonlanır (eskiden şablon bunu saklayamıyordu, hep boş geliyordu);
          // formdaki stepPlanning overlay'i yine ezebilir.
          requiredCategoryId:     overlay?.requiredCategoryId ?? s.requiredCategoryId ?? null,
          plannedSubcontractorId: overlay?.plannedSubcontractorId ?? s.plannedSubcontractorId ?? null,
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

    // ── Soft-delete guard (SEC-3): rotadaki istasyon/kategori/firma referansları
    // var + aktif olmalı. Custom rota VE şablon yolunu birlikte kapsar (şablon
    // aktif olsa da içindeki istasyon sonradan pasife alınmış olabilir).
    await assertRouteRefsActive(finalSteps);

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
        select: {
          id: true, itemId: true, colorId: true,
          order: { select: { status: true, orderNumber: true } },
        },
      });
      assertOrderLinesLinkable(allocations.map((a) => a.orderLineId), orderLineItems);
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

    // ── workOrderNumber / İş Emri No ─────────────────────────────────────────
    // KÖPRÜ (Faz 2): form/payload alanı hâlâ `batchNumber` adıyla geliyor (Zod
    // Faz 6'da `manualWorkOrderNumber`'a döner); bu değer artık İŞ EMRİ NO'yu
    // (İE…) doldurur — parti no (P…) attach anında AYRI üretilir (batch.service).
    // Kullanıcı verdiyse benzersizliğini doğrula; vermediyse otomatik üret
    // (IE+GGAAYY+NNNN) — üretim RETRY KAPSAMINDA, tx içinde: eşzamanlı iki create
    // aynı günlük max'ı okuyup P2002'de aynı numarayla çakışmasın.
    let manualWorkOrderNumber: string | null = null;
    if (data.batchNumber && data.batchNumber.trim().length > 0) {
      manualWorkOrderNumber = data.batchNumber.trim();
      await this.assertWorkOrderNumberUnique(manualWorkOrderNumber);
    }

    // Otomatik iş emri no sequence çakışırsa (P2002) tx'i baştan dene.
    const workOrder = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
      const workOrderNumber = manualWorkOrderNumber ?? (await this.generateWorkOrderNumber());
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
          workOrderNumber,
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

      // Refakat kartı İŞ EMRİ açılışında doğar (İE başına tek kart, barkod = İE).
      // Parti (Batch) sonradan doğsa da yeni kart üretmez; kart hep bu WO'ya bağlı.
      // Kartsız WO olmaz → mobil fason sevkte ilk sevkten önce bile okutulabilir.
      await travelerCardService.createForWorkOrder(tx, wo.id, userId);

      return wo;
    }), undefined, manualWorkOrderNumber
      ? (err) => {
          const meta = (err.meta ?? {}) as Record<string, unknown>;
          const target = JSON.stringify(meta.target ?? "");
          const driver = meta.driverAdapterError as
            | { cause?: { constraint?: unknown; originalMessage?: unknown } }
            | undefined;
          const constraint =
            typeof driver?.cause?.constraint === "string" ? driver.cause.constraint : "";
          const orig =
            typeof driver?.cause?.originalMessage === "string" ? driver.cause.originalMessage : "";
          // F61: workOrderNumber P2002'si MANUEL modda retry EDİLMEZ (hep aynı numarayı yazar) —
          // doğrudan anlaşılır 409. (Auto modda predicate undefined → tüm P2002 retry.)
          if (/workOrderNumber/i.test(target + constraint + orig)) {
            throw AppError.conflict(`Bu iş emri numarası zaten kullanılıyor: ${manualWorkOrderNumber}`);
          }
          return true;
        }
      : undefined);

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "WORK_ORDER",
      recordId: workOrder.id,
      newData: {
        workOrderNumber:    workOrder.workOrderNumber,
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
      message: `İş emri oluşturuldu: ${workOrder.workOrderNumber}`,
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
    data: WorkOrderCreateInput & { rollBarcodes: string[]; dispatchFirstStep?: boolean },
    userId?: string,
  ): Promise<
    ApiResponse<{
      workOrder: WorkOrder;
      attached: number;
      errors: string[];
      dispatch: { id: string; dispatchNo: string } | null;
    }>
  > {
    const { rollBarcodes, dispatchFirstStep, ...woInput } = data;
    const barcodes = [...new Set(rollBarcodes.map((b) => b.trim()).filter(Boolean))];
    if (barcodes.length === 0) {
      throw AppError.badRequest("En az bir top barkodu okutmalısınız.");
    }

    // ── 1) Ön-doğrulama: var + STOCK + aynı ürün ────────────────────────────
    const rolls = await prisma.roll.findMany({
      where: { barcode: { in: barcodes } },
      select: { id: true, barcode: true, status: true, itemId: true, sackId: true, shipmentId: true },
    });
    const byBarcode = new Map(rolls.map((r) => [r.barcode, r]));

    const missing = barcodes.filter((b) => !byBarcode.has(b));
    if (missing.length > 0) {
      throw AppError.badRequest(`Şu barkodlar bulunamadı: ${missing.join(", ")}`);
    }

    // Envanterdeki serbest+satılabilir toplar (ham STOCK + depo WAREHOUSE/A1_STOCK) bağlanabilir.
    const attachable: RollStatus[] = [RollStatus.STOCK, RollStatus.WAREHOUSE, RollStatus.A1_STOCK];
    const notAttachable = rolls.filter((r) => !attachable.includes(r.status));
    if (notAttachable.length > 0) {
      throw AppError.badRequest(
        "Yalnız envanterdeki (stok/depo) toplar bağlanabilir. Uygun olmayan: " +
          notAttachable.map((r) => `${r.barcode} (${r.status})`).join(", "),
      );
    }
    const committed = rolls.filter((r) => r.sackId != null || r.shipmentId != null);
    if (committed.length > 0) {
      throw AppError.badRequest(
        "Bir çuvalda/sevkiyatta olan top üretime bağlanamaz — önce oradan çıkarın: " +
          committed.map((r) => r.barcode).join(", "),
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
    // Telafi (zero-attach → WO'yu arşivle) başarısız OLURSA artık sessizce
    // yutulmuyor: telafi hardDelete patlarsa kullanıcıya "oluşturulmadı" denirken
    // canlı yetim PLANNED WO + ACTIVE refakat kartı kalır — bunu loglayıp iz bırak
    // (audit best-effort sayacı felsefesi; operatör/log yetim WO'yu görebilsin).
    const logOrphanCleanupFailure = (cleanupErr: unknown): void => {
      console.error(
        `[quickStart] telafi hardDelete başarısız — yetim WO kaldı (${workOrder.id}), manuel iptal gerekebilir:`,
        cleanupErr,
      );
    };

    try {
      const attachRes = await this.attachRolls(workOrder.id, barcodes, userId);
      attached = attachRes.data?.attached ?? 0;
      errors = attachRes.data?.errors ?? [];
    } catch (err) {
      await this.hardDelete(workOrder.id, userId).catch(logOrphanCleanupFailure);
      throw err;
    }

    if (attached === 0) {
      await this.hardDelete(workOrder.id, userId).catch(logOrphanCleanupFailure);
      throw AppError.conflict(
        `Hiçbir top bağlanamadı; iş emri oluşturulmadı. ${errors.join("; ")}`.trim(),
      );
    }

    // ── 5) Opsiyonel: ilk adım fason (EXTERNAL) ise otomatik fason sevki ──────
    // Hızlı iş emrinin amacı "iş emri aç + malı fasona gönder"i tek seferde yapmak.
    // dispatch() ayrı bir tx — patlarsa WO oluşmuş (PLANNED, toplar ilk adımda) kalır,
    // operatör manuel Fason Sevk'le tamamlar (kurtarılabilir kısmi başarı).
    let dispatch: { id: string; dispatchNo: string } | null = null;
    let dispatchWarning: string | null = null;
    if (dispatchFirstStep) {
      const firstStep = await prisma.workOrderStep.findFirst({
        where: { workOrderId: workOrder.id },
        orderBy: { stepSequence: "asc" },
        select: {
          id: true,
          plannedSubcontractorId: true,
          station: { select: { type: true } },
        },
      });
      if (firstStep && firstStep.station.type === "EXTERNAL") {
        if (!firstStep.plannedSubcontractorId) {
          dispatchWarning =
            "Fason firma planlanmadığı için otomatik sevk yapılamadı — Fason Sevk ekranından gönderin.";
        } else {
          const dispatchRollIds = (
            await prisma.roll.findMany({
              where: {
                currentStepId: firstStep.id,
                status: RollStatus.IN_PRODUCTION,
              },
              select: { id: true },
            })
          ).map((r) => r.id);
          if (dispatchRollIds.length === 0) {
            dispatchWarning =
              "İlk adıma bağlı top bulunamadığı için otomatik sevk yapılamadı.";
          } else {
            try {
              // dyehouseNote verilmez → dispatch() WO.dyehouseNote'u default alır.
              const dispRes = await new SubcontractorService().dispatch(
                {
                  workOrderId: workOrder.id,
                  stepId: firstStep.id,
                  subcontractorId: firstStep.plannedSubcontractorId,
                  rollIds: dispatchRollIds,
                },
                userId,
              );
              const d = dispRes.data as
                | { id?: string; dispatchNo?: string }
                | undefined;
              if (d?.id && d?.dispatchNo) {
                dispatch = { id: d.id, dispatchNo: d.dispatchNo };
              }
            } catch (err) {
              dispatchWarning =
                "İş emri oluştu ama otomatik fason sevki yapılamadı: " +
                (err instanceof Error ? err.message : "bilinmeyen hata") +
                " — Fason Sevk ekranından gönderebilirsiniz.";
            }
          }
        }
      }
    }

    return {
      success: true,
      data: { workOrder, attached, errors, dispatch },
      message:
        `İş emri ${workOrder.workOrderNumber} başlatıldı — ${attached} top bağlandı` +
        (errors.length ? `, ${errors.length} top bağlanamadı.` : ".") +
        (dispatch ? ` Fasona sevk edildi: ${dispatch.dispatchNo}.` : "") +
        (dispatchWarning ? ` ${dispatchWarning}` : ""),
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
      ["workOrderNumber"],
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
      workOrderNumber: true,
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
      // Üretilen kumaş + renk — liste sütunu + (targetItemId/targetColorId) filtre eşleşmesi.
      targetItem: { select: { id: true, code: true, name: true } },
      targetColor: { select: { id: true, code: true, name: true, hex: true } },
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
   * Ayrıca üretime GİREN ham metrajı ve bağlı SİPARİŞ TOPLAMINI (talep) ekler.
   */
  private async withProductionMeters<
    T extends { id: string; steps: { id: string; stepSequence: number }[] },
  >(
    wos: T[]
  ): Promise<
    (T & {
      producedMeters: number;
      inputMeters: number;
      orderedMeters: number;
      /** Şu an mal tutulan fason istasyon adları (genelde tek) — liste rozeti. */
      currentFasonStations: string[];
    })[]
  > {
    // SİPARİŞ TOPLAMI — WO'ya bağlı sipariş satırlarının talep metrajı (quantity)
    // toplamı; üretim çıktısını/girişini sipariş talebiyle kıyaslamak için. STOK
    // üretiminde bağ yok → 0 (frontend "—" gösterir). Pivot PK (workOrderId,...)
    // lider kolonuyla indeksli, sayfa başına tek sorgu.
    const orderedByWo = new Map<string, number>();
    const woIds = wos.map((w) => w.id);
    if (woIds.length > 0) {
      const links = await prisma.workOrderToOrderLine.findMany({
        where: { workOrderId: { in: woIds } },
        select: { workOrderId: true, orderLine: { select: { quantity: true } } },
      });
      for (const l of links) {
        orderedByWo.set(
          l.workOrderId,
          (orderedByWo.get(l.workOrderId) ?? 0) + Number(l.orderLine.quantity)
        );
      }
    }

    const stepIds = wos.flatMap((w) => w.steps.map((s) => s.id));
    if (stepIds.length === 0) {
      return wos.map((w) => ({
        ...w,
        producedMeters: 0,
        inputMeters: 0,
        orderedMeters: orderedByWo.get(w.id) ?? 0,
        currentFasonStations: [],
      }));
    }

    // ŞU AN FASONDA — bu sayfadaki WO'lardan hangisi şu an bir fasonda mal tutuyor
    // (AT_SUBCONTRACTOR top'un currentStepId'si o EXTERNAL adım). WO başına distinct
    // istasyon adı (liste rozeti). Tek batched sorgu — currentStepId partial-indexli.
    const fasonStationsByWo = new Map<string, Set<string>>();
    const atSubRows = await prisma.roll.findMany({
      where: { currentStepId: { in: stepIds }, status: RollStatus.AT_SUBCONTRACTOR },
      select: {
        currentStep: {
          select: { workOrderId: true, station: { select: { name: true } } },
        },
      },
    });
    for (const r of atSubRows) {
      const woId = r.currentStep?.workOrderId;
      const name = r.currentStep?.station?.name;
      if (!woId || !name) continue;
      let set = fasonStationsByWo.get(woId);
      if (!set) {
        set = new Set();
        fasonStationsByWo.set(woId, set);
      }
      set.add(name);
    }

    // ÇIKAN — üretim çıktısı; detay producedRolls.warehouse ile AYNI tanım
    // (producedInStepId ∈ adımlar, parent=SUBCONTRACTOR_RETURN, FIRE/A1 hariç).
    const producedRows = await prisma.roll.groupBy({
      by: ["producedInStepId"],
      where: {
        producedInStepId: { in: stepIds },
        parent: { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
        // Postgres `NOT IN` NULL-hostile: null kalite (kaliteye bakılmadı) sağlam
        // üretim sayılmalı; düz notIn onu dışlardı. null VEYA (FIRE/A1 değil).
        OR: [
          { qualityGrade: null },
          { qualityGrade: { notIn: ["FIRE", "A1"] } },
        ],
      },
      _sum: { initialQty: true },
    });
    const producedByStep = new Map<string, number>();
    for (const r of producedRows) {
      if (r.producedInStepId) producedByStep.set(r.producedInStepId, Number(r._sum.initialQty ?? 0));
    }

    // GİREN — her WO'nun İLK adımına (steps stepSequence asc → steps[0]) girmiş
    // ayrık topların initialQty toplamı; status≠CANCELLED/STOCK. Detay inputRolls
    // ile AYNI tanım (A: ilk-adım movement ∪ B: currentStepId=ilk adım, guard:
    // currentStepId null VEYA bu WO'nun bir adımı). Sayfa başına sabit sorguyla batched.
    const inputByStep = new Map<string, number>();
    const stepToWoForInput = new Map<string, string>();
    for (const w of wos) for (const st of w.steps) stepToWoForInput.set(st.id, w.id);
    const firstStepIds = wos
      .map((w) => w.steps[0]?.id)
      .filter((id): id is string => Boolean(id));
    if (firstStepIds.length > 0) {
      // A: ilk adıma hareketi olan toplar (firstStep → rollId kümesi)
      const moves = await prisma.rollMovement.findMany({
        where: { workOrderStepId: { in: firstStepIds } },
        select: { rollId: true, workOrderStepId: true },
        distinct: ["rollId", "workOrderStepId"],
      });
      const rollIdsByStep = new Map<string, Set<string>>();
      const allRollIds = new Set<string>();
      const addToStep = (stepId: string, rollId: string) => {
        allRollIds.add(rollId);
        let set = rollIdsByStep.get(stepId);
        if (!set) { set = new Set(); rollIdsByStep.set(stepId, set); }
        set.add(rollId);
      };
      for (const m of moves) {
        if (!m.workOrderStepId) continue;
        addToStep(m.workOrderStepId, m.rollId);
      }
      // B: currentStepId ilk adımı gösteren toplar (EXTERNAL attach→sevk penceresi)
      const bRolls = await prisma.roll.findMany({
        where: {
          currentStepId: { in: firstStepIds },
          status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] },
        },
        select: { id: true, currentStepId: true },
      });
      for (const r of bRolls) {
        if (r.currentStepId) addToStep(r.currentStepId, r.id);
      }
      if (allRollIds.size > 0) {
        const rolls = await prisma.roll.findMany({
          where: {
            id: { in: [...allRollIds] },
            status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] },
          },
          select: { id: true, initialQty: true, currentStepId: true },
        });
        const qtyByRoll = new Map<string, number>();
        const curStepByRoll = new Map<string, string | null>();
        for (const r of rolls) {
          qtyByRoll.set(r.id, Number(r.initialQty ?? 0));
          curStepByRoll.set(r.id, r.currentStepId);
        }
        for (const [stepId, rollSet] of rollIdsByStep) {
          const woId = stepToWoForInput.get(stepId);
          if (!woId) continue;
          let sum = inputByStep.get(stepId) ?? 0;
          for (const rid of rollSet) {
            const qty = qtyByRoll.get(rid);
            if (qty == null) continue; // CANCELLED/STOCK elendi
            // GUARD: başka WO'nun adımına taşınan top (detach→reattach) sayılmaz.
            const cs = curStepByRoll.get(rid) ?? null;
            if (cs !== null && stepToWoForInput.get(cs) !== woId) continue;
            sum += qty;
          }
          inputByStep.set(stepId, sum);
        }
      }
    }

    return wos.map((w) => ({
      ...w,
      producedMeters: w.steps.reduce((sum, st) => sum + (producedByStep.get(st.id) ?? 0), 0),
      inputMeters: inputByStep.get(w.steps[0]?.id ?? "") ?? 0,
      orderedMeters: orderedByWo.get(w.id) ?? 0,
      currentFasonStations: [...(fasonStationsByWo.get(w.id) ?? [])],
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
    // Sevkin kendi talimatı boşsa düşülecek default: o adımın notu (per-step).
    const stepNotesById = new Map(wo.steps.map((s) => [s.id, s.notes]));
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
        // Durum kırılımı (masaüstü fason sevk aksiyonu gating'i için): adımda
        // fiziksel BEKLEYEN (sevke hazır) vs FASONDA (dışarıda) top ayrımı.
        // EXTERNAL adımda AT_SUBCONTRACTOR top da currentStepId=step taşır →
        // "count" ikisini birleştirir; bu iki alan ayırır.
        waitingCount: number;
        waitingMeters: Prisma.Decimal;
        atSubcontractorCount: number;
        atSubcontractorMeters: Prisma.Decimal;
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
        qualityGrade: string | null;
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
        /** Anlık durum — UI: AT_SUBCONTRACTOR (fasonda) vs bekliyor ayrımı için. */
        status: RollStatus;
        currentQty: number;
        width: number | null;
        qualityGrade: string | null;
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
        instruction: string | null;
        /** Sevk edilen adımın notu (default) — sevkin kendi talimatı boşsa frontend buna düşer. */
        stepNote: string | null;
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
          status: true,
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
          waitingCount: 0,
          waitingMeters: new Prisma.Decimal(0),
          atSubcontractorCount: 0,
          atSubcontractorMeters: new Prisma.Decimal(0),
        };
        s.count += 1;
        s.totalMeters = s.totalMeters.plus(r.currentQty);
        // Durum kırılımı: AT_SUBCONTRACTOR = fasonda dışarıda; gerisi (IN_PRODUCTION/
        // STOCK) = bu adımda bekliyor, sevke hazır.
        if (r.status === RollStatus.AT_SUBCONTRACTOR) {
          s.atSubcontractorCount += 1;
          s.atSubcontractorMeters = s.atSubcontractorMeters.plus(r.currentQty);
        } else {
          s.waitingCount += 1;
          s.waitingMeters = s.waitingMeters.plus(r.currentQty);
        }
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
          status: r.status,
          currentQty: Number(r.currentQty),
          width: r.width != null ? Number(r.width) : null,
          qualityGrade: r.qualityGrade ?? "",
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
          instruction: true,
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
          instruction: d.instruction,
          // Sevkin kendi talimatı boşsa, sevk edilen adımın notuna düşülür.
          stepNote: stepNotesById.get(d.stepId) ?? null,
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
        qualityGrade: r.qualityGrade ?? "",
        currentQty: r.initialQty,
        status: r.status,
        color: r.color,
        createdAt: r.createdAt,
      }));

      // Üretime giren ham toplar — WO'nun İLK adımına girmiş ayrık topların
      // initialQty toplamı. İki kaynağın birleşimi (distinct rollId):
      //   A) ilk adıma RollMovement'ı olan toplar (append-only kalıcı: top sonradan
      //      fasona/tambura geçse, consumed olsa da sayılır) — mevcut davranış.
      //   B) currentStepId = ilk adım olan toplar — EXTERNAL (boyahane/fason) ilk
      //      adımda attach anında movement YAZILMAZ (sevkte açılır); bu top "eklendi
      //      ama henüz sevk edilmedi" aralığında yalnız B ile yakalanır.
      // GUARD (currentStepId null VEYA ∈ bu WO'nun adımları): top detach edilip başka
      // WO'ya bağlandıysa (currentStepId başka WO'yu gösterir) A'daki bayat movement
      // bu WO'ya saydırmasın. Born roll (currentStepId=sonraki adım) ve tambur çıktısı
      // (ilk adıma movement'sız) doğal olarak hariç → çift sayım olmaz.
      const firstStepId = stepIds[0];
      const entryRollRows = await prisma.rollMovement.findMany({
        where: { workOrderStepId: firstStepId },
        select: { rollId: true },
        distinct: ["rollId"],
      });
      const entryRollIds = entryRollRows.map((m) => m.rollId);
      const inputAgg = await prisma.roll.aggregate({
        where: {
          AND: [
            { OR: [{ id: { in: entryRollIds } }, { currentStepId: firstStepId }] },
            { OR: [{ currentStepId: null }, { currentStepId: { in: stepIds } }] },
            { status: { notIn: [RollStatus.CANCELLED, RollStatus.STOCK] } },
          ],
        },
        _sum: { initialQty: true },
        _count: { _all: true },
      });
      inputRolls = {
        count: inputAgg._count._all,
        totalMeters: inputAgg._sum.initialQty ?? new Prisma.Decimal(0),
      };
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
          waitingCount: 0,
          waitingMeters: new Prisma.Decimal(0),
          atSubcontractorCount: 0,
          atSubcontractorMeters: new Prisma.Decimal(0),
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
   * Bir iş emrinin PARTİLERİ (Batch lane'leri) — "Dallar" panelinin yeni kaynağı.
   *
   * Her parti (Batch) bir lane'dir: üyesi topların ŞU ANKİ konum dağılımı (istasyon
   * adı / statü etiketi), aktif refakat kartı, fason sevk durumu (K10: bir sevk =
   * bir parti) ve soy bağı (splitFrom / splitChildren) tek bakışta görünür — "1.
   * parti Kurşun'da, 2. parti hâlâ boyahanede". Kilit TÜRETİLMİŞ: iptal edilmemiş
   * sevki olan parti kilitlidir. (Route uyumu için metod adı `getBranches` kaldı;
   * Electron `/branches` ucu Faz 6'da `/batches`'e döner — bkz. plan Faz 6.3.)
   */
  async getBranches(workOrderId: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: {
        id: true,
        // Ayrılma soy bağı (WO seviyesi) — WO başka WO'nun partisinden ayrıldıysa
        // (redye NEW_COLOR / UNDYED_MOVE ile yeni WO'ya taşınma).
        splitFrom: { select: { id: true, workOrderNumber: true } },
        splitChildren: {
          where: { isActive: true },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            workOrderNumber: true,
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

    // Kart iş emri başına (tek) — tüm parti lane'leri aynı WO kartını gösterir.
    const woCard = await prisma.travelerCard.findFirst({
      where: { workOrderId, status: "ACTIVE" },
      select: { cardNumber: true, barcode: true },
    });

    const batches = await prisma.batch.findMany({
      where: { workOrderId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        batchNumber: true,
        createdAt: true,
        splitFrom: { select: { id: true, batchNumber: true } },
        splitChildren: { select: { id: true, batchNumber: true } },
        // Parti üyesi toplar (tüketilmiş ara düğümler HARİÇ — çift sayım olmasın:
        // fason öncesi orijinaller CONSUMED, Tambur'da bölünen parent CONSUMED).
        rolls: {
          where: {
            status: { notIn: ["SUBCONTRACTOR_CONSUMED", "TAMBUR_CONSUMED", "CANCELLED"] },
          },
          select: {
            currentQty: true,
            status: true,
            currentStep: { select: { station: { select: { name: true } } } },
          },
        },
        // Partinin fason sevkleri (K10) — durum türetimi (açık/kısmi/döndü) için.
        dispatches: {
          orderBy: { dispatchedAt: "asc" },
          select: {
            id: true,
            dispatchNo: true,
            dispatchedAt: true,
            totalQty: true,
            cancelledAt: true,
            directShippedAt: true,
            directShipReason: true,
            step: { select: { station: { select: { name: true } } } },
            subcontractor: { select: { id: true, name: true } },
            items: {
              select: {
                // Aktarım çıktısı türetimi (K: "Aktarımı Geri Al" butonu): sevkin TÜM
                // topları born (parentReceiptId dolu) ise bu bir fason→fason aktarımdır.
                roll: { select: { parentReceiptId: true } },
                receiptItems: {
                  select: {
                    receipt: {
                      select: { id: true, receiptNo: true, receivedAt: true, cancelledAt: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const statusLabel = (s: string): string =>
      s === "WAREHOUSE" ? "Depo" : s === "STOCK" ? "Stok" : "—";

    const lanes = batches.map((b) => {
      // Konum dağılımı: istasyon adı yoksa statü etiketi.
      const positions = new Map<
        string,
        { label: string; count: number; totalMeters: number }
      >();
      for (const r of b.rolls) {
        const label = r.currentStep?.station?.name ?? statusLabel(r.status);
        const cur = positions.get(label) ?? { label, count: 0, totalMeters: 0 };
        cur.count += 1;
        cur.totalMeters += Number(r.currentQty);
        positions.set(label, cur);
      }

      const dispatchViews = b.dispatches.map((d) => {
        const itemCount = d.items.length;
        const receivedItemCount = d.items.filter((it) =>
          it.receiptItems.some((ri) => ri.receipt && !ri.receipt.cancelledAt),
        ).length;
        // Aktarım çıktısı: tüm sevk topları born (parentReceiptId dolu) → geri alınabilir.
        const isTransferOutput =
          d.items.length > 0 && d.items.every((it) => it.roll?.parentReceiptId != null);
        let status: "OPEN" | "PARTIAL" | "RETURNED" | "CANCELLED" | "DIRECT_SHIPPED";
        if (d.cancelledAt) status = "CANCELLED";
        else if (d.directShippedAt) status = "DIRECT_SHIPPED";
        else if (receivedItemCount === 0) status = "OPEN";
        else if (receivedItemCount >= itemCount) status = "RETURNED";
        else status = "PARTIAL";

        const receiptMap = new Map<string, { receiptNo: string; receivedAt: Date }>();
        for (const it of d.items) {
          for (const ri of it.receiptItems) {
            const rcpt = ri.receipt;
            if (!rcpt || rcpt.cancelledAt) continue;
            if (!receiptMap.has(rcpt.id)) {
              receiptMap.set(rcpt.id, { receiptNo: rcpt.receiptNo, receivedAt: rcpt.receivedAt });
            }
          }
        }

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
          isTransferOutput,
          directShippedAt: d.directShippedAt,
          directShipReason: d.directShipReason,
          receipts: [...receiptMap.values()],
        };
      });

      // Kilit türetilmiş: iptal edilmemiş sevki varsa parti kilitli (düzenlenemez).
      const locked = b.dispatches.some((d) => !d.cancelledAt);
      const card = woCard;

      return {
        batchId: b.id,
        batchNumber: b.batchNumber,
        createdAt: b.createdAt,
        locked,
        cardNumber: card?.cardNumber ?? null,
        cardBarcode: card?.barcode ?? null,
        rollCount: b.rolls.length,
        currentPositions: [...positions.values()],
        dispatches: dispatchViews,
        splitFrom: b.splitFrom,
        splitChildren: b.splitChildren,
      };
    });

    return {
      success: true,
      data: {
        batches: lanes,
        // WO-seviyesi ayrılma bağı (redye ile yeni WO'ya taşınan/gelen partiler).
        splitFrom: wo.splitFrom,
        splitChildren: wo.splitChildren.map((c) => ({
          id: c.id,
          workOrderNumber: c.workOrderNumber,
          status: c.status,
          createdAt: c.createdAt,
          targetColor: c.targetColor,
        })),
      },
    };
  }

  // ===========================================================================
  // PARTİYİ AYIR (redye üç yolu) — workorder-split.service.ts'e delege.
  // REDYE_SAME_COLOR uygulandı; NEW_COLOR/UNDYED_MOVE (WO klonlu) sonraki iterasyon.
  // ===========================================================================

  /** Parti ayırma ÖNİZLEMESİ (izinli modlar + taşınacak toplar). */
  async getSplitPreview(
    workOrderId: string,
    batchId: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderSplitService.getSplitPreview(workOrderId, batchId);
  }

  /** Partiyi ayır: REDYE_SAME_COLOR (aynı renk yeniden boyama) / NEW_COLOR / UNDYED_MOVE. */
  async splitBranch(
    workOrderId: string,
    data: {
      batchId: string;
      mode: "REDYE_SAME_COLOR" | "NEW_COLOR" | "UNDYED_MOVE";
      newColorId?: string | null;
      orderMode?: "stock" | "keep";
      rollIds?: string[];
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderSplitService.splitBranch(workOrderId, data, userId);
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
    const rollWhere = {
      OR: [
        { producedInStepId: { in: stepIds } },
        { currentStepId: { in: stepIds } },
      ],
    };
    // M-11: liste 200 ile sınırlı (UI) ama SAYILAR limitsiz count'tan gelir —
    // 200+ toplu WO'da onay ekranı eksik sayı göstermesin; truncated bayrağı
    // UI'a "tamamı bu kadar değil" der.
    const totalRollCount =
      stepIds.length > 0 ? await prisma.roll.count({ where: rollWhere }) : 0;
    const rolls =
      stepIds.length > 0
        ? await prisma.roll.findMany({
            where: rollWhere,
            select: {
              id: true,
              barcode: true,
              status: true,
              currentQty: true,
              colorId: true,
              currentStepId: true,
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

    // Her top için: ham mı işlenmiş mi (boyalı/özellikli/fason-dönüşü) + hâlâ
    // fasonda mı + İPTALDE GERÇEKTEN STOCK'A DÖNECEK Mİ (M-11: softDelete'in
    // mutasyon predicate'iyle birebir aynı koşul — onay ekranı değişmeyecek
    // depo/bitmiş topları "etkilenecek" gibi göstermesin).
    const stepIdSet = new Set(stepIds);
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
      willRevertToStock:
        r.currentStepId !== null &&
        stepIdSet.has(r.currentStepId) &&
        r.status === RollStatus.IN_PRODUCTION &&
        String(r.entrySource) !== "SUBCONTRACTOR_RETURN",
    }));
    // Sayılar LİMİTSİZ count'lardan (liste 200 ile kırpılı olabilir).
    const atSubcontractorCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: { AND: [rollWhere, { status: RollStatus.AT_SUBCONTRACTOR }] },
          })
        : 0;
    const processedCount =
      stepIds.length > 0
        ? await prisma.roll.count({
            where: {
              AND: [
                rollWhere,
                {
                  OR: [
                    { colorId: { not: null } },
                    { properties: { some: {} } },
                    { entrySource: RollEntrySource.SUBCONTRACTOR_RETURN },
                    { status: RollStatus.AT_SUBCONTRACTOR },
                    { status: RollStatus.RETURNED_FROM_SUBCONTRACTOR },
                  ],
                },
              ],
            },
          })
        : 0;

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
        batchNumber: wo.workOrderNumber,
        status: wo.status,
        canCancel: blockReason === null,
        blockReason,
        travelerCardCount,
        rollCount: totalRollCount,
        processedCount,
        atSubcontractorCount,
        fasonInFlightCount,
        rolls: mappedRolls,
        // Liste 200 ile kırpıldıysa UI "ilk 200 gösteriliyor" diyebilsin.
        rollsTruncated: totalRollCount > rolls.length,
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
   *    (üretim izi) KORUNUR. Bitmiş depo malları (WAREHOUSE/
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
      // ATOMİK CLAIM ÖNCE (F57): WO satırını status-koşullu updateMany ile
      // kilitle. Fason in-flight guard'ı BUNDAN SONRA çalışır — böylece guard,
      // WO satır kilidini tutarken okur ve eşzamanlı bir fason sevkinin (dispatch
      // tx başında touchWorkOrderTx ile AYNI satırı kilitler) COMMIT'li
      // AT_SUBCONTRACTOR toplarını her zaman görür. Guard önce çalışsaydı, READ
      // COMMITTED'da commit'siz dispatch topları görülmez (count=0), sonra claim
      // dispatch commit'inden sonra geçer ve mal fasondayken WO iptal olurdu.
      // Ayrıca eşzamanlı son-top finalize (tambur.finalize / kursun.finishStep)
      // WO'yu COMPLETED yaparsa bu claim count===0 görür → 409. tx-DIŞI ön-kontrol
      // (2371-2376) yalnız UX; asıl koruma burada.
      const cancelClaim = await tx.workOrder.updateMany({
        where: {
          id,
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED] },
        },
        data: { status: WorkOrderStatus.CANCELLED },
      });
      if (cancelClaim.count === 0) {
        const fresh = await tx.workOrder.findUnique({
          where: { id },
          select: { status: true },
        });
        throw AppError.conflict(
          `İş emri bu sırada ${
            fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, iptal edilemez. Listeyi yenileyin.`
        );
      }

      // GUARD (claim'den SONRA — F57): Fasonda (boyahanede) işlem gören/görmüş
      // in-flight top varsa iptal edilemez. Fason malı asla ham stoğa dönemez —
      // sipariş kopsa bile bu mal stok için üretilmeye devam eder. Guard triplerse
      // tüm tx (claim dahil) geri sarılır → WO IN_PROGRESS kalır.
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

      if (stepIds.length > 0) {
        // Yalnız GERÇEKTEN HAM (entrySource ≠ SUBCONTRACTOR_RETURN), halen
        // üretimdeki topları STOCK'a geri çek. `producedInStepId` (üretim izi)
        // KORUNUR. Bitmiş depo malları (WAREHOUSE/TAMBUR_CONSUMED) ve
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

      // M-12: iptal edilen WO'nun adımlarındaki TÜM açık movement'ları kapat —
      // yoksa süresiz açık kalır: dashboard WIP sayacı kalıcı şişer, açık-kart
      // partial index'i ölü adımlarla dolar, serbest STOCK top "istasyonda
      // aktif" görünür. qtyOut topun son metrajından (detachRolls deseni).
      if (stepIds.length > 0) {
        await tx.$executeRaw`
          UPDATE roll_movements m
          SET "exitedAt" = now(),
              "qtyOut" = COALESCE(m."qtyOut", r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_CANCELLED'
                           ELSE m.notes || ' | WO_CANCELLED' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
        `;
        // Başlamamış/yarım adımlar terminal duruma (SKIPPED) — ölü WO'nun
        // adımları kuyruk/WIP istatistiklerinde "içeride" sayılmasın.
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "WO_CANCELLED" },
        });
      }

      // WO iptal olunca tüm ACTIVE refakat kartlarını VOIDED'a çek
      await setWorkOrderCardStatuses(tx, id, "ACTIVE", "VOIDED", { voidReason: "WO_CANCELLED" });

      const cancelledWO = await tx.workOrder.findUnique({ where: { id } });
      return { updated: cancelledWO! };
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { batchNumber: existing.workOrderNumber, status: existing.status },
      newData: { status: WorkOrderStatus.CANCELLED },
    });

    return {
      success: true,
      data: updated,
      message: `İş emri iptal edildi, ham toplar STOCK'a çekildi: ${existing.workOrderNumber}`,
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
      // ATOMİK CLAIM: tx başında WO satırını write-kilitle + "arşivlenebilir"
      // (isActive + IN_PROGRESS değil) olduğunu iddia et. tx-DIŞI ön-kontrol
      // (2520/2526) UX; eşzamanlı bir geçiş WO'yu IN_PROGRESS yaparsa ya da başka
      // bir istek aynı anda arşivlerse bu claim count===0 → 409 (çift-arşiv / çift
      // top-geri-çekme önlenir). Asıl isActive=false yazımı aşağıda kalır.
      const archiveClaim = await tx.workOrder.updateMany({
        where: { id, isActive: true, status: { not: WorkOrderStatus.IN_PROGRESS } },
        data: { updatedAt: new Date() },
      });
      if (archiveClaim.count === 0) {
        const fresh = await tx.workOrder.findUnique({
          where: { id },
          select: { isActive: true, status: true },
        });
        throw AppError.conflict(
          fresh && !fresh.isActive
            ? "İş emri bu sırada arşivlendi."
            : "İş emri bu sırada üretime geçti, arşivlenemez. Önce iptal edin."
        );
      }

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

        // M-12: arşivlenen WO'nun açık movement'larını kapat + adımları
        // terminal duruma çek (softDelete ile aynı gerekçe).
        await tx.$executeRaw`
          UPDATE roll_movements m
          SET "exitedAt" = now(),
              "qtyOut" = COALESCE(m."qtyOut", r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_ARCHIVED'
                           ELSE m.notes || ' | WO_ARCHIVED' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
        `;
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "WO_ARCHIVED" },
        });
      }

      // ACTIVE refakat kartı VOID edilir — quickStart zero-attach telafisi ve
      // planlamacı arşivi DB'de arşivli WO'ya bağlı hayalet ACTIVE kart
      // bırakmasın (softDelete'teki bloğun simetriği).
      await setWorkOrderCardStatuses(tx, id, "ACTIVE", "VOIDED", { voidReason: "WO_ARCHIVED" });

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
        batchNumber: existing.workOrderNumber,
        type: existing.type,
        status: existing.status,
        stepCount: existing.steps.length,
      },
      newData: { isActive: false, event: "ARCHIVED" },
    });

    return {
      success: true,
      data: archived,
      message: `İş emri arşivlendi: ${existing.workOrderNumber}`,
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
  ): Promise<ApiResponse<{ attached: number; errors: string[]; batch: { id: string; batchNumber: string } | null }>> {
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

    // Envanterdeki serbest + satılabilir toplar üretime bağlanabilir: ham (STOCK) VE
    // bitmiş depo malı (WAREHOUSE / A1_STOCK). "Her işlem final üretir" modelinde bir depo
    // topu yeni bir WO'ya (örn. zımpara, ya da WAREHOUSE açık kumaşı Tambur'a) sokulabilir;
    // bitince finalize depoya geri döndürür. Çuval/sevkiyattaki top hariç (F5: aşağıdaki
    // doğrulama + atomik claim'de sackId/shipmentId null guard'ı).
    const acceptedRollStatuses: RollStatus[] = [RollStatus.STOCK, RollStatus.WAREHOUSE, RollStatus.A1_STOCK];

    // Faz 1.1: tx withBarcodeRetry ile sarıldı — bugün içeride @unique üretimi yok
    // (no-op); parti modeli geçişinde tx'e P (parti) + RK (kart) sequence üretimi
    // girecek, "sequence okuma closure İÇİNDE" iskeleti şimdiden hazır. Sonuç dizileri
    // closure İÇİNDE tanımlı — retry mükerrer biriktirmesin.
    const { attached, errorMessages, batchRes } = await withBarcodeRetry(() => prisma.$transaction(async (tx) => {
      const attached: { id: string; barcode: string | null; prevStatus: RollStatus; qtyIn: number }[] = [];
      const errorMessages: string[] = [];
      // Bu attach dalgasının doğurduğu parti (K3) — succeeded>0 ise dolar.
      // Retry mükerrer biriktirmesin diye closure İÇİNDE tanımlı (Faz 1.1 deseni).
      let batchRes: CreateBatchResult | null = null;
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
        // F5: WAREHOUSE/A1 topu bir çuvalda/sevkiyatta olabilir → üretime alınamaz.
        if (roll.sackId != null || roll.shipmentId != null) {
          errorMessages.push(`${barcode}: Top bir çuvalda/sevkiyatta — önce oradan çıkarın`);
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
            sackId: null,
            shipmentId: null,
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

          // Parti doğuşu (K3): bu attach dalgası YENİ bir parti oluşturur; sahiplenilen
          // toplara batchId damgalanır + refakat kartı (RK) basılır. (Faz 2: her attach =
          // yeni parti; K4 "mevcut sevksiz partiye ekle" Faz 4'te targetBatchId ile gelir.)
          batchRes = await createBatchTx(tx, {
            workOrderId,
            rollIds: succeeded.map((r) => r.id),
            userId,
          });
        }
      }

      // INTERNAL ilk step: bağlama = üretim başlangıcı → step ACTIVE + WO IN_PROGRESS.
      // EXTERNAL ilk step: roller henüz fasona gönderilmedi → step PENDING + WO PLANNED
      //                    olarak kalmalı; dispatch oluşturulunca ikisi de güncellenir.
      if (attached.length > 0 && !firstStepIsExternal) {
        await recomputeStepStatus(tx, firstStepId);
        await ensureWorkOrderInProgress(tx, workOrderId);
      }

      return { attached, errorMessages, batchRes };
    }));

    // Audit log'lar tx dışında, TEK createMany ile (eski N ayrı INSERT yerine).
    // R8 fix: recordId roll.id (UUID), barcode newData'ya meta olarak gidiyor.
    await AuditService.logMany(
      attached.map((r) => ({
        userId,
        action: "UPDATE" as const,
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
      }))
    );

    // Parti + kart audit'i tx DIŞINDA (F273): bu dalga bir parti doğurduysa yaz.
    if (batchRes) {
      await AuditService.log({
        userId,
        action: "CREATE",
        tableName: "BATCH",
        recordId: batchRes.batch.id,
        newData: {
          batchNumber: batchRes.batch.batchNumber,
          workOrderId,
          rollCount: attached.length,
        },
      });
      // Kart audit'i YOK — kart parti doğuşunda değil, iş emri açılışında üretilir.
    }

    return {
      success: true,
      data: {
        attached: attached.length,
        errors: errorMessages,
        batch: batchRes
          ? { id: batchRes.batch.id, batchNumber: batchRes.batch.batchNumber }
          : null,
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
    if (
      data.targetColorId !== undefined &&
      (wo.targetColorId ?? null) !== (data.targetColorId ?? null) &&
      locks.targetColor
    ) {
      throw AppError.conflict(locks.reasons.targetColor ?? "Hedef renk kilitli.");
    }
    if (
      data.foldType !== undefined &&
      (wo.foldType ?? null) !== (data.foldType ?? null) &&
      locks.foldType
    ) {
      throw AppError.conflict(locks.reasons.foldType ?? "Kat tipi kilitli.");
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

    // Parti kodu değiştiriliyorsa benzersizliğini doğrula (kendini hariç tut).
    if (
      data.batchNumber &&
      data.batchNumber.trim().length > 0 &&
      data.batchNumber.trim() !== wo.workOrderNumber
    ) {
      await this.assertWorkOrderNumberUnique(data.batchNumber.trim(), id);
    }

    // ATOMİK CLAIM (check-then-act DEĞİL): terminal-durum reddini yazmanın WHERE'ine
    // koy. tx-DIŞI ön-kontrol (2815-2822) UX; eşzamanlı finalize WO'yu COMPLETED
    // yaparsa bu updateMany count===0 → 409 (terminal WO'ya alan yazımı engellenir).
    await prisma.$transaction(async (tx) => {
      // F58: WO satırını kilitle → locks'u kilit ALTINDA taze hesapla ve kilit
      // guard'larını yeniden doğrula. 3085'teki tx-DIŞI locks eşzamanlı adım-tamamlama/
      // sevkle bayatlayabilir; bu turda finishStep/finalize/createOpenFabric/cutOpenFabric
      // WO satırını kilitlediğinden ara-adım geçişleri de bu kilitle serileşir.
      await touchWorkOrderTx(tx, id);
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
      if (
        data.targetColorId !== undefined &&
        (wo.targetColorId ?? null) !== (data.targetColorId ?? null) &&
        freshLocks.targetColor
      ) {
        throw AppError.conflict(freshLocks.reasons.targetColor ?? "Hedef renk kilitli.");
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
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED] },
        },
        data: {
          workOrderNumber: data.batchNumber?.trim() || undefined,
          // F59: null'ı gerçek NULL olarak yaz (gönderilmeyen=undefined ile ayrış);
          // `?? undefined` null'ı sessizce yutup temizlemeyi kaçırıyordu.
          width: data.width === undefined ? undefined : data.width,
          targetQuantity: data.targetQuantity === undefined ? undefined : data.targetQuantity,
          targetWeight: data.targetWeight === undefined ? undefined : data.targetWeight,
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
        },
      });
      if (updateClaim.count === 0) {
        throw AppError.conflict(
          "İş emri bu sırada tamamlandı veya iptal edildi, düzenlenemez. Sayfayı yenileyin."
        );
      }
    });
    const updated = await prisma.workOrder.findUnique({ where: { id } });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      newData: data as Record<string, unknown>,
    });

    return { success: true, data: updated!, message: "İş emri güncellendi" };
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
          // Saha #14: şablondaki fason planlaması replace'te de default klonlanır.
          requiredCategoryId: overlay?.requiredCategoryId ?? s.requiredCategoryId ?? null,
          plannedSubcontractorId: overlay?.plannedSubcontractorId ?? s.plannedSubcontractorId ?? null,
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
        select: {
          id: true, itemId: true, colorId: true,
          order: { select: { status: true, orderNumber: true } },
        },
      });
      assertOrderLinesLinkable(allocations.map((a) => a.orderLineId), orderLineItems);
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
      data.batchNumber.trim() !== existing.workOrderNumber
    ) {
      await this.assertWorkOrderNumberUnique(data.batchNumber.trim(), id);
    }

    const workOrderNumber =
      data.batchNumber && data.batchNumber.trim().length > 0
        ? data.batchNumber.trim()
        : existing.workOrderNumber;

    // ── Transaction: smart merge (steps id-bazlı diff) ───────────────────────
    const updated = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: tx başında (yıkıcı drop-and-recreate'ten ÖNCE) WO satırını
      // write-kilitle + COMPLETED/CANCELLED'e geçmediğini iddia et. tx-DIŞI
      // ön-kontrol (2978-2985) UX; eşzamanlı son-top finalize bu satırı tx süresince
      // güncelleyemez, önce commit ettiyse count===0 → 409 (terminal WO'nun rotası/
      // bağları ezilmez). Asıl alan yazımı aşağıdaki tx.workOrder.update'te kalır.
      const replaceClaim = await tx.workOrder.updateMany({
        where: {
          id,
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED] },
        },
        data: { updatedAt: new Date() },
      });
      if (replaceClaim.count === 0) {
        const fresh = await tx.workOrder.findUnique({
          where: { id },
          select: { status: true },
        });
        throw AppError.conflict(
          `İş emri bu sırada ${
            fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, düzenlenemez. Sayfayı yenileyin.`
        );
      }

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
      if (data.targetPropertyIds) {
        const existingPropIds = new Set(
          existing.targetProperties.map((p) => p.propertyId),
        );
        const incomingSet = new Set(data.targetPropertyIds);
        for (const lockedId of freshLocks.lockedPropertyIds) {
          if (existingPropIds.has(lockedId) && !incomingSet.has(lockedId)) {
            throw AppError.conflict(
              freshLocks.reasons.properties?.[lockedId] ??
                "Bu özellik artık kaldırılamaz.",
            );
          }
        }
        const applicableSet = new Set(freshLocks.applicablePropertyIds);
        for (const newId of data.targetPropertyIds) {
          if (existingPropIds.has(newId)) continue;
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
          stationId: true,
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

      // 1b) Başlamış (PENDING olmayan) adımların GÖRELİ SIRASI değişemez —
      //     COMPLETED bir adım ACTIVE'in arkasına taşınırsa kart okutma ve
      //     "sonraki adım" hesabı (stepSequence) bozulur. Silme zaten guard'lı;
      //     bu kontrol yeniden sıralamayı yakalar. (Araya yeni PENDING adım
      //     eklemek serbesttir — göreli sıra korunur.)
      const startedOldOrder = existingStepRows
        .filter((s) => s.status !== "PENDING")
        .sort((a, b) => a.stepSequence - b.stepSequence)
        .map((s) => s.id);
      const startedNewOrder = finalSteps
        .map((s) => s.id)
        .filter(
          (sid): sid is string =>
            !!sid &&
            existingStepById.has(sid) &&
            existingStepById.get(sid)!.status !== "PENDING",
        );
      if (startedOldOrder.join("|") !== startedNewOrder.join("|")) {
        throw AppError.conflict(
          "Başlamış (aktif/tamamlanmış) adımların sırası değiştirilemez.",
        );
      }

      // 2) Step'leri güncelle veya ekle. stepSequence yeni listedeki indeks
      //    bazlı yeniden numaralandırılır. (workOrderId, stepSequence)
      //    üzerinde unique kısıtı olmadığı için iki-aşamalı güncelleme gerekmez.
      for (const [index, incoming] of finalSteps.entries()) {
        const stepSequence = index + 1;
        if (incoming.id && existingStepById.has(incoming.id)) {
          // Başlamış adımın İSTASYONU değişemez (üzerinde açık movement/geçmiş
          // kayıt var — silme guard'ının güncelleme simetriği). Not/kategori/
          // planlanan firma serbest kalır.
          const old = existingStepById.get(incoming.id)!;
          if (old.status !== "PENDING" && old.stationId !== incoming.stationId) {
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
          workOrderNumber,
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
        batchNumber: updated.workOrderNumber,
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
      message: `İş emri güncellendi: ${updated.workOrderNumber}`,
    };
  }

  /**
   * WO targetProperties güncelle. Bağlı tüm Roll'ların properties'i
   * senkronize edilir. Fiziksel taahhüt kilitleri replace() ile AYNI:
   * istasyonu adımını tamamlamış (fiilen uygulanmış) özellik kaldırılamaz,
   * eklenen özelliği uygulayabilecek açık istasyon rotada olmalı.
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
        targetProperties: { select: { propertyId: true } },
        targetItem: {
          select: {
            allowedProperties: { select: { propertyId: true } },
          },
        },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

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

    // F66: ATOMİK CLAIM (check-then-act DEĞİL) — WO terminal-durum kontrolünü yazmanın
    // WHERE'ine koy; eşzamanlı finalize WO'yu COMPLETED yaptıktan sonra planlama sızmasın.
    const claim = await prisma.workOrderStep.updateMany({
      where: {
        id: stepId,
        workOrder: { status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED] } },
      },
      data: {
        requiredCategoryId: data.requiredCategoryId,
        plannedSubcontractorId: data.plannedSubcontractorId,
      },
    });
    if (claim.count === 0) {
      throw AppError.conflict(
        "İş emri bu sırada tamamlandı/iptal edildi — adım planlaması güncellenemedi. Sayfayı yenileyin.",
      );
    }
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

  /**
   * Topları İş Emrinden (Sepetten) Çıkarma
   * Sepet mantığı için eklendi: Yanlış bağlanan stok topların rotasını ve durumunu temizler.
   */
  async detachRolls(workOrderId: string, rollIds: string[], userId?: string): Promise<ApiResponse<{ detached: number; errors: string[] }>> {
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

    // Çıkarılabilir statüler: bu WO'da üretimde olan + (bilinçli kurtarma akışı)
    // fasona gitmiş/dönmüş toplar. WAREHOUSE/SHIPPED/CANCELLED/CONSUMED toplar
    // "STOCK'a diriltilemez" — bayat UI/yanlış istek sessizce depo-sevk
    // muhasebesini bozamaz (attachRolls'taki claim deseninin simetriği).
    const DETACHABLE_STATUSES: RollStatus[] = [
      RollStatus.IN_PRODUCTION,
      RollStatus.AT_SUBCONTRACTOR,
      RollStatus.RETURNED_FROM_SUBCONTRACTOR,
    ];

    const detached: { id: string; barcode: string | null; prevStatus: RollStatus }[] = [];
    const errorMessages: string[] = [];

    await prisma.$transaction(async (tx) => {
      // TOPLU (eski kod top başına findUnique+update+updateMany = N+1).
      const found = await tx.roll.findMany({
        where: { id: { in: rollIds } },
        select: { id: true, barcode: true, status: true, currentStepId: true, colorId: true, qualityGrade: true },
      });
      const foundIds = new Set(found.map((r) => r.id));
      for (const reqId of rollIds) {
        if (!foundIds.has(reqId)) errorMessages.push(`${reqId}: top bulunamadı`);
      }

      // ÜYELİK + STATÜ GUARD'I: top BU iş emrinin bir adımında olmalı ve
      // çıkarılabilir statüde olmalı. Başka WO'nun topu / depodaki / sevk
      // edilmiş / iptal top sessizce sıfırlanamaz — sebep belirtilerek raporlanır.
      const stepIdSet = new Set(stepIds);
      const detachable = found.filter(
        (r) =>
          r.currentStepId !== null &&
          stepIdSet.has(r.currentStepId) &&
          DETACHABLE_STATUSES.includes(r.status),
      );
      const detachableIds = detachable.map((r) => r.id);
      for (const r of found) {
        if (detachableIds.includes(r.id)) continue;
        const ref = r.barcode ?? r.id;
        if (!r.currentStepId || !stepIdSet.has(r.currentStepId)) {
          errorMessages.push(`${ref}: top bu iş emrine bağlı değil`);
        } else {
          errorMessages.push(`${ref}: top çıkarılabilir durumda değil (${r.status})`);
        }
      }
      if (detachableIds.length === 0) return;

      // 1) Toplar → STOCK + pointer/dal kimliği temizle (currentQty'ye
      //    dokunulmaz). ATOMİK CLAIM: aynı koşullar WHERE'de — okuma ile
      //    update arasına başka işlem girerse count uyuşmaz → 409 + rollback.
      // F1: detach RESTORE — attach ÖNCESİ duruma en yakın hale getir. prevStatus saklanmadığından
      // colorId tek doğruluk kaynağı (createInitialEntry hüristiğinin aynası): renksiz (ham) → STOCK;
      // renkli (işlenmiş) → kaliteden çözülen final durum (varsayılan WAREHOUSE). Aksi halde WAREHOUSE
      // bir top attach→detach ile sessizce STOCK'a (ham) düşerdi. currentQty'ye dokunulmaz.
      // Parti (Batch) üyeliği de koparılır (batchId=null); boşalan parti izsizse sonra temizlenir.
      const { statusByCode } = await loadQualityTargetMaps(tx, detachable.map((r) => r.qualityGrade));
      const idsByTarget = new Map<RollStatus, string[]>();
      for (const r of detachable) {
        const target = r.colorId == null ? RollStatus.STOCK : resolveFinalStatus(r.qualityGrade, statusByCode);
        const arr = idsByTarget.get(target);
        if (arr) arr.push(r.id);
        else idsByTarget.set(target, [r.id]);
      }
      // Hedef duruma göre gruplanmış ATOMİK claim'ler (aynı WHERE guard'ı; toplam count kontrolü).
      let claimedCount = 0;
      for (const [target, ids] of idsByTarget) {
        const res = await tx.roll.updateMany({
          where: {
            id: { in: ids },
            currentStepId: { in: stepIds },
            status: { in: DETACHABLE_STATUSES },
          },
          data: {
            status: target,
            currentStepId: null,
            batchId: null,
          },
        });
        claimedCount += res.count;
      }
      if (claimedCount !== detachableIds.length) {
        throw AppError.conflict(
          "Toplardan biri bu sırada başka bir işlemle değişti. Listeyi yenileyip tekrar deneyin.",
        );
      }

      // 1b) producedInStepId yalnız BU WO'nun adımını gösteriyorsa temizlenir
      //     (attachRolls'un set ettiği işaretin geri alınması). Başka WO'da
      //     üretilmiş topun soy izi korunur.
      await tx.roll.updateMany({
        where: { id: { in: detachableIds }, producedInStepId: { in: stepIds } },
        data: { producedInStepId: null },
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
          AND m."rollId" = ANY(${detachableIds}::uuid[])
          AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
          AND m."exitedAt" IS NULL
      `;

      // 3) Boşalan adımların durumunu yeniden hesapla (tüm toplar çıkarıldıysa
      //    adım ACTIVE kalmasın).
      const affectedStepIds = [
        ...new Set(detachable.map((r) => r.currentStepId!).filter(Boolean)),
      ];
      for (const sid of affectedStepIds) {
        await recomputeStepStatus(tx, sid);
      }

      detached.push(
        ...detachable.map((r) => ({ id: r.id, barcode: r.barcode, prevStatus: r.status })),
      );
    });

    // R8 fix: audit recordId = UUID. oldData GERÇEK önceki statü (hardcode değil).
    // TEK createMany (eski sıralı for-loop INSERT yerine).
    await AuditService.logMany(
      detached.map((r) => ({
        userId,
        action: "UPDATE" as const,
        tableName: "ROLL",
        recordId: r.id,
        oldData: { status: r.prevStatus, workOrderId },
        newData: { status: "STOCK", workOrderId: null, barcode: r.barcode },
      }))
    );

    return {
      success: true,
      data: { detached: detached.length, errors: errorMessages },
      message:
        errorMessages.length > 0
          ? `${detached.length} top çıkarıldı, ${errorMessages.length} top çıkarılamadı.`
          : `${detached.length} top iş emrinden başarıyla çıkarıldı.`,
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

    // ATOMİK CLAIM (check-then-act DEĞİL): PLANNED→IN_PROGRESS geçişini status-koşullu
    // updateMany ile sahiplen. İki paralel kilitle / kilitle+iptal yarışında yalnız biri
    // kazanır; üst ön-kontrol (4082) UX, asıl koruma bu claim.
    const claim = await prisma.workOrder.updateMany({
      where: { id: workOrderId, status: WorkOrderStatus.PLANNED },
      data: { status: WorkOrderStatus.IN_PROGRESS },
    });
    if (claim.count === 0) {
      const fresh = await prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: { status: true },
      });
      throw AppError.conflict(
        `İş emri bu sırada ${fresh?.status} durumuna geçti — kilitlenemedi. Sayfayı yenileyin.`
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
      message: "İş emri kilitlendi ve üretime (IN_PROGRESS) alındı.",
    };
  }

  /**
   * Sepetteki (Bağlanmış) Topları Getir
   */
  async getAttachedRolls(workOrderId: string): Promise<ApiResponse<unknown[]>> {
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

    // PERF (#12 select>include): tüketiciler (mobil WorkOrderDetailSheet +
    // printWorkOrder) yalnız id/barcode/status/currentQty/item.name okuyor; color
    // savunma amaçlı dar select'le tutulur. item:true / color:true tüm sütunları
    // çekiyordu (over-fetch).
    const rolls = await prisma.roll.findMany({
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
        item: { select: { id: true, name: true } },
        color: { select: { id: true, code: true, name: true, hex: true } },
      },
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
      batchNumber: wo.workOrderNumber,
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
      // F69: manifest yalnız bu alanları kullanıyor — tüm item satırını çekme (over-fetch).
      select: {
        barcode: true,
        currentQty: true,
        weightKg: true,
        status: true,
        item: { select: { name: true } },
      },
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
      batchNumber: wo.workOrderNumber,
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

    // Manifest (çeki listesi) no: CL + GGAAYY + NNNN (örn CL1207260001)
    const now = new Date();
    const prefix = dailyCodePrefix("CL", now);

    // manifestNo @unique + günlük sequence TÜM WO'lar arasında paylaşımlı —
    // eşzamanlı iki basım aynı NNN'i hesaplardı; projedeki diğer tüm belge
    // numaraları gibi withBarcodeRetry ile sarıldı (P2002'de sequence closure
    // içinde yeniden okunur).
    const manifest = await withBarcodeRetry(async () => {
      // O-4: collation-güvenli (gte + startsWith) + NUMERIC max — lexicographic
      // "999">"1000" taşmasını önler (findFirst+orderBy desc "...999"da sıkışıp
      // withBarcodeRetry'ı kalıcı 409'a düşürüyordu). withBarcodeRetry sarması
      // korunur: P2002'de closure taze max okur.
      const todays = await prisma.manifest.findMany({
        where: { manifestNo: { gte: prefix, startsWith: prefix } },
        select: { manifestNo: true },
      });
      const seq = nextDailySeq(
        todays.map((m) => m.manifestNo),
        prefix,
      );
      const manifestNo = `${prefix}${String(seq).padStart(4, "0")}`;

      return prisma.manifest.create({
        data: {
          manifestNo,
          workOrderId,
          printedById: userId ?? null,
          snapshot: live as Prisma.InputJsonValue,
          notes: notes ?? null,
        },
      });
    });

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "MANIFEST",
      recordId: manifest.id,
      newData: { manifestNo: manifest.manifestNo, workOrderId },
    });

    return {
      success: true,
      data: {
        id: manifest.id,
        manifestNo: manifest.manifestNo,
        printedAt: manifest.printedAt,
        snapshot: manifest.snapshot,
      },
      message: `Çeki listesi oluşturuldu: ${manifest.manifestNo}`,
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
}
