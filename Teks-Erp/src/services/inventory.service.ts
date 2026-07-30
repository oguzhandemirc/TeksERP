// =============================================================================
// TeksERP - Inventory Service
// =============================================================================
// Handles initial goods receipt (Ham Mal Girişi / QC1) and inventory queries.
// Business Rule: Rolls default to STOCK status. IN_PRODUCTION rolls
// are excluded from inventory queries unless explicitly filtered.
// =============================================================================

import prisma from "../lib/prisma";
import { AuditService } from "./audit.service";
import { AppError } from "../utils/app-error";
import { isClientTokenP2002 } from "../utils/p2002";
import { ApiResponse, PaginatedResponse, QueryParams } from "../types/api.types";
import { resolveQualityGradeIdStrict } from "./helpers/quality-grade.helper";
import { readKk1WeightEntryEnabled } from "./system-setting.service";
import {
  parseQueryParams,
  buildWhereClause,
  buildOrderByClause,
  buildPagination,
  isCursorRequested,
  applyDateRange,
  resolveSortBy,
  buildTurkishSearch,
} from "../utils/query-parser";

const ROLL_DATE_FIELDS = ["createdAt"] as const;

// Rolls listesinde sıralanabilir kolonlar (UI SortableHeader'larıyla eşleşir) +
// createdAt/id kararlı tie-break. Whitelist dışı sortBy → createdAt'e düşer
// (bilinmeyen kolon 500'ünü ve indekssiz keyfi sortu engeller).
const ROLL_SORTABLE_FIELDS = [
  "createdAt",
  "updatedAt",
  "barcode",
  "currentQty",
  "initialQty",
  "width",
  "qualityGrade",
  "status",
] as const;

function readList(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.length > 0) {
    return value.split(",").map((v) => v.trim()).filter(Boolean);
  }
  return [];
}

function readNumberRange(
  min: string | string[] | undefined,
  max: string | string[] | undefined
): { gte?: number; lte?: number } | null {
  const range: { gte?: number; lte?: number } = {};
  const lo = typeof min === "string" ? parseFloat(min) : NaN;
  const hi = typeof max === "string" ? parseFloat(max) : NaN;
  if (Number.isFinite(lo)) range.gte = lo;
  if (Number.isFinite(hi)) range.lte = hi;
  return Object.keys(range).length > 0 ? range : null;
}
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import type { CursorPaginatedResponse } from "./base.service";
import { Request } from "express";
import {
  Prisma,
  Roll,
  RollStatus,
  RollOperationType,
  RollEntrySource,
  RollForm,
  ItemType,
  StationKind,
  StepStatus,
  WorkOrderStatus,
  ShipmentStatus,
} from "@prisma/client";
import {
  ensureWorkOrderInProgress,
  openMovementForNextStep,
  recomputeStepStatus,
  completeWorkOrderIfStepsDone,
} from "./helpers/roll-step.helper";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { copyStationCapabilitiesToRoll } from "./helpers/station-capability-transfer.helper";
import { touchWarehouseSackTx } from "./helpers/shipment-locks.helper";
import { generateRollBarcode, type RollBarcodeType } from "./helpers/roll-barcode.helper";
import { finalizeRollsAtLastStep, finalBarcodeType } from "./helpers/roll-finalize.helper";
import { matchesPermission } from "../middlewares/rbac.middleware";

export interface RollStats {
  totalCount: number;
  /** Filtreye uyan tüm rolların `currentQty` toplamı — metre. */
  totalQty: number;
  /** Filtreye uyan tüm rolların `weightKg` toplamı — kg (null'lar atlanır). */
  totalWeight: number;
  /** RollStatus → adet. Filtreye uyan status'ler için 0+ döner; eşleşmeyen status hiç yer almaz. */
  byStatus: Record<string, number>;
  /** qualityGrade kodu → adet (A1, FIRE, 1.KALITE, …). */
  byQuality: Record<string, number>;
}

/** Fasonda özet şeridi — GET /api/rolls/subcontractor-summary cevabı. */
export interface RollSubcontractorSummary {
  /** Firma kartları. subcontractorId=null → açık sevk kalemi bulunamayan
   *  AT_SUBCONTRACTOR top (veri anomalisi) — "Bilinmiyor" kartı. */
  bySubcontractor: Array<{
    subcontractorId: string | null;
    name: string;
    code: string | null;
    rollCount: number;
    /** Σ currentQty (mt) — 1 ondalık (F85 yuvarlama kuralı). */
    totalQty: number;
    oldestDispatchedAt: Date | null;
    /** En eski açık sevkin yaşı (gün, floor) — "en eski N gün". */
    oldestDays: number | null;
  }>;
  /** İşlem-tipi chip'leri. categoryId=null → "Bilinmiyor" (kategorisiz adım + anomali).
   *  Her top tam BİR gruba düşer → "Tümü" chip'i = Σ byCategory. */
  byCategory: Array<{
    categoryId: string | null;
    name: string;
    rollCount: number;
    totalQty: number;
  }>;
  /** Evren toplamı — frontend "Tümü" chip'i + boş-durum gate'i bunu okur. */
  total: {
    rollCount: number;
    totalQty: number;
  };
}

/**
 * İstasyonda takılı (IN_PRODUCTION) top için kurtarma önizlemesi (salt-okunur).
 * eligible yalnız IN_PRODUCTION topta true; açık fason sevki blockReasons'a düşer.
 */
export interface RescuePreview {
  rollId: string;
  barcode: string | null;
  itemName: string;
  currentStatus: RollStatus;
  eligible: boolean;
  blockReasons: string[];
  stationName: string | null;
  openMovementCount: number;
  willGenerateBarcode: boolean;
}

export type RollHistoryEventKind =
  | "CREATED"
  | "MOVEMENT_IN"
  | "MOVEMENT_OUT"
  | "OPERATION"
  | "SUBCONTRACTOR_DISPATCH"
  | "SUBCONTRACTOR_RECEIPT";

export interface RollHistoryEvent {
  kind: RollHistoryEventKind;
  subKind?: string;
  at: string;
  title: string;
  stationName: string | null;
  details: Record<string, unknown>;
  operatorName: string | null;
}

export interface RollHistoryPayload {
  roll: {
    id: string;
    /// Açık kumaş Roll'larında NULL olabilir (etiket basılmaz).
    barcode: string | null;
    status: RollStatus;
    initialQty: number;
    currentQty: number;
    weightKg: number | null;
    item: { id: string; code: string; name: string; itemType: string } | null;
    color: { id: string; code: string; name: string; hex: string | null } | null;
  };
  events: RollHistoryEvent[];
}

/**
 * Yeniden-Etiketleme istasyonu — "B" müşteri adayı. Topu üreten iş emrinin
 * bağlı sipariş satırlarından distinct müşteriler; operatöre "etiket bu müşteri
 * için yeniden bas" önerisi olarak sunulur. orderLineId = o müşterinin temsil
 * sipariş satırı (müşteriye özel ad override'ı varsa bundan çözülür).
 */
export interface RelabelCandidateCustomer {
  customerId: string;
  customerCode: string;
  customerName: string;
  orderLineId: string;
  orderNumber: string;
}

/**
 * Yeniden-Etiketleme istasyonu için zengin top bağlamı — `findRollByBarcode`'un
 * lean lookup'ından AYRI: relabel formunun seed'i (renk/kalite/en/özellik),
 * konum/guard (sevkiyat/çuval), son basıldığı yer ("A") ve "B" adayları.
 */
export interface RelabelContext {
  id: string;
  barcode: string | null;
  status: RollStatus;
  entrySource: string;
  itemId: string;
  item: { id: string; code: string; name: string };
  colorId: string | null;
  color: { id: string; code: string; name: string; hex: string | null } | null;
  /** Donmuş kalite snapshot string'i (örn "1.KALITE"); kaliteye bakılmamış açık
   *  kumaşta null — relabel PATCH'i bunu yazar. */
  qualityGrade: string | null;
  qualityGradeId: string | null;
  qualityGradeRef: { id: string; code: string; name: string; color: string | null } | null;
  width: number | null;
  currentQty: number;
  weightKg: number | null;
  markedForKartela: boolean;
  /** Etiket bayat mı — veri/metraj düzeltilmiş ama fiziksel etiket yeniden basılmamış → true. */
  labelDirty: boolean;
  /** Topta hâlihazırda damgalı özellikler — relabel formu TAM liste olarak replace eder. */
  properties: { id: string; code: string; name: string; color: string | null }[];
  propertyIds: string[];
  /** Son basılan etiketin künyesi ("A": kime/hangi sipariş/ne zaman) — null=hiç basılmadı/stok. */
  lastLabelSnapshot: Prisma.JsonValue | null;
  /** Atanmış sevkiyat — varsa spec düzenleme kilitlenir (backend de 409). */
  shipment: { id: string; shipmentNo: string; status: ShipmentStatus } | null;
  /** Bulunduğu çuval — sevkiyattaysa (shipmentId) spec düzenleme kilitlenir. */
  sack: { id: string; sackNo: string; seq: number | null; shipmentId: string | null } | null;
  /** Spec düzenleme kilitli mi (atanmış sevkiyat / sevkiyattaki çuval) — frontend kolaylığı; backend guard ayrıca enforce eder. */
  specLocked: boolean;
  /** "B" önerileri — topu üreten WO'nun bağlı siparişlerinden distinct müşteriler. */
  candidateCustomers: RelabelCandidateCustomer[];
}

/**
 * Top iptal (soft-delete) önizlemesi — operatöre silmeden ÖNCE gösterilir.
 * Yıkıcı işlem kuralı: somut etki (top hangi istasyonda/iş emrinde aktif)
 * net listelenir, soyut "X kayıt etkilenecek" yetmez. softDelete'in guard
 * sırasıyla birebir aynı mantık döner.
 */
export interface RollCancelPreview {
  rollId: string;
  barcode: string | null;
  status: RollStatus;
  itemName: string | null;
  colorName: string | null;
  initialQty: number;
  width: number | null;
  /** Hard-block yoksa true — operatör (gerekirse onaylayarak) iptal edebilir. */
  canCancel: boolean;
  /** canCancel=false ise neden (Türkçe, softDelete mesajıyla aynı). */
  blockReason: string | null;
  /**
   * İstasyonda / iş emrinde aktif top mu? true ise iptal için bilinçli onay
   * (confirmActive) ŞART — uyarısız sessiz iptali engeller.
   */
  requiresConfirm: boolean;
  /** Aktifse şu an nerede (istasyon + iş emri). */
  activeAt: {
    stepId: string;
    stationName: string | null;
    stationKind: StationKind | null;
    workOrderId: string;
    batchNumber: string | null;
  } | null;
  /** Kapanmamış (açık) hareket sayısı. */
  openMovementCount: number;
}

function operationLabel(type: RollOperationType): string {
  switch (type) {
    case "KURSUN_APPLIED":
      return "Kurşun Uygulandı";
    case "QC2_COMPLETED":
      return "QC2 Tamamlandı";
    case "TAMBUR_PROCESSED":
      return "Tambur İşlendi";
    case "SUBCONTRACTOR_SENT":
      return "Fasona Gönderildi";
    case "SUBCONTRACTOR_RETURNED":
      return "Fasondan Döndü";
    default:
      return type;
  }
}

/**
 * F112: Operatör iptalinin (softDelete) izin verdiği statü beyaz listesi.
 * Yalnız operasyonel (henüz sevk/tüketim muhasebesi işlenmemiş) toplar iptal
 * edilebilir. SHIPPED / *_CONSUMED / AT_KARTELA / AT_SUBCONTRACTOR bu listede
 * DEĞİL — bunların geri alınması ilgili modülün işidir (iade, fason/kartela
 * kabul), yoksa sevk edilmiş mal canlı veride "hiç olmamış" olur.
 * softDelete ve getCancelPreview bu tek kaynağı paylaşır (guard paritesi).
 */
const CANCELABLE_ROLL_STATUSES: RollStatus[] = [
  RollStatus.STOCK,
  RollStatus.IN_PRODUCTION,
  RollStatus.A1_STOCK,
  RollStatus.WAREHOUSE,
  RollStatus.RETURNED_FROM_SUBCONTRACTOR,
];

/** İptal edilemeyen statü için operatöre net Türkçe gerekçe. */
function nonCancelableRollReason(status: RollStatus): string {
  switch (status) {
    case RollStatus.SHIPPED:
      return "Bu top müşteriye sevk edilmiş — iptal edilemez. Geri almak için İade akışını kullanın.";
    case RollStatus.TAMBUR_CONSUMED:
      return "Bu top Tambur'da bölünüp çocuk toplara dönüştürülmüş — iptal edilemez.";
    case RollStatus.KARTELA_CONSUMED:
      return "Bu top kartelalara bölünüp kapatılmış — iptal edilemez.";
    case RollStatus.SUBCONTRACTOR_CONSUMED:
      return "Bu top fason kabulde kapatılmış — iptal edilemez.";
    case RollStatus.AT_KARTELA:
      return "Bu top kartela fasonunda işlemde — iptal edilemez, önce kartela kabulü yapın.";
    default:
      return `Bu top '${status}' durumunda — iptal edilemez.`;
  }
}

// Rulo liste/kart cevabının ortak include'u — findAllRolls (liste) ve
// getProductionFlow (Üretim Akışı kartları) AYNI şekli döndürsün diye tek kaynak.
// Detay paneli (RollDetailSheet) bu şekli anlık gösterim + fallback için okur,
// ağırı (`operations`, iade, kartela) `/api/rolls/:id` ile lazy çeker. Enum ÜYESİ
// içermez → modül-yükleme TDZ riski yok (top-level'da RollStatus deref edilmez).
const ROLL_LIST_INCLUDE = {
  item: { select: { id: true, code: true, name: true, itemType: true, unit: true } },
  color: { select: { id: true, code: true, name: true, hex: true } },
  operations: { select: { operationType: true } },
  createdBy: { select: { id: true, username: true, fullName: true } },
  properties: {
    select: {
      propertyId: true,
      property: { select: { id: true, code: true, name: true } },
    },
  },
  shipment: { select: { id: true, shipmentNo: true, status: true } },
  sack: { select: { id: true, sackNo: true, seq: true } },
  // Fasonda görünürlüğü: topun AÇIK (dönmemiş) son fason sevk kalemi — liste
  // "İşlem" + "Fason Firması" kolonlarını besler. Açık-kalem tanımı F85 ile
  // birebir (iptalsiz + doğrudan-sevksiz dispatch + aktif receipt-item'ı yok)
  // → dönmüş/eski topta dizi BOŞ döner; kartela emsalinden (findRollById
  // kartelaDispatchItems) farkı receipt-none koşulu: bu include TÜM sekmelerce
  // paylaşıldığı için dönmüş STOCK topunda bayat firma göstermemek ŞART.
  // take:1 → Prisma sayfa başına tek LATERAL sorgu (N+1 yok); rollId +
  // sourceDispatchItemId indeksli, anti-join ucuz.
  dispatchItems: {
    where: {
      dispatch: { cancelledAt: null, directShippedAt: null },
      receiptItems: { none: { receipt: { cancelledAt: null } } },
    },
    // "En güncel açık kalem" — özet ucu (getRollSubcontractorSummary open_items)
    // ile hizalı: dispatch.dispatchedAt DESC. Bir topun iki açık kalemi zorunlu
    // olarak iki AYRI dispatch'te (farklı dispatchedAt) olur (@@unique dispatchId,
    // rollId) → tek anahtar en güncel kalemi kesin seçer; kolon/detay ile şerit
    // kartı çoklu-açık-kalem anomalisinde AYNI firmayı gösterir.
    orderBy: { dispatch: { dispatchedAt: "desc" } },
    take: 1,
    select: {
      dispatch: {
        select: {
          dispatchNo: true,
          dispatchedAt: true,
          // "İşlem" (kategori) kaynağı: adımın requiredCategory'si BOŞ olabilir
          // (rota tasarımında girilmemiş) → firmanın kendi kategorisine düşülür
          // (firma tek kategoriliyse). Frontend activeCategoryOf() bu iki alandan
          // türetir; özet ucu + filtre de aynı COALESCE(step, firma-tek-kategori)
          // tanımını paylaşır.
          subcontractor: {
            select: {
              id: true,
              name: true,
              code: true,
              categories: { select: { category: { select: { id: true, name: true } } } },
            },
          },
          step: { select: { requiredCategory: { select: { id: true, name: true } } } },
        },
      },
    },
  },
} as const;

// --- Üretim Akışı (Kanban) panosu — tek-istek aggregate şekli --------------
/** Kurşun/Tambur kolonları için parti (refakat kartı) kartı. */
export interface ProductionFlowQueueCard {
  id: string;
  itemName: string | null;
  colorName: string | null;
  colorHex: string | null;
  openRollCount: number;
  totalCurrentQty: number;
  workOrderNumber: string;
  isUrgent: boolean;
}

/** Sevk kolonu kartı — çıkış bekleyen (PLANNED) planlı sevk. */
export interface ProductionFlowSackCard {
  id: string;
  shipmentNo: string;
  customer: { id: string; name: string };
  branch: { id: string; name: string } | null;
  sackCount: number;
  totalKg: number;
  totalQty: number;
}

/** Her kolon: en fazla 10 önizleme kaydı + gerçek toplam sayaç. */
export interface ProductionFlowData {
  hamStok: { rolls: Roll[]; total: number };
  fason: { rolls: Roll[]; total: number };
  kursun: { cards: ProductionFlowQueueCard[]; total: number };
  tambur: { cards: ProductionFlowQueueCard[]; total: number };
  depo: { rolls: Roll[]; total: number };
  sevk: { shipments: ProductionFlowSackCard[]; total: number };
}

export class InventoryService {
  /**
   * Initial goods receipt — creates a new Roll in STOCK status.
   *
   * Fabrikaya gelen ham kumaş girişi: barkod + temel meta veri. Top hep STOCK'a
   * düşer; iş emrine bağlama daha sonra `attach-rolls` ile yapılır.
   */
  async createInitialEntry(
    data: {
      itemId: string;
      colorId?: string | null;
      initialQty: number;
      weightKg?: number;
      qualityGrade?: string;
      width?: number | null;  // En (cm) — opsiyonel, ölçülmediyse null
      propertyIds?: string[];
      /**
       * Opsiyonel idempotency anahtarı (UUID) — offline KK1 / ağ-retry için mobil
       * üretir. Barkod artık SUNUCU'da sıralı atandığından (T+GGAAYY+H/F+NNNN)
       * dedup barkodla değil bu token'la yapılır: Roll.clientToken @unique → aynı
       * token'la 2. çağrı cached Roll döner. Verilmezse (backend-içi çağrı) dedup yok.
       */
      clientToken?: string;
    },
    userId?: string,
    /** KK1 makine atfı — aktif çalışma oturumundan (controller çözer). KK1 girişi
     *  RollOperation üretmediği için atıf Roll.createdMachineId üstünde kapanır. */
    machineId?: string | null,
    /** İsteğin kaynağı — eşleşmiş mobil cihazdan mı (KK1 istasyon taraması) geldi,
     *  yoksa Electron admin panelinden mi ("Manuel Top Ekle")? entrySource bunu
     *  ayırt eder (controller `Boolean(req.device)` ile çözer — Electron ASLA
     *  x-device-id göndermez). */
    isMobileOrigin?: boolean
  ): Promise<ApiResponse<Roll>> {
    // KK1 istasyonunda ağırlık (kg) girişi admin ayarıyla kapatılabilir (default kapalı).
    // UI alanı gizlemek yetmez — kapalıyken gelen ağırlık payload'ını (yanlışlıkla ya da
    // kötü niyetle) backend REDDEDER. Tüm istemcilerin (mobil + Electron + script) tek
    // choke-point'i burası (defense-in-depth). Zod weightKg'yi pozitif zorunlu kıldığından
    // >0 kontrolü, undefined/eksik girişleri serbest bırakır.
    if ((data.weightKg ?? 0) > 0 && !(await readKk1WeightEntryEnabled())) {
      throw AppError.badRequest("Ağırlık (kg) girişi bu istasyonda kapalı");
    }

    // Ürün var VE aktif olmalı. Soft-delete (isActive=false) edilmiş ürünle
    // giriş yapılamaz — picker pasifleri gizler ama önceden seçili/persist
    // edilmiş itemId backend'e kadar gelebiliyordu (renk/özellik kontrolleriyle
    // aynı sertlik).
    const item = await prisma.item.findUnique({
      where: { id: data.itemId },
      select: { id: true, isActive: true },
    });
    if (!item || !item.isActive) {
      throw AppError.notFound("Ürün bulunamadı veya pasif (silinmiş)");
    }

    // Renk verilmişse: var ve aktif olmalı + Item'ın allowed listesindeyse listede
    if (data.colorId) {
      const color = await prisma.color.findUnique({
        where: { id: data.colorId },
        select: { id: true, isActive: true },
      });
      if (!color || !color.isActive) {
        throw AppError.notFound("Renk bulunamadı veya pasif");
      }
      const allowedCount = await prisma.itemAllowedColor.count({
        where: { itemId: data.itemId },
      });
      if (allowedCount > 0) {
        const inAllowed = await prisma.itemAllowedColor.findUnique({
          where: { itemId_colorId: { itemId: data.itemId, colorId: data.colorId } },
        });
        if (!inAllowed) {
          throw AppError.badRequest(
            "Seçilen renk bu ürüne uygulanabilir renk listesinde değil",
          );
        }
      }
    }

    // Özellikler: dedupe, var ve aktif olmalı + Item'ın allowed listesindeyse listede
    const dedupedProps = [...new Set(data.propertyIds ?? [])];
    if (dedupedProps.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedProps }, isActive: true },
        select: { id: true },
      });
      if (props.length !== dedupedProps.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
      const allowedPropCount = await prisma.itemAllowedProperty.count({
        where: { itemId: data.itemId },
      });
      if (allowedPropCount > 0) {
        const inAllowed = await prisma.itemAllowedProperty.findMany({
          where: { itemId: data.itemId, propertyId: { in: dedupedProps } },
          select: { propertyId: true },
        });
        if (inAllowed.length !== dedupedProps.length) {
          throw AppError.badRequest(
            "Seçilen özelliklerden biri bu ürüne uygulanabilir listesinde değil",
          );
        }
      }
    }

    // Barkod SUNUCU'da sıralı atanır (tx içinde generateRollBarcode) — offline istemci
    // sırayı bilemez. Tip damgası: renkli manuel giriş = hazır/işlenmiş → depoya → "F"
    // (final kumaş); renksiz = ham (üretime girer) → "H". Mükerrer-top koruması artık
    // clientToken (@unique) ile — barkod DEDUP ANCHOR'I DEĞİL (aşağıdaki catch).
    const rollType: RollBarcodeType = data.colorId != null ? "F" : "H";

    // Mobil KK1 istasyonundan (eşleşmiş cihaz) mı, Electron admin'den elle mi
    // girildi — "Ham Giriş" / "Manuel Giriş" ayrımı raporlama için kritik.
    const entrySource: RollEntrySource = isMobileOrigin
      ? RollEntrySource.SUPPLIER_RECEIPT
      : RollEntrySource.MANUAL_ENTRY;

    // Operatör explicit kalite verdiyse SIKI doğrula (katalog + aktif —
    // soft-delete giriş guard'ı; typo'lu kod byQuality istatistiklerini
    // parçalayıp FIRE-dışlama string filtresinden kaçıyordu).
    // Kalite VERİLMEDİYSE (boş/whitespace) → qualityGrade + qualityGradeId null
    // kalır (kaliteye bakılmadı); artık sabit "1.KALITE" default'u yazılmaz.
    const trimmedQuality = data.qualityGrade?.trim();
    const qualityGradeCode = trimmedQuality || null;
    const qualityGradeId = trimmedQuality
      ? await resolveQualityGradeIdStrict(trimmedQuality)
      : null;

    // Renkli manuel giriş = hazır/işlenmiş kumaş (dışarıdan boyalı/işlemli geldi),
    // doğrudan depoya gider. Renksiz giriş = ham kumaş, üretim akışına girecek
    // (STOCK'ta bekler, KK1/Kurşun/Tambur'da işlenir).
    const initialStatus =
      data.colorId != null ? RollStatus.WAREHOUSE : RollStatus.STOCK;

    let roll: Awaited<ReturnType<typeof prisma.roll.create>>;
    try {
      roll = await prisma.$transaction(async (tx) => {
        // Barkod atomik sayaçtan (tx içinde) → sıra çakışmasız, retry gerekmez.
        const barcode = await generateRollBarcode(tx, rollType);
        const created = await tx.roll.create({
          data: {
            barcode,
            clientToken: data.clientToken ?? null,
            itemId: data.itemId,
            colorId: data.colorId ?? null,
            initialQty: data.initialQty,
            currentQty: data.initialQty,
            weightKg: data.weightKg ?? null,
            status: initialStatus,
            qualityGrade: qualityGradeCode,
            qualityGradeId,
            width: data.width ?? null,
            entrySource,
            createdById: userId ?? null,
            createdMachineId: machineId ?? null,
          },
          include: {
            item: true,
            color: true,
            createdBy: { select: { id: true, username: true, fullName: true } },
          },
        });
        if (dedupedProps.length > 0) {
          await tx.rollProperty.createMany({
            data: dedupedProps.map((propertyId) => ({ rollId: created.id, propertyId })),
          });
        }
        return created;
      });
    } catch (err) {
      // İdempotency: aynı clientToken ile 2. çağrı (offline sync replay / eşzamanlı race).
      // Roll.clientToken @unique → P2002 → mevcut Roll'u dön (audit ilk çağrıda yazıldı).
      if (
        data.clientToken &&
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await prisma.roll.findUnique({
          where: { clientToken: data.clientToken },
          include: {
            item: true,
            color: true,
            createdBy: { select: { id: true, username: true, fullName: true } },
          },
        });
        if (existing) {
          // F117: İdempotent retry SADECE gelen payload mevcut kayıtla ÖZDEŞSE geçerli.
          // Aynı token farklı topla kullanıldıysa (istemci hatası) 2. giriş sessizce
          // "kaydedildi" görünmemeli; kimlik-kilit alanları (item/renk/metre)
          // uyuşmuyorsa 409 çakışma fırlat.
          const sameItem = existing.itemId === data.itemId;
          const sameColor = existing.colorId === (data.colorId ?? null);
          const sameQty = new Prisma.Decimal(data.initialQty).equals(existing.initialQty);
          if (sameItem && sameColor && sameQty) {
            return {
              success: true,
              data: existing,
              message: `Top zaten kayıtlı (idempotent retry). Barkod: ${existing.barcode}`,
            };
          }
          throw AppError.conflict(
            "Bu istemci anahtarı farklı bir topla kullanılmış. Topu yeniden okutup tekrar deneyin.",
            {
              code: "CLIENT_TOKEN_COLLISION",
              barcode: existing.barcode,
              existing: {
                id: existing.id,
                itemId: existing.itemId,
                colorId: existing.colorId,
                initialQty: Number(existing.initialQty),
              },
              incoming: {
                itemId: data.itemId,
                colorId: data.colorId ?? null,
                initialQty: data.initialQty,
              },
            },
          );
        }
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        barcode: roll.barcode,
        itemId: roll.itemId,
        colorId: roll.colorId,
        initialQty: roll.initialQty,
        currentQty: roll.currentQty,
        weightKg: roll.weightKg,
        status: roll.status,
        entrySource: roll.entrySource,
        propertyIds: dedupedProps,
      },
    });

    return {
      success: true,
      data: roll,
      message: `Top oluşturuldu. Barkod: ${roll.barcode}`,
    };
  }

  /**
   * Roll listesi + istatistiklerin paylaştığı tek filtre kaynağı.
   * findAllRolls (liste) ve getRollStats (özet) bu metodu çağırır —
   * filtre eşleşmediğinde istatistik listeden sapar.
   */
  private buildRollWhere(params: QueryParams): Record<string, unknown> {
    const f = params.filters;

    // Base where: buildWhereClause sadece düz Roll alanları için. Nested ilişki
    // filtreleri (item.isDerived, item.colorId, item.properties...) ve range
    // alanları (width, currentQty) aşağıda explicit compose ediliyor — generic
    // helper'a relation bilgisi sızdırmamak için.
    // Search'i `buildWhereClause`'a vermiyoruz; ruloyu sadece barkoda göre değil,
    // bağlı kumaş adı/kodu üzerinden de aramak için OR'u explicit kuruyoruz.
    const where = buildWhereClause(f, ["barcode"]);
    applyDateRange(where, params, ROLL_DATE_FIELDS);

    const search = params.search?.trim();
    if (search) {
      // Barkod: TAM eşleşme (unique index seek). `contains`/`startsWith` ILIKE
      // en_US.UTF-8 collation'da barcode unique indeksini KULLANAMAZ — 300k satırda
      // ölçüldü: contains ~21-87ms (seq scan), equals ~0.3ms (index scan). Barkod
      // okutulur/yapıştırılır (tam değer); ortasından substring araması gerçek bir
      // saha akışı değil. Ürün adı/kodu küçük master tabloda kaldığı için contains
      // olarak kalır → "patos" gibi fuzzy ürün araması bozulmadan çalışır.
      where.OR = [
        { barcode: search },
        ...buildTurkishSearch<Prisma.RollWhereInput>(search, [
          "item.name",
          "item.code",
          "color.name",
        ]),
      ];
    }

    // Fason sevk picker'ı: belirli bir adıma SEVK EDİLEBİLİR toplar.
    // Filtre, subcontractor.service dispatch() kabul kuralının BİREBİR aynısı:
    //   serbest stok (currentStepId null & STOCK)              → auto-attach edilir
    //   bu adımdaki top (currentStepId === stepId & STOCK|IN_PRODUCTION)
    // Aşağıda OR olarak kurulur; varsayılan STOCK status'u devre dışı kalır
    // (OR kendi status'unu yönetir). FIRE hariç tutma kuralı korunur.
    const dispatchableForStepId =
      typeof f["dispatchableForStepId"] === "string" && f["dispatchableForStepId"]
        ? (f["dispatchableForStepId"] as string)
        : null;

    // --- Status: statusIn[] > status > default STOCK ---
    const statusIn = readList(f["statusIn"]);
    delete where.statusIn;
    if (statusIn.length > 0) {
      where.status = { in: statusIn as RollStatus[] };
    } else if (f["status"] === "ALL" || dispatchableForStepId) {
      delete where.status;
    } else if (!f["status"]) {
      where.status = RollStatus.STOCK;
    }

    // --- Roll-level renk + processingStatus filtreleri ---
    const colorIdFilter = typeof f["colorId"] === "string" ? f["colorId"] : null;
    delete where.colorId;
    if (colorIdFilter) {
      where.colorId = colorIdFilter;
    }

    const processingStatus = f["processingStatus"] as string | undefined;
    delete where.processingStatus;
    // M-29: istemci explicit status verdiyse processingStatus/rollScope onu
    // EZMEZ — AND ile kesişir (eski son-yazan-kazanır davranışı çelişen
    // kombinasyonda sessiz yanlış sonuç veriyordu). Explicit yoksa default
    // STOCK yerine dalın kendi kümesi geçer (eski davranış).
    const hasExplicitStatus = statusIn.length > 0 || Boolean(f["status"]);
    const applyStatusScope = (scope: unknown) => {
      if (hasExplicitStatus) {
        where.AND = [
          ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
          { status: scope },
        ];
      } else {
        where.status = scope;
      }
    };
    // F116 (M-29 türevi): explicit colorId, processingStatus'un renk koşulunu EZMEZ —
    // where.AND ile KESİŞİR. Aksi halde 'İşlenmiş' sekmesi + belirli renk birlikte
    // gelince renk sessizce düşer, TÜM renkteki işlenmiş toplar (ve aynı where'i
    // paylaşan /rolls/stats toplamları) yanlış filtreyle döner. raw+colorId çelişkisi
    // doğal boş küme döner.
    const hasExplicitColor = Boolean(colorIdFilter);
    const applyColorScope = (scope: unknown) => {
      if (hasExplicitColor) {
        where.AND = [
          ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
          { colorId: scope },
        ];
      } else {
        where.colorId = scope;
      }
    };
    if (processingStatus === "raw") {
      applyColorScope(null);
    } else if (processingStatus === "processed") {
      applyColorScope({ not: null });
      // İzinli statüler EXPLICIT (in) — eski notIn listesi CANCELLED/SHIPPED/
      // A1_STOCK/AT_KARTELA/KARTELA_CONSUMED/RETURNED'ı "işlenmekte" listesine
      // ve aynı where'i paylaşan /rolls/stats toplamlarına sızdırıyordu
      // (sözleşme: renk kazanmış + henüz Tambur'a ulaşmamış AKTİF toplar).
      applyStatusScope({
        in: [
          RollStatus.STOCK,
          RollStatus.IN_PRODUCTION,
          RollStatus.AT_SUBCONTRACTOR,
          RollStatus.RETURNED_FROM_SUBCONTRACTOR,
        ],
      });
    } else if (processingStatus === "open_fabric") {
      where.barcode = null;
      applyStatusScope(RollStatus.IN_PRODUCTION);
    } else if (processingStatus === "finished") {
      applyStatusScope(RollStatus.WAREHOUSE);
    }

    const qualityGradeFilter =
      typeof f["qualityGrade"] === "string" ? (f["qualityGrade"] as string) : null;
    delete where.qualityGrade;
    const includeFireRaw = f["includeFire"];
    const includeFire = includeFireRaw === "true";
    delete where.includeFire;
    if (qualityGradeFilter) {
      where.qualityGrade = qualityGradeFilter;
    } else if (!includeFire) {
      // Postgres `<>` NULL-hostile: düz `{ not: "FIRE" }` kalitesi NULL (kaliteye
      // bakılmadı) topları da dışlardı. Kalite artık nullable → null FIRE değildir,
      // Envanter listesinde/istatistiğinde kalmalı. where.AND'e OR olarak ekle
      // (status/renk scope'ları where.AND'i zaten kullanıyor olabilir).
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { OR: [{ qualityGrade: null }, { qualityGrade: { not: "FIRE" } }] },
      ];
    }

    const rollKind = f["rollKind"] as string | undefined;
    delete where.rollKind;
    if (rollKind === "OPEN_FABRIC") {
      where.barcode = null;
    } else if (rollKind === "WOUND_ROLL") {
      where.barcode = { not: null };
    }

    const currentStepKindRaw = f["currentStepKind"] as string | undefined;
    delete where.currentStepKind;
    if (
      currentStepKindRaw &&
      Object.values(StationKind).includes(currentStepKindRaw as StationKind)
    ) {
      where.currentStep = {
        is: { station: { kind: currentStepKindRaw as StationKind } },
      };
    }

    const rollScope = f["rollScope"] as string | undefined;
    delete where.rollScope;
    if (rollScope === "RAW_STOCK") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: null },
        { status: RollStatus.STOCK },
      ];
    } else if (rollScope === "PRODUCTION_ACTIVE") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { currentStepId: { not: null } },
        {
          status: {
            notIn: [
              RollStatus.WAREHOUSE,
              RollStatus.A1_STOCK,
              RollStatus.SCRAP,
              RollStatus.CANCELLED,
              RollStatus.TAMBUR_CONSUMED,
              RollStatus.SUBCONTRACTOR_CONSUMED,
              RollStatus.RETURNED_FROM_SUBCONTRACTOR,
            ],
          },
        },
      ];
    } else if (rollScope === "FINISHED_STOCK") {
      applyStatusScope({
        in: [RollStatus.WAREHOUSE, RollStatus.A1_STOCK],
      });
    } else if (rollScope === "IN_SACK") {
      // "Çuvalda" sekmesi: fiziksel olarak bir çuvalda (sackId dolu) ve henüz
      // depoyu terk etmemiş (SHIPPED/CANCELLED/SCRAP değil) toplar. Sevkiyata
      // atanmış (PLANNED) ama henüz sevk edilmemiş çuvallar da hâlâ çuvaldadır.
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { sackId: { not: null } },
        {
          status: {
            notIn: [RollStatus.SHIPPED, RollStatus.CANCELLED, RollStatus.SCRAP],
          },
        },
      ];
    }

    // --- Fason sevk uygunluğu (belirli adım) ---
    // buildWhereClause düz alan olarak yakaladıysa temizle, sonra OR ile compose et.
    delete where.dispatchableForStepId;
    if (dispatchableForStepId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        {
          OR: [
            // (a) serbest stok → auto-attach edilir
            { currentStepId: null, status: RollStatus.STOCK },
            // (b) bu adımdaki top → STOCK *veya* IN_PRODUCTION (dispatch() kabul
            //     kuralının birebir aynısı: subcontractor.service guard). Eski kod
            //     yalnız STOCK kabul ediyordu → bu adımda fiilen üretimdeki
            //     (IN_PRODUCTION) toplar picker'da HATALI gizleniyordu.
            {
              currentStepId: dispatchableForStepId,
              status: { in: [RollStatus.STOCK, RollStatus.IN_PRODUCTION] },
            },
          ],
        },
      ];
    }

    // --- Sevkiyat kapsamı: serbest depo vs çuvallanmış (committed) ---
    // 'free'      = GERÇEK serbest depo: sackId null VE shipmentId null — yalnız
    //               satılabilir/okutulabilir stok. Bir çuvala konmuş ama henüz
    //               sevkiyata atanmamış top (sackId dolu, shipmentId null) serbest
    //               DEĞİLDİR (çuval havuzu modeli: fiziksel olarak çuvalda).
    // 'committed' = çuvallanmış VEYA sevkiyatta (sackId dolu ya da shipmentId dolu).
    // yok/'all'   = ayrım yapma. Depo ekranı 'free' geçer → çuvaldaki top "serbest
    //               depoda" görünmez.
    const shipmentScope = f["shipmentScope"] as string | undefined;
    delete where.shipmentScope;
    if (shipmentScope === "free") {
      where.shipmentId = null;
      where.sackId = null;
    } else if (shipmentScope === "committed") {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        { OR: [{ sackId: { not: null } }, { shipmentId: { not: null } }] },
      ];
    }

    const itemId = typeof f["itemId"] === "string" ? f["itemId"] : null;
    delete where.itemId;
    if (itemId) {
      where.itemId = itemId;
    }

    const propertyIds = readList(f["propertyIds"]);
    delete where.propertyIds;
    if (propertyIds.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        ...propertyIds.map((pid) => ({
          properties: { some: { propertyId: pid } },
        })),
      ];
    }

    delete where.widthMin;
    delete where.widthMax;
    const widthRange = readNumberRange(f["widthMin"], f["widthMax"]);
    if (widthRange) where.width = widthRange;

    delete where.qtyMin;
    delete where.qtyMax;
    const qtyRange = readNumberRange(f["qtyMin"], f["qtyMax"]);
    if (qtyRange) where.currentQty = qtyRange;

    const markedForKartelaRaw = f["markedForKartela"];
    delete where.markedForKartela;
    if (markedForKartelaRaw === "true") {
      where.markedForKartela = true;
    }

    // --- Fasonda görünürlüğü: firma + işlem (kategori) filtresi ---
    // "Açık sevk kalemi" tanımı F85 (getOpenDispatches) ile birebir: iptalsiz +
    // doğrudan-sevksiz dispatch'in aktif (iptalsiz) receipt-item'ı OLMAYAN
    // kalemi. subcontractor-summary ucu ve ROLL_LIST_INCLUDE.dispatchItems ile
    // AYNI küme → şerit/kolon/liste sayıları sapmaz. AND'e eklenir (status/
    // renk scope'larıyla kesişir); sekme tabanı (status=AT_SUBCONTRACTOR)
    // frontend forceFilters'tan ayrıca gelir. delete where.X ŞART: buildWhereClause
    // her filter anahtarını düz kolon olarak kopyalar, Roll'da bu kolonlar yok.
    const subcontractorId =
      typeof f["subcontractorId"] === "string" && f["subcontractorId"]
        ? (f["subcontractorId"] as string)
        : null;
    delete where.subcontractorId;
    const subcontractorCategoryId =
      typeof f["subcontractorCategoryId"] === "string" && f["subcontractorCategoryId"]
        ? (f["subcontractorCategoryId"] as string)
        : null;
    delete where.subcontractorCategoryId;
    if (subcontractorId || subcontractorCategoryId) {
      where.AND = [
        ...(Array.isArray(where.AND) ? (where.AND as Record<string, unknown>[]) : []),
        {
          dispatchItems: {
            some: {
              dispatch: {
                cancelledAt: null,
                directShippedAt: null,
                ...(subcontractorId ? { subcontractorId } : {}),
                // Kategori: adımın requiredCategory'si eşleşir VEYA adım boşsa
                // firmanın kategorisi eşleşir (özet COALESCE tanımıyla hizalı —
                // firma tek kategoriliyse birebir, çok kategoride hafif geniş).
                ...(subcontractorCategoryId
                  ? {
                      OR: [
                        { step: { requiredCategoryId: subcontractorCategoryId } },
                        {
                          step: { requiredCategoryId: null },
                          subcontractor: {
                            categories: { some: { categoryId: subcontractorCategoryId } },
                          },
                        },
                      ],
                    }
                  : {}),
              },
              receiptItems: { none: { receipt: { cancelledAt: null } } },
            },
          },
        },
      ];
    }

    return where;
  }

  /**
   * List rolls with dynamic filtering, sorting, pagination.
   * Business Rule: By default only STOCK rolls are returned.
   * Other statuses must be explicitly requested via filter[status].
   *
   * İki mod (geri uyumlu):
   *   - Offset: ?page=1&pageSize=50 — eski sayfalama, küçük tablo gibi.
   *   - Cursor: ?mode=cursor&limit=50 — büyük tablo (30k+) için sabit hız.
   */
  async findAllRolls(
    req: Request
  ): Promise<PaginatedResponse<Roll> | CursorPaginatedResponse<Roll>> {
    const params = parseQueryParams(req);
    // sortBy güvenlik süzgeci — bilinmeyen kolon (500) + indekssiz keyfi sort engellenir.
    params.sortBy = resolveSortBy(params.sortBy, ROLL_SORTABLE_FIELDS);
    const where = this.buildRollWhere(params);

    // Sevkiyat rezervasyonu: WAREHOUSE top bir çuval/sevkiyata bağlıysa "serbest depo"
    // DEĞİLDİR — listede "Çuvalda" rozeti için sevkiyat no/durum + çuval no döner.
    // Şekil modül-seviyesinde tek kaynakta (getProductionFlow ile paylaşılır).
    const include = ROLL_LIST_INCLUDE;

    // CURSOR MODE — dinamik sortBy desteği (utils/cursor.ts dynamic API).
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      // Tavan MAX_PAGE_SIZE (500) ile hizalı: "tümünü indir" (fetchAll) 500'lük
      // sayfa ister → 30k kayıt 60 istekte iner (200 tavanında 150 istek/2.5× daha
      // yavaştı). Normal liste 100'lük ister; bu tavan yalnız büyük export'u etkiler.
      const limit = Math.min(Math.max(1, rawLimit), 500);
      const wantTotal = req.query.withTotal === "true";

      const sortBy = params.sortBy || "createdAt";
      const sortOrder: "asc" | "desc" = params.sortOrder === "asc" ? "asc" : "desc";
      // Nullable sıralama kolonları (barcode: fason dönüş açık kumaşı; width:
      // rawWidthEnabled kapalıyken stokun çoğu null): nulls EN SONA + null-aware
      // cursor — yoksa DESC'te NULLS FIRST cursor'ı null grubuna kilitler ve
      // "En"/"Barkod" başlığına tıklayan operatör listenin çoğunu hiç göremezdi.
      const NULLABLE_ROLL_SORT = new Set(["barcode", "width"]);
      const sortNullable = NULLABLE_ROLL_SORT.has(sortBy);
      const orderByPrimary = sortNullable
        ? { [sortBy]: { sort: sortOrder, nulls: "last" as const } }
        : { [sortBy]: sortOrder };
      const cursor = decodeDynamicCursor(req.query.cursor as string | undefined);
      const cursorWhereClause = cursor
        ? { AND: [where, dynamicCursorWhere(cursor, sortBy, sortOrder, sortNullable)] }
        : where;

      const [items, totalEstimate] = await Promise.all([
        prisma.roll.findMany({
          where: cursorWhereClause,
          orderBy: [orderByPrimary, { id: sortOrder }],
          take: limit + 1,
          include,
        }),
        wantTotal ? prisma.roll.count({ where }) : Promise.resolve(undefined),
      ]);

      const hasMore = items.length > limit;
      const data = hasMore ? items.slice(0, limit) : items;
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

    // OFFSET MODE (legacy, küçük gezinmelerde)
    const orderBy = buildOrderByClause(params.sortBy, params.sortOrder);
    const { skip, take } = buildPagination(params.page, params.pageSize);

    const [data, total] = await Promise.all([
      prisma.roll.findMany({
        where,
        orderBy,
        skip,
        take,
        include,
      }),
      prisma.roll.count({ where }),
    ]);

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
   * ÜRETİM AKIŞI (Kanban) panosu — Envanter ekranındaki salt-okunur pano. TEK
   * HTTP isteğiyle 6 kolon: her kolon en fazla 10 önizleme kaydı + gerçek toplam
   * sayaç. Eskiden frontend 6 AYRI istek atıyordu; kuyruk kolonları (Kurşun/Tambur)
   * ~500 satırı nested payload'la çekip 12'ye kırpıyor, Sevk'in gerçek toplamı hiç
   * yoktu. Tek uç + kolon başına `take:10 + count()` ile hem round-trip hem payload
   * küçüldü, tüm kolonlar doğru toplam gösterir.
   *
   * Sıra kolon-doğal: rulo kolonları createdAt DESC (en güncel), Kurşun öncelik
   * kuyruğu (kursun-qc.listQueue ile aynı), Tambur updatedAt DESC, Sevk board sırası
   * (createdAt ASC). Sayaç/preview sorguları tx-DIŞI `prisma.*` → Promise.all serbest
   * (pool max 30; kural yalnız tx.* için).
   *
   * RBAC: uç `roll:read` ile korunur (Envanter sayfasının izni). Kolon-bazlı ince
   * yetki controller'da hesaplanır — `quality:read` yoksa Kurşun/Tambur, `shipping:read`
   * yoksa Sevk boş (total 0) döner (eski davranışın 403-toast gürültüsü olmadan hâli).
   */
  async getProductionFlow(opts: {
    includeQueues: boolean;
    includeSevk: boolean;
  }): Promise<ApiResponse<ProductionFlowData>> {
    const PREVIEW = 10;

    const rollColumn = async (status: RollStatus) => {
      const where = { status };
      const [rolls, total] = await Promise.all([
        prisma.roll.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: PREVIEW,
          include: ROLL_LIST_INCLUDE,
        }),
        prisma.roll.count({ where }),
      ]);
      return { rolls, total };
    };

    const kursunColumn = async (): Promise<{ cards: ProductionFlowQueueCard[]; total: number }> => {
      if (!opts.includeQueues) return { cards: [], total: 0 };
      const where: Prisma.WorkOrderStepWhereInput = {
        station: { kind: StationKind.PROCESS_QC },
        status: { not: StepStatus.COMPLETED },
        currentRolls: { some: {} },
      };
      const [steps, total] = await Promise.all([
        prisma.workOrderStep.findMany({
          where,
          // kursun-qc.listQueue ile aynı öncelik sırası (en kritik önce).
          orderBy: [
            { isUrgent: "desc" },
            { urgentMarkedAt: { sort: "asc", nulls: "last" } },
            { priority: "asc" },
            { startedAt: { sort: "asc", nulls: "last" } },
          ],
          take: PREVIEW,
          select: {
            id: true,
            isUrgent: true,
            workOrder: {
              select: {
                // DİKKAT: WO'da alan adı workOrderNumber (İE…) — eski batchNumber
                // select'i parti-redesign sonrası Prisma validation hatasıyla tüm
                // production-flow'u 500'e düşürüyordu (2026-07-15 düzeltildi).
                workOrderNumber: true,
                targetItem: { select: { name: true } },
                targetColor: { select: { name: true, hex: true } },
              },
            },
            movements: {
              where: { exitedAt: null },
              select: { roll: { select: { currentQty: true } } },
            },
          },
        }),
        prisma.workOrderStep.count({ where }),
      ]);
      const cards = steps.map((s) => ({
        id: s.id,
        itemName: s.workOrder.targetItem?.name ?? null,
        colorName: s.workOrder.targetColor?.name ?? null,
        colorHex: s.workOrder.targetColor?.hex ?? null,
        openRollCount: s.movements.length,
        totalCurrentQty: s.movements
          .reduce((sum, m) => sum.plus(m.roll.currentQty), new Prisma.Decimal(0))
          .toNumber(),
        workOrderNumber: s.workOrder.workOrderNumber,
        isUrgent: s.isUrgent,
      }));
      return { cards, total };
    };

    const tamburColumn = async (): Promise<{ cards: ProductionFlowQueueCard[]; total: number }> => {
      if (!opts.includeQueues) return { cards: [], total: 0 };
      const where: Prisma.WorkOrderStepWhereInput = {
        station: { kind: StationKind.TAMBUR },
        status: { not: StepStatus.COMPLETED },
        currentRolls: { some: {} },
      };
      const [steps, total] = await Promise.all([
        prisma.workOrderStep.findMany({
          where,
          orderBy: { updatedAt: "desc" },
          take: PREVIEW,
          select: {
            id: true,
            workOrder: {
              select: {
                workOrderNumber: true,
                targetItem: { select: { name: true } },
                targetColor: { select: { name: true, hex: true } },
              },
            },
            currentRolls: { select: { currentQty: true } },
          },
        }),
        prisma.workOrderStep.count({ where }),
      ]);
      const cards = steps.map((s) => ({
        id: s.id,
        itemName: s.workOrder.targetItem?.name ?? null,
        colorName: s.workOrder.targetColor?.name ?? null,
        colorHex: s.workOrder.targetColor?.hex ?? null,
        openRollCount: s.currentRolls.length,
        totalCurrentQty: s.currentRolls
          .reduce((sum, r) => sum.plus(r.currentQty), new Prisma.Decimal(0))
          .toNumber(),
        workOrderNumber: s.workOrder.workOrderNumber,
        isUrgent: false,
      }));
      return { cards, total };
    };

    const sevkColumn = async (): Promise<{ shipments: ProductionFlowSackCard[]; total: number }> => {
      if (!opts.includeSevk) return { shipments: [], total: 0 };
      const where: Prisma.ShipmentWhereInput = { status: ShipmentStatus.PLANNED };
      const [rows, total] = await Promise.all([
        prisma.shipment.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: PREVIEW,
          select: {
            id: true,
            shipmentNo: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        }),
        prisma.shipment.count({ where }),
      ]);
      const ids = rows.map((s) => s.id);
      const [sackAgg, rollAgg] = ids.length
        ? await Promise.all([
            prisma.sack.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _count: { _all: true }, _sum: { weightKg: true } }),
            prisma.roll.groupBy({ by: ["shipmentId"], where: { shipmentId: { in: ids } }, _sum: { currentQty: true } }),
          ])
        : [[], []];
      const kgByShip = new Map(sackAgg.map((g) => [g.shipmentId, { count: g._count._all, kg: Number(g._sum.weightKg ?? 0) }]));
      const qtyByShip = new Map(rollAgg.map((g) => [g.shipmentId, Number(g._sum.currentQty ?? 0)]));
      const shipments = rows.map((s) => {
        const sk = kgByShip.get(s.id);
        return {
          id: s.id,
          shipmentNo: s.shipmentNo,
          customer: s.customer,
          branch: s.branch,
          sackCount: sk?.count ?? 0,
          totalKg: sk?.kg ?? 0,
          totalQty: qtyByShip.get(s.id) ?? 0,
        };
      });
      return { shipments, total };
    };

    const [hamStok, fason, depo, kursun, tambur, sevk] = await Promise.all([
      rollColumn(RollStatus.STOCK),
      rollColumn(RollStatus.AT_SUBCONTRACTOR),
      rollColumn(RollStatus.WAREHOUSE),
      kursunColumn(),
      tamburColumn(),
      sevkColumn(),
    ]);

    return { success: true, data: { hamStok, fason, kursun, tambur, depo, sevk } };
  }

  /**
   * Roll özet istatistikleri — listenin SAYFAYA bağlı toplamlarını değil,
   * filtreye uyan TÜM rolların aggregate'ini döner. Depo/dashboard kartlarının
   * "Toplam metre / Toplam kg / Statü dağılımı / Kalite dağılımı" gibi
   * panelleri için. Filtre seti findAllRolls ile aynı (buildRollWhere paylaşılır).
   */
  async getRollStats(req: Request): Promise<ApiResponse<RollStats>> {
    const params = parseQueryParams(req);
    const where = this.buildRollWhere(params) as Prisma.RollWhereInput;

    // TEK TARAMA: (status, qualityGrade) bazlı groupBy bir scan'de hem count
    // hem sum'ları döndürür. Eskiden 3 ayrı sorgu vardı (aggregate + groupBy
    // status + groupBy qualityGrade) → 500k satırda 3 kez tarama. Bunu tek
    // geçişe indiriyoruz (CLAUDE.md DB perf kuralı). Grup sayısı küçük
    // (status × qualityGrade ≈ on'lar) → aşağıdaki JS reduce maliyetsiz.
    const grouped = await prisma.roll.groupBy({
      where,
      by: ["status", "qualityGrade"],
      _count: { _all: true },
      _sum: { currentQty: true, weightKg: true },
    });

    let totalCount = 0;
    // Decimal toplamları Prisma.Decimal ile biriktir — JS float aritmetiği
    // ondalık metraj/ağırlıkta drift yapar (CLAUDE.md Decimal kuralı).
    let totalQty = new Prisma.Decimal(0);
    let totalWeight = new Prisma.Decimal(0);
    const byStatus: Record<string, number> = {};
    const byQuality: Record<string, number> = {};

    for (const row of grouped) {
      const n = row._count._all;
      totalCount += n;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + n;
      // qualityGrade artık nullable → null anahtarı "BELIRSIZ" kovasına düşer.
      const qualityKey = row.qualityGrade ?? "BELIRSIZ";
      byQuality[qualityKey] = (byQuality[qualityKey] ?? 0) + n;
      if (row._sum.currentQty) totalQty = totalQty.plus(row._sum.currentQty);
      if (row._sum.weightKg) totalWeight = totalWeight.plus(row._sum.weightKg);
    }

    return {
      success: true,
      data: {
        totalCount,
        totalQty: Number(totalQty),
        totalWeight: Number(totalWeight),
        byStatus,
        byQuality,
      },
    };
  }

  /**
   * Envanter özeti — N kategori filtresinin her biri için TEK istekte count + metre.
   * Frontend her kategoriyi kendi filtresiyle (buildRollForceFilters) gönderir; 8 ayrı
   * HTTP + 8 auth/parse yerine tek çağrı, içeride Promise.all ile paralel aggregate
   * (getWarehouseScope ile aynı desen). Kategori tanımı tek yerde (frontend) kalır;
   * backend generic sayım motoru. buildRollWhere liste/özet ile aynı → sapma olmaz.
   */
  async getRollStatsBatch(
    items: Array<{ key: string; filters?: Record<string, unknown> }>,
  ): Promise<ApiResponse<Array<{ key: string; totalCount: number; totalQty: number }>>> {
    const data = await Promise.all(
      items.map(async (it) => {
        const where = this.buildRollWhere({
          filters: it.filters ?? {},
        } as QueryParams) as Prisma.RollWhereInput;
        const agg = await prisma.roll.aggregate({
          where,
          _count: { _all: true },
          _sum: { currentQty: true },
        });
        return {
          key: it.key,
          totalCount: agg._count._all,
          totalQty: Number(agg._sum.currentQty ?? 0),
        };
      }),
    );
    return { success: true, data };
  }

  /**
   * Depo kapsam sayaçları — WAREHOUSE topları fiziksel yere göre ayır (ÇUVAL DEPO MODELİ):
   *  - serbest:    shipmentId null + sackId null (satılabilir/okutulabilir gerçek serbest stok)
   *  - çuval depo: shipmentId null + sackId dolu (çuvala konmuş, sevk edilmemiş)
   *  - planlı:     shipment.status PLANNED (onay bekleyen sevkiyata atandı, henüz sevk edilmedi)
   * Hepsi hâlâ binada (WAREHOUSE) ama yalnız "serbest" satılabilir stoktur. SHIPPED hariç.
   */
  async getWarehouseScope(): Promise<
    ApiResponse<{
      free: { count: number; qty: number };
      pool: { count: number; qty: number };
      planned: { count: number; qty: number };
    }>
  > {
    const agg = (where: Prisma.RollWhereInput) =>
      prisma.roll.aggregate({ where, _count: { _all: true }, _sum: { currentQty: true } });

    const [free, pool, planned] = await Promise.all([
      agg({ status: RollStatus.WAREHOUSE, shipmentId: null, sackId: null }),
      agg({ status: RollStatus.WAREHOUSE, shipmentId: null, sackId: { not: null } }),
      agg({ status: RollStatus.WAREHOUSE, shipment: { status: ShipmentStatus.PLANNED } }),
    ]);

    const pick = (r: { _count: { _all: number }; _sum: { currentQty: Prisma.Decimal | null } }) => ({
      count: r._count._all,
      qty: Number(r._sum.currentQty ?? 0),
    });

    return {
      success: true,
      data: { free: pick(free), pool: pick(pool), planned: pick(planned) },
    };
  }

  /**
   * Fasonda özet şeridi — AT_SUBCONTRACTOR topların firma + işlem (kategori)
   * bazlı dağılımı, TEK istekte iki dizi + toplam. Açık-kalem tanımı F85 ile
   * birebir (reports/subcontract getOpenDispatches): iptalsiz + doğrudan-sevksiz
   * sevkin, aktif (iptalsiz) receipt-item'ı OLMAYAN kalemi. base ROLL-driven
   * (1 satır/top) + DISTINCT ON en güncel açık kalemi seçer → fason→fason
   * transferde/anomalide çift sayım İMKANSIZ; açık kalemi bulunamayan top null
   * gruba düşer ("Bilinmiyor"). Evren varsayılan FIRE-hariç (liste default'uyla
   * hizalı: qualityGrade IS NULL OR <> 'FIRE'); includeFire=true iken FIRE toplar
   * da dahil → "Fire kaliteyi de göster" toggle'ı açıkken şerit sayıları tablo/
   * Top-Metre ile birebir tutar. LIMIT bilinçli YOK: grup sayısı master tablo
   * kardinalitesiyle sınırlı, sevk hacmiyle büyümez.
   */
  async getRollSubcontractorSummary(
    includeFire = false,
  ): Promise<ApiResponse<RollSubcontractorSummary>> {
    // FIRE dışlama koşulu (liste buildRollWhere ile aynı semantik): includeFire
    // açıksa boş fragment → FIRE toplar da sayılır.
    const fireClause = includeFire
      ? Prisma.empty
      : Prisma.sql`AND (r."qualityGrade" IS NULL OR r."qualityGrade" <> 'FIRE')`;
    // Paylaşılan CTE — rolls tarafı @@index([status, createdAt]), kalemler
    // @@index([rollId]), anti-join @@index([sourceDispatchItemId]) kullanır.
    const baseCte = Prisma.sql`
      open_items AS (
        SELECT DISTINCT ON (sdi."rollId")
          sdi."rollId"            AS "rollId",
          sd."subcontractorId"    AS "subcontractorId",
          sd."dispatchedAt"       AS "dispatchedAt",
          -- "İşlem" kategorisi: adımın requiredCategory'si; boşsa firmanın kendi
          -- kategorisine düşülür (yalnız firma TEK kategoriliyse — çok kategorili
          -- firmada işlem belirsiz → null "Bilinmiyor"). Frontend activeCategoryOf
          -- + buildRollWhere filtresi AYNI COALESCE tanımını paylaşır.
          COALESCE(
            ws."requiredCategoryId",
            (SELECT MAX(scl."categoryId"::text)::uuid
             FROM subcontractor_category_links scl
             WHERE scl."subcontractorId" = sd."subcontractorId"
             HAVING COUNT(*) = 1)
          )                       AS "categoryId"
        FROM rolls r
        JOIN subcontractor_dispatch_items sdi ON sdi."rollId" = r.id
        JOIN subcontractor_dispatches sd      ON sd.id = sdi."dispatchId"
        JOIN work_order_steps ws              ON ws.id = sd."stepId"
        WHERE r.status = 'AT_SUBCONTRACTOR'
          AND sd."cancelledAt" IS NULL
          AND sd."directShippedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM subcontractor_receipt_items sri
            JOIN subcontractor_receipts sr ON sr.id = sri."receiptId"
            WHERE sri."sourceDispatchItemId" = sdi.id
              AND sr."cancelledAt" IS NULL
          )
        ORDER BY sdi."rollId", sd."dispatchedAt" DESC, sdi."createdAt" DESC
      ),
      base AS (
        SELECT r.id, r."currentQty", oi."subcontractorId", oi."dispatchedAt", oi."categoryId"
        FROM rolls r
        LEFT JOIN open_items oi ON oi."rollId" = r.id
        WHERE r.status = 'AT_SUBCONTRACTOR'
          ${fireClause}
      )
    `;

    const [firmRows, catRows] = await Promise.all([
      prisma.$queryRaw<
        Array<{
          subcontractorId: string | null;
          name: string | null;
          code: string | null;
          rollCount: bigint;
          totalQty: number | null;
          oldestDispatchedAt: Date | null;
        }>
      >(Prisma.sql`
        WITH ${baseCte}
        SELECT
          b."subcontractorId"        AS "subcontractorId",
          s.name                     AS "name",
          s.code                     AS "code",
          COUNT(*)                   AS "rollCount",
          SUM(b."currentQty")::float AS "totalQty",
          MIN(b."dispatchedAt")      AS "oldestDispatchedAt"
        FROM base b
        LEFT JOIN subcontractors s ON s.id = b."subcontractorId"
        GROUP BY b."subcontractorId", s.name, s.code
        ORDER BY "rollCount" DESC, s.name ASC NULLS LAST
      `),
      prisma.$queryRaw<
        Array<{
          categoryId: string | null;
          name: string | null;
          rollCount: bigint;
          totalQty: number | null;
        }>
      >(Prisma.sql`
        WITH ${baseCte}
        SELECT
          b."categoryId"             AS "categoryId",
          c.name                     AS "name",
          COUNT(*)                   AS "rollCount",
          SUM(b."currentQty")::float AS "totalQty"
        FROM base b
        LEFT JOIN subcontractor_categories c ON c.id = b."categoryId"
        GROUP BY b."categoryId", c.name
        ORDER BY "rollCount" DESC, c.name ASC NULLS LAST
      `),
    ]);

    const now = Date.now();
    const round1 = (v: number | null) => Math.round(Number(v ?? 0) * 10) / 10;
    const byCategory = catRows.map((r) => ({
      categoryId: r.categoryId,
      name: r.name ?? "Bilinmiyor",
      rollCount: Number(r.rollCount),
      totalQty: round1(r.totalQty),
    }));
    // "Tümü" chip'i / boş-durum gate'i: her top tam bir kategori grubuna düştüğü
    // için total = Σ byCategory (aynı zamanda Σ bySubcontractor).
    const total = byCategory.reduce(
      (acc, c) => ({
        rollCount: acc.rollCount + c.rollCount,
        totalQty: Math.round((acc.totalQty + c.totalQty) * 10) / 10,
      }),
      { rollCount: 0, totalQty: 0 },
    );

    return {
      success: true,
      data: {
        bySubcontractor: firmRows.map((r) => ({
          subcontractorId: r.subcontractorId,
          name: r.name ?? "Bilinmiyor",
          code: r.code,
          rollCount: Number(r.rollCount),
          totalQty: round1(r.totalQty),
          oldestDispatchedAt: r.oldestDispatchedAt,
          oldestDays: r.oldestDispatchedAt
            ? Math.max(0, Math.floor((now - new Date(r.oldestDispatchedAt).getTime()) / 86_400_000))
            : null,
        })),
        byCategory,
        total,
      },
    };
  }

  /**
   * Get a single roll by ID with all relations.
   */
  async findRollById(id: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      include: {
        item: true,
        color: true,
        errors: true,
        // Rezervasyon bilgisi — detay panelinde "çuvalda/sevkiyatta" gösterimi.
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        sack: { select: { id: true, sackNo: true, seq: true } },
        operations: {
          select: {
            id: true,
            operationType: true,
            createdAt: true,
            operator: { select: { id: true, fullName: true, username: true } },
          },
          orderBy: { createdAt: "asc" },
        },
        properties: { include: { property: true } },
        // En güncel iade kaydı (iade gelmiş depo topu için not/neden).
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
          },
        },
        // AT_KARTELA top için aktif (iptal edilmemiş) kartela sevki → detay
        // panelinde "hangi kartela firmasında" gösterilir. En son non-cancelled.
        kartelaDispatchItems: {
          where: { dispatch: { cancelledAt: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            dispatch: {
              select: {
                dispatchNo: true,
                dispatchedAt: true,
                subcontractor: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
        // AT_SUBCONTRACTOR top için açık (dönmemiş) fason sevk kalemi → detay
        // panelinde (RollDetailSheet) "Fason Bilgisi" kartı: firma + sevk no +
        // sevk tarihi + işlem. ROLL_LIST_INCLUDE.dispatchItems ile AYNI tanım (F85)
        // + AYNI sıralama (dispatch.dispatchedAt DESC, özetle hizalı).
        dispatchItems: {
          where: {
            dispatch: { cancelledAt: null, directShippedAt: null },
            receiptItems: { none: { receipt: { cancelledAt: null } } },
          },
          orderBy: { dispatch: { dispatchedAt: "desc" } },
          take: 1,
          select: {
            dispatch: {
              select: {
                dispatchNo: true,
                dispatchedAt: true,
                // "İşlem" kategorisi: step.requiredCategory boşsa firmanın
                // kategorisine düşülür (ROLL_LIST_INCLUDE ile aynı, activeCategoryOf).
                subcontractor: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                    categories: { select: { category: { select: { id: true, name: true } } } },
                  },
                },
                step: { select: { requiredCategory: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Get a roll by its barcode.
   */
  async findRollByBarcode(barcode: string): Promise<ApiResponse<Roll | null>> {
    const roll = await prisma.roll.findUnique({
      where: { barcode },
      include: {
        item: true,
        color: true,
        errors: true,
        // Rezervasyon bilgisi — barkod okutmada "bu top çuvalda/sevkiyatta" uyarısı.
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        sack: { select: { id: true, sackNo: true, seq: true } },
        // En güncel iade kaydı — Tambur/depo barkod okutmada iade notu/nedeni görünür.
        returns: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            id: true,
            qty: true,
            reasonText: true,
            note: true,
            createdAt: true,
            reason: { select: { code: true, name: true, color: true } },
            receivedBy: { select: { fullName: true } },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Barkod bulunamadı" };
    }

    return { success: true, data: roll };
  }

  /**
   * Yeniden-Etiketleme istasyonu için zengin bağlam — barkod okutunca topun tüm
   * spec'i (renk/kalite/en/özellik), konumu/guard'ı (sevkiyat/çuval), son basıldığı
   * yer (`lastLabelSnapshot` = "A") ve "B" müşteri adayları (topu üreten WO'nun
   * bağlı siparişlerinden) döner. Salt-okunur — relabel'in kendisi mevcut
   * `applyManualProperties` (spec) + label.service (bas) uçlarıyla yapılır.
   *
   * `findRollByBarcode`'tan AYRI tutulur: o lean lookup (depo/Tambur okutması, hot
   * path); bu method üretim-zinciri include'larını yalnız relabel istasyonu için taşır.
   */
  /**
   * Barkod VEYA rollId ile çözülür. rollId yolu şart: barkodsuz açık kumaş
   * (fason dönüşü / istasyonda bekleyen top) barkodla bulunamaz ama tek "Düzelt"
   * diyaloğu onu da açmak zorunda (eski ManualAttributesDialog'un tek üstünlüğü buydu).
   */
  async getRelabelContext(
    ref: { barcode: string } | { rollId: string },
  ): Promise<ApiResponse<RelabelContext | null>> {
    const roll = await prisma.roll.findUnique({
      where: "barcode" in ref ? { barcode: ref.barcode } : { id: ref.rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        entrySource: true,
        itemId: true,
        item: { select: { id: true, code: true, name: true } },
        colorId: true,
        color: { select: { id: true, code: true, name: true, hex: true } },
        qualityGrade: true,
        qualityGradeId: true,
        qualityGradeRef: { select: { id: true, code: true, name: true, color: true } },
        width: true,
        currentQty: true,
        weightKg: true,
        markedForKartela: true,
        lastLabelSnapshot: true,
        labelDirty: true,
        properties: {
          select: {
            propertyId: true,
            property: { select: { id: true, code: true, name: true, color: true } },
          },
        },
        shipment: { select: { id: true, shipmentNo: true, status: true } },
        sack: { select: { id: true, sackNo: true, seq: true, shipmentId: true } },
        producedInStep: {
          select: {
            workOrder: {
              select: {
                orderLinks: {
                  // Aday müşteri temsilcisi deterministik olsun: aynı müşterinin
                  // bu WO'da birden çok satırı varsa (farklı override'larla) hep aynı
                  // orderLineId seçilsin — yoksa "first seen" Prisma'da rastgele.
                  orderBy: [{ orderLine: { order: { orderNumber: "asc" } } }, { orderLineId: "asc" }],
                  select: {
                    orderLine: {
                      select: {
                        id: true,
                        order: {
                          select: {
                            orderNumber: true,
                            customer: { select: { id: true, code: true, name: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Barkod bulunamadı" };
    }

    // "B" adayları — topu üreten WO'nun bağlı sipariş satırlarından distinct müşteri.
    // Aynı müşteri birden çok satırda olabilir; ilk görülen satır temsil seçilir.
    const candidateMap = new Map<string, RelabelCandidateCustomer>();
    for (const link of roll.producedInStep?.workOrder?.orderLinks ?? []) {
      const ol = link.orderLine;
      const cust = ol.order.customer;
      if (!candidateMap.has(cust.id)) {
        candidateMap.set(cust.id, {
          customerId: cust.id,
          customerCode: cust.code,
          customerName: cust.name,
          orderLineId: ol.id,
          orderNumber: ol.order.orderNumber,
        });
      }
    }

    // Spec düzenleme kilidi: atanmış sevkiyatta (PLANNED/DISPATCHED) VEYA sevkiyattaki
    // çuvalda → değişiklik donmuş/havuz tahsisini bozar. Açık çuval/serbest serbest.
    const specLocked =
      roll.shipment != null || (roll.sack != null && roll.sack.shipmentId != null);

    return {
      success: true,
      data: {
        id: roll.id,
        barcode: roll.barcode,
        status: roll.status,
        entrySource: roll.entrySource,
        itemId: roll.itemId,
        item: roll.item,
        colorId: roll.colorId,
        color: roll.color,
        qualityGrade: roll.qualityGrade ?? "",
        qualityGradeId: roll.qualityGradeId,
        qualityGradeRef: roll.qualityGradeRef,
        width: roll.width != null ? Number(roll.width) : null,
        currentQty: Number(roll.currentQty),
        weightKg: roll.weightKg != null ? Number(roll.weightKg) : null,
        markedForKartela: roll.markedForKartela,
        lastLabelSnapshot: roll.lastLabelSnapshot,
        labelDirty: roll.labelDirty,
        properties: roll.properties.map((p) => p.property),
        propertyIds: roll.properties.map((p) => p.propertyId),
        shipment: roll.shipment,
        sack: roll.sack,
        specLocked,
        candidateCustomers: [...candidateMap.values()],
      },
    };
  }

  /**
   * Get a roll's full lifecycle history — station movements, discrete operations,
   * subcontractor dispatches/receipts — merged into one chronological timeline.
   */
  async getRollHistory(id: string): Promise<ApiResponse<RollHistoryPayload | null>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true,
        barcode: true,
        status: true,
        initialQty: true,
        currentQty: true,
        weightKg: true,
        entrySource: true,
        qualityGrade: true,
        parentRollId: true,
        createdAt: true,
        item: { select: { id: true, code: true, name: true, itemType: true } },
        color: { select: { id: true, code: true, name: true, hex: true } },
        // Topu sisteme kim açtı — KK1, fason kabul, Tambur split (parent oluşturucu)
        createdBy: { select: { id: true, username: true, fullName: true } },
        // Parent (kaynak) top — TAMBUR_SPLIT için "kimden ayrıldı" bilgisi.
        // FK indexed, +1 LEFT JOIN; sadece detay sayfasında çağrılan endpoint.
        parent: {
          select: {
            id: true,
            barcode: true,
            qualityGrade: true,
            producedInStep: {
              select: {
                stepSequence: true,
                station: { select: { code: true, name: true } },
                workOrder: { select: { id: true, workOrderNumber: true } },
              },
            },
          },
        },
      },
    });

    if (!roll) {
      return { success: false, data: null, message: "Top bulunamadı" };
    }

    const [movements, operations, dispatchItems, receiptItems] =
      await Promise.all([
        prisma.rollMovement.findMany({
          where: { rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { enteredAt: "asc" },
        }),
        prisma.rollOperation.findMany({
          where: { rollId: id },
          include: {
            step: { include: { station: true } },
            operator: { select: { id: true, username: true, fullName: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorDispatchItem.findMany({
          where: { rollId: id },
          include: {
            dispatch: {
              include: {
                subcontractor: { select: { id: true, code: true, name: true } },
                dispatchedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.subcontractorReceiptItem.findMany({
          where: { newRollId: id },
          include: {
            receipt: {
              include: {
                subcontractor: { select: { id: true, code: true, name: true } },
                receivedBy: { select: { id: true, username: true, fullName: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);

    const events: RollHistoryEvent[] = [];

    // Top'un sisteme nasıl girdiğine göre başlık — itemType'tan değil entrySource'tan türer.
    // NOT: eskiden SUBCONTRACTOR_RETURN da `default`'a düşüp yanlışlıkla "Ham Giriş"
    // gösteriyordu — dört değer de artık AÇIK case'le eşleniyor.
    const entryTitle = ((): string => {
      switch (roll.entrySource) {
        case RollEntrySource.TAMBUR_SPLIT:
          return "Tambur Kesimi (Yeni Parça)";
        case RollEntrySource.SUBCONTRACTOR_RETURN:
          return "Fason Dönüşü";
        case RollEntrySource.MANUAL_ENTRY:
          return "Manuel Giriş";
        case RollEntrySource.SUPPLIER_RECEIPT:
        default:
          return "Ham Giriş";
      }
    })();

    // Parent referansı — split rolünün kaynağını izlenebilir kıl.
    // TAMBUR_SPLIT için zorunlu, diğerlerinde de parent varsa eklenir.
    const parentInfo = roll.parent
      ? {
        parentRollId: roll.parent.id,
        parentBarcode: roll.parent.barcode,
        parentQualityGrade: roll.parent.qualityGrade,
        parentWorkOrder: roll.parent.producedInStep?.workOrder
          ? {
            id: roll.parent.producedInStep.workOrder.id,
            batchNumber: roll.parent.producedInStep.workOrder.workOrderNumber,
          }
          : null,
        parentProducedStation: roll.parent.producedInStep?.station
          ? {
            code: roll.parent.producedInStep.station.code,
            name: roll.parent.producedInStep.station.name,
            stepSequence: roll.parent.producedInStep.stepSequence,
          }
          : null,
      }
      : null;

    events.push({
      kind: "CREATED",
      at: roll.createdAt.toISOString(),
      title: entryTitle,
      stationName: null,
      details: {
        barcode: roll.barcode,
        initialQty: roll.initialQty,
        weightKg: roll.weightKg,
        itemCode: roll.item?.code,
        itemName: roll.item?.name,
        itemType: roll.item?.itemType,
        entrySource: roll.entrySource,
        qualityGrade: roll.qualityGrade,
        ...(parentInfo ? { parent: parentInfo } : {}),
      },
      operatorName: roll.createdBy?.fullName ?? roll.createdBy?.username ?? null,
    });

    for (const m of movements) {
      events.push({
        kind: "MOVEMENT_IN",
        at: m.enteredAt.toISOString(),
        title: `${m.step?.station?.name ?? "İstasyon"} – Giriş`,
        stationName: m.step?.station?.name ?? null,
        details: {
          qtyIn: m.qtyIn,
          weightIn: m.weightIn,
          notes: m.notes,
        },
        operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
      });
      if (m.exitedAt) {
        events.push({
          kind: "MOVEMENT_OUT",
          at: m.exitedAt.toISOString(),
          title: `${m.step?.station?.name ?? "İstasyon"} – Çıkış`,
          stationName: m.step?.station?.name ?? null,
          details: {
            qtyOut: m.qtyOut,
            weightOut: m.weightOut,
            qtyIn: m.qtyIn,
            weightIn: m.weightIn,
            notes: m.notes,
          },
          operatorName: m.operator?.fullName ?? m.operator?.username ?? null,
        });
      }
    }

    for (const op of operations) {
      events.push({
        kind: "OPERATION",
        subKind: op.operationType,
        at: op.createdAt.toISOString(),
        title: operationLabel(op.operationType),
        stationName: op.step?.station?.name ?? null,
        details: {
          metadata: op.metadata,
        },
        operatorName: op.operator?.fullName ?? op.operator?.username ?? null,
      });
    }

    for (const di of dispatchItems) {
      events.push({
        kind: "SUBCONTRACTOR_DISPATCH",
        at: di.dispatch.dispatchedAt.toISOString(),
        title: `Fasona Sevk: ${di.dispatch.subcontractor?.name ?? "-"}`,
        stationName: null,
        details: {
          dispatchNo: di.dispatch.dispatchNo,
          subcontractorCode: di.dispatch.subcontractor?.code,
          subcontractorName: di.dispatch.subcontractor?.name,
          dispatchedQty: di.dispatchedQty,
          dispatchedWeight: di.dispatchedWeight,
          plateNumber: di.dispatch.plateNumber,
          driverName: di.dispatch.driverName,
        },
        operatorName:
          di.dispatch.dispatchedBy?.fullName ??
          di.dispatch.dispatchedBy?.username ??
          null,
      });
    }

    for (const ri of receiptItems) {
      events.push({
        kind: "SUBCONTRACTOR_RECEIPT",
        at: ri.receipt.receivedAt.toISOString(),
        title: `Fasondan Kabul: ${ri.receipt.subcontractor?.name ?? "-"}`,
        stationName: null,
        details: {
          receiptNo: ri.receipt.receiptNo,
          manifestNo: ri.receipt.manifestNo,
          subcontractorCode: ri.receipt.subcontractor?.code,
          subcontractorName: ri.receipt.subcontractor?.name,
          notes: ri.notes,
        },
        operatorName:
          ri.receipt.receivedBy?.fullName ??
          ri.receipt.receivedBy?.username ??
          null,
      });
    }

    // Sort: first by timestamp, then by kind order (MOVEMENT_OUT before MOVEMENT_IN
    // before OPERATION) to correctly represent process flow when timestamps coincide.
    // Stable sort preserves original relative order for equal keys.
    // Eşit timestamp'te doğal süreç sırası:
    // istasyondan çıkış → o istasyondaki işlem/karar → sonraki istasyona giriş
    const kindOrder: Record<string, number> = {
      MOVEMENT_OUT: 0,
      OPERATION: 1,
      MOVEMENT_IN: 2,
      SUBCONTRACTOR_DISPATCH: 3,
      SUBCONTRACTOR_RECEIPT: 4,
      CREATED: 5,
    };
    events.sort((a, b) => {
      if (a.at < b.at) return -1;
      if (a.at > b.at) return 1;
      return (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9);
    });

    return {
      success: true,
      data: {
        roll: {
          id: roll.id,
          barcode: roll.barcode,
          status: roll.status,
          currentQty: Number(roll.currentQty),
          initialQty: Number(roll.initialQty),
          weightKg: roll.weightKg !== null ? Number(roll.weightKg) : null,
          item: roll.item,
          color: roll.color,
        },
        events,
      },
    };
  }

  /**
   * Soft-delete (Operatör İptali / Yanlış Giriş): topu CANCELLED'a çeker.
   * Bu fire (SCRAP) DEĞİL — sadece operatör kaydı geri alıyor. Gerçek fire
   * (kalite reddi vb.) için Tambur akışı SCRAP set eder.
   *
   * **İzin verilen statüler:** STOCK, IN_PRODUCTION,
   * A1_STOCK, WAREHOUSE, RETURNED_FROM_SUBCONTRACTOR.
   *
   * **Blok:**
   * - SCRAP / CANCELLED — zaten kapalı (idempotent başarı döner)
   * - AT_SUBCONTRACTOR — fasonda; önce mal kabul yapılmalı
   * - Açık bir SubcontractorDispatch'e bağlı top
   *
   * Yan etkiler:
   * - Açık RollMovement'lar kapatılır (qtyOut=0, not "CANCELLED")
   * - currentStepId temizlenir
   * - Etkilenen step'lerin status'u recompute edilir
   */
  /**
   * Top iptal önizlemesi (GET /rolls/:id/cancel-preview). Salt-okunur.
   * Operatör KK1'de "Sil"e basınca çağrılır → modalda somut etki gösterilir.
   * Sıcak liste yoluna (rolls listesi) DOKUNMAZ — yalnız bu talep-anında
   * endpoint join taşır, böylece liste sorgusu hafif kalır.
   */
  async getCancelPreview(id: string): Promise<ApiResponse<RollCancelPreview>> {
    const roll = await prisma.roll.findUnique({
      where: { id },
      select: {
        id: true,
        barcode: true,
        status: true,
        initialQty: true,
        width: true,
        currentStepId: true,
        shipmentId: true,
        sackId: true,
        item: { select: { name: true } },
        color: { select: { name: true } },
        currentStep: {
          select: {
            id: true,
            station: { select: { name: true, kind: true } },
            workOrder: { select: { id: true, workOrderNumber: true } },
          },
        },
      },
    });
    if (!roll) {
      throw AppError.notFound("Top bulunamadı");
    }

    // Açık (kapanmamış) hareket sayısı — currentStepId null olsa bile aktiflik
    // sinyali olabilir. [rollId, enteredAt desc] indeksli.
    const openMovementCount = await prisma.rollMovement.count({
      where: { rollId: id, exitedAt: null },
    });

    // activeAt: öncelik currentStep; yoksa en güncel açık movement'ın step'i.
    let activeAt: RollCancelPreview["activeAt"] = null;
    if (roll.currentStep) {
      activeAt = {
        stepId: roll.currentStep.id,
        stationName: roll.currentStep.station?.name ?? null,
        stationKind: roll.currentStep.station?.kind ?? null,
        workOrderId: roll.currentStep.workOrder.id,
        batchNumber: roll.currentStep.workOrder.workOrderNumber,
      };
    } else if (openMovementCount > 0) {
      const mv = await prisma.rollMovement.findFirst({
        where: { rollId: id, exitedAt: null },
        orderBy: { enteredAt: "desc" },
        select: {
          step: {
            select: {
              id: true,
              station: { select: { name: true, kind: true } },
              workOrder: { select: { id: true, workOrderNumber: true } },
            },
          },
        },
      });
      if (mv?.step) {
        activeAt = {
          stepId: mv.step.id,
          stationName: mv.step.station?.name ?? null,
          stationKind: mv.step.station?.kind ?? null,
          workOrderId: mv.step.workOrder.id,
          batchNumber: mv.step.workOrder.workOrderNumber,
        };
      }
    }

    // ── Hard-block durumları: softDelete guard sırasıyla BİREBİR aynı ──
    let blockReason: string | null = null;
    if (
      roll.status === RollStatus.CANCELLED ||
      roll.status === RollStatus.SCRAP
    ) {
      blockReason = `Top zaten iptal/hurda: ${roll.barcode}`;
    } else if (roll.status === RollStatus.AT_SUBCONTRACTOR) {
      blockReason = "Fasondaki top iptal edilemez — önce fason mal kabul yapın";
    } else if (!CANCELABLE_ROLL_STATUSES.includes(roll.status)) {
      // F112: softDelete ile aynı beyaz liste — SHIPPED/*_CONSUMED/AT_KARTELA.
      blockReason = nonCancelableRollReason(roll.status);
    } else {
      const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
        where: { rollId: id, dispatch: { cancelledAt: null } },
        select: { id: true },
      });
      if (openDispatch) {
        blockReason =
          "Bu top açık bir fason sevkiyatına bağlı — önce sevki iptal et veya kabul yap";
      } else if (roll.shipmentId) {
        const ship = await prisma.shipment.findUnique({
          where: { id: roll.shipmentId },
          select: { status: true, shipmentNo: true },
        });
        if (ship && ship.status === ShipmentStatus.PLANNED) {
          blockReason = `Bu top planlı bir sevkiyatta (${ship.shipmentNo}) — önce sevkten çıkarın.`;
        }
      } else if (roll.sackId) {
        const sk = await prisma.sack.findUnique({ where: { id: roll.sackId }, select: { shipmentId: true, sackNo: true } });
        if (sk && sk.shipmentId) {
          blockReason = `Bu top sevkiyattaki bir çuvalda (${sk.sackNo}) — önce çuvaldan çıkarın.`;
        }
      }
    }

    const canCancel = blockReason === null;
    // İstasyonda/iş emrinde aktif top: iptal edilebilir ama bilinçli onay şart.
    const requiresConfirm =
      canCancel && (roll.currentStepId != null || openMovementCount > 0);

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        status: roll.status,
        itemName: roll.item?.name ?? null,
        colorName: roll.color?.name ?? null,
        initialQty: Number(roll.initialQty),
        width: roll.width != null ? Number(roll.width) : null,
        canCancel,
        blockReason,
        requiresConfirm,
        activeAt,
        openMovementCount,
      },
    };
  }

  async softDelete(
    id: string,
    userId?: string,
    opts?: { confirmActive?: boolean },
  ): Promise<ApiResponse<Roll>> {
    const existing = await prisma.roll.findUnique({ where: { id } });
    if (!existing) {
      throw AppError.notFound("Top bulunamadı");
    }

    if (
      existing.status === RollStatus.CANCELLED ||
      existing.status === RollStatus.SCRAP
    ) {
      return {
        success: true,
        data: existing,
        message: `Top zaten iptal/hurda: ${existing.barcode}`,
      };
    }
    if (existing.status === RollStatus.AT_SUBCONTRACTOR) {
      throw AppError.conflict(
        "Fasondaki top iptal edilemez — önce fason mal kabul yapın",
      );
    }

    // F112: Pozitif statü beyaz listesi (docstring'i UYGULA). SHIPPED /
    // TAMBUR_CONSUMED / SUBCONTRACTOR_CONSUMED / KARTELA_CONSUMED / AT_KARTELA
    // gibi sevk/tüketim statüleri buraya kadar geliyordu ve iptal edilip
    // shipmentId null'lanabiliyordu — sevk edilmiş mal canlı veriden siliniyordu.
    if (!CANCELABLE_ROLL_STATUSES.includes(existing.status)) {
      throw AppError.conflict(nonCancelableRollReason(existing.status));
    }

    // Açık fason sevkiyatına bağlı mı?
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: {
        rollId: id,
        dispatch: { cancelledAt: null },
      },
      select: { id: true, dispatchId: true },
    });
    if (openDispatch) {
      throw AppError.conflict(
        "Bu top açık bir fason sevkiyatına bağlı — önce sevki iptal et veya kabul yap",
      );
    }

    // Planlı bir sevkiyata veya sevkiyattaki çuvala bağlı mı? Bağlıysa iptal
    // edilemez — önce sevkten/çuvaldan çıkarılmalı (donmuş tahsis/rezerv bayat kalmasın).
    if (existing.shipmentId) {
      const ship = await prisma.shipment.findUnique({
        where: { id: existing.shipmentId },
        select: { status: true, shipmentNo: true },
      });
      if (ship && ship.status === ShipmentStatus.PLANNED) {
        throw AppError.conflict(
          `Bu top planlı bir sevkiyatta (${ship.shipmentNo}) — önce sevkten çıkarın.`,
        );
      }
    } else if (existing.sackId) {
      const sk = await prisma.sack.findUnique({ where: { id: existing.sackId }, select: { shipmentId: true, sackNo: true } });
      if (sk && sk.shipmentId) {
        throw AppError.conflict(
          `Bu top sevkiyattaki bir çuvalda (${sk.sackNo}) — önce çuvaldan çıkarın.`,
        );
      }
    }

    // İstasyonda / iş emrinde AKTİF top (currentStepId set VEYA açık movement):
    // bilinçli onay (confirmActive) olmadan iptal edilmez. Hard-block değil —
    // operatör önizlemeyi onaylarsa geçer. Amaç: yanlış girilip sonradan bir
    // istasyona okutulmuş bir topun KK1'den UYARISIZ düşürülmesini engellemek
    // (silme o adımdan çeker + step status'unu geri sarar). Önizleme endpoint'i
    // (getCancelPreview) operatöre nerede aktif olduğunu gösterir.
    if (!opts?.confirmActive) {
      let activeAtStation = existing.currentStepId != null;
      if (!activeAtStation) {
        const openMv = await prisma.rollMovement.count({
          where: { rollId: id, exitedAt: null },
        });
        activeAtStation = openMv > 0;
      }
      if (activeAtStation) {
        throw AppError.conflict(
          "Bu top bir istasyonda/iş emrinde aktif — iptal için önizlemeyi onaylamanız gerekiyor.",
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Açık RollMovement'ları topla — sonra status recompute için step ID'leri lazım
      const openMovements = await tx.rollMovement.findMany({
        where: { rollId: id, exitedAt: null },
        select: { id: true, workOrderStepId: true },
      });
      const affectedStepIds = new Set<string>();
      for (const m of openMovements) affectedStepIds.add(m.workOrderStepId);
      if (existing.currentStepId) affectedStepIds.add(existing.currentStepId);

      // Açık movement'ları kapat
      if (openMovements.length > 0) {
        await tx.rollMovement.updateMany({
          where: { rollId: id, exitedAt: null },
          data: {
            exitedAt: new Date(),
            qtyOut: 0,
            weightOut: 0,
            notes: "CANCELLED",
          },
        });
      }

      // Top: CANCELLED + currentStepId temizle — ATOMİK CLAIM (M-30): tüm
      // guard'lar (fason/açık sevk/aktif sevkiyat) tx DIŞINDA okundu; pencerede
      // fason dispatch claim'i veya çuvala okutma (shipmentId claim'i) commit
      // ettiyse top fasondayken/çuvaldayken iptal edilirdi. Gözlenen statü +
      // shipmentId koşuluyla kaybeden 409 alır (atomik claim deseni); shipmentId
      // de temizlenir (CANCELLED top sevkiyat rezervi taşıyamaz).
      const cancelClaim = await tx.roll.updateMany({
        where: { id, status: existing.status, shipmentId: existing.shipmentId },
        data: {
          status: RollStatus.CANCELLED,
          currentStepId: null,
          shipmentId: null,
          sackId: null,
        },
      });
      if (cancelClaim.count === 0) {
        throw AppError.conflict(
          "Top bu sırada başka bir işleme girdi (sevk/çuval/fason olabilir) — tekrar deneyin."
        );
      }
      const r = await tx.roll.findUniqueOrThrow({ where: { id } });

      // Etkilenen step'lerin status'unu recompute et
      for (const stepId of affectedStepIds) {
        await recomputeStepStatus(tx, stepId);
      }

      return r;
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: id,
      oldData: {
        status: existing.status,
        currentStepId: existing.currentStepId,
      },
      newData: {
        status: RollStatus.CANCELLED,
        cancelled: true,
      },
    });

    return {
      success: true,
      data: updated,
      message: `Top iptal edildi: ${existing.barcode}`,
    };
  }

  /**
   * Arşivle: STOCK durumundaki bir topu CANCELLED'a çeker. RollError ve
   * RollMovement / RollOperation kayıtları KORUNUR — izlenebilirlik ve
   * audit için. Zaten SCRAP veya CANCELLED ise idempotent (no-op).
   *
   * NOT: Eski "hardDelete" davranışı (fiziksel DELETE + RollError purge)
   * kaldırıldı — CLAUDE.md'deki "asla fiziksel DELETE" kuralı gereği.
   * Method adı route uyumluluğu için korundu; semantik = soft archive.
   */
  async hardDelete(id: string, userId?: string): Promise<ApiResponse<Roll>> {
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
      const claim = await tx.roll.updateMany({
        where: { id, status: RollStatus.STOCK },
        data: {
          status: RollStatus.CANCELLED,
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
      // STOCK topun currentStepId'si normalde null; anomali olarak takılıysa açık
      // movement'ı kapat + step recompute (softDelete hijyeni; defansif).
      if (existing.currentStepId) {
        await tx.rollMovement.updateMany({
          where: { rollId: id, exitedAt: null },
          data: { exitedAt: new Date(), qtyOut: 0, weightOut: 0, notes: "ARCHIVED" },
        });
        await recomputeStepStatus(tx, existing.currentStepId);
      }
      return tx.roll.findUniqueOrThrow({ where: { id } });
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
      newData: { status: RollStatus.CANCELLED, event: "ARCHIVED" },
    });

    return {
      success: true,
      data: updated,
      message: `Top arşivlendi: ${existing.barcode}`,
    };
  }

  /**
   * Manuel renk + özellik override — operatör fason kabul sonrası bir rulonun
   * rengini/özelliklerini elle düzeltebilir. Senaryolar:
   *   - Boyahane mavi vermesi gereken 10 ruloda 2'si yanmazlık tutmamış →
   *     o 2 ruloya yanmazlık atanmaz (manuel kaldır).
   *   - Bir rulo bonus olarak ekstra özellik kazandı → operatör manuel ekler.
   *
   * Replace semantics: gönderilen colorId + propertyIds yeni TAM listedir.
   * Item DEĞİŞMEZ (artık ürün kimliği renk içermiyor).
   */
  async applyManualProperties(
    rollId: string,
    data: { colorId: string | null; propertyIds: string[]; width?: number | null; qualityGrade?: string; currentQty?: number; reason?: string },
    userId?: string,
    /** F221 deseni: sağlanırsa süpervizör kapsamı için `roll:manual-adjust` ENFORCE
     *  edilir. Controller `req.user.permissions`'ı HER ZAMAN geçirir; omit =
     *  güvenilen dahili çağrı (test/servis-içi) → kontrol atlanır. */
    opts?: { permissions?: readonly string[] },
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        barcode: true,
        itemId: true,
        colorId: true,
        status: true,
        width: true,
        qualityGrade: true,
        initialQty: true,
        currentQty: true,
        shipmentId: true,
        shipment: { select: { status: true } },
        sackId: true,
        sack: { select: { shipmentId: true } },
        properties: { select: { propertyId: true } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status === RollStatus.SCRAP || roll.status === RollStatus.CANCELLED) {
      throw AppError.badRequest("Hurda/iptal edilmiş topun rengi/özelliği değiştirilemez");
    }
    // TEK SÖZLEŞME (2026-07-30, F114 revizyonu): statü kapsamı artık TOPUN DURUMUNA
    // bakar, `Boolean(reason)`'a DEĞİL. Eski kurgu iki ucu (relabel / manual-attributes)
    // aynı motoru iki farklı kapsamla çağırıyordu ve iki tuhaflık üretiyordu:
    //   (a) süpervizör istasyondaki topun rengini düzeltebiliyor ama METRAJINI
    //       düzeltemiyordu (depo yolu metrajı alıyordu, süpervizör yolu almıyordu);
    //   (b) kapsamı genişleten şey yetki değil "sebep alanının dolu olması" idi —
    //       koruma örtüktü (yalnız relabel Zod şemasının reason'ı elemesi sayesinde
    //       sömürülemezdi).
    // Yeni kurgu:
    //   ALWAYS_BLOCKED → hiçbir yolla düzeltilemez (sevk↔kabul paritesi + lineage).
    //   FREE_STOCK     → serbest düzeltme: sebep OPSİYONEL, ek yetki yok (depo/mobil).
    //   gerisi (örn. IN_PRODUCTION) → SÜPERVİZÖR: sebep ZORUNLU + `roll:manual-adjust`.
    const ALWAYS_BLOCKED: RollStatus[] = [
      RollStatus.AT_SUBCONTRACTOR,
      RollStatus.AT_KARTELA,
      RollStatus.TAMBUR_CONSUMED,
      RollStatus.SUBCONTRACTOR_CONSUMED,
      RollStatus.KARTELA_CONSUMED,
      RollStatus.RETURNED_FROM_SUBCONTRACTOR,
      RollStatus.SHIPPED,
    ];
    if (ALWAYS_BLOCKED.includes(roll.status)) {
      throw AppError.badRequest(
        "Bu top fason/kartelada, emekliye ayrılmış veya sevk edilmiş — nitelikleri düzeltilemez (sevk↔kabul paritesi ve izlenebilirlik bozulur).",
      );
    }
    const FREE_STOCK: RollStatus[] = [
      RollStatus.STOCK,
      RollStatus.WAREHOUSE,
      RollStatus.A1_STOCK,
    ];
    const needsSupervisor = !FREE_STOCK.includes(roll.status);
    if (needsSupervisor) {
      // F221 deseni: permissions SAĞLANIRSA enforce edilir; omit = güvenilen dahili
      // çağrı (test/servis-içi). Güvenlik sınırı controller'dadır.
      if (
        opts?.permissions !== undefined &&
        !matchesPermission(opts.permissions, "roll:manual-adjust")
      ) {
        // Mesaj İKİ kitleye birden konuşur: depo/mobil operatörü için durum bilgisi
        // ("bu top üretimde, senin yetkin serbest stok içindir"), süpervizör için
        // eksik izin. Yalnız izin adı yazmak depo operatörünü asla alamayacağı bir
        // yetkiye yönlendirirdi (2026-07-31 düzeltmesi).
        throw AppError.forbidden(
          "Bu top serbest satılabilir stokta değil (üretimde) — yalnız süpervizör düzeltebilir ('roll:manual-adjust' yetkisi).",
        );
      }
      if (!data.reason || data.reason.trim().length < 3) {
        throw AppError.badRequest(
          "Bu top serbest satılabilir stokta değil (üretimde) — düzeltme için işlem nedeni (en az 3 karakter) zorunludur.",
        );
      }
    }
    // ÇUVAL HAVUZU: renk/en/kalite değişimi spec-karşılanmayı bozar. Atanmış sevkiyatta
    // (PLANNED/DISPATCHED) VEYA sevkiyattaki çuvalda → reddet (önce çuvaldan çıkar /
    // sevkten çıkar). Açık çuval + serbest WAREHOUSE/STOCK serbest.
    if (roll.shipmentId) {
      throw AppError.conflict(
        "Bu top bir sevkiyata atanmış — etiketi değiştirmeden önce sevkiyattan çıkarın.",
      );
    }
    if (roll.sack && roll.sack.shipmentId != null) {
      throw AppError.conflict(
        "Bu top sevkiyattaki bir çuvalda — etiketi değiştirmeden önce çuvaldan çıkarın.",
      );
    }
    if (data.width !== undefined && data.width !== null && !(data.width > 0)) {
      throw AppError.badRequest("Geçerli bir en (cm) girilmeli");
    }
    // Metraj düzeltmesi — kısmen tüketilmiş topta reddet (currentQty < initialQty →
    // geçmişi sessizce silmemek için); yalnız bütün toplarda (initialQty == currentQty)
    // düzeltmeye izin ver, initialQty ile birlikte güncelle.
    const rollWhole = roll.initialQty.equals(roll.currentQty);
    if (data.currentQty !== undefined) {
      if (!(data.currentQty > 0)) throw AppError.badRequest("Geçerli bir metraj (mt) girilmeli");
      if (!rollWhole) {
        throw AppError.conflict(
          "Bu top kısmen tüketilmiş (kesim/tüketim geçmişi var) — metrajı buradan düzeltilemez.",
        );
      }
    }

    // Catalog doğrulamaları (varsa)
    if (data.colorId) {
      const c = await prisma.color.findUnique({
        where: { id: data.colorId },
        select: { isActive: true },
      });
      if (!c || !c.isActive) {
        throw AppError.badRequest("Renk bulunamadı veya pasif");
      }
      // Item allowed list (boş → serbest)
      const allowedCount = await prisma.itemAllowedColor.count({
        where: { itemId: roll.itemId },
      });
      if (allowedCount > 0) {
        const inAllowed = await prisma.itemAllowedColor.findUnique({
          where: { itemId_colorId: { itemId: roll.itemId, colorId: data.colorId } },
        });
        if (!inAllowed) {
          throw AppError.badRequest(
            "Seçilen renk bu ürüne uygulanabilir renk listesinde değil",
          );
        }
      }
    }
    const dedupedProps = [...new Set(data.propertyIds)];
    if (dedupedProps.length > 0) {
      const props = await prisma.fabricProperty.findMany({
        where: { id: { in: dedupedProps }, isActive: true },
        select: { id: true },
      });
      if (props.length !== dedupedProps.length) {
        throw AppError.badRequest("Bazı özellikler bulunamadı veya pasif");
      }
      // Item allowed-property listesi (boş → serbest) — createInitialEntry PARİTE.
      // Yeniden-etiketlemede de seçilen özellikler ürünün uygulanabilir listesinde
      // olmalı; aksi halde create-path'te reddedilen kombinasyon relabel'la sızardı.
      const allowedPropCount = await prisma.itemAllowedProperty.count({
        where: { itemId: roll.itemId },
      });
      if (allowedPropCount > 0) {
        const inAllowed = await prisma.itemAllowedProperty.findMany({
          where: { itemId: roll.itemId, propertyId: { in: dedupedProps } },
          select: { propertyId: true },
        });
        if (inAllowed.length !== dedupedProps.length) {
          throw AppError.badRequest(
            "Seçilen özelliklerden biri bu ürüne uygulanabilir listesinde değil",
          );
        }
      }
    }

    // Roll skaler güncellemeleri (renk her zaman; en/kalite verildiyse).
    const rollData: Prisma.RollUncheckedUpdateManyInput = {};
    if (roll.colorId !== data.colorId) rollData.colorId = data.colorId;
    if (data.width !== undefined) rollData.width = data.width === null ? null : new Prisma.Decimal(data.width);
    // Metraj: bütün topta initialQty + currentQty birlikte güncellenir (ölçüm düzeltmesi);
    // değer aynıysa no-op. rollWhole guard yukarıda garantiledi.
    if (data.currentQty !== undefined && !roll.currentQty.equals(new Prisma.Decimal(data.currentQty))) {
      const m = new Prisma.Decimal(data.currentQty);
      rollData.currentQty = m;
      rollData.initialQty = m;
    }
    if (data.qualityGrade !== undefined && data.qualityGrade.trim()) {
      // Soft-delete giriş guard'ı (createInitialEntry/tambur finalize ile PARİTE):
      // operatör girdisi kataloğa karşı SIKI doğrulanır (bilinmeyen/pasif kod → 400),
      // ve canonical FK (qualityGradeId) snapshot ile BİRLİKTE yazılır — yoksa
      // snapshot↔FK ayrışır (qualityGradeRef raporları bayatlar) + typo'lu kod
      // FIRE-dışlama filtresinden kaçıp byQuality istatistiklerini bölerdi.
      const code = data.qualityGrade.trim();
      rollData.qualityGradeId = await resolveQualityGradeIdStrict(code);
      rollData.qualityGrade = code;
    }

    // Etiket bayat: etiket-görünür bir alan (renk/en/metraj/kalite/özellik) GERÇEKTEN
    // değiştiyse topun fiziksel etiketi artık uyuşmuyor → labelDirty=true (baskıda temizlenir).
    // NOT: kalite/en blokları değer aynı olsa da yazılabildiğinden (FK self-heal / unconditional),
    // "değişti mi"yi Object.keys(rollData) yerine alan-alan karşılaştır → no-op kayıtta dirty olmaz.
    const existingPropIds = new Set(roll.properties.map((p) => p.propertyId));
    const propsChanged =
      dedupedProps.length !== existingPropIds.size || dedupedProps.some((id) => !existingPropIds.has(id));
    const oldWidth = roll.width == null ? null : Number(roll.width);
    const widthChanged = data.width !== undefined && data.width !== oldWidth;
    const colorChanged = roll.colorId !== data.colorId;
    const metrajChanged =
      data.currentQty !== undefined && !roll.currentQty.equals(new Prisma.Decimal(data.currentQty));
    const qualityChanged =
      data.qualityGrade !== undefined &&
      data.qualityGrade.trim() !== "" &&
      data.qualityGrade.trim() !== roll.qualityGrade;
    if (colorChanged || widthChanged || metrajChanged || qualityChanged || propsChanged) {
      rollData.labelDirty = true;
    }

    await prisma.$transaction(async (tx) => {
      // TOCTOU (çuval havuzu): pre-tx kontrol tx DIŞINDA okundu — top bu sırada bir
      // sevkiyata atanmış olabilir (renk/en değişimi donmuş/havuz tahsisini bozar).
      // Çözüm: bağı tx İÇİNDE taze oku; atanmışsa 409; çuvaldaysa
      // touchWarehouseSackTx ile çuval satırına serileş; yazımı pinle.
      const cur = await tx.roll.findUnique({ where: { id: rollId }, select: { shipmentId: true, sackId: true } });
      if (!cur) throw AppError.notFound("Top bulunamadı");
      if (cur.shipmentId) {
        throw AppError.conflict("Top bu sırada bir sevkiyata atandı — etiketi değiştirmeden önce sevkiyattan çıkarın.");
      }
      if (cur.sackId) {
        await touchWarehouseSackTx(tx, cur.sackId);
      }

      // 1) Roll skaler alanları (renk/en/kalite) — üyelik PİNLİ atomik claim (serbest kalır).
      if (Object.keys(rollData).length > 0) {
        const upd = await tx.roll.updateMany({
          where: { id: rollId, shipmentId: null, sackId: cur.sackId },
          data: rollData,
        });
        if (upd.count === 0) {
          throw AppError.conflict(
            "Top bu sırada bir sevkiyata okutuldu/çıkarıldı — etiket güncellenemedi, yenileyip tekrar deneyin",
          );
        }
      }

      // 2) Roll.properties replace
      await tx.rollProperty.deleteMany({ where: { rollId } });
      if (dedupedProps.length > 0) {
        await tx.rollProperty.createMany({
          data: dedupedProps.map((propertyId) => ({ rollId, propertyId })),
        });
      }

    });

    // F119: audit tx-DIŞI (best-effort konvansiyonu — bu dosyadaki diğer tüm CUD
    // gibi). oldData/newData tx öncesi yüklenen `roll` + `data` + `dedupedProps`
    // kapsamda kalır; yazım hatası mutasyonu düşürmez.
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL_MANUAL_OVERRIDE",
      recordId: rollId,
      oldData: {
        colorId: roll.colorId,
        width: roll.width != null ? Number(roll.width) : null,
        qualityGrade: roll.qualityGrade,
        currentQty: Number(roll.currentQty),
      },
      newData: {
        colorId: data.colorId,
        propertyIds: dedupedProps,
        width: data.width,
        qualityGrade: data.qualityGrade,
        currentQty: data.currentQty ?? null,
        reason: data.reason ?? null,
        // Saha akışı (Yeniden Etiketle) sebep göndermez → RELABEL; süpervizör
        // "Manuel Düzelt" zorunlu sebep gönderir → MANUAL_ATTRIBUTE.
        event: data.reason ? "MANUAL_ATTRIBUTE" : "RELABEL",
      },
    });

    return {
      success: true,
      data: {
        rollId,
        colorId: data.colorId,
        propertyIds: dedupedProps,
        width: data.width,
        qualityGrade: data.qualityGrade,
        currentQty: data.currentQty,
      },
      message: `Top etiketi güncellendi`,
    };
  }

  /**
   * Saha #10: ham/stok kumaşı doğrudan satışa hazırla — STOCK topu WAREHOUSE'a
   * geçirir (sevke hazır). Fabrika işlemeden gelen ham kumaş bu yolla sevk akışına
   * girer (kapsama renk-null spec eşleşmesiyle çalışır). Guard: top serbest olmalı
   * — bir WO adımında/sevkiyatta/fasonda DEĞİL. Sadece STOCK → WAREHOUSE.
   */
  async prepareRawForSale(rollId: string, userId?: string): Promise<ApiResponse<Record<string, unknown>>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: { id: true, barcode: true, status: true, shipmentId: true, currentStepId: true },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status === RollStatus.WAREHOUSE) {
      return { success: true, data: { rollId, status: "WAREHOUSE" }, message: "Top zaten sevke hazır (depoda)" };
    }
    if (roll.status !== RollStatus.STOCK) {
      throw AppError.badRequest(`Yalnız STOCK topu satışa hazırlanabilir (bu top: ${roll.status})`);
    }
    if (roll.shipmentId) throw AppError.conflict("Top bir sevkiyatta — önce çıkarın");
    if (roll.currentStepId) throw AppError.conflict("Top bir iş emri adımında — önce üretimden çıkarın");
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId, dispatch: { cancelledAt: null } },
      select: { id: true },
    });
    if (openDispatch) throw AppError.conflict("Top açık bir fason sevkiyatında");

    // Atomik: hâlâ STOCK + serbest iken WAREHOUSE'a çek.
    const claimed = await prisma.roll.updateMany({
      where: { id: rollId, status: RollStatus.STOCK, shipmentId: null, currentStepId: null },
      data: { status: RollStatus.WAREHOUSE },
    });
    if (claimed.count === 0) {
      throw AppError.conflict("Top az önce başka bir akışa girdi — tekrar deneyin");
    }
    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: { kind: "RAW_FOR_SALE", status: "WAREHOUSE", barcode: roll.barcode },
    });
    return { success: true, data: { rollId, status: "WAREHOUSE" }, message: "Ham top satışa hazırlandı (depoya alındı)" };
  }

  // ===========================================================================
  // OPEN FABRIC — Kurşun/KK2'de açık kumaş Roll oluştur
  // ===========================================================================
  //
  // Senaryo: Boyahaneden açık kumaş döndü; SubcontractorReceipt oluşturuldu;
  // orijinal Roll'lar SUBCONTRACTOR_CONSUMED'a çekildi. Şimdi Kurşun/KK2
  // operatörü "yeni kumaş aç" der → bu endpoint çağrılır.
  //
  // Yeni Roll:
  //   - barcode: NULL (etiket basılmaz, fiziksel takip arabada)
  //   - colorId / properties: receipt'ten inherit
  //   - itemId: WO.targetItemId
  //   - currentStepId / producedInStepId: Kurşun/KK2 step (PROCESS_QC)
  //   - parentReceiptId: kaynak receipt referansı (lineage)
  //   - initialQty / currentQty: 0 (ölçüm kursun-finish'te yapılır)
  //
  async createOpenFabric(
    data: {
      receiptId: string;
      stepId: string; // Kurşun/KK2 (PROCESS_QC) step
      notes?: string | null;
      /** İdempotency anahtarı — çift çağrı (retry) ikinci hayalet açık-kumaş
       *  doğurmasın (Roll.clientToken @unique; createInitialEntry emsali). */
      clientToken?: string | null;
    },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    const receipt = await prisma.subcontractorReceipt.findUnique({
      where: { id: data.receiptId },
      include: {
        appliedProperties: { select: { propertyId: true } },
        workOrder: {
          select: { id: true, status: true, targetItemId: true },
        },
      },
    });
    if (!receipt) throw AppError.notFound("Mal kabul belgesi bulunamadı");
    if (receipt.cancelledAt) {
      throw AppError.badRequest("İptal edilmiş mal kabul üzerinden yeni kumaş açılamaz");
    }
    if (receipt.workOrder.status === WorkOrderStatus.COMPLETED) {
      throw AppError.conflict("İş emri tamamlanmış");
    }
    if (!receipt.workOrder.targetItemId) {
      throw AppError.badRequest("İş emrinde hedef ürün (targetItem) tanımlı değil");
    }

    const step = await prisma.workOrderStep.findUnique({
      where: { id: data.stepId },
      include: {
        station: { select: { kind: true } },
      },
    });
    if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
    if (step.workOrderId !== receipt.workOrderId) {
      throw AppError.badRequest("Adım bu iş emrine ait değil");
    }
    if (step.station.kind !== StationKind.PROCESS_QC) {
      throw AppError.badRequest(
        "Açık kumaş Roll sadece PROCESS_QC (Kurşun/KK2) istasyonunda açılabilir",
      );
    }
    if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
      throw AppError.conflict(
        `Adım kapalı (${step.status}) — açık kumaş açılamaz`,
      );
    }

    const propertyIds = receipt.appliedProperties.map((p) => p.propertyId);

    let roll: Roll;
    try {
      roll = await prisma.$transaction(async (tx) => {
      // F115: WO satırını tx başında kilitle → cancelReceipt (o da tx başında
      // touchWorkOrderTx alır) ve WO-completion yollarıyla serileş. Guard'ları
      // kilit ALTINDA TAZE oku — pre-tx guard'lar (2197-2227) yalnız UX; araya
      // giren cancelReceipt/WO-tamamlama commit ederse iptalli/tamamlanmış
      // parent'a hayalet IN_PRODUCTION top doğardı (write-skew).
      await touchWorkOrderTx(tx, receipt.workOrderId);

      const fr = await tx.subcontractorReceipt.findUnique({
        where: { id: data.receiptId },
        select: {
          cancelledAt: true,
          workOrder: { select: { status: true, targetItemId: true } },
        },
      });
      if (!fr) throw AppError.notFound("Mal kabul belgesi bulunamadı");
      if (fr.cancelledAt) {
        throw AppError.conflict("Mal kabul bu sırada iptal edildi — açık kumaş açılamaz");
      }
      if (fr.workOrder.status === WorkOrderStatus.COMPLETED) {
        throw AppError.conflict("İş emri bu sırada tamamlandı — açık kumaş açılamaz");
      }
      if (!fr.workOrder.targetItemId) {
        throw AppError.badRequest("İş emrinde hedef ürün (targetItem) tanımlı değil");
      }
      const fs = await tx.workOrderStep.findUnique({
        where: { id: data.stepId },
        select: { status: true },
      });
      if (!fs) throw AppError.notFound("İş emri adımı bulunamadı");
      if (fs.status === StepStatus.COMPLETED || fs.status === StepStatus.SKIPPED) {
        throw AppError.conflict(`Adım bu sırada kapandı (${fs.status}) — açık kumaş açılamaz`);
      }

      const created = await tx.roll.create({
        data: {
          barcode: null,
          clientToken: data.clientToken ?? null,
          itemId: fr.workOrder.targetItemId,
          colorId: receipt.appliedColorId,
          initialQty: 0,
          currentQty: 0,
          status: RollStatus.IN_PRODUCTION,
          // Açık kumaş (Tambur'dan geçmedi) → form ACIK.
          form: RollForm.ACIK,
          // Açık kumaş, kaliteye bakılmadı → qualityGrade null (Tambur karar verir).
          qualityGrade: null,
          qualityGradeId: null,
          entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
          createdById: userId ?? null,
          currentStepId: step.id,
          producedInStepId: step.id,
          parentReceiptId: receipt.id,
        },
      });

      if (propertyIds.length > 0) {
        await tx.rollProperty.createMany({
          data: propertyIds.map((propertyId) => ({
            rollId: created.id,
            propertyId,
          })),
          skipDuplicates: true,
        });
      }

      // Kurşun/KK2 step'ine "girdi" — açık movement (ölçüm yok henüz; kursun-finish kapatır).
      await tx.rollMovement.create({
        data: {
          rollId: created.id,
          workOrderStepId: step.id,
          qtyIn: 0, // henüz ölçülmedi (Roll.initialQty = 0); kursun-finish'te qtyOut measured yazılır
          weightIn: null,
          operatorId: userId ?? null,
          notes: data.notes ?? `OPEN_FABRIC_FROM_RECEIPT:${receipt.receiptNo}`,
        },
      });

      await recomputeStepStatus(tx, step.id);
      await ensureWorkOrderInProgress(tx, receipt.workOrderId);

      return created;
      });
    } catch (err) {
      // İdempotent replay (createInitialEntry emsali): aynı clientToken'la 2. çağrı
      // → mevcut açık-kumaş Roll'u dön (audit ilk çağrıda yazıldı). Catch tx DIŞINDA
      // — PG aborted-tx tuzağına girmez.
      if (data.clientToken && isClientTokenP2002(err)) {
        const existing = await prisma.roll.findUnique({
          where: { clientToken: data.clientToken },
        });
        if (existing) {
          return {
            success: true,
            data: existing,
            message: `Açık kumaş zaten açılmış (idempotent retry, id: ${existing.id}).`,
          };
        }
      }
      throw err;
    }

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: "ROLL",
      recordId: roll.id,
      newData: {
        rollKind: "OPEN_FABRIC",
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        workOrderId: receipt.workOrderId,
        stepId: step.id,
        appliedColorId: receipt.appliedColorId,
        appliedPropertyIds: propertyIds,
      },
    });

    return {
      success: true,
      data: roll,
      message: `Açık kumaş Roll oluşturuldu (id: ${roll.id}). Kurşun/KK2 sonrası kursun-finish endpoint'i ile metraj + hata girilir.`,
    };
  }

  // ===========================================================================
  // KURTARMA — İstasyonda takılı (IN_PRODUCTION) topu depoya al ("İstasyondan Kurtar")
  // ===========================================================================
  //
  // Senaryo: Bir top makinede/istasyonda IN_PRODUCTION olarak takılı kaldı
  // (operatör bitiremedi, süreç yarıda kesildi). Süpervizör topu istasyondan
  // kurtarır: açık hareketler FİZİKSEL çıkışla kapatılır (top metresiyle çıktı —
  // softDelete'in "hiç olmadı" semantiği DEĞİL), top WAREHOUSE'a alınır ve
  // barkodsuzsa "her kumaşa etiket" (F4) gereği final barkod üretilir.

  /**
   * İstasyonda takılı (IN_PRODUCTION) top için kurtarma önizlemesi — salt-okunur.
   * eligible yalnız IN_PRODUCTION topta true; açık fason sevki engel olarak raporlanır.
   */
  async getRescuePreview(rollId: string): Promise<ApiResponse<RescuePreview>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        currentStepId: true,
        shipmentId: true,
        sackId: true,
        item: { select: { name: true } },
        currentStep: { select: { station: { select: { name: true } } } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const blockReasons: string[] = [];
    let eligible = roll.status === RollStatus.IN_PRODUCTION;
    if (roll.status !== RollStatus.IN_PRODUCTION) {
      blockReasons.push(
        `Top üretimde değil (durum: ${roll.status}) — kurtarma yalnız makinede/istasyonda takılı toplar için`,
      );
    }
    // Açık (iptal edilmemiş) fason sevkine bağlı top kurtarılamaz — önce fason
    // kapatılmalı (iptal-önizleme/softDelete guard'larıyla aynı invariant deseni).
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId, dispatch: { cancelledAt: null } },
      select: { id: true },
    });
    if (openDispatch) {
      blockReasons.push("Top açık bir fason sevkine bağlı — önce fasonu kapatın");
    }
    const openMovementCount = await prisma.rollMovement.count({
      where: { rollId, exitedAt: null },
    });
    eligible = eligible && blockReasons.length === 0;

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        itemName: roll.item.name,
        currentStatus: roll.status,
        eligible,
        blockReasons,
        stationName: roll.currentStep?.station.name ?? null,
        openMovementCount,
        willGenerateBarcode: roll.barcode == null,
      },
    };
  }

  /**
   * İstasyonda takılı (IN_PRODUCTION) topu kurtarır → WAREHOUSE. Açık hareketler
   * fiziksel çıkışla kapatılır (qtyOut/weightOut = topun mevcut ölçüsü; top
   * metresiyle istasyondan ayrıldı — softDelete "hiç olmadı" DEĞİL). Barkodsuzsa
   * final barkod üretilir (F4).
   *
   * Recompute semantiği: kapanan movement "geçti" sayılır → adım/WO oto-COMPLETE
   * olabilir; dokunulmamış PENDING adımlar WO'yu bloklar (operatör WO'yu ayrıca iptal eder).
   */
  async rescueStuckRoll(
    rollId: string,
    data: { reason: string },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    const reason = data.reason.trim();
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni (en az 3 karakter) zorunludur");
    }

    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        status: true,
        currentStepId: true,
        weightKg: true,
        currentQty: true,
        barcode: true,
        qualityGrade: true,
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.status !== RollStatus.IN_PRODUCTION) {
      throw AppError.conflict(
        "Bu top üretimde değil — kurtarma yalnız istasyonda takılı toplar için",
      );
    }

    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId, dispatch: { cancelledAt: null } },
      select: { id: true },
    });
    if (openDispatch) {
      throw AppError.conflict("Top açık bir fason sevkine bağlı — önce fasonu kapatın");
    }

    const rescued = await prisma.$transaction(async (tx) => {
      // Açık hareketler + bağlı adımlar (+ currentStep) — recompute hedefleri.
      const openMoves = await tx.rollMovement.findMany({
        where: { rollId, exitedAt: null },
        select: { id: true, workOrderStepId: true },
      });
      const affectedStepIds = Array.from(
        new Set(
          [...openMoves.map((m) => m.workOrderStepId), roll.currentStepId].filter(
            (s): s is string => !!s,
          ),
        ),
      );

      // WO id currentStep üzerinden çözülür; touchWorkOrderTx write-skew guard'ı
      // recompute/complete ÖNCESİ alınır (son-adım oto-tamamlama paritesi).
      const woId = roll.currentStepId
        ? (
            await tx.workOrderStep.findUnique({
              where: { id: roll.currentStepId },
              select: { workOrderId: true },
            })
          )?.workOrderId ?? null
        : null;
      if (woId) await touchWorkOrderTx(tx, woId);

      // Açık hareketleri FİZİKSEL çıkışla kapat (top metresiyle çıktı).
      await tx.rollMovement.updateMany({
        where: { rollId, exitedAt: null },
        data: {
          exitedAt: new Date(),
          qtyOut: roll.currentQty,
          weightOut: roll.weightKg,
          notes: "RESCUED_FROM_PRODUCTION",
        },
      });

      // Atomik claim — IN_PRODUCTION + serbest (shipment/sack null) iken WAREHOUSE'a çek.
      const claim = await tx.roll.updateMany({
        where: {
          id: rollId,
          status: RollStatus.IN_PRODUCTION,
          shipmentId: null,
          sackId: null,
        },
        data: { status: RollStatus.WAREHOUSE, currentStepId: null },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Top bu sırada başka bir işleme girdi — yenileyip tekrar deneyin",
        );
      }

      // "her kumaşa etiket" (F4) — barkodsuzsa final (WAREHOUSE) barkod üret.
      if (roll.barcode == null) {
        const bc = await generateRollBarcode(tx, finalBarcodeType(RollStatus.WAREHOUSE));
        await tx.roll.update({ where: { id: rollId }, data: { barcode: bc } });
      }

      // Kapanan movement "geçti" → adım/WO oto-COMPLETE olabilir.
      for (const sid of affectedStepIds) await recomputeStepStatus(tx, sid);
      if (woId) await completeWorkOrderIfStepsDone(tx, woId);

      return tx.roll.findUniqueOrThrow({ where: { id: rollId } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      newData: {
        event: "RESCUE_STUCK_ROLL",
        from: RollStatus.IN_PRODUCTION,
        to: RollStatus.WAREHOUSE,
        reason,
      },
    });

    return {
      success: true,
      data: rescued,
      message: "Top istasyondan kurtarıldı ve depoya alındı",
    };
  }

  // ===========================================================================
  // KURSUN-FINISH — Kurşun/KK2 sonu: metraj + hata + Tambur'a ilerlet
  // ===========================================================================
  //
  // Açık kumaş Roll'unun ölçümü tamamlanır:
  //   - currentQty / initialQty = totalMeters (cihazda gözüken)
  //   - RollError'lar toplu insert (sadece startMeter zorunlu)
  //   - RollOperation: QC2_COMPLETED her zaman, KURSUN_APPLIED istasyonun
  //     KURSUN yeteneği varsa
  //   - İstasyonun propertyCapabilities listesi Roll'a RollProperty olarak kopyalanır
  //   - Kurşun/KK2 movement'ı kapatılır (qtyOut=totalMeters, exitedAt=now)
  //   - Sonraki step (Tambur) için RollMovement açılır + Roll.currentStepId güncellenir
  //
  async kursunFinish(
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
            station: { select: { kind: true } },
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
    if (
      !roll.currentStep ||
      roll.currentStep.station.kind !== StationKind.PROCESS_QC
    ) {
      const priorFinish = await prisma.rollOperation.findFirst({
        where: {
          rollId,
          operationType: RollOperationType.QC2_COMPLETED,
          step: { station: { kind: StationKind.PROCESS_QC } },
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
      if (!roll.currentStep) {
        throw AppError.badRequest("Roll bir step'te değil");
      }
      throw AppError.badRequest(
        `Roll PROCESS_QC step'inde değil (mevcut: ${roll.currentStep.station.kind})`,
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

    // Hata validasyonu — sadece nokta (startMeter)
    const errors = data.errors ?? [];
    for (const e of errors) {
      if (e.startMeter < 0 || e.startMeter > totalMeters) {
        throw AppError.badRequest(
          `Hata metresi (${e.startMeter}) 0 ile ${totalMeters} arasında olmalı`,
        );
      }
    }

    // DefectType doğrulamaları (varsa) — M-28: isActive da aranır (pasif hata
    // tipiyle kayıt açılamaz — soft-delete giriş guard'ı); eskiden birebir aynı
    // findMany iki kez koşuyordu, tek sorguya indirildi.
    const defectIds = [...new Set(errors.map((e) => e.defectTypeId).filter((x): x is string => !!x))];
    const defectMap = new Map<string, string>();
    if (defectIds.length > 0) {
      const found = await prisma.defectType.findMany({
        where: { id: { in: defectIds }, isActive: true },
        select: { id: true, name: true },
      });
      if (found.length !== defectIds.length) {
        throw AppError.badRequest("Bazı hata tipleri bulunamadı veya pasif");
      }
      for (const d of found) defectMap.set(d.id, d.name);
    }

    const allSteps = roll.currentStep.workOrder.steps;
    const currentIndex = allSteps.findIndex((s) => s.id === roll.currentStepId);
    const nextStep = currentIndex < allSteps.length - 1 ? allSteps[currentIndex + 1] : null;

    const stepId = roll.currentStep.id;
    const stationId = roll.currentStep.stationId;
    const woId = roll.currentStep.workOrderId;

    // Kurşun yeteneği per-station: istasyona KURSUN özelliği atanmışsa
    // KURSUN_APPLIED log'u atılır + RollProperty(KURSUN) otomatik kazanılır.
    const hasKursunCap = await prisma.stationProperty.findFirst({
      where: { stationId, property: { code: "KURSUN" } },
      select: { id: true },
    });

    // Eşzamanlı çift çağrıda kaybeden tx movement kapatmada 0 satır eşler →
    // tüm tx (mükerrer RollError'lar dahil) geri sarılır, idempotent cevap döner.
    let raceLost = false;
    try {
    await prisma.$transaction(async (tx) => {
      // F162: O-2 write-skew guard (finishStep paritesi) — son-adım WO oto-tamamlama
      // sayımını eşzamanlı fason receive/cancel/finalize ile serileştir.
      await touchWorkOrderTx(tx, woId);

      // 1) Roll metraj güncelle
      await tx.roll.update({
        where: { id: rollId },
        data: {
          initialQty: totalMeters,
          currentQty: totalMeters,
        },
      });

      // 2) RollError'lar toplu insert
      if (errors.length > 0) {
        await tx.rollError.createMany({
          data: errors.map((e) => ({
            rollId,
            startMeter: e.startMeter,
            defectTypeId: e.defectTypeId ?? null,
            errorType: e.defectTypeId ? defectMap.get(e.defectTypeId) ?? null : null,
            detectedAtStepId: stepId,
            detectedByUserId: userId ?? null,
          })),
        });
      }

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
            errorCount: errors.length,
            notes: data.notes ?? null,
          } as Prisma.InputJsonValue,
        },
      ];
      if (hasKursunCap) {
        ops.push({
          rollId,
          workOrderStepId: stepId,
          operationType: RollOperationType.KURSUN_APPLIED,
          operatorId: userId ?? null,
          machineId: machineId ?? null,
          metadata: { totalMeters: totalMeters } as Prisma.InputJsonValue,
        });
      }
      await tx.rollOperation.createMany({ data: ops, skipDuplicates: true });

      // 3b) İstasyon yetenekleri (propertyCapabilities) Roll'a kopyalanır.
      await copyStationCapabilitiesToRoll(tx, { stationId, rollId });

      // 4) Kurşun/KK2 movement'ı kapat (qtyOut = ölçülen toplam metre)
      //    ATOMİK CLAIM (BL-3 kardeşi): idempotency guard'ı tx DIŞINDA — iki
      //    eşzamanlı çağrı ikisi de geçer ve Tambur'da İKİNCİ açık movement +
      //    mükerrer RollError üretirdi. 0 satır = kaybeden → tx geri sar.
      const closedMove = await tx.rollMovement.updateMany({
        where: {
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
        await finalizeRollsAtLastStep(tx, [rollId]);
      }

      await recomputeStepStatus(tx, stepId);
      await ensureWorkOrderInProgress(tx, woId);
      // F162: rota PROCESS_QC ile bitiyorsa (nextStep yok) ve tüm adımlar bittiyse
      // WO + refakat kartı COMPLETED'a çekilir — 'sonsuza-dek IN_PROGRESS' bug'ı kapanır.
      if (!nextStep) {
        await completeWorkOrderIfStepsDone(tx, woId);
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
        errorCount: errors.length,
        nextStepId: nextStep?.id ?? null,
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
}
