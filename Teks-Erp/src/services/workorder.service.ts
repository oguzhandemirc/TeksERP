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
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
// Kurşun bypass (kurşun istasyonunda tablet YOK): WO yaşam döngüsü olayları açık
// dağıtım atamalarını bayat bırakmasın. Guard helper hiçbir servise bağlı değil —
// `kursun-bypass.service`'i import etmek burada döngü yaratırdı.
import { voidStalePendingBypassAssignmentsTx } from "./helpers/kursun-bypass-guard.helper";
import { computeWoInput } from "./helpers/coverage.helper";
import {
  buildHideCancelledWhere,
  HIDE_CANCELLED_FILTER,
} from "./helpers/hidden-status.helper";
import { setWorkOrderCardStatuses } from "./helpers/traveler-card-fanout.helper";
import {
  createBatchTx,
  deleteIfEmptyAndTraceless,
  K18_DEAD_STATUSES,
  type CreateBatchResult,
} from "./batch.service";
import { WorkOrderSplitService } from "./workorder-split.service";
import { WorkOrderManualMoveService, type PartyMode } from "./workorder-manual-move.service";
import { cloneWorkOrderTx, repointRollsTx } from "./helpers/workorder-clone.helper";
import {
  loadQualityTargetMaps,
  resolveFinalStatus,
  finalBarcodeType,
} from "./helpers/roll-finalize.helper";
import { generateRollBarcode } from "./helpers/roll-barcode.helper";
import { TravelerCardService } from "./traveler-card.service";
import { readWorkOrderDefaultPlanDurationDays } from "./system-setting.service";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { isClientTokenP2002, p2002Mentions } from "../utils/p2002";
import { buildDailyCode, dailyCodePrefix, nextDailySeq } from "../utils/code-format";
// Per-roll split'te taşınan toplar için yeni SD dispatch numarası (aynı sequence).
import { nextPrefixedSequence, SubcontractorService } from "./subcontractor.service";

// Prisma.Decimal | number | null | undefined → number | null (karşılaştırma için)
function normNum(v: Prisma.Decimal | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "number" ? v : Number(v);
}

// =============================================================================
// KAPANIŞ DİSPOZİSYONU (WIP disposition) — manuel kapatmada istasyonda kalan top
// =============================================================================
// Kapatma artık "işlemde top var" diye reddetmez; kapanışı yapan kişi her top için
// KARAR verir ve karar sebebiyle audit'e yazılır (sektör pratiği: SAP TECO sonrası
// WIP dispozisyonu / Oracle-D365 job close). Fiziksel olarak DIŞARIDA olan mal
// (fason) hâlâ hard-block — ofisten verilen karar kumaşı geri getirmez.

/** Kapanışta istasyonda kalan (in-flight) topa uygulanacak dispozisyon kararı. */
export type CloseDisposition =
  | "STOCK" // ham stok — işlem görmemiş mal üretime geri döner (yeni WO'ya sokulabilir)
  | "WAREHOUSE" // bitmiş depo — satışa/sevke hazır
  | "A1_STOCK" // 2. kalite satılabilir stok
  | "SCRAP" // gerçek fire (mal vardı, çöpe gitti)
  | "CANCELLED" // hatalı kayıt geri alındı (fire DEĞİL — mal hiç yoktu)
  | "TRANSFER"; // üretim yeni (devam) iş emrinde sürer — statü değişmez

/** Dispozisyonun hedef `RollStatus`'u. TRANSFER burada YOK — statü değiştirmez. */
const DISPOSITION_STATUS: Record<Exclude<CloseDisposition, "TRANSFER">, RollStatus> = {
  STOCK: RollStatus.STOCK,
  WAREHOUSE: RollStatus.WAREHOUSE,
  A1_STOCK: RollStatus.A1_STOCK,
  SCRAP: RollStatus.SCRAP,
  CANCELLED: RollStatus.CANCELLED,
};

/** Satılabilir final statüler — barkod ("her kumaşa etiket") + kalite bunlarda anlamlı. */
const SELLABLE_DISPOSITIONS: RollStatus[] = [RollStatus.WAREHOUSE, RollStatus.A1_STOCK];

/**
 * Fiziksel olarak DIŞARIDA (fason/boyahane) olan statüler — kapanışta hard-block.
 * `softDelete`'in fason guard'ıyla aynı gerekçe: fason malı ofis kararıyla yer
 * değiştirmez, önce fason kabul/iade yapılır.
 */
const CLOSE_BLOCKED_STATUSES: RollStatus[] = [
  RollStatus.AT_SUBCONTRACTOR,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

/** Kapanışta "istasyonda/işlemde" sayılan statüler (dispozisyon + blok kümesi). */
const CLOSE_IN_FLIGHT_STATUSES: RollStatus[] = [
  RollStatus.IN_PRODUCTION,
  ...CLOSE_BLOCKED_STATUSES,
];

/**
 * Tek kapanışta dispozisyon verilebilecek en fazla top. Aşılırsa kapatma bloklanır
 * (sessiz kırpma YOK) — bu bir istisna prosedürü, yüz toplu WIP'in yeri değil.
 */
const CLOSE_DISPOSITION_MAX_ROLLS = 200;

/** İstemciden gelen tek dispozisyon satırı. */
export interface CloseDispositionInput {
  rollId: string;
  action: CloseDisposition;
  /** Yalnız WAREHOUSE/A1_STOCK'ta anlamlı; opsiyonel — boş bırakılırsa kalite "—" kalır. */
  qualityGradeId?: string | null;
}

/** Uygulanan dispozisyonun audit izi (tx dışında `SystemLog`'a yazılır). */
interface AppliedDisposition {
  rollId: string;
  barcode: string | null;
  from: RollStatus;
  to: RollStatus;
  action: CloseDisposition;
}

/** Manuel kapatma payload'ı. */
export interface CompleteWorkOrderInput {
  /** Dispozisyon varsa zorunlu (min 3 karakter) — audit'e yazılır. */
  reason?: string;
  dispositions?: CloseDispositionInput[];
  /** TRANSFER varsa: yeni iş emri siparişe bağlı kalsın mı ("keep") yoksa stok mu. */
  transferOrderMode?: "stock" | "keep";
}

const workOrderSplitService = new WorkOrderSplitService();
const workOrderManualMoveService = new WorkOrderManualMoveService();
const travelerCardService = new TravelerCardService();

/**
 * `quickStart` idempotent-replay dalları için partiyi ÇÖZ.
 *
 * Normal akışta parti `attachRolls`'un yanıtından gelir; replay'de attach hiç
 * koşmadığı için WO üzerinden okunur. Timeout sonrası tekrar denemede operatör
 * sonuç ekranını İLK KEZ görür — parti orada boş kalırsa özellik tam da en çok
 * gerektiği anda kaybolur.
 *
 * `mergedIntoId != null` olan parti TARİHÇEDİR (başka partiye katılmış), canlı
 * kimlik değildir → dışlanır. Hızlı İş Emri tek parti üretir; yine de en YENİsi
 * alınır ki elle bölünmüş/eklenmiş WO'da güncel olan dönsün.
 */
async function resolveQuickStartBatch(
  workOrderId: string,
): Promise<{ id: string; batchNumber: string } | null> {
  return prisma.batch.findFirst({
    where: { workOrderId, mergedIntoId: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, batchNumber: true },
  });
}

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
  /** İdempotency anahtarı (UUID) — istemci form-oturumu başına üretir. Aynı
   *  token'la 2. çağrı (timeout sonrası tekrar) mevcut WO'yu cached döner;
   *  farklı payload ile gelirse 409 CLIENT_TOKEN_COLLISION. */
  clientToken?:       string | null;
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
  ): Promise<ApiResponse<WorkOrder> & { idempotentReplay?: boolean }> {
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

      // ── Özellik başına rota kapsaması ────────────────────────────────────
      // 2026-08-02: bu kontrol eskiden YALNIZ replace/updateTargetProperties'te
      // vardı. Asimetri şuna yol açıyordu: API'den ZIMPARALI hedefiyle iş emri
      // AÇILABİLİYOR ama aynı iş emrine sonradan EKLENEMİYOR (409). Yukarıdaki
      // kategori kontrolü "özellik veren bir adım var mı" der; bu blok "ŞU
      // özelliği veren bir adım var mı" der — ikisi farklı sorular (rotada
      // boyahane olması zımparanın uygulanacağı anlamına gelmez).
      // Create'te tüm adımlar PENDING olduğu için uygun küme = rotadaki tüm
      // istasyonların yetenekleri; locks helper'ının COMPLETED elemesine gerek yok.
      if (targetPropertyIds.length > 0) {
        const routeStationIds = [...new Set(finalSteps.map((s) => s.stationId))];
        const caps = await prisma.stationProperty.findMany({
          where: { stationId: { in: routeStationIds } },
          select: { propertyId: true },
        });
        const applicable = new Set(caps.map((c) => c.propertyId));
        const uncoveredIds = targetPropertyIds.filter((pid) => !applicable.has(pid));
        if (uncoveredIds.length > 0) {
          const uncovered = await prisma.fabricProperty.findMany({
            where: { id: { in: uncoveredIds } },
            select: { name: true },
          });
          const names = uncovered.map((p) => p.name).join(", ");
          throw AppError.badRequest(
            `Şu özelliği uygulayabilecek istasyon rotada yok: ${names}. Uygun istasyonu rotaya ekleyin ya da o istasyonun yetenek listesine bu özelliği tanımlayın.`,
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
          clientToken:       data.clientToken ?? null,
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
    }), undefined, (err) => {
      // İdempotent replay: clientToken P2002'si retry EDİLMEZ (retry hep aynı
      // token'ı yazar) — false ile propagate edilir, aşağıdaki catch cached
      // (idempotent retry) yanıtına çevirir.
      if (isClientTokenP2002(err)) return false;
      // F61: workOrderNumber P2002'si MANUEL modda retry EDİLMEZ (hep aynı numarayı
      // yazar) — doğrudan anlaşılır 409. (Auto modda taze numarayla retry edilir.)
      if (manualWorkOrderNumber && p2002Mentions(err, /workOrderNumber/i)) {
        throw AppError.conflict(`Bu iş emri numarası zaten kullanılıyor: ${manualWorkOrderNumber}`);
      }
      return true;
    }).catch(async (err) => ({
      replayOf: await this.resolveCreateTokenReplay(err, data.clientToken, type, resolvedTargetItemId),
    }));

    if ("replayOf" in workOrder) {
      // İlk commit refakat kartı dahil her şeyi yazdı; audit yalnız gerçek
      // create yolunda (inventory emsali — cached yol audit'i atlar).
      return {
        success: true,
        data: workOrder.replayOf,
        message: `İş emri zaten oluşturulmuş (idempotent retry): ${workOrder.replayOf.workOrderNumber}`,
        idempotentReplay: true,
      };
    }

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
   * create() tx'i clientToken P2002 ile düştüyse idempotent replay çözümlemesi:
   * aynı token'lı mevcut WO'yu bulur; payload kimliği (type + targetItemId)
   * uyuşuyorsa onu döner (çağıran cached yanıt üretir). Uyuşmuyorsa veya WO
   * arşivliyse 409. Token replay'i değilse orijinal hata aynen fırlar.
   */
  private async resolveCreateTokenReplay(
    err: unknown,
    clientToken: string | null | undefined,
    type: WorkOrder["type"],
    targetItemId: string | null,
  ): Promise<WorkOrder> {
    if (!clientToken || !isClientTokenP2002(err)) throw err;
    const existing = await prisma.workOrder.findUnique({
      where: { clientToken },
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
    if (!existing) throw err;
    if (!existing.isActive) {
      // quickStart zero-attach telafisi token'ı NULL'ladığından buraya pratikte
      // düşülmez (savunma guard'ı): arşivli WO'ya cached dönmek operatörü
      // "iş emri açık" sanrısına sokar.
      throw AppError.conflict(
        `Bu formun önceki denemesi arşivlenmiş (${existing.workOrderNumber}) — formu yenileyip tekrar deneyin.`,
      );
    }
    // Hafif payload-özdeşlik (F117 emsali): kimlik-kilit alanları uyuşmalı.
    if (existing.type === type && existing.targetItemId === targetItemId) {
      return existing;
    }
    throw AppError.conflict(
      `Bu form daha önce kaydedilmiş: ${existing.workOrderNumber}. Yeni iş emri için formu kapatıp yeniden açın.`,
      {
        code: "CLIENT_TOKEN_COLLISION",
        workOrderNumber: existing.workOrderNumber,
        existing: { id: existing.id, type: existing.type, targetItemId: existing.targetItemId },
        incoming: { type, targetItemId },
      },
    );
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
      /** Topların bağlandığı PARTİ — İş Emri No ile AYRI kavram. Çözülemezse null. */
      batch: { id: string; batchNumber: string } | null;
    }>
  > {
    const { rollBarcodes, dispatchFirstStep, ...woInput } = data;
    const barcodes = [...new Set(rollBarcodes.map((b) => b.trim()).filter(Boolean))];
    if (barcodes.length === 0) {
      throw AppError.badRequest("En az bir top barkodu okutmalısınız.");
    }

    // ── 0) İdempotent replay kısa-devresi ───────────────────────────────────
    // Bu clientToken'la WO zaten açılmışsa (manuel tekrar / timeout-replay), aşağıdaki
    // ön-doğrulamaya HİÇ girme: toplar İLK istekte bağlandığından artık IN_PRODUCTION
    // ve pre-validation yanlışlıkla "toplar envanterde değil" 400'ü atardı. Cached WO'yu
    // dön (create()'in idempotentReplay guard'ının pre-validation-öncesi ikizi).
    if (woInput.clientToken) {
      const existing = await prisma.workOrder.findUnique({
        where: { clientToken: woInput.clientToken },
        include: {
          steps:      { include: { station: true }, orderBy: { stepSequence: "asc" } },
          orderLinks: { include: { orderLine: { include: { order: { include: { customer: true } }, item: true, color: true } } } },
          routeTemplate: true,
        },
      });
      if (existing && existing.isActive) {
        const attached = await prisma.roll.count({
          where: { barcode: { in: barcodes }, currentStep: { workOrderId: existing.id } },
        });
        return {
          success: true,
          data: {
            workOrder: existing,
            attached,
            errors: [],
            dispatch: null,
            batch: await resolveQuickStartBatch(existing.id),
          },
          message: `İş emri zaten başlatılmış (idempotent retry): ${existing.workOrderNumber}`,
        };
      }
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

    // İdempotent replay: create() cached WO döndüyse toplar İLK istekte bağlanmış
    // demektir — attach/telafi/dispatch TEKRARLANMAZ. (Devam edilseydi attach 0
    // dönerdi ve zero-attach telafisi GERÇEK WO'yu hardDelete ile arşivlerdi.)
    if (createRes.idempotentReplay) {
      const attached = await prisma.roll.count({
        where: { barcode: { in: barcodes }, currentStep: { workOrderId: workOrder.id } },
      });
      return {
        success: true,
        data: {
          workOrder,
          attached,
          errors: [],
          dispatch: null,
          batch: await resolveQuickStartBatch(workOrder.id),
        },
        message: `İş emri zaten başlatılmış (idempotent retry): ${workOrder.workOrderNumber}`,
      };
    }

    // ── 3) Topları bağla + 4) telafi (zero-attach → WO'yu arşivle) ──────────
    let attached = 0;
    let errors: string[] = [];
    // Parti, attachRolls'ta doğar (P+GGAAYY+NNNN). Eskiden yanıta konmuyordu ve
    // mobil sonuç ekranı parti yerine İŞ EMRİ numarasını basıyordu — iki kavram
    // ayrı (bkz. kök CLAUDE.md "İş Emri No ≠ Parti"), operatör kartta/lanede
    // parti arayınca bulamıyordu.
    let batch: { id: string; batchNumber: string } | null = null;
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
      batch = attachRes.data?.batch ?? null;
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
      data: { workOrder, attached, errors, dispatch, batch },
      message:
        `İş emri ${workOrder.workOrderNumber} başlatıldı — ${attached} top bağlandı` +
        (batch ? ` (Parti ${batch.batchNumber})` : "") +
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
    // İptal gizleme bayrağı: buildWhereClause BU serviste allowlist'ten geçmeyen
    // her filtre anahtarını body'ye kopyalar (Order'daki safeFilters süzgeci burada
    // YOK) → bayrak `where.hideCancelled` olarak Prisma'ya sızar ve "Unknown
    // argument" 500'ü verirdi. Okuyup filtre kümesinden ÇIKARIYORUZ.
    const hideCancelledWhere = buildHideCancelledWhere(params.filters, [
      WorkOrderStatus.CANCELLED,
    ]);
    delete params.filters[HIDE_CANCELLED_FILTER];
    // Arama kapsamı liste kolonlarıyla hizalı: İE no + parti no + kumaş/renk +
    // sipariş bağı üzerinden müşteri adı VE sipariş no (nested some → EXISTS
    // subquery). Sipariş no ile de aranabilmesi siparişten üretim emrine
    // erişimi tamamlar (sipariş listesindeki rollup rozetinin tersi yönü).
    const where = buildWhereClause(
      params.filters,
      [
        "workOrderNumber",
        "batches.some.batchNumber",
        "targetItem.name",
        "targetColor.name",
        "orderLinks.some.orderLine.order.customer.name",
        "orderLinks.some.orderLine.order.orderNumber",
      ],
      params.search
    );
    applyDateRange(where, params, WORKORDER_DATE_FIELDS);
    if (hideCancelledWhere) Object.assign(where, hideCancelledWhere);
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
   * WO ÜRETİM ÇIKTISI küme tanımı — liste (withProductionMeters) ve detay
   * (producedRolls) AYNI kümeyi kullanır (drift = iki ekranda farklı sayı).
   *
   * 2026-07-27 düzeltmesi: eski tanım `parent.entrySource=SUBCONTRACTOR_RETURN`
   * şartıyla YALNIZ fason-dönüşü açık kumaştan kesilen çocukları sayıyordu —
   * fasonsuz rota (stok top → KK1→KK2→Tambur) ve Tambur'suz biten rota
   * ("her rotanın son adımı final üretir": Kurşun/fason finalize) ÇIKAN=0
   * görünüyordu. Yeni küme iki daldan oluşur:
   *   a) Tambur birinci-nesil çocukları (entrySource=TAMBUR_SPLIT, bu WO'nun
   *      adımında doğmuş). AYNI WO içi re-cut torunları çift sayım nedeniyle
   *      hariç; ama BAŞKA WO'nun deposundan tüketilen TAMBUR_SPLIT parent'ın
   *      çocukları meşru çıktıdır (parent.producedInStepId kapsam şartı).
   *      Snapshot: sonradan TAMBUR_CONSUMED/CANCELLED olan çocuk listede kalır
   *      (detay rozet basar).
   *   b) Çocuğa bölünmeden nihai-ürün statüsüne ulaşan finalize çıktıları —
   *      rota Kurşun/QC2 veya fasonla bitti. Ara-tüketilenler
   *      (TAMBUR_CONSUMED/SUBCONTRACTOR_CONSUMED) ve canlı üretim bu dala giremez.
   */
  private producedOutputWhere(stepIds: string[]): Prisma.RollWhereInput {
    return {
      producedInStepId: { in: stepIds },
      OR: [
        {
          entrySource: RollEntrySource.TAMBUR_SPLIT,
          NOT: {
            parent: {
              entrySource: RollEntrySource.TAMBUR_SPLIT,
              producedInStepId: { in: stepIds },
            },
          },
        },
        {
          entrySource: { not: RollEntrySource.TAMBUR_SPLIT },
          status: {
            in: [
              RollStatus.WAREHOUSE,
              RollStatus.A1_STOCK,
              RollStatus.SCRAP,
              RollStatus.SHIPPED,
              RollStatus.AT_KARTELA,
              RollStatus.KARTELA_CONSUMED,
            ],
          },
        },
      ],
    };
  }

  /**
   * Liste WO'larına ÜRETİLEN DEPO METRAJINI ekler (ilerleme kolonu için). Detay
   * sayfasının `producedRolls.warehouse.totalMeters` tanımıyla aynı küme
   * (`producedOutputWhere`); FIRE/A1 olmayan rulolar; initialQty toplamı. Tek
   * groupBy ile sayfa başına 1 sorgu. Ayrıca üretime GİREN ham metrajı ve bağlı
   * SİPARİŞ TOPLAMINI (talep) ekler.
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

    // ÇIKAN — üretim çıktısı; detay producedRolls.warehouse ile AYNI küme
    // (producedOutputWhere) + FIRE/A1 hariç (sağlam üretim).
    const producedRows = await prisma.roll.groupBy({
      by: ["producedInStepId"],
      where: {
        AND: [
          this.producedOutputWhere(stepIds),
          {
            // Postgres `NOT IN` NULL-hostile: null kalite (kaliteye bakılmadı) sağlam
            // üretim sayılmalı; düz notIn onu dışlardı. null VEYA (FIRE/A1 değil).
            OR: [
              { qualityGrade: null },
              { qualityGrade: { notIn: ["FIRE", "A1"] } },
            ],
          },
        ],
      },
      _sum: { initialQty: true },
    });
    const producedByStep = new Map<string, number>();
    for (const r of producedRows) {
      if (r.producedInStepId) producedByStep.set(r.producedInStepId, Number(r._sum.initialQty ?? 0));
    }

    // GİREN (üretime giren) — SPLIT (tebdil) WO dahil doğru; computeWoInput tek
    // kaynak (detay inputRolls + committed ile AYNI tanım). Girdi kökü = W dışından
    // gelen üye top; split WO'nun reEntry adımında doğan enjekte kökü de sayılır
    // (eski "yalnız ilk adım" çapası split WO'yu 0 sayıyordu).
    const inputByWo = await computeWoInput(
      prisma,
      wos.map((w) => w.id),
    );

    return wos.map((w) => ({
      ...w,
      producedMeters: w.steps.reduce((sum, st) => sum + (producedByStep.get(st.id) ?? 0), 0),
      inputMeters: Number(inputByWo.get(w.id)?.meters ?? 0),
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
                order: { include: { customer: true, branch: { select: { id: true, name: true, code: true } } } },
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
        /** Hangi partiye üye — "hangi top hangi partide" sorusu için (F: Rota&Dağılım). */
        batchNumber: string | null;
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
        /** Bir sevk = bir parti (K10) — bu sevkte hangi partinin topları gitti. */
        batchNumber: string | null;
        /** Bu sevkte BİRLİKTE giden toplar (barkod+ürün+renk) — "hangi toplar birlikte gitti". */
        rolls: Array<{
          id: string;
          barcode: string | null;
          dispatchedQty: number;
          item: { name: string } | null;
          color: { name: string; hex: string | null } | null;
        }>;
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
          batch: { select: { batchNumber: true } },
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
          batchNumber: r.batch?.batchNumber ?? null,
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
          batch: { select: { batchNumber: true } },
          // Bir sevk = bir parti (K10) — sevkte BİRLİKTE giden topların kimliği.
          items: {
            select: {
              dispatchedQty: true,
              roll: {
                select: {
                  id: true,
                  barcode: true,
                  item: { select: { name: true } },
                  color: { select: { name: true, hex: true } },
                },
              },
            },
          },
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
          batchNumber: d.batch?.batchNumber ?? null,
          rolls: d.items.map((it) => ({
            id: it.roll.id,
            barcode: it.roll.barcode,
            dispatchedQty: Number(it.dispatchedQty),
            item: it.roll.item,
            color: it.roll.color,
          })),
        });
        stepDispatches.set(d.stepId, list);
      }

      // Üretim çıktısı — SNAPSHOT: liste metriğiyle AYNI küme (producedOutputWhere;
      // Tambur birinci-nesil çocukları + Tambur'suz finalize çıktıları). Tambur
      // dalında status filtresi yok; sonradan re-cut'la TAMBUR_CONSUMED veya
      // CANCELLED olanlar listede kalır (rozetle işaretlenir). Metraj initialQty
      // (production anı), currentQty değil — re-cut sonrası sıfırlanmaz, snapshot sabit.
      const producedRollRows = await prisma.roll.findMany({
        where: this.producedOutputWhere(stepIds),
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

      // Üretime giren ham toplar — SPLIT (tebdil) WO dahil doğru. computeWoInput
      // "girdi kökü" tanımını kullanır (W dışından gelen üye toplar): normal WO'da
      // eskiyle AYNI (tek KK1/supplier kökü; fason-dönüş + Tambur çocuğu elenir),
      // split WO'da reEntry adımında doğan enjekte kökü de sayar (eskiden 0'dı).
      const wi = (await computeWoInput(prisma, [id])).get(id);
      inputRolls = {
        count: wi?.count ?? 0,
        totalMeters: wi?.meters ?? new Prisma.Decimal(0),
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
   * parti Kurşun'da, 2. parti hâlâ boyahanede". Kilit TÜRETİLMİŞ (K14): fasonda
   * (AT_SUB) topu VEYA outstanding açık sevki olan parti kilitlidir; mal dönünce
   * kendiliğinden açılır. (Route uyumu için metod adı `getBranches` kaldı;
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
      // `contentDirty` = "basılı kart güncel değil" rozeti (WO detay başlığı).
      select: { cardNumber: true, barcode: true, contentDirty: true },
    });

    const batches = await prisma.batch.findMany({
      where: { workOrderId },
      // id tie-break: createdAt eşitliğinde (aynı tx'te doğan partiler) UI'nın
      // survivor önizlemesi ile mergeBatches'in gerçek survivor seçimi ayrışmasın.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        batchNumber: true,
        createdAt: true,
        splitFrom: { select: { id: true, batchNumber: true } },
        splitChildren: { select: { id: true, batchNumber: true } },
        // K17: bu parti bir survivor'a birleştiyse — lane'de "→ P… altına birleşti"
        // rozeti için (boş+merge'li kaynaklar rollCount=0 lane'i olarak döner).
        mergedInto: { select: { id: true, batchNumber: true } },
        // Parti üyesi toplar (tüketilmiş ara düğümler HARİÇ — çift sayım olmasın:
        // fason öncesi orijinaller CONSUMED, Tambur'da bölünen parent CONSUMED,
        // kartelaya bölünen parent KARTELA_CONSUMED). Küme tek kaynaktan (K18) —
        // elle liste kopyası KARTELA_CONSUMED'ı atlıyordu (lane'de hayalet top).
        rolls: {
          where: {
            status: { notIn: K18_DEAD_STATUSES },
          },
          orderBy: [{ barcode: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            barcode: true,
            currentQty: true,
            status: true,
            currentStep: { select: { station: { select: { name: true, type: true } } } },
            item: { select: { name: true } },
            color: { select: { name: true, hex: true } },
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
            step: { select: { stepSequence: true, station: { select: { name: true } } } },
            subcontractor: { select: { id: true, name: true } },
            items: {
              select: {
                // Kapanış metrajı: dönen kalemin sevk metresi (list-endpoint semantiği).
                dispatchedQty: true,
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

    // Partiye ait FASONDAN SEVKLER (DSK): split çocuğu ya da tamamı sevk edilmiş orijinal
    // top directShipmentId taşır + batchId'yi korur → partiye bağlanır. Parti Geçmişi'nde
    // "Fasondan Sevkler" bölümü için (mal fasondan doğrudan müşteriye gitti).
    const batchIdList = batches.map((b) => b.id);
    const dsRolls = batchIdList.length
      ? await prisma.roll.findMany({
          where: { batchId: { in: batchIdList }, directShipmentId: { not: null } },
          select: {
            batchId: true,
            directShipment: {
              select: {
                id: true,
                shipmentNo: true,
                totalQty: true,
                rollCount: true,
                shippedAt: true,
                customer: { select: { name: true } },
              },
            },
          },
        })
      : [];
    type DsRow = NonNullable<(typeof dsRolls)[number]["directShipment"]>;
    const directShipsByBatch = new Map<string, Map<string, DsRow>>();
    for (const r of dsRolls) {
      if (!r.batchId || !r.directShipment) continue;
      const m = directShipsByBatch.get(r.batchId) ?? new Map<string, DsRow>();
      m.set(r.directShipment.id, r.directShipment);
      directShipsByBatch.set(r.batchId, m);
    }

    // Kapanış kolonu için sevk-başına FASONDAN SEVK metrajı (Σ DirectShipment.totalQty).
    // DirectShipment.dispatchId doğrudan FK → groupBy ile tek sorgu.
    const dispatchIdsAll = batches.flatMap((b) => b.dispatches.map((d) => d.id));
    const dsByDispatch = dispatchIdsAll.length
      ? await prisma.directShipment.groupBy({
          by: ["dispatchId"],
          where: { dispatchId: { in: dispatchIdsAll } },
          _sum: { totalQty: true },
        })
      : [];
    const directShippedByDispatch = new Map(
      dsByDispatch.map((g) => [g.dispatchId, Number(g._sum.totalQty ?? 0)]),
    );

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

        // Kapanış bakiyesi (metraj): Dönen = non-cancelled makbuzu olan kalemlerin sevk
        // metresi Σ; Fasondan = bu sevke atfedilmiş Σ DirectShipment.totalQty. Fasonda kalan
        // = totalQty − Dönen − Fasondan (frontend hesaplar).
        const returnedQty = d.items.reduce(
          (s, it) =>
            it.receiptItems.some((ri) => ri.receipt && !ri.receipt.cancelledAt)
              ? s + Number(it.dispatchedQty)
              : s,
          0,
        );
        const directShippedQty = directShippedByDispatch.get(d.id) ?? 0;

        return {
          dispatchId: d.id,
          dispatchNo: d.dispatchNo,
          stepName: d.step?.station?.name ?? null,
          stepSequence: d.step?.stepSequence ?? 0,
          // K15 onay-listesi gruplaması AD değil KİMLİK üzerinden yapılsın diye
          // (aynı istasyon adına iki fason adımı / ad çakışması yanlış "birleşecek"
          // beyanı üretirdi) — Electron batch-merge-confirm bunu anahtar yapar.
          subcontractorId: d.subcontractor.id,
          subcontractorName: d.subcontractor.name,
          dispatchedAt: d.dispatchedAt,
          totalQty: Number(d.totalQty),
          rollCount: itemCount,
          receivedItemCount,
          returnedQty,
          directShippedQty,
          status,
          isTransferOutput,
          directShippedAt: d.directShippedAt,
          directShipReason: d.directShipReason,
          receipts: [...receiptMap.values()],
        };
      });

      // Fasondan sevkler (DSK) — mal fasondan doğrudan müşteriye gitti; en yeni önce.
      const directShipments = [...(directShipsByBatch.get(b.id)?.values() ?? [])]
        .map((ds) => ({
          id: ds.id,
          shipmentNo: ds.shipmentNo,
          customerName: ds.customer?.name ?? null,
          totalQty: Number(ds.totalQty),
          rollCount: ds.rollCount,
          shippedAt: ds.shippedAt,
        }))
        .sort((a, c) => c.shippedAt.getTime() - a.shippedAt.getTime());

      // Kilit türetilmiş (K14, isBatchLockedTx ile aynı ÇİFT kural): partinin FASONDA
      // (AT_SUBCONTRACTOR) topu VEYA outstanding (OPEN/PARTIAL — dönmemiş kalemi olan)
      // açık sevki varsa kilitli — mal fiilen dışarıda. İkinci koşul "zombi sevk"
      // içindir: AT_SUB top detach edilirse roll-koşulu söner ama açık sevk kalır;
      // kilit sürmeli. Mal dönünce iki koşul da söner → kilit kendiliğinden açılır;
      // DIRECT_SHIPPED sevk kilit saymaz (toplar SHIPPED, dönmeyecek).
      const locked =
        b.rolls.some((r) => r.status === "AT_SUBCONTRACTOR") ||
        dispatchViews.some((d) => d.status === "OPEN" || d.status === "PARTIAL");
      const card = woCard;
      // Fasona sevk bekliyor: parti topları bir FASON (EXTERNAL) adımında ÜRETİMDE ama
      // henüz sevk edilmemiş (redye geri-sarımı ya da ilk sevk öncesi). Panelde
      // "boyahaneye gönder" ipucu için — sahadan Fason Sevk yapılmalı.
      const awaitingFasonDispatch = b.rolls.some(
        (r) => r.status === "IN_PRODUCTION" && r.currentStep?.station?.type === "EXTERNAL",
      );

      return {
        batchId: b.id,
        batchNumber: b.batchNumber,
        createdAt: b.createdAt,
        locked,
        awaitingFasonDispatch,
        cardNumber: card?.cardNumber ?? null,
        cardBarcode: card?.barcode ?? null,
        rollCount: b.rolls.length,
        directShipments,
        currentPositions: [...positions.values()],
        // "Hangi partide hangi top var" — count'un ötesinde tek tek kimlik (F: Partiler).
        rolls: b.rolls.map((r) => ({
          id: r.id,
          barcode: r.barcode,
          status: r.status,
          currentQty: Number(r.currentQty),
          positionLabel: r.currentStep?.station?.name ?? statusLabel(r.status),
          item: r.item,
          color: r.color,
        })),
        dispatches: dispatchViews,
        splitFrom: b.splitFrom,
        splitChildren: b.splitChildren,
        // K17 (additive): { id, batchNumber } | null — dolu ise bu lane birleşmiş
        // kaynak partidir (Electron Faz 4 rozeti).
        mergedInto: b.mergedInto,
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

  /**
   * Parti rota-zaman çizelgesi (birleşik geçmiş) — partinin TÜM toplarının hareket
   * (RollMovement: adım giriş/çıkış) ve operasyon (RollOperation: kurşun/QC2/tambur/
   * fason) log'unu ADIMA göre toplar. Performans: per-top `/rolls/:id/history` yerine
   * TEK istek + toplu (in-list) sorgu (1 round-trip). Tambur-split kopya operasyonları
   * (inheritedFromParentRollId) hariç → çift sayım yok.
   */
  async getBatchTimeline(workOrderId: string, batchId: string): Promise<ApiResponse<unknown>> {
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, workOrderId },
      select: { id: true, batchNumber: true },
    });
    if (!batch) {
      return { success: false, data: null, message: "Parti bulunamadı" };
    }

    // Fasondan-sevk split ÇOCUKLARINI dışla: kısmi doğrudan sevkte orijinal top bölünür,
    // sevk edilen parça yeni bir çocuk roll olur (parentRollId + directShipmentId dolu),
    // batchId'yi miras alır ve fason adımında bir RollMovement yaratır. Bunlar sevk için
    // kesilen efemer parçalardır (FASON SEVKLER / Sevkiyatlar'da izlenir), partinin gerçek
    // üyesi/adım sakini DEĞİL — sayılırsa adım "3 top" gibi şişer (aslında 1 top duruyor).
    const rolls = await prisma.roll.findMany({
      where: { batchId },
      select: { id: true, parentRollId: true, directShipmentId: true },
    });
    const rollIds = rolls
      .filter((r) => !(r.parentRollId != null && r.directShipmentId != null))
      .map((r) => r.id);

    const [steps, movements, operations] = await Promise.all([
      prisma.workOrderStep.findMany({
        where: { workOrderId },
        orderBy: { stepSequence: "asc" },
        select: { id: true, stepSequence: true, station: { select: { name: true, type: true } } },
      }),
      prisma.rollMovement.findMany({
        where: { rollId: { in: rollIds } },
        select: { workOrderStepId: true, rollId: true, enteredAt: true, exitedAt: true },
      }),
      prisma.rollOperation.findMany({
        where: { rollId: { in: rollIds }, inheritedFromParentRollId: null },
        select: {
          workOrderStepId: true,
          operationType: true,
          createdAt: true,
          operator: { select: { fullName: true, username: true } },
        },
      }),
    ]);

    const timelineSteps = steps.map((s) => {
      const stepMovements = movements.filter((m) => m.workOrderStepId === s.id);
      const stepOps = operations.filter((o) => o.workOrderStepId === s.id);
      const enteredTimes = stepMovements.map((m) => m.enteredAt.getTime());
      const exitedMovements = stepMovements.filter((m) => m.exitedAt != null);
      const allExited = stepMovements.length > 0 && exitedMovements.length === stepMovements.length;

      const opMap = new Map<
        string,
        { type: string; count: number; lastAt: Date; operators: Set<string> }
      >();
      for (const o of stepOps) {
        const cur =
          opMap.get(o.operationType) ??
          { type: o.operationType, count: 0, lastAt: o.createdAt, operators: new Set<string>() };
        cur.count += 1;
        if (o.createdAt > cur.lastAt) cur.lastAt = o.createdAt;
        const name = o.operator?.fullName ?? o.operator?.username;
        if (name) cur.operators.add(name);
        opMap.set(o.operationType, cur);
      }

      return {
        stepId: s.id,
        stepSequence: s.stepSequence,
        stationName: s.station?.name ?? "—",
        stationType: s.station?.type ?? null,
        visited: stepMovements.length > 0,
        rollCount: new Set(stepMovements.map((m) => m.rollId)).size,
        enteredAt: enteredTimes.length ? new Date(Math.min(...enteredTimes)) : null,
        exitedAt:
          allExited && exitedMovements.length
            ? new Date(Math.max(...exitedMovements.map((m) => m.exitedAt!.getTime())))
            : null,
        operations: [...opMap.values()].map((o) => ({
          type: o.type,
          count: o.count,
          lastAt: o.lastAt,
          operators: [...o.operators],
        })),
      };
    });

    return {
      success: true,
      data: {
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        rollCount: rollIds.length,
        steps: timelineSteps,
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
      /**
       * Tebdil sebebi (opsiyonel) — audit'e/parti kaydına yazılır.
       * Bu ince cephe (facade) tipi `reason`'ı TAŞIMIYORDU: hem controller'ın Zod
       * şeması hem de asıl `workOrderSplitService.splitBranch` onu kabul edip
       * DB'ye yazdığı için HTTP yolu doğru çalışıyor, yalnız doğrudan TS
       * çağrıcıları (testler) "fazla alan" hatası alıyordu. Tip driftiydi.
       */
      reason?: string;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderSplitService.splitBranch(workOrderId, data, userId);
  }

  /** Manuel konum düzeltme önizlemesi (süpervizör override) — hiçbir şeyi değiştirmez. */
  async getManualMovePreview(
    workOrderId: string,
    input: { batchId?: string; rollIds?: string[]; targetStepId: string },
  ): Promise<ApiResponse<unknown>> {
    return workOrderManualMoveService.getManualMovePreview(workOrderId, input);
  }

  /** Parti/top bazında rotada manuel taşıma (süpervizör override). */
  async manualMove(
    workOrderId: string,
    input: {
      batchId?: string;
      rollIds?: string[];
      targetStepId: string;
      partyMode?: PartyMode;
      joinBatchId?: string;
      reason: string;
    },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    return workOrderManualMoveService.manualMove(workOrderId, input, userId);
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
    } else if (wo.status === WorkOrderStatus.SUPERSEDED) {
      blockReason = "Devredilmiş iş emri iptal edilemez (malzemesi yeni iş emrine taşındı).";
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
    if (existing.status === WorkOrderStatus.SUPERSEDED) {
      throw AppError.badRequest("Devredilmiş iş emri iptal edilemez (malzemesi yeni iş emrine taşındı)");
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
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
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
          -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
          -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
          SET "exitedAt" = (now() AT TIME ZONE 'UTC'),
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

      // Kurşun bypass: iş emri artık YOK → açık kurşun dağıtımı da yok. `force`
      // ile TÜM açık atamalar iptal edilir (adım durumuna bakılmaz): yukarıdaki
      // blok adımları zaten SKIPPED'a çekiyor ama `stepIds` boşsa hiç çalışmıyor,
      // ve bayat kalan bir atama dağıtım ekranında "bu iş bizde bekliyor" diye
      // sonsuza dek görünür + partial unique yüzünden adım yeniden kullanılamazdı.
      // İSTASYON GERİ YÜKLENMEZ (helper sözleşmesi) — kapanmış movement'ların
      // istasyon atfı, işi fiilen yapan kurşun istasyonunda kalmalı.
      await voidStalePendingBypassAssignmentsTx(tx, id, "WO_CANCELLED", { force: true });

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
   * MANUEL KAPATMA ÖNİZLEMESİ (read-only): kalan (atlanacak) adımlar + in-flight
   * topların DİSPOZİSYON listesi. In-flight toplar iki kümeye ayrılır:
   *   - `dispositionRolls` → içeride (IN_PRODUCTION, açık fason sevki yok): kapatan
   *     kişi her biri için karar verir (ham stok / depo / 2. kalite / fire / hatalı
   *     kayıt / devir).
   *   - `blockedRolls`     → fasonda ya da açık fason sevkinde: KARAR VERİLEMEZ,
   *     kapatma bloklanır (mal fiziksel olarak dışarıda).
   * `canComplete` artık "WIP var" diye false OLMAZ — yalnız blocked küme (ya da WO'nun
   * kendi durumu) engeller.
   */
  async getCompletePreview(id: string) {
    const wo = await prisma.workOrder.findUnique({
      where: { id },
      include: {
        steps: {
          include: { station: { select: { name: true } } },
          orderBy: { stepSequence: "asc" },
        },
        _count: { select: { orderLinks: true } },
      },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    const stepIds = wo.steps.map((s) => s.id);
    const stepName = new Map(wo.steps.map((s) => [s.id, s.station?.name ?? "—"]));

    // In-flight = bu WO'nun bir adımında halen işlemde/fasonda olan toplar.
    const inFlightRolls = stepIds.length
      ? await prisma.roll.findMany({
          where: {
            currentStepId: { in: stepIds },
            status: { in: CLOSE_IN_FLIGHT_STATUSES },
          },
          select: {
            id: true,
            barcode: true,
            status: true,
            currentQty: true,
            colorId: true,
            currentStepId: true,
            entrySource: true,
            qualityGrade: true,
            color: { select: { name: true, hex: true } },
            _count: { select: { properties: true } },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

    // Açık (iptal edilmemiş) fason sevkine bağlı toplar — statüsü IN_PRODUCTION olsa
    // bile fason izinde sayılır (getRescuePreview'ın guard'ıyla aynı).
    const openDispatchRollIds = new Set(
      inFlightRolls.length
        ? (
            await prisma.subcontractorDispatchItem.findMany({
              where: {
                rollId: { in: inFlightRolls.map((r) => r.id) },
                dispatch: { cancelledAt: null },
              },
              select: { rollId: true },
            })
          ).map((d) => d.rollId)
        : [],
    );

    const mapRoll = (r: (typeof inFlightRolls)[number]) => ({
      id: r.id,
      barcode: r.barcode,
      status: r.status,
      currentQty: Number(r.currentQty ?? 0),
      colorName: r.color?.name ?? null,
      colorHex: r.color?.hex ?? null,
      propertyCount: r._count.properties,
      // "Ham değil" — cancel-impact'teki processed tanımıyla aynı.
      processed:
        Boolean(r.colorId) ||
        r._count.properties > 0 ||
        r.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN ||
        CLOSE_BLOCKED_STATUSES.includes(r.status),
      qualityGrade: r.qualityGrade,
      stepId: r.currentStepId as string,
      stationName: stepName.get(r.currentStepId as string) ?? "—",
      // Fason dönüşü mal ham stoğa DÖNEMEZ (softDelete'in fason invariant'ı).
      canReturnToStock: r.entrySource !== RollEntrySource.SUBCONTRACTOR_RETURN,
    });

    type PreviewRoll = ReturnType<typeof mapRoll>;
    const dispositionRolls: PreviewRoll[] = [];
    const blockedRolls: (PreviewRoll & { blockReason: string })[] = [];
    for (const r of inFlightRolls) {
      const mapped = mapRoll(r);
      if (r.status !== RollStatus.IN_PRODUCTION) {
        blockedRolls.push({
          ...mapped,
          blockReason: "Fasonda (fiziksel olarak dışarıda) — önce fason kabul/iade yapılmalı",
        });
      } else if (openDispatchRollIds.has(r.id)) {
        blockedRolls.push({
          ...mapped,
          blockReason: "Açık bir fason sevkine bağlı — önce fason kapatılmalı",
        });
      } else {
        dispositionRolls.push(mapped);
      }
    }

    const byStep = new Map<string, { stationName: string; count: number; meters: number }>();
    for (const r of inFlightRolls) {
      const key = r.currentStepId!;
      const e = byStep.get(key) ?? { stationName: stepName.get(key) ?? "—", count: 0, meters: 0 };
      e.count += 1;
      e.meters += Number(r.currentQty ?? 0);
      byStep.set(key, e);
    }
    const inFlightCount = inFlightRolls.length;
    const inFlightMeters = inFlightRolls.reduce((s, r) => s + Number(r.currentQty ?? 0), 0);

    const remainingSteps = wo.steps
      .filter((s) => s.status === StepStatus.PENDING || s.status === StepStatus.ACTIVE)
      .map((s) => ({ stepId: s.id, stationName: s.station?.name ?? "—", stepSequence: s.stepSequence }));

    let blockReason: string | null = null;
    if (wo.status === WorkOrderStatus.COMPLETED) {
      blockReason = "İş emri zaten tamamlanmış.";
    } else if (wo.status === WorkOrderStatus.SUPERSEDED) {
      blockReason = "Devredilmiş iş emri kapatılamaz (malzemesi yeni iş emrine taşındı).";
    } else if (wo.status === WorkOrderStatus.CANCELLED) {
      blockReason = "İptal edilmiş iş emri kapatılamaz.";
    } else if (wo.status === WorkOrderStatus.PLANNED) {
      blockReason =
        "İş emri henüz üretime başlamadı (Planlandı). Başlamamış iş emrini kapatmak yerine iptal edin.";
    } else if (blockedRolls.length > 0) {
      blockReason =
        `${blockedRolls.length} top fasonda / açık fason sevkinde — mal fiziksel olarak ` +
        "dışarıda olduğu için kapatılamaz. Önce fason kabul/iade yapılmalı.";
    } else if (dispositionRolls.length > CLOSE_DISPOSITION_MAX_ROLLS) {
      blockReason =
        `${dispositionRolls.length} top işlemde — kapanış dispozisyonu en fazla ` +
        `${CLOSE_DISPOSITION_MAX_ROLLS} top için yapılabilir. Önce topları istasyonlardan çözün.`;
    }

    return {
      success: true,
      data: {
        workOrderId: id,
        workOrderNumber: wo.workOrderNumber,
        status: wo.status,
        canComplete: blockReason === null,
        blockReason,
        /** true ise kapatma isteği her dispozisyon topu için karar taşımak ZORUNDA. */
        requiresDisposition: dispositionRolls.length > 0,
        /** Devirde yeni WO'nun sipariş bağı default'u için (bağ varsa "keep"). */
        orderLinked: wo._count.orderLinks > 0,
        remainingSteps,
        inFlight: {
          count: inFlightCount,
          totalMeters: inFlightMeters,
          byStep: [...byStep.values()],
        },
        dispositionRolls,
        blockedRolls,
      },
    };
  }

  /**
   * MANUEL KAPATMA + KAPANIŞ DİSPOZİSYONU: IN_PROGRESS bir iş emrini elle COMPLETED'a
   * çeker. İstasyonda kalan (IN_PRODUCTION) her top için ÇAĞIRAN karar verir
   * (`data.dispositions`) — kapatma artık "işlemde top var" diye reddedilmez; karar
   * kapanışın parçasıdır ve sebebiyle audit'e yazılır. Hâlâ hard-block olan tek şey
   * FASON: mal fiziksel olarak dışarıdaysa ofis kararı onu geri getirmez.
   *
   * Kalan PENDING/ACTIVE adımlar SKIPPED(MANUAL_COMPLETE), açık movement'lar kapatılır,
   * ACTIVE refakat kartları COMPLETED olur. Atomik claim + guard'lar tx-içinde
   * (eşzamanlı finalize/iptal ile yarış güvenli — cancel deseninin aynısı).
   */
  async completeWorkOrder(
    id: string,
    data: CompleteWorkOrderInput = {},
    userId?: string,
  ): Promise<ApiResponse<WorkOrder>> {
    const existing = await prisma.workOrder.findUnique({
      where: { id },
      include: { steps: { select: { id: true, stepSequence: true } } },
    });
    if (!existing) throw AppError.notFound("İş emri bulunamadı");
    if (existing.status === WorkOrderStatus.COMPLETED) {
      throw AppError.badRequest("İş emri zaten tamamlanmış");
    }
    if (existing.status === WorkOrderStatus.SUPERSEDED) {
      throw AppError.conflict("Devredilmiş iş emri kapatılamaz (malzemesi yeni iş emrine taşındı)");
    }
    if (existing.status === WorkOrderStatus.CANCELLED) {
      throw AppError.conflict("İptal edilmiş iş emri kapatılamaz");
    }
    if (existing.status === WorkOrderStatus.PLANNED) {
      throw AppError.badRequest("İş emri henüz üretime başlamadı — kapatmak yerine iptal edin");
    }

    const dispositions = data.dispositions ?? [];
    const reason = (data.reason ?? "").trim();
    if (dispositions.length > 0 && reason.length < 3) {
      throw AppError.badRequest(
        "Kapanış dispozisyonu için işlem nedeni (en az 3 karakter) zorunludur",
      );
    }
    if (dispositions.length > CLOSE_DISPOSITION_MAX_ROLLS) {
      throw AppError.badRequest(
        `Tek kapanışta en fazla ${CLOSE_DISPOSITION_MAX_ROLLS} top için dispozisyon verilebilir`,
      );
    }
    const seenRollIds = new Set<string>();
    for (const d of dispositions) {
      if (seenRollIds.has(d.rollId)) {
        throw AppError.badRequest("Aynı top için birden fazla dispozisyon gönderildi");
      }
      seenRollIds.add(d.rollId);
      if (d.qualityGradeId && d.action !== "WAREHOUSE" && d.action !== "A1_STOCK") {
        throw AppError.badRequest(
          "Kalite yalnız depo / 2. kalite dispozisyonunda verilebilir",
        );
      }
    }

    const stepIds = existing.steps.map((s) => s.id);
    const stepSeqById = new Map(existing.steps.map((s) => [s.id, s.stepSequence]));
    // Adımsız WO'da in-flight top olamaz — gelen dispozisyon sessizce yutulmasın.
    if (stepIds.length === 0 && dispositions.length > 0) {
      throw AppError.badRequest("İş emrinin adımı yok — dispozisyon verilebilecek top da yok");
    }

    const { updated, applied, transferredWorkOrderNumber } = await withBarcodeRetry(() =>
      prisma.$transaction(async (tx) => {
        // ATOMİK CLAIM ÖNCE: WO satırını IN_PROGRESS→COMPLETED koşullu kilitle.
        // Eşzamanlı son-top finalize (tambur/kursun) ya da iptal WO'yu başka duruma
        // çekmişse count===0 → 409 (çift geçiş önlenir).
        const claim = await tx.workOrder.updateMany({
          where: { id, status: WorkOrderStatus.IN_PROGRESS },
          data: { status: WorkOrderStatus.COMPLETED },
        });
        if (claim.count === 0) {
          const fresh = await tx.workOrder.findUnique({ where: { id }, select: { status: true } });
          throw AppError.conflict(
            `İş emri bu sırada ${
              fresh?.status === WorkOrderStatus.COMPLETED ? "tamamlandı" : "değişti"
            }, kapatılamaz. Sayfayı yenileyin.`,
          );
        }

        const appliedRows: AppliedDisposition[] = [];
        let transferredWoNumber: string | null = null;

        if (stepIds.length > 0) {
          // Guard'lar claim'den SONRA (cancel deseni): tripleyince tüm tx (claim dahil)
          // geri sarılır → WO IN_PROGRESS kalır, mal "kapalı WO'da takılı" limbosuna
          // düşmez.
          const inFlight = await tx.roll.findMany({
            where: {
              currentStepId: { in: stepIds },
              status: { in: CLOSE_IN_FLIGHT_STATUSES },
            },
            select: {
              id: true,
              barcode: true,
              status: true,
              currentQty: true,
              weightKg: true,
              currentStepId: true,
              entrySource: true,
              batchId: true,
            },
          });

          // GUARD 1 — FASON: mal fiziksel olarak dışarıda, karar verilemez.
          const outside = inFlight.filter((r) => CLOSE_BLOCKED_STATUSES.includes(r.status));
          if (outside.length > 0) {
            throw AppError.conflict(
              `${outside.length} top fasonda (fiziksel olarak dışarıda) — iş emri ` +
                "kapatılamaz. Önce fason kabul/iade yapılmalı.",
            );
          }

          // GUARD 1b — statüsü IN_PRODUCTION olsa da açık fason sevkine bağlı toplar
          // fason izindedir (rescueStuckRoll'un guard'ıyla aynı).
          if (inFlight.length > 0) {
            const openDispatchCount = await tx.subcontractorDispatchItem.count({
              where: {
                rollId: { in: inFlight.map((r) => r.id) },
                dispatch: { cancelledAt: null },
              },
            });
            if (openDispatchCount > 0) {
              throw AppError.conflict(
                `${openDispatchCount} top açık bir fason sevkine bağlı — iş emri ` +
                  "kapatılamaz. Önce fason kapatılmalı.",
              );
            }
          }

          // GUARD 2 — KAPSAM: tx içinde TAZE okunan in-flight küme ile gönderilen
          // dispozisyonlar birebir örtüşmeli. Eksik/fazla → istemcinin gördüğü liste
          // bayat; sessizce yarım kapatma yapmaktansa reddet.
          const byId = new Map(inFlight.map((r) => [r.id, r]));
          if (
            inFlight.length !== dispositions.length ||
            dispositions.some((d) => !byId.has(d.rollId))
          ) {
            throw AppError.badRequest(
              `İşlemde ${inFlight.length} top var, ${dispositions.length} dispozisyon ` +
                "gönderildi — liste bu sırada değişti. Sayfayı yenileyip tekrar deneyin.",
            );
          }

          // GUARD 3 — fason dönüşü mal ham stoğa DÖNEMEZ (softDelete invariant'ı).
          for (const d of dispositions) {
            const roll = byId.get(d.rollId)!;
            if (d.action === "STOCK" && roll.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN) {
              throw AppError.badRequest(
                `${roll.barcode ?? "Açık kumaş"}: fason dönüşü top ham stoğa çekilemez — ` +
                  "depo / 2. kalite / fire seçin.",
              );
            }
          }

          // Kalite (opsiyonel) — verilen id'ler aktif katalogda olmalı.
          const qualityIds = Array.from(
            new Set(dispositions.map((d) => d.qualityGradeId).filter((q): q is string => !!q)),
          );
          const qualityById = new Map<string, { id: string; code: string }>();
          if (qualityIds.length > 0) {
            const rows = await tx.qualityGrade.findMany({
              where: { id: { in: qualityIds }, isActive: true },
              select: { id: true, code: true },
            });
            if (rows.length !== qualityIds.length) {
              throw AppError.badRequest("Seçilen kalite bulunamadı veya aktif değil");
            }
            for (const q of rows) qualityById.set(q.id, q);
          }

          // 1) DEVİR — üretim yeni (devam) iş emrinde sürsün.
          const transferRolls = dispositions
            .filter((d) => d.action === "TRANSFER")
            .map((d) => byId.get(d.rollId)!);
          if (transferRolls.length > 0) {
            transferredWoNumber = await this.transferRollsToNewWorkOrderTx(tx, {
              sourceWorkOrderId: id,
              rolls: transferRolls,
              stepSeqById,
              orderMode: data.transferOrderMode ?? "stock",
              userId,
            });
            for (const r of transferRolls) {
              appliedRows.push({
                rollId: r.id,
                barcode: r.barcode,
                from: r.status,
                to: r.status,
                action: "TRANSFER",
              });
            }
          }

          // 2) STATÜ DİSPOZİSYONLARI (tx içinde SIRALI — Promise.all yasak).
          for (const d of dispositions) {
            if (d.action === "TRANSFER") continue;
            const roll = byId.get(d.rollId)!;
            const target = DISPOSITION_STATUS[d.action];

            // Açık movement'ları FİZİKSEL çıkışla kapat (softDelete'in "hiç olmadı"
            // semantiği DEĞİL). notes = sebep kodu.
            //
            // qtyOut = movement'ın KENDİ qtyIn'i — tambur/kursun finishStep paritesi.
            // `currentQty` ile kapatmak YANLIŞ olurdu: top daha önce Tambur'da
            // kesilmişse (currentQty < qtyIn) aradaki fark istasyon iş-hacmi
            // raporunda HAYALET KAYIP gibi görünürdü (800 girdi / 700 çıktı).
            // qtyIn ölçülmemişse (0/null — KK1 kenarı) kalan metraja düşülür.
            const openMoves = await tx.rollMovement.findMany({
              where: { rollId: roll.id, exitedAt: null },
              select: { id: true, qtyIn: true, weightIn: true },
            });
            for (const m of openMoves) {
              const qtyOut =
                m.qtyIn && new Prisma.Decimal(m.qtyIn).greaterThan(0)
                  ? new Prisma.Decimal(m.qtyIn)
                  : roll.currentQty;
              await tx.rollMovement.update({
                where: { id: m.id },
                data: {
                  exitedAt: new Date(),
                  qtyOut,
                  weightOut: m.weightIn ?? roll.weightKg,
                  notes: `WO_CLOSE_${d.action}`,
                },
              });
            }

            // Atomik claim: IN_PRODUCTION + serbest (çuval/sevk yok) iken hedefe çek.
            const rollClaim = await tx.roll.updateMany({
              where: {
                id: roll.id,
                status: RollStatus.IN_PRODUCTION,
                shipmentId: null,
                sackId: null,
              },
              data: { status: target, currentStepId: null },
            });
            if (rollClaim.count === 0) {
              throw AppError.conflict(
                `${roll.barcode ?? "Açık kumaş"} bu sırada başka bir işleme girdi — ` +
                  "yenileyip tekrar deneyin.",
              );
            }

            // "Her kumaşa etiket" (F4): satılabilir final statüde barkodsuz top kalmaz.
            const quality = d.qualityGradeId ? qualityById.get(d.qualityGradeId)! : null;
            const newBarcode =
              roll.barcode == null && SELLABLE_DISPOSITIONS.includes(target)
                ? await generateRollBarcode(tx, finalBarcodeType(target))
                : null;
            if (newBarcode || quality) {
              await tx.roll.update({
                where: { id: roll.id },
                data: {
                  ...(newBarcode ? { barcode: newBarcode } : {}),
                  ...(quality ? { qualityGradeId: quality.id, qualityGrade: quality.code } : {}),
                },
              });
            }

            appliedRows.push({
              rollId: roll.id,
              barcode: newBarcode ?? roll.barcode,
              from: roll.status,
              to: target,
              action: d.action,
            });
          }
        }

        // Bayat açık movement kalmışsa kapat (defansif — WIP yok ama iz temiz olsun).
        await tx.$executeRaw`
          UPDATE roll_movements m
          -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
          -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
          SET "exitedAt" = (now() AT TIME ZONE 'UTC'),
              -- qtyIn ÖNCE (istasyon iş-hacmi paritesi — yukarıdaki dispozisyon
              -- kapanışıyla aynı gerekçe): kesilmiş topta currentQty ile kapatmak
              -- üretim raporunda hayalet kayıp yaratır. qtyIn 0/null ise kalan metraj.
              "qtyOut" = COALESCE(m."qtyOut", NULLIF(m."qtyIn", 0), r."currentQty"),
              "weightOut" = COALESCE(m."weightOut", m."weightIn", r."weightKg"),
              notes = CASE WHEN m.notes IS NULL OR m.notes = '' THEN 'WO_MANUAL_COMPLETE'
                           ELSE m.notes || ' | WO_MANUAL_COMPLETE' END
          FROM rolls r
          WHERE m."rollId" = r.id
            AND m."workOrderStepId" = ANY(${stepIds}::uuid[])
            AND m."exitedAt" IS NULL
        `;

        // Kalan PENDING/ACTIVE adımları SKIPPED — kapatılan WO adımları kuyruk/WIP
        // istatistiklerinde "içeride" sayılmasın (fason-tamamla / iptal ile aynı).
        await tx.workOrderStep.updateMany({
          where: { workOrderId: id, status: { in: [StepStatus.PENDING, StepStatus.ACTIVE] } },
          data: { status: StepStatus.SKIPPED, skipReason: "MANUAL_COMPLETE" },
        });

        // Kurşun bypass: kapanış dispozisyonu WO'yu terminal duruma çeker → açık
        // kurşun dağıtımı anlamsız kalır (Tambur'da okutulacak kart artık yok).
        // `force` gerekçesi iptaldeki ile aynı: adımsız/atlanmış hallerde de temizle.
        // İSTASYON GERİ YÜKLENMEZ — kapanmış movement'ların atfı, tablet akışıyla
        // birebir aynı kalsın (dağıtılan kurşun istasyonu hacmi geriye dönük silinmez).
        await voidStalePendingBypassAssignmentsTx(tx, id, "WO_CLOSE", { force: true });

        // ACTIVE refakat kartları COMPLETED (otomatik-tamamlama yollarıyla aynı).
        await setWorkOrderCardStatuses(tx, id, "ACTIVE", "COMPLETED");

        const done = await tx.workOrder.findUnique({ where: { id } });
        return {
          updated: done!,
          applied: appliedRows,
          transferredWorkOrderNumber: transferredWoNumber,
        };
      }),
    );

    // Audit tx DIŞINDA (best-effort). WO satırı + her top için ayrı iz: kapanış
    // dispozisyonu sabit sebep kodu (`WO_CLOSE_DISPOSITION`) ile ayrıştırılabilir
    // olmalı — 6 ay sonra "bu top depoda ne arıyor" sorusunun cevabı burada.
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "WORK_ORDER",
      recordId: id,
      oldData: { workOrderNumber: existing.workOrderNumber, status: existing.status },
      newData: {
        status: WorkOrderStatus.COMPLETED,
        manualComplete: true,
        ...(applied.length > 0 ? { dispositionCount: applied.length, reason } : {}),
        ...(transferredWorkOrderNumber ? { transferredTo: transferredWorkOrderNumber } : {}),
      },
    });
    for (const a of applied) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        recordId: a.rollId,
        oldData: { status: a.from },
        newData: {
          event: "WO_CLOSE_DISPOSITION",
          action: a.action,
          from: a.from,
          to: a.to,
          barcode: a.barcode,
          workOrderNumber: existing.workOrderNumber,
          ...(a.action === "TRANSFER" && transferredWorkOrderNumber
            ? { transferredTo: transferredWorkOrderNumber }
            : {}),
          reason,
        },
      });
    }

    const messageParts = [`İş emri manuel kapatıldı: ${existing.workOrderNumber}`];
    if (applied.length > 0) messageParts.push(`${applied.length} top için dispozisyon uygulandı`);
    if (transferredWorkOrderNumber) {
      messageParts.push(`devredilen toplar yeni iş emrinde: ${transferredWorkOrderNumber}`);
    }

    return {
      success: true,
      data: updated,
      message: messageParts.join(" — "),
    };
  }

  /**
   * DEVİR (dispozisyon: TRANSFER) — kapanan WO'da işlemi bitmemiş topları YENİ bir
   * (devam) iş emrine taşır. Şablon: workorder-split `undyedMove` (klon + repoint).
   * Toplar `IN_PRODUCTION` KALIR, barkod/kalite değişmez — üretim sürüyor.
   *
   * `reEntryStepSequence` = taşınan topların EN KÜÇÜK adım sırası; klon o adımdan
   * başlar ve sonrasını içerir, böylece her top `oldToNew` ile kendi adımına oturur.
   *
   * `supersedeEmptiedSourceWorkOrderTx` BİLİNÇLİ olarak çağrılmaz: kaynak WO bu
   * çağrıda COMPLETED'a claim edildi; SUPERSEDED'e çekmek claim'i bozar ve "malzemesi
   * devredildi" yanlış anlamını verir (burada malzemenin bir kısmı devrediliyor).
   *
   * Döner: yeni iş emri numarası.
   */
  private async transferRollsToNewWorkOrderTx(
    tx: Prisma.TransactionClient,
    params: {
      sourceWorkOrderId: string;
      rolls: Array<{
        id: string;
        currentStepId: string | null;
        currentQty: Prisma.Decimal | null;
        batchId: string | null;
      }>;
      stepSeqById: Map<string, number>;
      orderMode: "stock" | "keep";
      userId?: string;
    },
  ): Promise<string> {
    const { sourceWorkOrderId, rolls, stepSeqById, orderMode, userId } = params;
    const rollIds = rolls.map((r) => r.id);

    const sequences = rolls.map((r) => stepSeqById.get(r.currentStepId as string));
    if (sequences.some((s) => s === undefined)) {
      throw AppError.conflict("Devredilecek top bu iş emrinin bir adımında değil — listeyi yenileyin");
    }
    const reEntryStepSequence = Math.min(...(sequences as number[]));
    const movedTotalQty = rolls.reduce((s, r) => s + Number(r.currentQty ?? 0), 0);

    const src = await tx.workOrder.findUnique({
      where: { id: sourceWorkOrderId },
      select: { targetColorId: true },
    });

    const { newWo, oldToNew, newReEntryStepId } = await cloneWorkOrderTx(tx, {
      sourceWorkOrderId,
      reEntryStepSequence,
      targetColorId: src?.targetColorId ?? null,
      orderMode,
      movedTotalQty,
      userId,
    });

    // Her top KENDİ adımının klonuna taşınır (hepsi aynı adımda olmak zorunda değil).
    for (const roll of rolls) {
      const newStepId = oldToNew.get(roll.currentStepId as string);
      if (!newStepId) {
        throw AppError.conflict("Yeni iş emrinde hedef adım bulunamadı (rota kopyası tutarsız)");
      }
      const claim = await tx.roll.updateMany({
        where: {
          id: roll.id,
          status: RollStatus.IN_PRODUCTION,
          currentStepId: roll.currentStepId,
          shipmentId: null,
          sackId: null,
        },
        data: { currentStepId: newStepId },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Devredilecek top bu sırada değişti — yenileyip tekrar deneyin");
      }
    }

    // Ayak izi (movement/operation/error) yeni WO'nun adımlarına repoint — aksi hâlde
    // kaynak WO'nun adımları "hâlâ bekleyen top var" sanır.
    await repointRollsTx(tx, rollIds, oldToNew);

    // Kısmi seçim olduğu için parti TAŞINMAZ: yeni WO'da yeni parti doğar, kaynak
    // parti izsiz boşaldıysa silinir (manual-move'un kısmi taşıma yolu ile aynı).
    const sourceBatchIds = Array.from(
      new Set(rolls.map((r) => r.batchId).filter((b): b is string => !!b)),
    );
    await createBatchTx(tx, {
      workOrderId: newWo.id,
      rollIds,
      splitFromId: sourceBatchIds.length === 1 ? sourceBatchIds[0] : null,
      userId,
    });
    for (const batchId of sourceBatchIds) {
      await deleteIfEmptyAndTraceless(tx, batchId);
    }

    await recomputeStepStatus(tx, newReEntryStepId);

    return newWo.workOrderNumber;
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
          -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
          -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
          SET "exitedAt" = (now() AT TIME ZONE 'UTC'),
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
        // clientToken serbest bırakılır: zero-attach telafisi sonrası operatör
        // AYNI form oturumundan (aynı token) düzeltip tekrar denediğinde taze
        // create arşivli WO'nun token'ına çarpmasın.
        data: { isActive: false, clientToken: null },
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
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
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

        // 3) Atomik bulk claim — status guard race condition'ı yakalar. RETURNING
        //    ile FİİLEN BİZİM kazandığımız id'ler döner.
        //
        //    NEDEN updateManyAndReturn (yeniden-sorgu DEĞİL): eskiden count
        //    beklenenden azsa kazanan küme `{id in candidateIds, status:
        //    IN_PRODUCTION, producedInStepId: firstStepId}` ile TAHMİN ediliyordu.
        //    Bu filtre eşzamanlı ikinci bir attach çağrısının AYNI adıma commit
        //    ettiği topu bizden ayırt edemez (READ COMMITTED'de commit'li satır
        //    görünür) → başkasının topu bizim kümemize sızardı. Sonuç: aşağıdaki
        //    rollMovement.createMany `roll_movements_one_open_per_roll_step_uq`
        //    partial unique'ine çarpar (P2002) ve TÜM tx düşer — operatör temiz
        //    "başka işlemde değişti" mesajı yerine 500 görürdü; ayrıca
        //    createBatchTx sahibi olmadığımız topa batchId damgalardı.
        const claimed = await tx.roll.updateManyAndReturn({
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
          select: { id: true },
        });

        // 4) Kaybedilen toplar (varsa) tek tek raporlanır.
        const claimedIds = new Set(claimed.map((r) => r.id));
        const succeeded =
          claimedIds.size === candidates.length
            ? candidates
            : candidates.filter((r) => claimedIds.has(r.id));
        if (claimedIds.size !== candidates.length) {
          for (const r of candidates) {
            if (!claimedIds.has(r.id)) {
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
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
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
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
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
      // Kart snapshot'ı bu alanları DONDURUYOR (ürün/renk/en/miktar/kat/tarihler) —
      // WO değişince eldeki kâğıt yanlışlanır. Snapshot yalnız `reprint` ile tazelenir.
      await markTravelerCardDirtyTx(tx, id);
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
      existing.status === WorkOrderStatus.CANCELLED ||
      existing.status === WorkOrderStatus.SUPERSEDED
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
          status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
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
            `${old.stepSequence}. adım silinemez — bu adıma bağlı rulo, hareket, sevk veya kurşun dağıtım kaydı var.`,
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

      // `replace` rotayı, sipariş bağlarını ve hedef özellikleri baştan yazar —
      // kart snapshot'ındaki adım listesi/sipariş tablosu topluca yanlışlanır.
      await markTravelerCardDirtyTx(tx, id);

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

      // Hedef özellikler kartın "İSTENEN ÖZELLİKLER" bloğunda basılı.
      await markTravelerCardDirtyTx(tx, id);

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
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
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
        workOrder: { status: { notIn: [WorkOrderStatus.COMPLETED, WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } },
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
    // Planlanan fasoncu kartın OPERASYON tablosunda basılı ("Boyahane (Fason) —
    // Yıldız Boyahane"). Bu metodun tx'i YOK (tek atomik claim); helper `prisma`
    // ile de çalışır — işaret bağımsız ve idempotent, claim'e bağlı değil.
    await markTravelerCardDirtyTx(prisma, workOrderId);

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
      wo.status === WorkOrderStatus.CANCELLED ||
      wo.status === WorkOrderStatus.SUPERSEDED
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
        -- O-11: tz'siz kolona UTC yaz (çıplak NOW() yerel saat yazar → Prisma'nın
        -- UTC'siyle aynı tabloda iki saat olur, süre raporu +3sa şişer).
        SET "exitedAt" = (now() AT TIME ZONE 'UTC'),
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
   * BİR İŞ EMRİNİN TÜM BELGELERİ — tek liste, tek sözleşme.
   *
   * Neden ayrı uç: belgeler dört ayrı kaynakta yaşıyor (TravelerCard + üç
   * PrintedDocument tipi) ve `findById` yalnız `steps[].dispatches`'i taşıyor.
   * Sonuç: fason **kabul makbuzu** ve **fasondan doğrudan sevk irsaliyesi** iki
   * istemcide de iş emrinden ULAŞILAMIYORDU — belge vardı, kapısı yoktu.
   * İstemciler artık bu listeyi basar; yeni bir belge tipi eklendiğinde tek yer
   * güncellenir (aksi halde her istemci kendi listesini kurar ve ayrışırlar).
   *
   * ⚠️ İPTAL EDİLMİŞ belgeler LİSTEDE KALIR (`cancelled: true`). Donmuş belge
   * silinmez, VOIDED'e çekilir ve baskıda İPTAL filigranı alır — dosyaya bakan
   * kişi onu yeniden basabilmeli. İstemci rozetle ayırır. (Electron'un eski
   * Belgeler diyaloğu iptalleri gizliyor; bu uca geçtiğinde davranış birleşir.)
   *
   * Sıralama: kart önce (iş emri belgesi), sonra fason belgeleri TARİH DESC —
   * sahada en çok aranan "en son basılan"dır.
   */
  async getDocuments(workOrderId: string): Promise<ApiResponse<unknown>> {
    const wo = await prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, workOrderNumber: true },
    });
    if (!wo) throw AppError.notFound("İş emri bulunamadı");

    // Dört kaynak paralel değil SERİ okunur (pg adapter tek connection —
    // `Promise.all([tx.*])` yasağıyla aynı gerekçe; burada tx yok ama havuz
    // davranışı için de seri okumak güvenli ve fark ölçülemez: 4 küçük sorgu).
    const card = await prisma.travelerCard.findUnique({
      where: { workOrderId },
      select: { id: true, cardNumber: true, printedAt: true, version: true, status: true, contentDirty: true },
    });

    const dispatches = await prisma.subcontractorDispatch.findMany({
      where: { workOrderId },
      orderBy: { dispatchedAt: "desc" },
      select: {
        id: true,
        dispatchNo: true,
        dispatchedAt: true,
        totalQty: true,
        cancelledAt: true,
        directShippedAt: true,
        subcontractor: { select: { name: true } },
        batch: { select: { batchNumber: true } },
        step: { select: { stepSequence: true, station: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });

    const receipts = await prisma.subcontractorReceipt.findMany({
      where: { workOrderId },
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        receiptNo: true,
        manifestNo: true,
        receivedAt: true,
        cancelledAt: true,
        subcontractor: { select: { name: true } },
        step: { select: { stepSequence: true, station: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });

    // Doğrudan sevk WO'ya DOLAYLI bağlı (DirectShipment → dispatch → workOrder).
    const directShipments = dispatches.length
      ? await prisma.directShipment.findMany({
          where: { dispatchId: { in: dispatches.map((d) => d.id) } },
          orderBy: { shippedAt: "desc" },
          select: {
            id: true,
            shipmentNo: true,
            shippedAt: true,
            totalQty: true,
            customer: { select: { name: true } },
            dispatch: { select: { step: { select: { station: { select: { name: true } } } } } },
          },
        })
      : [];

    const docs: Record<string, unknown>[] = [];

    if (card) {
      docs.push({
        docType: "TRAVELER_CARD",
        sourceId: card.id,
        documentNo: card.cardNumber,
        date: card.printedAt.toISOString(),
        group: "İş Emri Belgeleri",
        title: "Refakat Kartı",
        subtitle: `v${card.version} · Üretim sahasında topla birlikte dolaşır`,
        cancelled: card.status === "VOIDED",
        // İstemci "güncel değil" rozetini bu alandan basar (bkz. contentDirty).
        contentDirty: card.contentDirty,
      });
    }

    for (const d of dispatches) {
      const station = d.step?.station?.name ?? "Fason";
      docs.push({
        docType: "SUBCONTRACTOR_DISPATCH",
        sourceId: d.id,
        documentNo: d.dispatchNo,
        date: d.dispatchedAt.toISOString(),
        group: station,
        title: "Fason Sevk İrsaliyesi",
        subtitle: [
          d.subcontractor?.name,
          d.batch?.batchNumber ? `Parti ${d.batch.batchNumber}` : null,
          `${d._count.items} top · ${Number(d.totalQty)} m`,
        ]
          .filter(Boolean)
          .join(" · "),
        cancelled: d.cancelledAt != null,
      });
    }

    for (const r of receipts) {
      const station = r.step?.station?.name ?? "Fason";
      docs.push({
        docType: "SUBCONTRACTOR_RECEIPT",
        sourceId: r.id,
        documentNo: r.receiptNo,
        date: r.receivedAt.toISOString(),
        group: station,
        title: "Fason Kabul Makbuzu",
        subtitle: [
          r.subcontractor?.name,
          r.manifestNo ? `Fason İrs. ${r.manifestNo}` : null,
          `${r._count.items} top`,
        ]
          .filter(Boolean)
          .join(" · "),
        cancelled: r.cancelledAt != null,
      });
    }

    for (const ds of directShipments) {
      docs.push({
        docType: "SUBCONTRACTOR_DIRECT_SHIP",
        sourceId: ds.id,
        documentNo: ds.shipmentNo,
        date: ds.shippedAt.toISOString(),
        group: ds.dispatch?.step?.station?.name ?? "Fason",
        title: "Fasondan Sevk İrsaliyesi",
        subtitle: [ds.customer?.name, `${Number(ds.totalQty)} m`].filter(Boolean).join(" · "),
        // Doğrudan sevk terminaldir — iptal yolu yok (buildFasonDirectShipDoc da
        // `voidInfo: null` der); alan sözleşme bütünlüğü için sabit false.
        cancelled: false,
      });
    }

    return {
      success: true,
      data: { workOrderNumber: wo.workOrderNumber, documents: docs },
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
