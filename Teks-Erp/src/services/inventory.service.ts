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
import { ApiResponse, PaginatedResponse, QueryParams } from "../types/api.types";
import { resolveQualityGradeId, resolveQualityGradeIdStrict } from "./helpers/quality-grade.helper";
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

// Manuel durum düzeltme — DENY-BY-DEFAULT whitelist. Yalnız güvenli, tersine
// çevrilebilir, istasyon/sevk-dışı geçişler. EXCLUSIVE akış durumları
// (AT_SUBCONTRACTOR/SHIPPED/TAMBUR_CONSUMED/SUBCONTRACTOR_CONSUMED/KARTELA/
// IN_PRODUCTION) burada YOK — onlar kendi servisleriyle yönetilir. IN_PRODUCTION'a
// alma "Üretime Geri Al" (recoverOpenFabricToProduction); iptal softDelete; fire Tambur.
// NOT: enum ÜYESİ ({[RollStatus.WAREHOUSE]: ...}) yerine string literal kullanılır —
// modül-yükleme sırasında @prisma/client (client_1) henüz init olmadan bu top-level
// sabit değerlendirildiğinde "Cannot access 'client_1' before initialization" TDZ
// crash'i oluyordu (tam-server döngülü import yük sırasında). RollStatus değerleri
// runtime'da bu string'lerin aynısı; tip `as` ile korunur, çalışma anı dereference yok.
const MANUAL_STATUS_TRANSITIONS = {
  WAREHOUSE: ["STOCK"],
  STOCK: ["WAREHOUSE"],
  PRODUCED: ["WAREHOUSE"],
} as Partial<Record<RollStatus, RollStatus[]>>;
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

/** "Üretime Geri Al" için uygun bir Tambur adımı (kurtarma hedefi). */
export interface RecoveryTarget {
  workOrderId: string;
  batchNumber: string;
  workOrderStatus: WorkOrderStatus;
  stepId: string;
  stationName: string;
  stepStatus: StepStatus;
}

/** Takılı açık-kumaş orphan için kurtarma önizlemesi (salt-okunur). */
export interface RecoveryTargetsResult {
  roll: {
    id: string;
    itemId: string;
    itemName: string;
    currentQty: number;
    qualityGrade: string;
  };
  /** Top "üretime geri al" için uygun bir orphan mı? */
  eligible: boolean;
  /** eligible=false ise neden. */
  reason?: string;
  eligibleTargets: RecoveryTarget[];
  /** Bilgilendirme (örn. uygun açık iş emri yok). */
  warnings: string[];
}

/** Manuel durum düzeltme önizlemesi (salt-okunur). */
export interface StatusOverridePreview {
  rollId: string;
  barcode: string | null;
  itemName: string;
  currentStatus: RollStatus;
  /** İzinli (whitelist) hedef durumlar — engel varsa boş. */
  allowedTargets: RollStatus[];
  /** Geçişi engelleyen nedenler (sevkiyat/çuval/istasyon/fason). */
  blockReasons: string[];
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
  /** Donmuş kalite snapshot string'i (örn "1.KALITE") — relabel PATCH'i bunu yazar. */
  qualityGrade: string;
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
  RollStatus.PRODUCED,
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
    machineId?: string | null
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

    // Tüm item tipleri (fabric, yarn, consumable, vb) tedarikçiden gelir → SUPPLIER_RECEIPT.
    const entrySource: RollEntrySource = RollEntrySource.SUPPLIER_RECEIPT;

    // Operatör explicit kalite verdiyse SIKI doğrula (katalog + aktif —
    // soft-delete giriş guard'ı; typo'lu kod byQuality istatistiklerini
    // parçalayıp FIRE-dışlama string filtresinden kaçıyordu); default sabit
    // "1.KALITE" lenient kalır.
    // F120: Boş/whitespace kalite = 'verilmedi' → default lenient path (aksi halde
    // qualityGrade="" + qualityGradeId=null katalog-dışı snapshot sızıyordu).
    const trimmedQuality = data.qualityGrade?.trim();
    const qualityGradeCode = trimmedQuality || "1.KALITE";
    const qualityGradeId = trimmedQuality
      ? await resolveQualityGradeIdStrict(qualityGradeCode)
      : await resolveQualityGradeId(qualityGradeCode);

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
          RollStatus.PRODUCED,
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
      where.qualityGrade = { not: "FIRE" };
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
        in: [RollStatus.WAREHOUSE, RollStatus.A1_STOCK, RollStatus.PRODUCED],
      });
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
    // 'free'      = serbest depo (shipmentId null) — yalnız satılabilir/okutulabilir stok.
    // 'committed' = çuvallanmış (shipmentId dolu) — çuval depo/sevk yolundaki.
    // yok/'all'   = ayrım yapma. Depo ekranı 'free' geçer → çuvallanan top "serbest depoda"
    // görünmez (çuval depo ayrı ekranda izlenir).
    const shipmentScope = f["shipmentScope"] as string | undefined;
    delete where.shipmentScope;
    if (shipmentScope === "free") {
      where.shipmentId = null;
    } else if (shipmentScope === "committed") {
      where.shipmentId = { not: null };
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

    const include = {
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
      // Sevkiyat rezervasyonu: WAREHOUSE top bir çuval/sevkiyata bağlıysa "serbest depo"
      // DEĞİLDİR — listede "Çuvalda" rozeti için sevkiyat no/durum + çuval no döner.
      shipment: { select: { id: true, shipmentNo: true, status: true } },
      sack: { select: { id: true, sackNo: true, seq: true } },
    } as const;

    // CURSOR MODE — dinamik sortBy desteği (utils/cursor.ts dynamic API).
    if (isCursorRequested(req)) {
      const rawLimit = parseInt(req.query.limit as string, 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);
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
      byQuality[row.qualityGrade] = (byQuality[row.qualityGrade] ?? 0) + n;
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
  async getRelabelContext(barcode: string): Promise<ApiResponse<RelabelContext | null>> {
    const roll = await prisma.roll.findUnique({
      where: { barcode },
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
        qualityGrade: roll.qualityGrade,
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
                workOrder: { select: { id: true, batchNumber: true } },
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
    const entryTitle = ((): string => {
      switch (roll.entrySource) {
        case RollEntrySource.TAMBUR_SPLIT:
          return "Tambur Kesimi (Yeni Parça)";
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
            batchNumber: roll.parent.producedInStep.workOrder.batchNumber,
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
   * **İzin verilen statüler:** STOCK, IN_PRODUCTION, PRODUCED,
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
            workOrder: { select: { id: true, batchNumber: true } },
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
        batchNumber: roll.currentStep.workOrder.batchNumber,
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
              workOrder: { select: { id: true, batchNumber: true } },
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
          batchNumber: mv.step.workOrder.batchNumber,
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

    // Planlı bir sevkiyata veya mühürlü çuvala bağlı mı? Bağlıysa iptal
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
      // shipmentId koşuluyla kaybeden 409 alır (unmarkReady deseni); shipmentId
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
    // eşzamanlı prepareRawForSale/recoverOpenFabricToProduction/fason sevk topu
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
    // F114: statü kapsamı ÇAĞIRANA göre (mevcut reason↔event ayrımıyla tutarlı —
    // paylaşılan motor iki farklı ucu karıştırmasın). Süpervizör yolu (/:id/manual-attributes,
    // reason ZORUNLU): istasyonda açık kumaşı (IN_PRODUCTION/PRODUCED) da düzeltebilir;
    // yalnız gerçekten tehlikeli statüler (fason/kartelada, emekli/lineage veya sevk edilmiş)
    // bloklanır. Yeniden Etiketle yolu (/:id/label, reason YOK): yalnız serbest satılabilir stok.
    const isSupervisor = Boolean(data.reason && data.reason.trim());
    if (isSupervisor) {
      const SUPERVISOR_BLOCKED: RollStatus[] = [
        RollStatus.AT_SUBCONTRACTOR,
        RollStatus.AT_KARTELA,
        RollStatus.TAMBUR_CONSUMED,
        RollStatus.SUBCONTRACTOR_CONSUMED,
        RollStatus.KARTELA_CONSUMED,
        RollStatus.RETURNED_FROM_SUBCONTRACTOR,
        RollStatus.SHIPPED,
      ];
      if (SUPERVISOR_BLOCKED.includes(roll.status)) {
        throw AppError.badRequest(
          "Bu top fason/kartelada, emekliye ayrılmış veya sevk edilmiş — nitelikleri düzeltilemez (sevk↔kabul paritesi ve izlenebilirlik bozulur).",
        );
      }
    } else {
      const RELABEL_ALLOWED: RollStatus[] = [
        RollStatus.STOCK,
        RollStatus.WAREHOUSE,
        RollStatus.A1_STOCK,
      ];
      if (!RELABEL_ALLOWED.includes(roll.status)) {
        throw AppError.badRequest(
          "Bu top serbest/satılabilir stokta değil (fason/üretim/kartela/emekli veya sevk edilmiş) — etiketi ancak STOCK, WAREHOUSE veya A1 durumundaki (serbest ya da açık çuvaldaki) toplarda düzeltebilirsiniz.",
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
    const defaultQualityGradeId = await resolveQualityGradeId("1.KALITE");

    const roll = await prisma.$transaction(async (tx) => {
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
          itemId: fr.workOrder.targetItemId,
          colorId: receipt.appliedColorId,
          initialQty: 0,
          currentQty: 0,
          status: RollStatus.IN_PRODUCTION,
          qualityGrade: "1.KALITE",
          qualityGradeId: defaultQualityGradeId,
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
  // KURTARMA — Ham stokta takılı açık kumaşı Tambur'a geri al ("Üretime Geri Al")
  // ===========================================================================
  //
  // Senaryo: Fason rota SON ADIMKEN dönen açık kumaş, doğum anında nextStep
  // olmadığı için STOCK + currentStepId=null + barcode=null olarak ham stokta
  // takılır (subcontractor born-roll, nextStep yok). Bu topun normal üretim
  // çıkışı yoktur (yalnız tekrar fasona gönderme). Süpervizör topu uygun bir
  // açık iş emrinin Tambur adımına geri alıp orada keser.
  //
  // Yaklaşım: YENİ roll YARATMAZ — orphan'ın kendisini yerinde claim eder
  // (status STOCK→IN_PRODUCTION, currentStepId/producedInStepId=Tambur step) +
  // Tambur'a açık RollMovement açar. producedInStepId overwrite muhasebe-nötr:
  // üretim metrajı yalnız Tambur ÇOCUKLARI (parent.entrySource=SUBCONTRACTOR_RETURN)
  // üzerinden sayılır; parentRollId=null olan orphan o sayıma hiç girmez.

  /** Bir topun "üretime geri al" için takılı açık-kumaş orphan'ı olup olmadığı. */
  private isRecoverableOrphan(roll: {
    status: RollStatus;
    barcode: string | null;
    entrySource: RollEntrySource;
    currentStepId: string | null;
    shipmentId: string | null;
    sackId: string | null;
  }): boolean {
    return (
      roll.status === RollStatus.STOCK &&
      roll.barcode === null &&
      roll.entrySource === RollEntrySource.SUBCONTRACTOR_RETURN &&
      roll.currentStepId === null &&
      roll.shipmentId === null &&
      roll.sackId === null
    );
  }

  /**
   * Takılı açık-kumaş orphan için uygun "Üretime Geri Al" hedeflerini döner.
   * Hedef = aynı ürünlü, açık (PLANNED/IN_PROGRESS) iş emirlerinin kapanmamış
   * Tambur adımları. Salt-okunur önizleme.
   */
  async getRecoveryTargets(rollId: string): Promise<ApiResponse<RecoveryTargetsResult>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        status: true,
        barcode: true,
        entrySource: true,
        currentStepId: true,
        shipmentId: true,
        sackId: true,
        currentQty: true,
        qualityGrade: true,
        item: { select: { name: true } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const rollOut = {
      id: roll.id,
      itemId: roll.itemId,
      itemName: roll.item.name,
      currentQty: Number(roll.currentQty),
      qualityGrade: roll.qualityGrade,
    };

    if (!this.isRecoverableOrphan(roll)) {
      return {
        success: true,
        data: {
          roll: rollOut,
          eligible: false,
          reason:
            "Bu top 'üretime geri al' için uygun değil — yalnız ham stokta takılı, barkodsuz, fason-dönüşü açık kumaş geri alınabilir.",
          eligibleTargets: [],
          warnings: [],
        },
      };
    }

    const candidates = await prisma.workOrderStep.findMany({
      where: {
        station: { kind: StationKind.TAMBUR },
        status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
        workOrder: {
          status: { in: [WorkOrderStatus.PLANNED, WorkOrderStatus.IN_PROGRESS] },
          targetItemId: roll.itemId,
          // Renk eşleşmesi (tek WO = tek renk) — çapraz-spec enjeksiyonu engelle (BUG-3).
          // null===null de eşleşir (ham hedef ↔ renksiz orphan).
          targetColorId: roll.colorId,
        },
      },
      select: {
        id: true,
        status: true,
        station: { select: { name: true } },
        workOrder: {
          select: {
            id: true,
            batchNumber: true,
            status: true,
            width: true,
            steps: { select: { id: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // En eşleşmesi (ikisi de doluysa) + Tambur DIŞI tüm adımlar tamamlanmış/atlanmış
    // olmalı: orphan yalnız Tambur'a movement alır; üst adımlar dangle/COMPLETED→ACTIVE
    // revert ederse WO tamamlanamaz (BUG-1). Tek-adımlı Tambur WO'su her zaman geçer.
    const eligibleTargets = candidates
      .filter((s) => {
        if (
          roll.width != null &&
          s.workOrder.width != null &&
          Number(s.workOrder.width) !== Number(roll.width)
        ) {
          return false;
        }
        const otherOpen = s.workOrder.steps.some(
          (st) =>
            st.id !== s.id &&
            st.status !== StepStatus.COMPLETED &&
            st.status !== StepStatus.SKIPPED,
        );
        return !otherOpen;
      })
      .map((s) => ({
        workOrderId: s.workOrder.id,
        batchNumber: s.workOrder.batchNumber,
        workOrderStatus: s.workOrder.status,
        stepId: s.id,
        stationName: s.station.name,
        stepStatus: s.status,
      }));

    const warnings: string[] = [];
    if (eligibleTargets.length === 0) {
      warnings.push(
        "Bu top için uygun iş emri yok — aynı ürün+renk(+en), Tambur'lu ve Tambur öncesi adımları tamamlanmış (veya yalnız Tambur'lu) açık bir iş emri gerekir.",
      );
    }

    return {
      success: true,
      data: {
        roll: rollOut,
        eligible: true,
        eligibleTargets,
        warnings,
      },
    };
  }

  /**
   * Takılı açık-kumaş orphan'ı seçilen Tambur adımına geri alır (üretime sokar).
   * Yeni roll yaratmaz; orphan'ı atomik claim ile IN_PRODUCTION'a çeker, Tambur'a
   * açık RollMovement açar. Sonrasında normal Tambur kesim akışı (`cutOpenFabric`)
   * sıfır değişiklikle çalışır.
   */
  async recoverOpenFabricToProduction(
    rollId: string,
    data: { stepId: string; reason: string },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    const reason = (data.reason ?? "").trim();
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni (en az 3 karakter) zorunludur");
    }

    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        status: true,
        barcode: true,
        entrySource: true,
        currentStepId: true,
        shipmentId: true,
        sackId: true,
        currentQty: true,
        weightKg: true,
        producedInStepId: true,
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");
    if (roll.barcode !== null) {
      throw AppError.badRequest("Yalnız barkodsuz açık kumaş üretime geri alınabilir");
    }
    if (roll.entrySource !== RollEntrySource.SUBCONTRACTOR_RETURN) {
      throw AppError.badRequest("Bu top fason dönüşü açık kumaş değil");
    }
    if (roll.shipmentId !== null || roll.sackId !== null) {
      throw AppError.conflict("Top bir sevkiyat/çuvalda — önce oradan çıkarın");
    }
    if (roll.status !== RollStatus.STOCK || roll.currentStepId !== null) {
      throw AppError.conflict(`Top üretime geri alınamaz (durum: ${roll.status})`);
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Hedef adımı tx içinde taze oku (TOCTOU — adım/WO bu arada kapanmış olabilir).
      const step = await tx.workOrderStep.findUnique({
        where: { id: data.stepId },
        select: {
          id: true,
          status: true,
          workOrderId: true,
          station: { select: { kind: true } },
          workOrder: {
            select: { status: true, targetItemId: true, targetColorId: true, width: true },
          },
        },
      });
      if (!step) throw AppError.notFound("İş emri adımı bulunamadı");
      if (step.station.kind !== StationKind.TAMBUR) {
        throw AppError.badRequest("Açık kumaş yalnız Tambur adımına geri alınabilir");
      }
      if (step.status === StepStatus.COMPLETED || step.status === StepStatus.SKIPPED) {
        throw AppError.conflict(`Hedef adım kapalı (${step.status}) — geri alınamaz`);
      }
      if (
        step.workOrder.status !== WorkOrderStatus.PLANNED &&
        step.workOrder.status !== WorkOrderStatus.IN_PROGRESS
      ) {
        throw AppError.conflict(`Hedef iş emri açık değil (${step.workOrder.status})`);
      }
      if (step.workOrder.targetItemId !== roll.itemId) {
        throw AppError.badRequest("Topun ürünü iş emrinin hedef ürünüyle eşleşmiyor");
      }
      // Renk eşleşmesi (BUG-3) — çapraz-spec enjeksiyon + producedMeters mis-count engeli.
      if (step.workOrder.targetColorId !== roll.colorId) {
        throw AppError.badRequest("Topun rengi iş emrinin hedef rengiyle eşleşmiyor");
      }
      // En eşleşmesi (ikisi de doluysa).
      if (
        roll.width != null &&
        step.workOrder.width != null &&
        Number(step.workOrder.width) !== Number(roll.width)
      ) {
        throw AppError.badRequest("Topun eni iş emrinin hedef eniyle eşleşmiyor");
      }
      // Tambur DIŞI adımlar tamamlanmamışsa orphan üst adımları dangle bırakır → WO
      // tamamlanamaz / COMPLETED adım ACTIVE'e revert eder (BUG-1). Tek-adımlı Tambur
      // WO'su geçer; çok-adımlı WO yalnız üst adımları bitmişse hedef olabilir.
      const otherOpen = await tx.workOrderStep.count({
        where: {
          workOrderId: step.workOrderId,
          id: { not: step.id },
          status: { notIn: [StepStatus.COMPLETED, StepStatus.SKIPPED] },
        },
      });
      if (otherOpen > 0) {
        throw AppError.conflict(
          "İş emrinin Tambur öncesi adımları tamamlanmamış — açık kumaş yalnız Tambur aşamasındaki (veya tek-adımlı Tambur) iş emrine geri alınabilir",
        );
      }

      // Atomik claim — orphan'ı tam beklenen halinde yakala (check-then-act yok).
      const claim = await tx.roll.updateMany({
        where: {
          id: rollId,
          status: RollStatus.STOCK,
          currentStepId: null,
          shipmentId: null,
          sackId: null,
          barcode: null,
          entrySource: RollEntrySource.SUBCONTRACTOR_RETURN,
        },
        data: {
          status: RollStatus.IN_PRODUCTION,
          currentStepId: step.id,
          producedInStepId: step.id,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Top bu sırada başka bir işleme alınmış — sayfayı yenileyin");
      }

      // Tambur'a açık giriş movement'i (metraj fason kabulde ölçülü → qtyIn=currentQty).
      await tx.rollMovement.create({
        data: {
          rollId,
          workOrderStepId: step.id,
          qtyIn: Number(roll.currentQty),
          weightIn: roll.weightKg !== null ? Number(roll.weightKg) : null,
          operatorId: userId ?? null,
          notes: `RECOVER_TO_PRODUCTION:${reason}`,
        },
      });

      await recomputeStepStatus(tx, step.id);
      await ensureWorkOrderInProgress(tx, step.workOrderId);

      return tx.roll.findUniqueOrThrow({ where: { id: rollId } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      oldData: {
        status: roll.status,
        currentStepId: roll.currentStepId,
        producedInStepId: roll.producedInStepId,
      },
      newData: {
        event: "RECOVER_TO_PRODUCTION",
        workOrderStepId: data.stepId,
        status: RollStatus.IN_PRODUCTION,
        reason,
      },
    });

    return {
      success: true,
      data: updated,
      message: "Açık kumaş üretime (Tambur) geri alındı — artık Tambur'da kesilebilir",
    };
  }

  // ===========================================================================
  // MANUEL DURUM DÜZELTME — kısıtlı whitelist (süpervizör)
  // ===========================================================================
  //
  // Yalnız güvenli geçişler (MANUAL_STATUS_TRANSITIONS): WAREHOUSE↔STOCK,
  // PRODUCED→WAREHOUSE. Invariant guard'ları softDelete deseniyle birebir:
  // sevkiyat/çuval/istasyon/açık-fason bağı varsa reddedilir. Atomik claim +
  // zorunlu sebep + audit.

  /** Bir topun invariant engellerini (sevk/çuval/istasyon/fason) hesaplar. */
  private async computeStatusBlockReasons(roll: {
    shipmentId: string | null;
    sackId: string | null;
    currentStepId: string | null;
  }, rollId: string): Promise<string[]> {
    const blockReasons: string[] = [];
    if (roll.shipmentId) blockReasons.push("Top bir sevkiyata bağlı — önce sevkten çıkarın");
    if (roll.sackId) blockReasons.push("Top bir çuvalın içinde — önce çuvaldan çıkarın");
    if (roll.currentStepId) blockReasons.push("Top bir istasyonda aktif — durum manuel değiştirilemez");
    const openMv = await prisma.rollMovement.count({ where: { rollId, exitedAt: null } });
    if (openMv > 0) blockReasons.push("Topun açık bir istasyon hareketi var");
    const openDispatch = await prisma.subcontractorDispatchItem.findFirst({
      where: { rollId, dispatch: { cancelledAt: null } },
      select: { id: true },
    });
    if (openDispatch) blockReasons.push("Top açık bir fason sevkine bağlı");
    return blockReasons;
  }

  /** Manuel durum düzeltme önizlemesi — izinli hedefler + engel nedenleri. */
  async getStatusOverridePreview(rollId: string): Promise<ApiResponse<StatusOverridePreview>> {
    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        barcode: true,
        status: true,
        shipmentId: true,
        sackId: true,
        currentStepId: true,
        item: { select: { name: true } },
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const blockReasons = await this.computeStatusBlockReasons(roll, rollId);
    const allowedTargets =
      blockReasons.length === 0 ? MANUAL_STATUS_TRANSITIONS[roll.status] ?? [] : [];

    return {
      success: true,
      data: {
        rollId: roll.id,
        barcode: roll.barcode,
        itemName: roll.item.name,
        currentStatus: roll.status,
        allowedTargets,
        blockReasons,
      },
    };
  }

  /** Topun durumunu manuel düzeltir (whitelist + invariant guard + atomik claim). */
  async manualStatusOverride(
    rollId: string,
    data: { targetStatus: RollStatus; reason: string },
    userId?: string,
  ): Promise<ApiResponse<Roll>> {
    const reason = (data.reason ?? "").trim();
    if (reason.length < 3) {
      throw AppError.badRequest("İşlem nedeni (en az 3 karakter) zorunludur");
    }

    const roll = await prisma.roll.findUnique({
      where: { id: rollId },
      select: {
        id: true,
        status: true,
        shipmentId: true,
        sackId: true,
        currentStepId: true,
      },
    });
    if (!roll) throw AppError.notFound("Top bulunamadı");

    const allowed = MANUAL_STATUS_TRANSITIONS[roll.status] ?? [];
    if (!allowed.includes(data.targetStatus)) {
      throw AppError.badRequest(
        `Bu durum geçişi manuel olarak yapılamaz (${roll.status} → ${data.targetStatus})`,
      );
    }

    // Invariant hard-block (softDelete deseni) — sevk/çuval/istasyon/fason bağı varsa red.
    const blockReasons = await this.computeStatusBlockReasons(roll, rollId);
    if (blockReasons.length > 0) {
      throw AppError.conflict(blockReasons[0] ?? "Top durumu manuel değiştirilemez");
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Atomik claim — gözlenen durum + serbestlik (shipment/sack/step null) pinli.
      const claim = await tx.roll.updateMany({
        where: {
          id: rollId,
          status: roll.status,
          shipmentId: null,
          sackId: null,
          currentStepId: null,
        },
        data: { status: data.targetStatus },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Top bu sırada başka bir işleme girdi — sayfayı yenileyin");
      }
      return tx.roll.findUniqueOrThrow({ where: { id: rollId } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ROLL",
      recordId: rollId,
      oldData: { status: roll.status },
      newData: { event: "MANUAL_STATUS_OVERRIDE", from: roll.status, to: data.targetStatus, reason },
    });

    return {
      success: true,
      data: updated,
      message: `Top durumu güncellendi: ${roll.status} → ${data.targetStatus}`,
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
        // Sonraki step yok — son step'ten çıkış. Açık kumaşın Tambur'a girmesi
        // beklenir, son step PROCESS_QC ise sistem hatası — yine de Roll'u
        // PRODUCED'a çek ve currentStepId=null yap.
        await tx.roll.update({
          where: { id: rollId },
          data: {
            status: RollStatus.PRODUCED,
            currentStepId: null,
          },
        });
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
        : `Kurşun/KK2 tamamlandı (${totalMeters} mt). Sonraki step yok — Roll PRODUCED.`,
    };
  }
}
