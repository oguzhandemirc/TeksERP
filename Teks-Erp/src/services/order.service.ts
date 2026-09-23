// =============================================================================
// TeksERP - Order Service (extends BaseService)
// =============================================================================
// Overrides:
//   - create: auto-generates orderNumber as SIP+GGAAYY+NNNN
//   - softDelete: sets status = CANCELLED (Order has no isActive field)
//                 + iş emri bağlarını güvenli şekilde çözer (R1)
// =============================================================================

import prisma from "../lib/prisma";
import { ACTIVE_SACK_ALLOCATION } from "./helpers/sack-allocation.helper";
import type { ItemUnit } from "@prisma/client";
import { AuditService } from "./audit.service";
import { BaseService, BaseServiceConfig, CursorPaginatedResponse } from "./base.service";
import { ApiResponse, PaginatedResponse, QueryParams } from "../types/api.types";
import {
  decodeDynamicCursor,
  dynamicCursorWhere,
  buildNextDynamicCursor,
} from "../utils/cursor";
import { AppError } from "../utils/app-error";
import { assertOrderReplayAlive } from "./helpers/token-replay.helper";
import { resolveShipmentDestination } from "./helpers/shipment-destination.helper";
import {
  OrderStatus,
  Prisma,
  ReasonPresetKind,
  RollEntrySource,
  RollStatus,
  ShipmentStatus,
  WorkOrderStatus,
  WorkOrderType,
} from "@prisma/client";
import { withBarcodeRetry } from "../utils/barcode-retry";
import { resolveReasonCode } from "./reason-preset.service";
import { isMeasuredLine, openLineWhere, someOpenLine } from "./helpers/order-line-scope.helper";
import { isClientTokenP2002 } from "../utils/p2002";
import { validate as isUuidString } from "uuid";
import { nextSeriesNo, resolveSeriesFormat, seriesPrefix } from "./number-series.service";

// MASS-ASSIGNMENT WHITELIST'leri (M-3): route'larda Zod yok (BaseController ham
// body); muhasebe/kimlik alanları (status, shippedQty, completedAt,
// manualClosedById, orderNumber, orderId) istemciden YAZILAMAZ. Statü
// geçişleri yalnız özel endpoint'lerden (cancel, manual-close) ve
// recomputeOrderStatusTx'tan akar (şemadaki "tek yazma noktası" notları).
const ORDER_HEADER_WRITABLE = new Set([
  "customerId",
  "branchId",
  "currency",
  "totalAmount",
  "deadline",
  "orderDate",
]);
const ORDER_LINE_WRITABLE = new Set([
  "itemId",
  "colorId",
  "quantity",
  // Satır birimi (MT/KG/ADET) — gönderilmezse kalem kartından kopyalanır
  // (`resolveLineUnit`); gönderilirse enum'a karşı doğrulanır.
  "unit",
  "unitPrice",
  "width",
  "pieceLengthM",
  "cutNote",
  "customerItemName",
  "customerColorName",
]);
import { readOrderDefaultDeadlineDays } from "./system-setting.service";
import { CURRENCIES } from "../config/currencies";
import {
  recomputeOrderStatusTx,
  touchOrderLinesTx,
  unmeasuredLineWarnings,
} from "./helpers/order-status.helper";
import { isItemUnit } from "../constants/item-unit";
import { touchWorkOrderTx } from "./helpers/workorder-locks.helper";
import { markTravelerCardDirtyTx } from "./helpers/traveler-card-dirty.helper";
import { computeLineCoverage, computeWoMaterial } from "./helpers/coverage.helper";
import { assertColorsAssignableToCustomer } from "./helpers/color-assignment.helper";
import { assertTargetablePropertyIds } from "./helpers/targetable-property.helper";
import { buildHideCancelledWhere } from "./helpers/hidden-status.helper";
import { CustomerAliasService } from "./customer-alias.service";
import {
  applyDateRange,
  buildOrderByClause,
  buildPagination,
  buildTextSearch,
  buildWhereClause,
  parseQueryParams,
  readIdCondition,
} from "../utils/query-parser";
import { Request } from "express";
import { hata } from "../lib/logger";
import { warehouseStampManyTx } from "./helpers/warehouse.helper";
import { ACTIVE_ORDER_LINK, activeOrderLinkCount, unlinkOrderLinesTx, withActiveOrderLinks } from "./helpers/order-link.helper";
import { assertManualNumberAllowed } from "./helpers/manual-number.helper";

// ─── Cancel Akışı Karar Matrisi ─────────────────────────────────────────────
//
// Operatör sipariş iptal ederken, etkilenecek her WO için üç olası aksiyon:
//   - UNLINK_ONLY     : sadece order-WO join'ini sil, WO yaşamaya devam
//   - CONVERT_TO_STOCK: join sil + WO.type = STOCK_PRODUCTION (kalan üretim
//                       stoğa düşer; ORDER_PRODUCTION'dı, müşteri iptal etti)
//   - CANCEL_WO       : WorkOrderService.softDelete (rolls STOCK'a, traveler
//                       VOID, fason kayıtlar sil vb. tam kaskat)
//
// İzin matrisi WO.status + tek/çoklu sipariş durumuna göre değişir.
// "Tek-sipariş" = bu WO'ya bağlı tek sipariş bu — diğer order link yok.

export type CancelAction = "UNLINK_ONLY" | "CONVERT_TO_STOCK" | "CANCEL_WO";

function computeAllowedActions(
  woStatus: string,
  isSoleOrder: boolean
): CancelAction[] {
  if (woStatus === "PLANNED") {
    // Üretim başlamadı; CONVERT/CANCEL anlamsız.
    return ["UNLINK_ONLY"];
  }
  if (woStatus === "COMPLETED") {
    // Üretim bitti, rulolar var. CANCEL_WO yasak (workorder.service zaten
    // reddeder). Tek-sipariş ise CONVERT açık (müşteri kaydı silinir).
    return isSoleOrder ? ["UNLINK_ONLY", "CONVERT_TO_STOCK"] : ["UNLINK_ONLY"];
  }
  if (woStatus === "IN_PROGRESS") {
    return isSoleOrder
      ? ["UNLINK_ONLY", "CONVERT_TO_STOCK", "CANCEL_WO"]
      : ["UNLINK_ONLY"];
  }
  // CANCELLED WO bağı zaten anlamsız — gelmemesi gerek ama defansif.
  return ["UNLINK_ONLY"];
}

/**
 * Varsayılan aksiyon — İZİNLİ LİSTEDEN TÜRETİLİR, ayrı yazılmaz.
 *
 * ⚠️ Bu iki fonksiyon eskiden BAĞIMSIZDI ve sessizce ayrıştılar (BULGU-T2-005):
 * İPTAL EDİLMİŞ iş emrine bağlı tek-siparişli bir siparişte izinli liste
 * `["UNLINK_ONLY"]` iken varsayılan `CONVERT_TO_STOCK` dönüyordu. Arayüz izinli
 * aksiyon tek olduğu için seçim kutusunu ÇİZMİYOR, dolayısıyla istemci bir şey
 * göndermiyor, sunucu da varsayılana düşüyordu → "CONVERT_TO_STOCK geçersiz"
 * 400'ü. Yenilemek işe yaramıyordu: sipariş HİÇBİR yoldan iptal edilemiyordu ve
 * sonsuza dek "açık talep" sayılıyordu (prod'da 2 canlı sipariş bu durumdaydı;
 * tek çıkış DB'ye elle müdahaleydi).
 *
 * Tercih hâlâ ifade edilir ("en sık vaka: malı stoğa al") ama izinli değilse
 * listenin ilkine düşer — yani ayrışma YAPISAL OLARAK imkânsız.
 */
function pickDefaultAction(
  woStatus: string,
  isSoleOrder: boolean
): CancelAction {
  const allowed = computeAllowedActions(woStatus, isSoleOrder);
  const tercih: CancelAction =
    woStatus === "PLANNED" ? "UNLINK_ONLY" : isSoleOrder ? "CONVERT_TO_STOCK" : "UNLINK_ONLY";
  return allowed.includes(tercih) ? tercih : allowed[0];
}

/**
 * Bekçi ihracı — bu iki saf fonksiyonun AYRIŞAMAZLIĞI ölçülebilir olmalı
 * (BULGU-T2-005). Üretim kodu bunu kullanmaz; kaynak okuyarak sözleşme ölçmek
 * kırılgan olduğu için asıl kontrol her (durum × tek-sipariş) kombinasyonunu
 * gerçekten koşturur.
 */
export const __test__ = { computeAllowedActions, pickDefaultAction };

/**
 * Lines üzerinden totalAmount hesaplar. unitPrice null olan satırlar toplama
 * dahil edilmez (kasıtlı: "fiyatlandırılmamış" kalemleri 0 saymak yanıltıcı).
 * Hiç satırın fiyatı yoksa null döner — sipariş "fiyatsız" sayılır.
 */
function computeTotalAmount(
  lines: Array<{ quantity?: number; unitPrice?: number | null | string }>
): number | null {
  // Fiyatlandırma Decimal aritmetik ile — float drift faturada kuruş kayması yaratmasın.
  let total = new Prisma.Decimal(0);
  let any = false;
  for (const l of lines) {
    if (l.unitPrice == null) continue;
    const qtyRaw = Number(l.quantity ?? 0);
    const priceRaw =
      typeof l.unitPrice === "string" ? Number(l.unitPrice) : l.unitPrice;
    if (!Number.isFinite(qtyRaw) || !Number.isFinite(priceRaw)) continue;
    total = total.plus(new Prisma.Decimal(qtyRaw).times(priceRaw as number));
    any = true;
  }
  return any ? Number(total.toFixed(2)) : null;
}

// ── "İş Emri" rollup filtresi (filter[woState]) ──────────────────────────────
// Semantik Electron `work-order-rollup.ts` (deriveWoRollup) ile BİREBİR aynı
// olmalı — rozet ne gösteriyorsa filtre onu bulmalı. Aktif küme CANCELLED +
// SUPERSEDED hariçtir; PLANNED+COMPLETED karışımı (IN_PROGRESS yokken) rozette
// "Üretimde" sayılır. Durumlar bu tanımla karşılıklı münhasırdır; çoklu seçim
// OR'lanır. Varlık sorgusu (some) distinct-WO ayrımına duyarsızdır → frontend'in
// distinct kümesiyle aynı sonucu verir.
const WO_ROLLUP_ACTIVE: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED,
  WorkOrderStatus.IN_PROGRESS,
  WorkOrderStatus.COMPLETED,
];

/** "Siparişin herhangi bir kalemi, verilen durumlardan bir WO'ya bağlı" koşulu. */
function hasWoLink(statuses: WorkOrderStatus[]): Record<string, unknown> {
  return {
    lines: {
      some: { workOrderLinks: { some: { ...ACTIVE_ORDER_LINK, workOrder: { status: { in: statuses } } } } },
    },
  } satisfies Prisma.OrderWhereInput;
}

const WO_STATE_WHERE: Record<string, Record<string, unknown>> = {
  NONE: { NOT: hasWoLink(WO_ROLLUP_ACTIVE) },
  PLANNED: {
    AND: [
      hasWoLink([WorkOrderStatus.PLANNED]),
      { NOT: hasWoLink([WorkOrderStatus.IN_PROGRESS]) },
      { NOT: hasWoLink([WorkOrderStatus.COMPLETED]) },
    ],
  },
  IN_PROGRESS: {
    OR: [
      hasWoLink([WorkOrderStatus.IN_PROGRESS]),
      { AND: [hasWoLink([WorkOrderStatus.PLANNED]), hasWoLink([WorkOrderStatus.COMPLETED])] },
    ],
  },
  COMPLETED: {
    AND: [
      hasWoLink([WorkOrderStatus.COMPLETED]),
      { NOT: hasWoLink([WorkOrderStatus.PLANNED]) },
      { NOT: hasWoLink([WorkOrderStatus.IN_PROGRESS]) },
    ],
  },
};

/** filter[woState] (CSV) → Prisma where. Geçersiz/boş değerler sessizce düşer. */
function buildWoStateWhere(
  raw: string | string[] | undefined
): Record<string, unknown> | undefined {
  const values = (Array.isArray(raw) ? raw : (raw ?? "").split(","))
    .map((v) => v.trim())
    .filter((v) => v in WO_STATE_WHERE);
  if (values.length === 0) return undefined;
  const conds = [...new Set(values)].map((v) => WO_STATE_WHERE[v]);
  return conds.length === 1 ? conds[0] : { OR: conds };
}

/**
 * Sipariş listesi özet şeridinin verisi (`getOrderStats`).
 * Kapsam ayrımı için o metodun başlığına bak: ADET listenin aynası, METRAJ
 * iptalleri her zaman dışlar.
 */
export interface OrderStats {
  /** Filtreye uyan sipariş adedi — listenin satır sayısıyla BİREBİR. */
  totalCount: number;
  /** `OrderStatus` → adet. Yalnız kümede geçen durumlar anahtar taşır. */
  byStatus: Record<string, number>;
  /** Kalemlerden toplanan istenen metraj (m). İptaller hariç. */
  totalOrderedQty: number;
  /** Sevk edilen metraj (m) — `OrderLine.shippedQty` defter denormu. İptaller hariç. */
  totalShippedQty: number;
  /** Açık metraj (m) = istenen − sevk (0'da kırpılı). */
  totalOpenQty: number;
  /** Termini geçmiş ve hâlâ açık sipariş adedi. */
  overdueCount: number;
  /** Önümüzdeki 7 gün içinde termini dolan açık sipariş adedi. */
  dueThisWeekCount: number;
  /** Hiçbir kalemi aktif iş emrine bağlı olmayan sipariş adedi (`woState=NONE`). */
  noWorkOrderCount: number;
  /** Para birimi → toplam tutar. Fiyat girilmemişse boş obje. */
  amountByCurrency: Record<string, number>;
}

// ── Sipariş → sevkiyat drill-down (getOrderShipments) ────────────────────────
/** İç toplama kovası — çuval sevki ve fason direkt sevk aynı şekle indirgenir. */
interface ShipmentAgg {
  shipmentId: string;
  shipmentNo: string;
  status: ShipmentStatus;
  kind: "SHIPMENT" | "DIRECT";
  date: Date | null;
  qty: Prisma.Decimal;
  sacks: Set<string>;
  branchName: string | null;
}

export interface OrderShipmentRow {
  /** DIRECT legacy toplu satırında boş (tıklanamaz). */
  shipmentId: string;
  shipmentNo: string;
  status: ShipmentStatus;
  kind: "SHIPMENT" | "DIRECT";
  /** ISO; PLANNED çuval-sevkinde/DIRECT-legacy'de null olabilir. */
  date: string | null;
  qty: number;
  sackCount: number;
  branchName: string | null;
}

export interface OrderShipmentsResult {
  /** DISPATCHED çuval + fason direkt — order.shippedQty ile mutabık. */
  dispatchedTotal: number;
  /** PLANNED çuval (bekleyen, henüz sevk edilmemiş). */
  plannedTotal: number;
  shipments: OrderShipmentRow[];
}

export class OrderService extends BaseService {
  private aliasService = new CustomerAliasService();

  constructor(config: BaseServiceConfig) {
    super(config);
  }

  /**
   * Liste filtresi `filter[itemId]` / `filter[colorId]` / `filter[woState]`
   * ilişki bazlıdır: Order'da bu kolonlar yoktur. `safeFilters` skaler-süzgeci
   * bunları düşürür (500'ü önler) — burada ilişki koşuluna çevirip `findAll`'ın
   * where'ine AND'liyoruz. itemId+colorId birden verilirse AYNI satır eşleşmeli
   * (ürün X + renk Y olan kalem). `woState` = "İş Emri" rollup filtresi (CSV,
   * çoklu seçim OR'lanır) — DB'de hesaplanır, sayfadaki veriyle sınırlı değildir.
   *
   * itemId/colorId de ÇOKLU seçilebilir (`readIdCondition` → `{ in: [...] }`):
   * kendi içinde OR, birbirleriyle AND — "kırmızı VEYA mavi olan patos kalemi".
   * Eski `typeof === "string"` okuması CSV'yi ham geçirirdi; ikisi de uuid
   * kolonu olduğu için sonuç boş liste değil P2007 → HTTP 400 *"Geçersiz veri
   * formatı"* olurdu (arıza modları: query-parser `readIdCondition` notu).
   */
  /**
   * Liste where'i: `codeSearchFields`teki `lines.some.workOrderLinks.some.…` yolu koparılmış
   * bağdan eşleşmesin — yürüyücü aktif yüklemi ekler (AST kapısı string yolu göremez).
   */
  protected override buildListWhere(params: QueryParams, req: Request): Record<string, unknown> {
    return withActiveOrderLinks(super.buildListWhere(params, req));
  }

  protected extraWhere(req: Request): Record<string, unknown> | undefined {
    const { filters } = parseQueryParams(req);
    const conds: Record<string, unknown>[] = [];

    const lineCond: Record<string, unknown> = {};
    const itemCond = readIdCondition(filters.itemId);
    if (itemCond) lineCond.itemId = itemCond;
    const colorCond = readIdCondition(filters.colorId);
    if (colorCond) lineCond.colorId = colorCond;
    if (Object.keys(lineCond).length > 0) conds.push({ lines: { some: lineCond } });

    const woCond = buildWoStateWhere(filters.woState);
    if (woCond) conds.push(woCond);

    // İptal edilmiş siparişleri gizle (panel varsayılanı). `safeFilters` bu
    // anahtarı skaler süzgeçte düşürür — burada ham filters'tan okunur.
    const hideCancelled = buildHideCancelledWhere(filters, [OrderStatus.CANCELLED]);
    if (hideCancelled) conds.push(hideCancelled);

    if (conds.length === 0) return undefined;
    return conds.length === 1 ? conds[0] : { AND: conds };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SİPARİŞ KALEMİ İPTALİ (2026-08-27)
  // ═══════════════════════════════════════════════════════════════════════
  // 10 kalemlik siparişin 3 kalemini iptal edip kalan 7'siyle devam etmek.
  // Bugüne dek imkânsızdı: kalem çıkarmanın tek yolu hard-delete idi ve aktif
  // iş emri bağı varsa TAMAMEN reddediliyordu.
  //
  // Kararlar (kullanıcı, 2026-08-26):
  //   • İptal SOFT — kalem listede kalır, "iptal" işaretli ve salt-okunur.
  //   • İş emri bağı OTOMATİK kopar; kullanıcı yalnız UYARILIR (engellenmez).
  //   • Kısmi sevk görmüş kalem iptal EDİLEBİLİR ("kalanı iptal"): sevk edilen
  //     geçerli sayılır, kalan düşer.
  //   • Son aktif kalem iptal edilirse sipariş: sevk varsa COMPLETED, yoksa
  //     CANCELLED (kural `recomputeOrderStatusTx`'ta — tek yazma noktası).

  /** Kalem iptalinde etkilenecek iş emri. */
  private async loadLineForCancel(orderId: string, lineId: string) {
    const line = await prisma.orderLine.findUnique({
      where: { id: lineId },
      select: {
        id: true,
        orderId: true,
        quantity: true,
        shippedQty: true,
        cancelledAt: true,
        width: true,
        item: { select: { name: true } },
        color: { select: { name: true } },
        order: { select: { id: true, orderNumber: true, status: true } },
        workOrderLinks: {
          where: ACTIVE_ORDER_LINK,
          select: {
            workOrder: {
              select: {
                id: true,
                workOrderNumber: true,
                status: true,
                type: true,
                targetItemId: true,
                _count: { select: { orderLinks: { where: ACTIVE_ORDER_LINK } } },
              },
            },
          },
        },
      },
    });
    if (!line || line.orderId !== orderId) {
      throw AppError.notFound("Sipariş kalemi bulunamadı.");
    }
    return line;
  }

  /**
   * İPTAL ÖNİZLEMESİ — "onayladığında ne olacak" somut listesi.
   * CLAUDE.md kuralı: yıkıcı işlemde etkilenen HER kayıt tek tek gösterilir;
   * "3 kayıt etkilenecek" gibi soyut sayı yetmez.
   */
  async getLineCancelPreview(orderId: string, lineId: string): Promise<ApiResponse<unknown>> {
    const line = await this.loadLineForCancel(orderId, lineId);
    const requested = new Prisma.Decimal(line.quantity);
    const shipped = new Prisma.Decimal(line.shippedQty);
    const remaining = Prisma.Decimal.max(0, requested.minus(shipped));

    const blockers: string[] = [];
    if (line.cancelledAt !== null) blockers.push("Bu kalem zaten iptal edilmiş.");
    if (line.order.status === OrderStatus.CANCELLED) {
      blockers.push("Siparişin tamamı zaten iptal edilmiş.");
    }
    if (remaining.lessThanOrEqualTo(0)) {
      blockers.push(
        "Kalemin tamamı sevk edilmiş — iptal edilecek bir şey kalmadı. " +
          "Mal geri geldiyse iade yolunu kullanın.",
      );
    }

    // Aktif WO bağları — CANCELLED/SUPERSEDED sayılmaz (zaten ölü).
    const affectedWorkOrders = line.workOrderLinks
      .map((l) => l.workOrder)
      .filter((w) => w.status !== WorkOrderStatus.CANCELLED && w.status !== "SUPERSEDED")
      .map((w) => {
        // Bu kalem WO'nun SON bağıysa iş emri stok üretimine döner
        // ("tip = bağın aynası" kuralı, 2026-08-21).
        const willBecomeStock = w.type === WorkOrderType.ORDER_PRODUCTION && w._count.orderLinks === 1;
        // TEK SERT ENGEL: hedef kumaşı olmayan WO stok üretimine DÖNEMEZ.
        // Sessizce bağlı bırakmak "tip = bağın aynası" invariantını bozardı.
        const blockedNoTargetItem = willBecomeStock && !w.targetItemId;
        if (blockedNoTargetItem) {
          blockers.push(
            `${w.workOrderNumber} bu kalemin son bağı ve hedef kumaşı tanımlı değil — ` +
              "stok üretimine dönemez. Önce iş emrinde hedef kumaşı seçin.",
          );
        }
        return {
          id: w.id,
          workOrderNumber: w.workOrderNumber,
          status: w.status,
          willBecomeStock,
          blockedNoTargetItem,
        };
      });

    // Bu kalem iptal edilince siparişte aktif kalem kalıyor mu?
    const otherActive = await prisma.orderLine.count({
      where: { orderId, cancelledAt: null, id: { not: lineId } },
    });
    const isLastActiveLine = otherActive === 0 && line.cancelledAt === null;
    const orderShipped = new Prisma.Decimal(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { shippedQty: true } }))
        .shippedQty,
    );

    return {
      success: true,
      data: {
        lineId: line.id,
        orderNumber: line.order.orderNumber,
        itemName: line.item.name,
        colorName: line.color?.name ?? null,
        width: line.width == null ? null : Number(line.width),
        requestedQty: Number(requested),
        shippedQty: Number(shipped),
        /** İptal edilecek metraj — sevk edilen DÜŞMEZ, "kalanı iptal". */
        remainingQty: Number(remaining),
        affectedWorkOrders,
        isLastActiveLine,
        /** Son kalemse siparişin düşeceği statü (kullanıcı kuralı). */
        resultingOrderStatus: isLastActiveLine
          ? orderShipped.greaterThan(0)
            ? OrderStatus.COMPLETED
            : OrderStatus.CANCELLED
          : null,
        blockers,
        canCancel: blockers.length === 0,
      },
    };
  }

  /**
   * KALEMİ İPTAL ET. Sebep İSTEĞE BAĞLI (sipariş iptaliyle aynı gerekçe:
   * zorunlu tutmak operatörü rastgele kategori seçmeye iter).
   */
  async cancelOrderLine(
    orderId: string,
    lineId: string,
    userId?: string,
    reason?: { reasonCode?: string | null; reasonText?: string | null },
  ): Promise<ApiResponse<unknown>> {
    const preview = (await this.getLineCancelPreview(orderId, lineId)).data as {
      canCancel: boolean;
      blockers: string[];
      affectedWorkOrders: Array<{ id: string; willBecomeStock: boolean }>;
    };
    if (!preview.canCancel) {
      throw AppError.badRequest(preview.blockers.join(" "));
    }

    // Sebep çözümü TX DIŞINDA (top/sipariş iptalindeki kural): önbellek okuması
    // + olası tazeleme kilidi uzatmasın; geçersiz kod iptali hiç başlatmadan durdurur.
    const { code: cancelReasonCode, text: cancelReasonText } = reason
      ? await resolveReasonCode(ReasonPresetKind.ORDER_CANCEL, reason)
      : { code: null, text: null };

    const affectedWoIds = preview.affectedWorkOrders.map((w) => w.id);

    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM: iki paralel iptal isteğinde ikincisi 409 almalı
      // (check-then-act YASAK — CLAUDE.md durum geçişi kuralı).
      const claim = await tx.orderLine.updateMany({
        where: { id: lineId, cancelledAt: null },
        data: {
          cancelledAt: new Date(),
          cancelReason: cancelReasonText,
          cancelReasonCode,
          cancelledById: userId ?? null,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict("Bu kalem bu sırada iptal edildi. Sayfayı yenileyin.");
      }

      // Bağları kopar + gerekiyorsa WO'yu stok üretimine çevir.
      for (const woId of affectedWoIds) {
        // Bağ SİLİNMEZ, damgalanır (③a, 2026-09-14) — kalem iptali izi satırda durur.
        await unlinkOrderLinesTx(tx, { workOrderId: woId, orderLineId: lineId, reason: "ORDER_LINE_CANCEL", userId: userId ?? null });
        // Taze AÇIK sayım: yarışta araya yeni bağ girdiyse tip ORDER kalmalı
        // (`unlinkOrderLine` ile aynı atomik desen).
        const remaining = await activeOrderLinkCount(tx, woId);
        if (remaining === 0) {
          await tx.workOrder.updateMany({
            where: { id: woId, type: WorkOrderType.ORDER_PRODUCTION },
            data: { type: WorkOrderType.STOCK_PRODUCTION },
          });
        }
        await markTravelerCardDirtyTx(tx, woId);
      }

      // Karşılanma + statü tek yazma noktasından (son-kalem kuralı orada).
      const lineIds = (
        await tx.orderLine.findMany({ where: { orderId }, select: { id: true } })
      ).map((l) => l.id);
      await touchOrderLinesTx(tx, lineIds);
      await recomputeOrderStatusTx(tx, orderId);
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ORDER_LINE",
      recordId: lineId,
      newData: {
        cancelled: true,
        orderId,
        cancelReasonCode,
        cancelReason: cancelReasonText,
        unlinkedWorkOrderIds: affectedWoIds,
      },
    }).catch(() => undefined);

    const fresh = await this.findById(orderId);
    return {
      success: true,
      data: fresh.data,
      message:
        affectedWoIds.length > 0
          ? `Kalem iptal edildi. ${affectedWoIds.length} iş emri bağı koparıldı.`
          : "Kalem iptal edildi.",
    };
  }

  /**
   * SİPARİŞ ÖZET ŞERİDİ — listedeki filtreye uyan kümenin sayıları.
   *
   * Where `buildListWhere` ile kurulur (BaseService) — yani `findAll`ın offset ve
   * cursor yollarıyla AYNI ifade. Envanterdeki `buildRollWhere` emsali: özet ile
   * liste ayrı where kurarsa üst satırdaki sayı alttaki tabloyla çelişir ve
   * operatör hangisine güveneceğini bilemez.
   *
   * ⚠️ İKİ FARKLI KAPSAM, BİLİNÇLİ:
   *   • ADET (`totalCount` / `byStatus`) listenin BİREBİR aynasıdır. Panel iptalleri
   *     varsayılan gizler (`hideCancelled` → `extraWhere`), o yüzden İPTAL kovası
   *     yalnız kullanıcı "İptalleri göster" dediğinde dolar. Burada ikinci bir
   *     iptal sorgusu KOŞULMAZ — koşsaydı şeridin toplamı listenin satır sayısını
   *     tutmazdı ki bu ekranın tek vaadi o eşitliktir.
   *   • METRAJ (`totalOrderedQty` / `totalShippedQty` / `totalOpenQty`) iptalleri
   *     HER ZAMAN dışlar: iptal edilmiş siparişin açık metrajı yoktur. Kullanıcı
   *     iptalleri görünür yapsa bile metraj değişmez.
   *
   * `totalOpenQty` düz çıkarmadır (istenen − sevk). Satır bazında kırpma
   * (`GREATEST(...,0)`) gerekmiyor: tahsis kapasitesi kilit altında taze okunur
   * (`order-status.helper` kilit protokolü) ve canlı kopyada aşırı sevkli kalem
   * ÖLÇÜLDÜ = 0. Yine de toplam 0'da kırpılır — invariant kırılırsa şerit negatif
   * metraj basmasın (gösterim koruması; muhasebe defteri değil).
   */
  async getOrderStats(req: Request): Promise<ApiResponse<OrderStats>> {
    const params = parseQueryParams(req);
    const where = this.buildListWhere(params, req) as Prisma.OrderWhereInput;

    /** Liste where'i + ek koşul. */
    const and = (extra: Prisma.OrderWhereInput): Prisma.OrderWhereInput => ({
      AND: [where, extra],
    });
    /** Terminal olmayan (hâlâ çıkış bekleyen) siparişler. */
    const openStatuses: Prisma.OrderWhereInput = {
      status: { notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] },
    };
    const now = new Date();
    // tz-ok: "termini geçti mi" / "7 gün içinde mi" iki AN arasındaki farktır,
    // takvim günü sorusu değil → fabrika saat diliminden bağımsız.
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [grouped, lineAgg, overdueCount, dueThisWeekCount, noWorkOrderCount, amountGroups] =
      await Promise.all([
        prisma.order.groupBy({ where, by: ["status"], _count: { _all: true } }),
        prisma.orderLine.aggregate({
          where: { order: and({ status: { not: OrderStatus.CANCELLED } }) },
          _sum: { quantity: true, shippedQty: true },
        }),
        prisma.order.count({ where: and({ AND: [openStatuses, { deadline: { lt: now } }] }) }),
        prisma.order.count({
          where: and({ AND: [openStatuses, { deadline: { gte: now, lte: weekAhead } }] }),
        }),
        // En ağır sorgu (NOT EXISTS → order_lines ⋈ work_order_to_order_lines ⋈
        // work_orders). `woState=NONE` filtresiyle AYNI ifade — rozet ne sayıyorsa
        // filtre onu bulmalı.
        prisma.order.count({ where: and(WO_STATE_WHERE.NONE as Prisma.OrderWhereInput) }),
        prisma.order.groupBy({
          where: and({ totalAmount: { not: null } }),
          by: ["currency"],
          _sum: { totalAmount: true },
        }),
      ]);

    let totalCount = 0;
    const byStatus: Record<string, number> = {};
    for (const row of grouped) {
      totalCount += row._count._all;
      byStatus[row.status] = row._count._all;
    }

    // Decimal ile biriktir — ondalık metrajda JS float drift yapar.
    const ordered = new Prisma.Decimal(lineAgg._sum.quantity ?? 0);
    const shipped = new Prisma.Decimal(lineAgg._sum.shippedQty ?? 0);
    const open = ordered.minus(shipped);

    const amountByCurrency: Record<string, number> = {};
    for (const row of amountGroups) {
      const sum = row._sum.totalAmount;
      // Para birimi KARIŞIK olabilir (Order.currency satır bazlı) → tek toplam
      // basmak yanlış olurdu; kırılım aynen döner, gösterimi istemci seçer.
      if (sum != null) amountByCurrency[row.currency] = Number(sum);
    }

    return {
      success: true,
      data: {
        totalCount,
        byStatus,
        totalOrderedQty: Number(ordered),
        totalShippedQty: Number(shipped),
        totalOpenQty: open.isNegative() ? 0 : Number(open),
        overdueCount,
        dueThisWeekCount,
        noWorkOrderCount,
        amountByCurrency,
      },
    };
  }

  /**
   * Müşteriye-özel ad terfisi (otomatik master kaydı).
   *
   * Sipariş satırında `customerItemName` / `customerColorName` girilmiş VE o
   * müşteri+ürün / müşteri+renk için master alias HENÜZ YOKSA → master tabloya
   * (CustomerItemAlias / CustomerColorAlias) yazılır. Böylece aynı müşteriye
   * sonraki sipariş girilirken `/aliases/suggest` bu adı otomatik getirir
   * (alan kilitli/dolu gelir).
   *
   * Master ZATEN VARSA dokunulmaz: bu durumda satırdaki değer bilinçli bir
   * tek-seferlik override'dır (frontend alanı master varken kilitler; "Override
   * Et" onayıyla farklı ad girilebilir). Master'ı ezmek o ayrımı bozar.
   *
   * Best-effort: sipariş zaten commit edilmiştir, alias kaydı yan-etkidir.
   * Terfi sırasında bir hata olursa (örn. ürün/renk pasifleştirilmiş) sipariş
   * kaydı bozulmamalı — hata satır bazında yutulur.
   */
  private async promoteCustomerAliases(
    customerId: string | null | undefined,
    lines: Array<Record<string, unknown>> | null | undefined,
    userId?: string
  ): Promise<void> {
    if (!customerId || !Array.isArray(lines) || lines.length === 0) return;

    // Aynı sipariş içinde aynı ürün/renk birden fazla satırda geçerse tek terfi
    // yeter (ilk dolu ad master olur). PERF: satır-bazlı 2N findUnique yerine
    // benzersiz item/color için TEK varlık-okuması (2 findMany) + yalnız EKSİK
    // olanları upsert. Davranış birebir: yalnız HİÇ alias-satırı olmayan (assigned
    // dahil) item/color terfi edilir; mevcut satır korunur, ilk-dolu-ad kazanır.
    const itemNameById = new Map<string, string>();
    const colorNameById = new Map<string, string>();
    for (const line of lines) {
      const itemId = typeof line.itemId === "string" ? line.itemId : null;
      const colorId = typeof line.colorId === "string" ? line.colorId : null;
      const itemName =
        typeof line.customerItemName === "string" ? line.customerItemName.trim() : "";
      const colorName =
        typeof line.customerColorName === "string" ? line.customerColorName.trim() : "";
      if (itemId && itemName.length > 0 && !itemNameById.has(itemId)) {
        itemNameById.set(itemId, itemName);
      }
      if (colorId && colorName.length > 0 && !colorNameById.has(colorId)) {
        colorNameById.set(colorId, colorName);
      }
    }
    if (itemNameById.size === 0 && colorNameById.size === 0) return;

    const itemIds = [...itemNameById.keys()];
    const colorIds = [...colorNameById.keys()];
    let existingItems = new Set<string>();
    let existingColors = new Set<string>();
    try {
      if (itemIds.length > 0) {
        existingItems = new Set(
          (
            await prisma.customerItemAlias.findMany({
              where: { customerId, itemId: { in: itemIds } },
              select: { itemId: true },
            })
          ).map((r) => r.itemId)
        );
      }
      if (colorIds.length > 0) {
        existingColors = new Set(
          (
            await prisma.customerColorAlias.findMany({
              where: { customerId, colorId: { in: colorIds } },
              select: { colorId: true },
            })
          ).map((r) => r.colorId)
        );
      }
    } catch (e) {
      // best-effort: varlık okunamazsa terfi atlanır, sipariş etkilenmez.
      hata("order", "müşteri alias varlık-okuması başarısız:", e);
      return;
    }

    for (const [itemId, itemName] of itemNameById) {
      if (existingItems.has(itemId)) continue;
      try {
        await this.aliasService.upsertItemAlias(customerId, itemId, itemName, userId);
      } catch (e) {
        hata("order", "müşteri-ürün alias terfisi başarısız:", e);
      }
    }
    for (const [colorId, colorName] of colorNameById) {
      if (existingColors.has(colorId)) continue;
      try {
        await this.aliasService.upsertColorAlias(customerId, colorId, colorName, userId);
      } catch (e) {
        hata("order", "müşteri-renk alias terfisi başarısız:", e);
      }
    }
  }

  /**
   * Sipariş kalemleri için finansal sınırlar:
   *   - quantity > 0 (pozitif metraj/adet)
   *   - unitPrice >= 0 ya da null (null = "fiyatlandırılmamış", iş kuralı)
   * Negatif/sıfır metraj veya negatif fiyat finansal kayıt + üretim akışını
   * bozacağı için service seviyesinde reddedilir (Zod yerine inline AppError,
   * mevcut validateBranch / assertValidCurrency deseniyle uyumlu).
   */
  private validateLines(lines: unknown): void {
    if (!Array.isArray(lines)) return;
    lines.forEach((rawLine, idx) => {
      if (rawLine == null || typeof rawLine !== "object") return;
      const line = rawLine as Record<string, unknown>;
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw AppError.badRequest(
          `Sipariş kalemi #${idx + 1}: miktar pozitif olmalı (0'dan büyük).`
        );
      }
      // Decimal(12,3) tavanı — aşımda DB'de P2020 yerine alan-düzeyinde net hata.
      if (qty > 999_999_999) {
        throw AppError.badRequest(`Sipariş kalemi #${idx + 1}: miktar çok büyük.`);
      }
      // En (width) opsiyonel; verildiyse pozitif + makul üst sınır (0/negatif/
      // aşırı-büyük en üretim spec'ini bozar — miktar deseniyle aynı hijyen).
      if (line.width != null) {
        const w = Number(line.width);
        if (!Number.isFinite(w) || w <= 0) {
          throw AppError.badRequest(`Sipariş kalemi #${idx + 1}: en pozitif olmalı (0'dan büyük).`);
        }
        if (w > 100_000) {
          throw AppError.badRequest(`Sipariş kalemi #${idx + 1}: en çok büyük.`);
        }
      }
      if (line.unitPrice != null) {
        const price =
          typeof line.unitPrice === "string"
            ? Number(line.unitPrice)
            : (line.unitPrice as number);
        if (!Number.isFinite(price) || price < 0) {
          throw AppError.badRequest(
            `Sipariş kalemi #${idx + 1}: birim fiyat negatif olamaz.`
          );
        }
        if (price > 999_999_999) {
          throw AppError.badRequest(
            `Sipariş kalemi #${idx + 1}: birim fiyat çok büyük.`
          );
        }
      }
    });
  }

  /**
   * Sipariş kalemlerindeki renkler bu müşteride kullanılabilir mi? Müşteriye
   * özel (assigned) bir renk, yanlış müşteride veya müşterisiz siparişte
   * reddedilir. Public renkler serbest. (UI zaten gizler; bu backend enforce.)
   */
  private async validateLineColors(
    lines: unknown,
    customerId: string | null | undefined,
  ): Promise<void> {
    if (!Array.isArray(lines)) return;
    const colorIds = lines.map((l) => {
      if (l && typeof l === "object") {
        const c = (l as Record<string, unknown>).colorId;
        if (typeof c === "string") return c;
      }
      return null;
    });
    await assertColorsAssignableToCustomer(colorIds, customerId);
  }

  /**
   * Sipariş kalemlerindeki ürün (itemId) ve istenen özelliklerin
   * (requiredPropertyIds) var + aktif olduğunu doğrular. Pasife alınmış
   * (soft-deleted) bir ürün/özellik DB FK kontrolünü geçer ve canlı sipariş
   * satırına yazılabilir — master-data'nın emekliye ayırdığı kayda finansal/
   * üretim bağı kurulur. KK1/WO ile aynı soft-delete-entry guard sınıfı.
   * (Var-olmayan UUID zaten P2003→400 ile yakalanır; bu guard pasif kayıtları kapatır.)
   */
  /**
   * Satır kalemlerini doğrular ve `itemId → Item.unit` haritasını döner: satır
   * birimi buradan kopyalanır (ikinci bir okuma doğmasın diye aynı sorgu).
   */
  private async validateLineItems(lines: unknown): Promise<Map<string, ItemUnit>> {
    const unitByItem = new Map<string, ItemUnit>();
    if (!Array.isArray(lines)) return unitByItem;

    const itemIds = new Set<string>();
    const propertyIds = new Set<string>();
    const colorIds = new Set<string>();
    const pairs: Array<{ itemId: string; colorId: string | null; propIds: string[] }> = [];
    for (const raw of lines) {
      if (!raw || typeof raw !== "object") continue;
      const line = raw as Record<string, unknown>;
      const itemId = typeof line.itemId === "string" && line.itemId ? line.itemId : null;
      const colorId = typeof line.colorId === "string" && line.colorId ? line.colorId : null;
      const propIds = Array.isArray(line.requiredPropertyIds)
        ? (line.requiredPropertyIds as unknown[]).filter(
            (p): p is string => typeof p === "string" && p.length > 0,
          )
        : [];
      if (itemId) {
        itemIds.add(itemId);
        pairs.push({ itemId, colorId, propIds });
      }
      if (colorId) colorIds.add(colorId);
      for (const p of propIds) propertyIds.add(p);
    }

    if (itemIds.size > 0) {
      // M-24: Item.allowedColors/allowedProperties kuralı (dolu = bu listeden;
      // boş = sınırsız) artık SİPARİŞ satırında da enforce edilir — KK1'in
      // zaten uyguladığı kuralın simetriği. Yoksa üretilemez renkte satır MRP
      // talebi yaratıyor, hata ancak KK1/üretimde patlıyordu.
      const live = await prisma.item.findMany({
        where: { id: { in: [...itemIds] }, isActive: true },
        select: {
          id: true,
          name: true,
          unit: true,
          allowedColors: { select: { colorId: true } },
          allowedProperties: { select: { propertyId: true } },
        },
      });
      if (live.length !== itemIds.size) {
        throw AppError.badRequest("Sipariş kaleminde bulunmayan veya pasif ürün var");
      }
      const itemById = new Map(live.map((i) => [i.id, i]));
      for (const i of live) unitByItem.set(i.id, i.unit);
      for (const pair of pairs) {
        const item = itemById.get(pair.itemId);
        if (!item) continue;
        const allowedColorSet = new Set(item.allowedColors.map((c) => c.colorId));
        if (pair.colorId && allowedColorSet.size > 0 && !allowedColorSet.has(pair.colorId)) {
          throw AppError.badRequest(
            `Seçilen renk '${item.name}' ürününün izinli renk listesinde değil`,
          );
        }
        const allowedPropSet = new Set(item.allowedProperties.map((p) => p.propertyId));
        if (allowedPropSet.size > 0) {
          const outside = pair.propIds.find((p) => !allowedPropSet.has(p));
          if (outside) {
            throw AppError.badRequest(
              `Seçilen özelliklerden biri '${item.name}' ürününün izinli özellik listesinde değil`,
            );
          }
        }
      }
    }

    await this.assertLineRefsLive(colorIds, propertyIds);
    return unitByItem;
  }

  /** Satırın renk/özellik referansları var ve aktif mi (M-23 / denetim Q2). */
  private async assertLineRefsLive(colorIds: Set<string>, propertyIds: Set<string>): Promise<void> {
    // M-23: satır rengi varlık + isActive (item/property gibi — pasif renk
    // canlı sipariş satırına yazılamaz; assertColorsAssignableToCustomer
    // yalnız atama kuralına bakar, aktifliğe bakmaz).
    if (colorIds.size > 0) {
      const liveColors = await prisma.color.findMany({
        where: { id: { in: [...colorIds] }, isActive: true },
        select: { id: true },
      });
      if (liveColors.length !== colorIds.size) {
        throw AppError.badRequest("Sipariş kaleminde bulunmayan veya pasif renk var");
      }
    }

    if (propertyIds.size > 0) {
      const live = await prisma.fabricProperty.findMany({
        where: { id: { in: [...propertyIds] }, isActive: true },
        select: { id: true },
      });
      if (live.length !== propertyIds.size) {
        throw AppError.badRequest("Sipariş kaleminde bulunmayan veya pasif özellik var");
      }
      // SEÇİM tipli özellik sipariş şartı olamaz (denetim Q2): "müşteri GRAMAJ
      // istiyor" hangi gramaj olduğunu söylemez; iş emri kalıtımıyla hedef
      // listeye ve oradan doğan toplara değersiz satır olarak yayılırdı.
      await assertTargetablePropertyIds([...propertyIds], "sipariş kalemi özelliği");
    }
  }

  /**
   * Satır birimi: gönderildiyse enum'a karşı doğrulanır, gönderilmediyse kalem
   * kartından kopyalanır. Sessiz `MT` varsayılanı YOK — kalem çözülemediyse 400
   * (varsayılan, 1000 kg'lık satırı metre saydıran sessiz yanlışın kendisiydi).
   */
  private resolveLineUnit(
    raw: Record<string, unknown>,
    unitByItem: Map<string, ItemUnit>,
  ): ItemUnit {
    if (raw.unit != null && raw.unit !== "") {
      if (!isItemUnit(raw.unit)) {
        throw AppError.badRequest(`Geçersiz kalem birimi: ${String(raw.unit)} (MT, KG veya ADET).`);
      }
      return raw.unit;
    }
    const fromItem = typeof raw.itemId === "string" ? unitByItem.get(raw.itemId) : undefined;
    if (!fromItem) {
      throw AppError.badRequest("Sipariş kaleminin birimi çözülemedi — ürün seçilmemiş.");
    }
    return fromItem;
  }

  /** Yanıta MT-dışı satır uyarılarını ekler (engel değil, `warnings`). */
  private withUnitWarnings<T>(res: ApiResponse<T>): ApiResponse<T> {
    const lines = (res.data as { lines?: unknown } | null)?.lines;
    if (!Array.isArray(lines)) return res;
    const warnings = unmeasuredLineWarnings(lines as Parameters<typeof unmeasuredLineWarnings>[0]);
    return warnings.length > 0 ? { ...res, warnings } : res;
  }

  /**
   * Hedef şubenin müşteriye ait + aktif olduğunu doğrular.
   */
  private async validateBranch(
    branchId: string,
    customerId: string
  ): Promise<void> {
    const branch = await prisma.customerBranch.findUnique({
      where: { id: branchId },
      select: { id: true, customerId: true, isActive: true },
    });
    if (!branch) throw AppError.notFound("Şube bulunamadı");
    if (branch.customerId !== customerId) {
      throw AppError.badRequest("Şube bu müşteriye ait değil");
    }
    if (!branch.isActive) throw AppError.badRequest("Şube pasif durumda");
  }

  /**
   * Müşterinin varlığını + aktifliğini doğrular. Pasif (soft-deleted) müşteriye
   * yeni sipariş açılamaz — satış temsilcisi yanlış kayıt seçimini fark etmesin
   * diye iş kuralı seviyesinde reddedilir.
   */
  private async validateCustomer(customerId: string): Promise<void> {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, isActive: true },
    });
    if (!customer) throw AppError.notFound("Müşteri bulunamadı");
    if (!customer.isActive) {
      throw AppError.badRequest(
        "Müşteri pasif durumda. Aktif olmayan müşteriye sipariş açılamaz."
      );
    }
  }

  /** F148: para birimi ISO 4217 kataloğunda mı (create/update simetrik). null=opsiyonel. */
  private assertValidCurrency(currency: unknown): void {
    if (currency == null) return; // opsiyonel; şema default TRY
    const code = String(currency);
    if (!CURRENCIES.some((c) => c.code === code)) {
      throw AppError.badRequest(`Geçersiz para birimi: ${code}`);
    }
  }

  /** F148: termin >= sipariş tarihi (verilmezse referans = now). create/update ortak. */
  private assertDeadlineNotBeforeOrderDate(deadline: unknown, orderDate: unknown): void {
    if (deadline == null) return;
    const d = new Date(deadline as string);
    if (Number.isNaN(d.getTime())) throw AppError.badRequest("Termin tarihi geçersiz");
    const ref = orderDate != null ? new Date(orderDate as string) : new Date();
    if (Number.isNaN(ref.getTime())) throw AppError.badRequest("Sipariş tarihi geçersiz");
    if (d.getTime() < ref.getTime()) {
      throw AppError.badRequest("Termin tarihi sipariş tarihinden önce olamaz");
    }
  }

  /**
   * İş emri picker'ı için müsait sipariş listesi.
   *
   * Gevşek/gap model (güncel): açık > 0 (quantity − shippedQty) satırı olan,
   * CANCELLED/COMPLETED-dışı siparişleri döner. WO bağı müsaitliği ETKİLEMEZ —
   * sipariş yalnız SEVKle kapanır, üretime girince değil. (Eski workOrderLinks-bazlı
   * filtreleme ve excludeWorkOrderId artık YOK; açık-satır süzgeci DB WHERE'inde.)
   *
   * Standart `filters` (status, customerId), `search`, `dateFrom/dateTo`,
   * `sortBy` ve sayfalama parametreleri `findAll` ile aynı şekilde çalışır.
   */
  async findAvailableForWorkOrder(
    req: Request
  ): Promise<PaginatedResponse<unknown>> {
    const params = parseQueryParams(req);
    // Search'i `buildWhereClause`'a vermiyoruz; picker'da arama relation'lara
    // (müşteri adı, kalem ürün adı) genişletiliyor — kendi OR'umuzu kuruyoruz.
    const baseWhere = buildWhereClause(
      params.filters,
      this.config.searchFields
    );
    applyDateRange(baseWhere, params, this.config.dateFields ?? []);

    const search = params.search?.trim();
    if (search) {
      baseWhere.OR = buildTextSearch<Prisma.OrderWhereInput>(search, {
        text: [
          "customer.name",
          "lines.some.item.name",
          "lines.some.customerItemName",
          "lines.some.item.customerAliases.some.alias",
        ],
        code: ["orderNumber"],
      });
    }

    // Gap-bazlı picker: bir satır "müsait" ise Açık > 0.
    //   Açık = quantity − sevk (OrderLine.shippedQty). WO bağı açığı ETKİLEMEZ —
    //   sipariş ancak sevk edilince kapanır, üretime girince değil (gevşek model).
    // Kapalı/iptal sipariş hariç (gap hesabı yalnız açık siparişlerde anlamlı).
    // F147: açık-satır koşulunu WHERE'e taşı → 500-tavanı yalnız açık siparişlere
    // harcanır (memory filtresi `lines.length>0` zaten kapalıları eliyordu; özdeş).
    // F150: filter[status] (buildWhereClause → baseWhere.status) notIn ile EZİLMESİN —
    // AND ile birleştir (picker daima iptal/tamamlanmışı eler; ek statü onu daraltır).
    const { status: filterStatus, ...restBase } = baseWhere;
    const where: Prisma.OrderWhereInput = {
      ...restBase,
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
      // Aktif + açık kalem — tek kaynak (iptal edilmiş kalem talep sayılmaz).
      ...someOpenLine(prisma.orderLine.fields),
      ...(filterStatus !== undefined
        ? { AND: [{ status: filterStatus as Prisma.OrderWhereInput["status"] }] }
        : {}),
    };

    // sortBy güvenlik süzgeci (BaseService) — bilinmeyen kolon 500'ünü engeller.
    const orderBy = buildOrderByClause(
      this.safeSortBy(params.sortBy || "createdAt"),
      params.sortOrder
    );

    // Aday açık siparişleri display include + satır tahsisleriyle çek (picker tavanı 500).
    const orders = await prisma.order.findMany({
      where,
      orderBy,
      take: 500,
      include: {
        customer: true,
        branch: { select: { id: true, name: true, code: true, city: true, district: true } },
        lines: {
          include: {
            // item.allowedProperties picker sonucunda KULLANILMIYOR (TargetPropertyPicker
            // ayrı item sorgusundan alır) — over-fetch'i kaldır. requiredProperties
            // ise OrderPickerDialog'da gösteriliyor → kalır.
            item: true,
            color: true,
            requiredProperties: { include: { property: true } },
          },
        },
      },
    });

    // Kapsama (yalnız sevk) — tüm aday satırlar için tek hesap.
    const allLineIds = orders.flatMap((o) => o.lines.map((l) => l.id));
    const covMap = await computeLineCoverage(prisma, allLineIds);

    // Her sipariş için Açık>0 satırları süz + kovaları satıra ekle (UI'da göster).
    const enriched = orders
      .map((order) => {
        const lines = order.lines
          .map((line) => {
            const cov = covMap.get(line.id);
            const shipped = cov?.shipped ?? new Prisma.Decimal(0);
            // KG/ADET satırda açık metraj ÖLÇÜLMEZ (null) — satır yine üretime alınabilir.
            const measured = isMeasuredLine(line);
            const openQty = measured ? new Prisma.Decimal(line.quantity).minus(shipped) : null;
            return { ...line, shippedQty: shipped, openQty, measured };
          })
          .filter((line) => line.openQty === null || line.openQty.greaterThan(0));
        return { ...order, lines };
      })
      .filter((order) => order.lines.length > 0);

    const total = enriched.length;
    const { skip, take } = buildPagination(params.page, params.pageSize);
    const data = enriched.slice(skip, skip + take);

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
   * Bir topun özelliğine (itemId + opsiyonel colorId/width) uyan, Açık > 0 olan
   * AÇIK sipariş kalemlerini döner. Tambur "Yeniden Kes" (depo topu → müşteri
   * etiketi) ve top-önce paketleme picker'ları için.
   * Açık = quantity − sevk (OrderLine.shippedQty); WO bağı açığı etkilemez.
   * `withInProduction` verilirse her satıra ayrıca `inProduction` (üretimdeki) +
   * `netOpenQty` (= açık − üretimdeki) eklenir — Hızlı İş Emri "ne kadar daha
   * üretmeliyim" için. Tambur/Etiket bunu GÖNDERMEZ (bitmiş mal ataması; açık aynı kalır).
   */
  async findAvailableOrderLines(params: {
    itemId?: string | null;
    colorId?: string | null;
    width?: number | null;
    withInProduction?: boolean;
    // Cursor mod (sipariş-önce aramalı liste) — yalnız `limit` verilince devreye girer.
    search?: string | null;
    cursor?: string | null;
    limit?: number | null;
    withTotal?: boolean;
    /** Mobil picker "detaylı filtre" — müşteri bazlı daraltma. */
    customerId?: string | null;
    /**
     * "Bu kalemle AYNI iş emrinde üretilebilecek kalemler" — verilen satırın
     * spec'ini (kumaş + renk + en) okur ve listeyi ona daraltır.
     *
     * Neden ham `colorId`/`width` değil: spec'in parçaları NULL olabilir
     * (renksiz/ham kalem, eni girilmemiş kalem) ve "renk yok" ile "renk filtresi
     * yok" sorgu dizesinde aynı görünür — istemci NULL'ı kodlamaya çalışsa
     * eninde sonunda birini diğeri sanardı. Satır id'si tek parça, belirsizlik yok.
     */
    specOfLineId?: string | null;
  }): Promise<ApiResponse<unknown> | CursorPaginatedResponse<unknown>> {
    // Ortak WHERE — itemId artık OPSİYONEL (cursor modda sipariş-önce için).
    const orderWhere: Prisma.OrderWhereInput = {
      status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
    };
    if (params.customerId) orderWhere.customerId = params.customerId;
    const baseWhere: Prisma.OrderLineWhereInput = { order: orderWhere };

    // Spec çapası varsa kumaş/renk/en'i O BELİRLER (istemciden geleni ezer).
    let resolvedItemId: string | null = params.itemId ?? null;
    if (params.specOfLineId) {
      const anchor = await prisma.orderLine.findUnique({
        where: { id: params.specOfLineId },
        select: { itemId: true, colorId: true, width: true },
      });
      if (!anchor) throw AppError.badRequest("Referans sipariş kalemi bulunamadı");
      // NULL'lar BİLEREK aynen yazılır: renksiz çapa yalnız renksiz kalemleri,
      // ensiz çapa yalnız ensiz kalemleri getirsin.
      baseWhere.itemId = anchor.itemId;
      baseWhere.colorId = anchor.colorId;
      baseWhere.width = anchor.width;
      resolvedItemId = anchor.itemId;
    } else {
      if (params.itemId) baseWhere.itemId = params.itemId;
      if (params.colorId) baseWhere.colorId = params.colorId;
      if (params.width != null) baseWhere.width = params.width;
    }
    const term = params.search?.trim();
    if (term) {
      baseWhere.OR = buildTextSearch<Prisma.OrderLineWhereInput>(term, {
        text: [
          "order.customer.name",
          "item.name",
          "customerItemName",
          "item.customerAliases.some.alias",
        ],
        code: ["order.orderNumber"],
      });
    }

    // ── CURSOR MOD (limit verildi): itemId opsiyonel, "sipariş-önce" aramalı liste.
    //    E1: açık>0 SQL'de (keyset-safe; openQty = quantity − shippedQty). withInProduction
    //    broad modda (itemId yok) hesaplanmaz; openQty doğrudan shippedQty'den türetilir.
    if (params.limit != null) {
      const limit = Math.min(Math.max(1, params.limit), 50);
      const whereOpen: Prisma.OrderLineWhereInput = {
        ...baseWhere,
        ...openLineWhere(prisma.orderLine.fields),
      };
      // EN YENİ SİPARİŞ ÖNCE (desc). Saha gerekçesi: picker'ı açan kişi genelde
      // az önce girilen siparişi arıyor; artan sırada o kalem sayfalar sonundaydı.
      // Keyset tie-break de desc olmalı — `dynamicCursorWhere` "lt" üretir.
      const cur = decodeDynamicCursor(params.cursor ?? undefined);
      const where = cur
        ? { AND: [whereOpen, dynamicCursorWhere(cur, "createdAt", "desc")] }
        : whereOpen;
      const rows = await prisma.orderLine.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          itemId: true,
          quantity: true,
          shippedQty: true,
          unit: true,
          width: true,
          colorId: true,
          customerItemName: true,
          customerColorName: true,
          createdAt: true,
          order: {
            select: {
              id: true,
              orderNumber: true,
              deadline: true,
              customer: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          },
          item: { select: { code: true, name: true } },
          color: { select: { code: true, name: true } },
        },
      });
      const totalEstimate = params.withTotal
        ? await prisma.orderLine.count({ where: whereOpen })
        : undefined;
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1] as Record<string, unknown> | undefined;
      const nextCursor = hasMore ? buildNextDynamicCursor(last, "createdAt") : null;
      // F152: cursor mod da withInProduction'ı hesaplasın (eskiden 0 hardcode idi).
      // Yalnız itemId sabitlendiğinde anlamlı (spec-havuz item bazlı); broad modda atlanır.
      let inProdBySpec: Map<string, Prisma.Decimal> | null = null;
      if (params.withInProduction && resolvedItemId) {
        inProdBySpec = await this.computeInProdBySpec(resolvedItemId);
      }
      // "Bu kaleme iş emri açılmış mı" — SATIR bazlı gerçek bağ (pivot).
      // `inProduction`'dan FARKLIDIR: o spec-havuz (kumaş|renk|en) bazında hesaplanır,
      // yani aynı spec'teki BAŞKA bir kalem üretimdeyse de dolu gelir. Rozet satırın
      // kendi bağını göstermeli. İptal/devredilmiş WO sayılmaz (mal o emirde değil).
      const woLinked = new Set<string>();
      if (page.length > 0) {
        const links = await prisma.workOrderToOrderLine.findMany({
          where: {
            ...ACTIVE_ORDER_LINK,
            orderLineId: { in: page.map((l) => l.id) },
            workOrder: {
              status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
            },
          },
          select: { orderLineId: true },
          distinct: ["orderLineId"],
        });
        for (const l of links) woLinked.add(l.orderLineId);
      }
      const data = page.map((l) => {
        // Açık = quantity − sevk (rezerv yok; düşüş yalnız sevkte). KG/ADET satırda
        // ÖLÇÜLMEZ (null): shippedQty hiç yazılmaz, metre açığı yalan olurdu.
        const measured = isMeasuredLine(l);
        const openQty = measured ? new Prisma.Decimal(l.quantity).minus(l.shippedQty) : null;
        const inProduction =
          inProdBySpec?.get(
            `${l.itemId}|${l.colorId ?? ""}|${l.width == null ? "" : new Prisma.Decimal(l.width).toString()}`,
          ) ?? new Prisma.Decimal(0);
        const netOpenQty = openQty === null ? null : Prisma.Decimal.max(0, openQty.minus(inProduction));
        return {
          lineId: l.id,
          itemId: l.itemId,
          orderId: l.order.id,
          orderNumber: l.order.orderNumber,
          deadline: l.order.deadline,
          customerId: l.order.customer.id,
          customerName: l.order.customer.name,
          branchName: l.order.branch?.name ?? null,
          itemCode: l.item.code,
          itemName: l.item.name,
          customerItemName: l.customerItemName,
          colorId: l.colorId,
          colorCode: l.color?.code ?? null,
          colorName: l.color?.name ?? null,
          customerColorName: l.customerColorName,
          width: l.width,
          quantity: l.quantity,
          openQty,
          inProduction,
          netOpenQty,
          measured,
          hasWorkOrder: woLinked.has(l.id),
        };
      });
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

    // ── LEGACY MOD (limit yok): itemId ZORUNLU — Tambur/etiket picker'ı. DAVRANIŞ BİREBİR.
    const itemId = params.itemId;
    if (!itemId) throw AppError.badRequest("itemId gerekli");

    const lines = await prisma.orderLine.findMany({
      // F146: legacy mod da cursor moddaki açık-satır süzgecini uygular (200-tavanı
      // açık satırlara harcanır). Bellek süzgeci (openQty>0) defansif kalır — özdeş.
      where: { ...baseWhere, ...openLineWhere(prisma.orderLine.fields) },
      take: 200,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        itemId: true,
        quantity: true,
        unit: true,
        width: true,
        colorId: true,
        customerItemName: true,
        customerColorName: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            deadline: true,
            customer: { select: { id: true, name: true } },
            branch: { select: { id: true, name: true } },
          },
        },
        item: { select: { code: true, name: true } },
        color: { select: { code: true, name: true } },
      },
    });

    const lineIds = lines.map((l) => l.id);
    const covMap = await computeLineCoverage(prisma, lineIds);

    // Opsiyonel: üretimdeki (canlı WO committed − finished) spec-havuz bazında.
    // getCoverageForLines ile aynı mantık; yalnız bu itemId için hesaplanır.
    const specKey = (
      colorId: string | null,
      width: Prisma.Decimal | number | null,
    ): string =>
      `${itemId}|${colorId ?? ""}|${width == null ? "" : new Prisma.Decimal(width).toString()}`;
    // F152: üretimdeki hesabı computeInProdBySpec'e çıkarıldı (cursor mod da kullanır).
    let inProdBySpec: Map<string, Prisma.Decimal> | null = null;
    if (params.withInProduction) inProdBySpec = await this.computeInProdBySpec(itemId);

    const data = lines
      .map((l) => {
        const cov = covMap.get(l.id);
        // Açık = quantity − kapsama (sevk + çuvallanmış rezerv). KG/ADET satırda
        // ÖLÇÜLMEZ (null) — satır listede kalır, rakam yerine "ölçülmüyor".
        const measured = isMeasuredLine(l);
        const openQty = measured
          ? new Prisma.Decimal(l.quantity).minus(cov?.coverage ?? new Prisma.Decimal(0))
          : null;
        const inProduction =
          inProdBySpec?.get(specKey(l.colorId, l.width)) ?? new Prisma.Decimal(0);
        // Net açık = açık − üretimdeki (0'ın altına inmez). Yalnız withInProduction'da anlamlı.
        const netOpenQty = openQty === null ? null : Prisma.Decimal.max(0, openQty.minus(inProduction));
        return {
          lineId: l.id,
          itemId: l.itemId,
          orderId: l.order.id,
          orderNumber: l.order.orderNumber,
          deadline: l.order.deadline,
          customerId: l.order.customer.id,
          customerName: l.order.customer.name,
          branchName: l.order.branch?.name ?? null,
          itemCode: l.item.code,
          itemName: l.item.name,
          customerItemName: l.customerItemName,
          colorId: l.colorId,
          colorCode: l.color?.code ?? null,
          colorName: l.color?.name ?? null,
          customerColorName: l.customerColorName,
          width: l.width,
          quantity: l.quantity,
          openQty,
          inProduction,
          netOpenQty,
          measured,
        };
      })
      .filter((l) => l.openQty === null || l.openQty.greaterThan(0));

    return { success: true, data };
  }

  /**
   * F152: bir item'ın canlı WO'larından spec-havuz (item|renk|en) başına üretimdeki
   * (in-flight = committed − finished) miktarı. findAvailableOrderLines'ın hem cursor
   * hem legacy modu paylaşır. Anahtar formatı: `${itemId}|${colorId}|${width}`.
   */
  private async computeInProdBySpec(
    itemId: string,
  ): Promise<Map<string, Prisma.Decimal>> {
    const liveWos = await prisma.workOrder.findMany({
      where: {
        status: {
          in: [
            WorkOrderStatus.PLANNED,
            WorkOrderStatus.IN_PROGRESS,
          ],
        },
        isActive: true,
        targetItemId: itemId,
      },
      select: { id: true, targetColorId: true, width: true },
    });
    const woMat = await computeWoMaterial(prisma, liveWos.map((w) => w.id));
    const map = new Map<string, Prisma.Decimal>();
    for (const w of liveWos) {
      const mat = woMat.get(w.id);
      const inFlight = Prisma.Decimal.max(
        0,
        (mat?.committed ?? new Prisma.Decimal(0)).minus(mat?.finished ?? 0),
      );
      if (inFlight.lessThanOrEqualTo(0)) continue;
      const key = `${itemId}|${w.targetColorId ?? ""}|${w.width == null ? "" : new Prisma.Decimal(w.width).toString()}`;
      map.set(key, (map.get(key) ?? new Prisma.Decimal(0)).plus(inFlight));
    }
    return map;
  }

  /**
   * Kapsama (coverage) — WO formundaki seçili sipariş kalemleri için "ne kadar
   * üretmeliyim". Her spec (ürün+renk+en) için:
   *   istenen − sevk − üretimde − serbest depo − serbest ham = net açık (eksi = fazla).
   * HİBRİT MODEL:
   *  - sevk: kaleme özel (OrderLine.shippedQty) → satır bazında toplanır.
   *  - üretimde: canlı WO'ların hedef-spec başına in-flight'ı (committed − finished,
   *    computeWoMaterial). Spec-havuz: aynı spec'in her kalemi aynı değeri taşır
   *    (frontend bir kez sayar). Pro-rata / per-kalem tahsis YOK.
   *  - serbest depo/ham: item+renk+en eşleşen, sevkiyata okutulmamış
   *    (shipmentId=null) WAREHOUSE/STOCK toplar (fungible havuz).
   * excludeWorkOrderId: düzenleme modunda WO'nun kendi üretimini sayma.
   */
  async getCoverageForLines(params: {
    lineIds: string[];
    excludeWorkOrderId?: string;
  }): Promise<ApiResponse<unknown>> {
    const lineIds = [...new Set(params.lineIds)];
    if (lineIds.length === 0) return { success: true, data: [] };

    const lines = await prisma.orderLine.findMany({
      where: { id: { in: lineIds } },
      select: {
        id: true,
        itemId: true,
        colorId: true,
        width: true,
        quantity: true,
        shippedQty: true,
        item: { select: { id: true, code: true, name: true } },
        color: { select: { id: true, code: true, name: true } },
      },
    });

    const specKey = (
      itemId: string,
      colorId: string | null,
      width: Prisma.Decimal | number | null,
    ): string => {
      const w = width == null ? "" : new Prisma.Decimal(width).toString();
      return `${itemId}|${colorId ?? ""}|${w}`;
    };

    // En eşleşmesi: Depo (bitmiş) birebir; Ham EN-AGNOSTİK (ham kumaşın eni
    // önemsiz, fasonda işlenir) — Ürün Dengesi ile aynı.
    const widthEqual = (a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean =>
      a == null || b == null ? a == null && b == null : new Prisma.Decimal(a).equals(b);

    // Serbest stok — spec bazında grupla; hiçbir çuvala/sevkiyata girmemiş (shipmentId=null
    // + sackId=null) WAREHOUSE + STOCK toplar (fungible havuz). sackId:null: çuvaldaki
    // (bekleyen) mal serbest stok sayılmaz.
    const itemIds = [...new Set(lines.map((l) => l.itemId))];
    const freeGrouped = await prisma.roll.groupBy({
      // `entrySource`: ham ↔ yarı mamul ayrımı statüden çıkmaz (ikisi de STOCK).
      by: ["itemId", "colorId", "width", "status", "entrySource"],
      where: {
        shipmentId: null,
        sackId: null,
        itemId: { in: itemIds },
        status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
      },
      _sum: { currentQty: true },
    });

    // Serbest stok eşleştirme (item kesin):
    //  - Depo (WAREHOUSE, bitmiş/boyalı): renk + en BİREBİR (renk + en zaten sabit).
    //  - Ham (STOCK, işlenecek): renksiz (null) ham JOKER — boyahanede istenen renge
    //    boyanır, renkli talebe de sayılır; en AGNOSTİK (eni önemsiz). (Ürün Dengesi ile aynı.)
    /**
     * `semi`: yalnız STOCK dalında anlamlı — `true` yarı mamul, `false` gerçek ham,
     * `undefined` ikisi birden. Ayrım GÖSTERİM içindir; `netGap` zaten ham havuzunu
     * hiç saymıyor (işlenmemiş girdi, mamul değil).
     */
    const matchFree = (
      line: (typeof lines)[number],
      status: RollStatus,
      semi?: boolean,
    ): Prisma.Decimal =>
      freeGrouped.reduce((sum, g) => {
        if (g.status !== status) return sum;
        if (g.itemId !== line.itemId) return sum;
        if (semi !== undefined && (g.entrySource === RollEntrySource.SEMI_FINISHED) !== semi) {
          return sum;
        }
        if (status === RollStatus.WAREHOUSE) {
          if ((g.colorId ?? null) !== (line.colorId ?? null)) return sum;
          if (!widthEqual(g.width, line.width)) return sum;
        } else {
          const colorOk =
            g.colorId == null || line.colorId == null || g.colorId === line.colorId;
          if (!colorOk) return sum;
          // Ham en-agnostik: en kontrolü yok.
        }
        return sum.plus(g._sum.currentQty ?? 0);
      }, new Prisma.Decimal(0));

    // Üretimde — canlı WO'ların hedef-spec başına in-flight (committed − finished).
    // Düzenlenen WO hariç (kendi üretimini açığa saymamak için).
    const liveWos = await prisma.workOrder.findMany({
      where: {
        status: {
          in: [
            WorkOrderStatus.PLANNED,
            WorkOrderStatus.IN_PROGRESS,
          ],
        },
        isActive: true,
        targetItemId: { in: itemIds },
        ...(params.excludeWorkOrderId ? { id: { not: params.excludeWorkOrderId } } : {}),
      },
      select: {
        id: true,
        targetItemId: true,
        targetColorId: true,
        width: true,
      },
    });
    const woMat = await computeWoMaterial(prisma, liveWos.map((w) => w.id));
    const inProdBySpec = new Map<string, Prisma.Decimal>();
    for (const w of liveWos) {
      if (!w.targetItemId) continue;
      const mat = woMat.get(w.id);
      const inFlight = Prisma.Decimal.max(
        0,
        (mat?.committed ?? new Prisma.Decimal(0)).minus(mat?.finished ?? 0),
      );
      if (inFlight.lessThanOrEqualTo(0)) continue;
      const key = specKey(w.targetItemId, w.targetColorId, w.width);
      inProdBySpec.set(key, (inProdBySpec.get(key) ?? new Prisma.Decimal(0)).plus(inFlight));
    }

    const data = lines.map((l) => {
      const shipped = new Prisma.Decimal(l.shippedQty);
      const packed = new Prisma.Decimal(0); // rezerv yok — geriye uyum için 0
      const inProduction =
        inProdBySpec.get(specKey(l.itemId, l.colorId, l.width)) ?? new Prisma.Decimal(0);
      const freeWarehouse = matchFree(l, RollStatus.WAREHOUSE);
      // Ham ↔ yarı mamul AYRI raporlanır (2026-08-27): ikisi de "işlenecek girdi"
      // ama farklı stok türü ve envanterde ayrı sekmelerde duruyor. Toplamları
      // eskisiyle aynı; değişen tek şey rakamın ikiye bölünmesi.
      const freeStock = matchFree(l, RollStatus.STOCK, false);
      const freeSemiFinished = matchFree(l, RollStatus.STOCK, true);
      const requested = new Prisma.Decimal(l.quantity);
      // Net açık = bitmiş/üretimdeki ürün açığı. Rezerv/çuvallanmış (packed) KALKTI —
      // packed hep 0 (yanıt şekli için tutulur). freeWarehouse havuz malını içermez (§4).
      // Ham (freeStock) HARİÇ — işlenmemiş girdi, mamul değil (yalnız bilgi).
      const netGap = requested
        .minus(shipped)
        .minus(packed)
        .minus(freeWarehouse)
        .minus(inProduction);
      return {
        lineId: l.id,
        item: l.item,
        color: l.color,
        width: l.width,
        requested,
        shipped,
        packed,
        inProduction,
        freeWarehouse,
        freeStock,
        freeSemiFinished,
        netGap,
      };
    });

    return { success: true, data };
  }

  /**
   * Spec-bazlı anlık müsaitlik — sipariş GİRİŞ formunda (henüz kaydedilmemiş,
   * lineId'siz satır) "Depoda / Üretimde / Ham" ipucu için. getCoverageForLines
   * ile AYNI kaynakları kullanır ama tek spec (item+renk+en) parametresiyle,
   * satır/sevk muhasebesi olmadan:
   *  - freeWarehouse: item+renk+en birebir eşleşen serbest depo (WAREHOUSE).
   *  - freeStock: renk-joker + en-agnostik serbest ham (STOCK).
   *  - inProduction: canlı WO'ların hedef-spec başına in-flight'ı (computeInProdBySpec).
   * ANLIK FOTOĞRAF — rezervasyon değildir. Değerler DÜRÜST number döner (Decimal
   * JSON'a string sızmasın — getCoverageForLines emsalinin aksine, `.toNumber()`).
   */
  async getSpecAvailability(params: {
    itemId: string;
    colorId?: string | null;
    width?: number | null;
  }): Promise<
    ApiResponse<{
      freeWarehouse: number;
      inProduction: number;
      freeStock: number;
      /** Dışarıdan alınan yarı mamul — `freeStock`tan AYRI raporlanır (2026-08-27). */
      freeSemiFinished: number;
    }>
  > {
    const colorId = params.colorId ?? null;
    const width = params.width == null ? null : new Prisma.Decimal(params.width);

    // Serbest stok — hiçbir çuvala/sevkiyata girmemiş WAREHOUSE + STOCK (fungible havuz).
    const freeGrouped = await prisma.roll.groupBy({
      // `entrySource`: ham ↔ yarı mamul statüden ayrılmaz (ikisi de STOCK).
      by: ["colorId", "width", "status", "entrySource"],
      where: {
        shipmentId: null,
        sackId: null,
        itemId: params.itemId,
        status: { in: [RollStatus.WAREHOUSE, RollStatus.STOCK] },
      },
      _sum: { currentQty: true },
    });

    // En eşleşmesi: Depo birebir; Ham en-agnostik (getCoverageForLines ile aynı kural).
    const widthEqual = (a: Prisma.Decimal | null, b: Prisma.Decimal | null): boolean =>
      a == null || b == null ? a == null && b == null : new Prisma.Decimal(a).equals(b);

    let freeWarehouse = new Prisma.Decimal(0);
    let freeStock = new Prisma.Decimal(0);
    let freeSemiFinished = new Prisma.Decimal(0);
    for (const g of freeGrouped) {
      const qty = g._sum.currentQty ?? new Prisma.Decimal(0);
      if (g.status === RollStatus.WAREHOUSE) {
        // Depo: renk + en BİREBİR.
        if ((g.colorId ?? null) !== colorId) continue;
        if (!widthEqual(g.width, width)) continue;
        freeWarehouse = freeWarehouse.plus(qty);
      } else {
        // Ham: renksiz joker (renkli talebe de sayılır), en-agnostik.
        const colorOk = g.colorId == null || colorId == null || g.colorId === colorId;
        if (!colorOk) continue;
        // Ham ↔ yarı mamul AYRI kovada; toplamları eskisiyle aynı, değişen yalnız
        // rakamın ikiye bölünmesi (ikisi de gerçek arz — hiçbiri düşülmüyor).
        if (g.entrySource === RollEntrySource.SEMI_FINISHED) {
          freeSemiFinished = freeSemiFinished.plus(qty);
        } else {
          freeStock = freeStock.plus(qty);
        }
      }
    }

    // Üretimde — hazır spec-havuz hesabı; anahtar computeInProdBySpec ile aynı format.
    const inProdBySpec = await this.computeInProdBySpec(params.itemId);
    const key = `${params.itemId}|${colorId ?? ""}|${width == null ? "" : width.toString()}`;
    const inProduction = inProdBySpec.get(key) ?? new Prisma.Decimal(0);

    return {
      success: true,
      data: {
        freeWarehouse: freeWarehouse.toNumber(),
        inProduction: inProduction.toNumber(),
        freeStock: freeStock.toNumber(),
        freeSemiFinished: freeSemiFinished.toNumber(),
      },
    };
  }

  /**
   * Sipariş detayında "hangi sevkiyatlarla sevk edildi" drill-down'ı. İKİ kaynağı
   * birleştirir — `shippedQty` de bu ikisinin toplamıdır (order-status.helper
   * computeLineLedgerTx), o yüzden `dispatchedTotal` `order.shippedQty` ile MUTABIK olmalı:
   *   - Çuval sevki (SHIPMENT): SackAllocation → sack → shipment (CANCELLED hariç;
   *     DISPATCHED sevk edilen, PLANNED bekleyen).
   *   - Fason direkt sevk (DIRECT): SubcontractorDirectShipAllocation → directShipment
   *     (terminal — hep sevk edilmiş sayılır). Legacy directShipmentId=null → tek toplu satır.
   * Bilgilendirici snapshot (sevk muhasebesini değiştirmez).
   */
  /** Detay: MT-dışı aktif satır varsa `warnings` ile "karşılama ölçülmüyor". */
  async findById(id: string): Promise<ApiResponse<unknown>> {
    return this.withUnitWarnings(await super.findById(id));
  }

  async getOrderShipments(orderId: string): Promise<ApiResponse<OrderShipmentsResult>> {
    // ── Kaynak A: çuval sevkiyatı ──
    const sackAllocs = await prisma.sackAllocation.findMany({
      where: {
        orderLine: { orderId },
        sack: { shipment: { status: { not: ShipmentStatus.CANCELLED } } },
        ...ACTIVE_SACK_ALLOCATION,
      },
      select: {
        qty: true,
        sackId: true,
        sack: {
          select: {
            shipment: {
              select: {
                id: true,
                shipmentNo: true,
                status: true,
                dispatchedAt: true,
                branch: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    const byShipment = new Map<string, ShipmentAgg>();
    for (const a of sackAllocs) {
      const s = a.sack.shipment;
      if (!s) continue;
      let agg = byShipment.get(s.id);
      if (!agg) {
        agg = {
          shipmentId: s.id,
          shipmentNo: s.shipmentNo,
          status: s.status,
          kind: "SHIPMENT",
          date: s.dispatchedAt,
          qty: new Prisma.Decimal(0),
          sacks: new Set<string>(),
          branchName: s.branch?.name ?? null,
        };
        byShipment.set(s.id, agg);
      }
      agg.qty = agg.qty.plus(a.qty);
      agg.sacks.add(a.sackId);
    }

    // ── Kaynak B: fason direkt sevk ──
    const directAllocs = await prisma.subcontractorDirectShipAllocation.findMany({
      where: { orderLine: { orderId } },
      select: {
        qty: true,
        directShipmentId: true,
        directShipment: {
          select: {
            id: true,
            shipmentNo: true,
            shippedAt: true,
            branch: { select: { name: true } },
          },
        },
      },
    });

    const byDirect = new Map<string, ShipmentAgg>();
    let legacyDirectQty = new Prisma.Decimal(0);
    for (const a of directAllocs) {
      const d = a.directShipment;
      if (!d || !a.directShipmentId) {
        legacyDirectQty = legacyDirectQty.plus(a.qty);
        continue;
      }
      let agg = byDirect.get(d.id);
      if (!agg) {
        agg = {
          shipmentId: d.id,
          shipmentNo: d.shipmentNo,
          status: ShipmentStatus.DISPATCHED, // direkt sevk terminal
          kind: "DIRECT",
          date: d.shippedAt,
          qty: new Prisma.Decimal(0),
          sacks: new Set<string>(),
          branchName: d.branch?.name ?? null,
        };
        byDirect.set(d.id, agg);
      }
      agg.qty = agg.qty.plus(a.qty);
    }

    // ── Totaller (mutabakat: dispatchedTotal = order.shippedQty) ──
    let dispatchedTotal = new Prisma.Decimal(0);
    let plannedTotal = new Prisma.Decimal(0);
    for (const agg of byShipment.values()) {
      if (agg.status === ShipmentStatus.DISPATCHED) dispatchedTotal = dispatchedTotal.plus(agg.qty);
      else if (agg.status === ShipmentStatus.PLANNED) plannedTotal = plannedTotal.plus(agg.qty);
    }
    for (const agg of byDirect.values()) dispatchedTotal = dispatchedTotal.plus(agg.qty);
    dispatchedTotal = dispatchedTotal.plus(legacyDirectQty);

    // ── Satırlar: PLANNED üstte (bekliyor), sonra tarih desc ──
    const rows = [...byShipment.values(), ...byDirect.values()].map((a) => ({
      shipmentId: a.shipmentId,
      shipmentNo: a.shipmentNo,
      status: a.status,
      kind: a.kind,
      date: a.date ? a.date.toISOString() : null,
      qty: a.qty.toNumber(),
      sackCount: a.sacks.size,
      branchName: a.branchName,
    }));
    if (legacyDirectQty.greaterThan(0)) {
      rows.push({
        shipmentId: "",
        shipmentNo: "Fason direkt sevk (eski)",
        status: ShipmentStatus.DISPATCHED,
        kind: "DIRECT",
        date: null,
        qty: legacyDirectQty.toNumber(),
        sackCount: 0,
        branchName: null,
      });
    }
    rows.sort((a, b) => {
      const ap = a.status === ShipmentStatus.PLANNED ? 0 : 1;
      const bp = b.status === ShipmentStatus.PLANNED ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const ad = a.date ? Date.parse(a.date) : 0;
      const bd = b.date ? Date.parse(b.date) : 0;
      return bd - ad;
    });

    return {
      success: true,
      data: {
        dispatchedTotal: dispatchedTotal.toNumber(),
        plannedTotal: plannedTotal.toNumber(),
        shipments: rows,
      },
    };
  }

  async create(
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    // F154: satırsız sipariş = ölü kayıt (coverage/MRP işleyemez, wo-picker düşürür).
    if (!Array.isArray(data.lines) || data.lines.length === 0) {
      throw AppError.badRequest("Sipariş en az bir kalem içermeli.");
    }
    this.validateLines(data.lines);
    const unitByItem = await this.validateLineItems(data.lines);

    if (data.customerId) {
      await this.validateCustomer(data.customerId as string);
    }

    if (data.branchId && data.customerId) {
      await this.validateBranch(
        data.branchId as string,
        data.customerId as string
      );
    }

    await this.validateLineColors(
      data.lines,
      data.customerId as string | null | undefined,
    );

    // F148: para birimi kataloğa karşı doğrula (create/update simetrik).
    this.assertValidCurrency(data.currency);

    // totalAmount: gönderilmediyse lines'tan otomatik hesapla. Gönderilmiş ise
    // (planlamacı override etmiş — KDV/indirim gibi) olduğu gibi bırak.
    if (
      data.totalAmount == null &&
      Array.isArray(data.lines) &&
      data.lines.length > 0
    ) {
      const computed = computeTotalAmount(
        data.lines as Array<{ quantity?: number; unitPrice?: number | null | string }>
      );
      if (computed !== null) data.totalAmount = computed;
    }

    // Termin (deadline) default: sipariş tarihinden N gün sonra. N tanımlardan
    // (`order.defaultDeadlineDays`) okunur; yoksa 7. orderDate verilmediyse
    // şema default'u (now()) baz alınır.
    if (data.deadline == null) {
      const baseDate = data.orderDate
        ? new Date(data.orderDate as string)
        : new Date();
      const days = await readOrderDefaultDeadlineDays();
      const deadline = new Date(baseDate);
      deadline.setDate(deadline.getDate() + days);
      data.deadline = deadline;
    } else {
      // F148: İş kuralı deadline >= orderDate (helper — update ile simetrik).
      this.assertDeadlineNotBeforeOrderDate(data.deadline, data.orderDate);
    }

    // Sipariş no: SIP + GGAAYY + NNNN (örn SIP1207260001) — tek tip kod kalıbı.
    const today = new Date();
    const fmt = resolveSeriesFormat("order");
    const prefix = seriesPrefix(fmt, today);

    // HEADER + SATIR WHITELIST (M-3): orderNumber/status/shippedQty gibi
    // muhasebe alanları istemciden yazılamaz; bilinmeyen anahtarlar atılır.
    const prismaData: Record<string, unknown> = {
      // Sipariş oluşturulur oluşturulmaz üretime/sevke açık olsun;
      // ayrı bir "onay" adımı kullanılmıyor.
      status: OrderStatus.APPROVED,
    };
    for (const key of Object.keys(data)) {
      if (ORDER_HEADER_WRITABLE.has(key)) prismaData[key] = data[key];
    }
    // SİPARİŞ YÖNÜ DOĞUŞTA DONAR (sevkiyatın donmuş yönüyle aynı zincir): şube → cari; zincir boşsa
    // NULL ("yön belirsiz"). Kart sonradan değişse de sipariş değişmez; gövdeden yazılamaz (whitelist dışı).
    prismaData.destination = data.customerId
      ? (await resolveShipmentDestination(prisma, {
          customerId: data.customerId as string,
          branchId: (data.branchId as string | null | undefined) ?? null,
        })).destination
      : null;

    // Lines: whitelist + requiredPropertyIds → { create: [...] } formatı.
    if (Array.isArray(data.lines)) {
      prismaData.lines = (data.lines as Record<string, unknown>[]).map((rawLine) => {
        const line: Record<string, unknown> = {};
        for (const key of Object.keys(rawLine)) {
          if (ORDER_LINE_WRITABLE.has(key)) line[key] = rawLine[key];
        }
        line.unit = this.resolveLineUnit(rawLine, unitByItem);
        const ids = Array.isArray(rawLine.requiredPropertyIds)
          ? [...new Set((rawLine.requiredPropertyIds as string[]).filter(Boolean))]
          : [];
        if (ids.length > 0) {
          line.requiredProperties = {
            create: ids.map((propertyId) => ({ propertyId })),
          };
        }
        return line;
      });
    }

    if (this.config.nestedCreateFields) {
      for (const field of this.config.nestedCreateFields) {
        if (Array.isArray(prismaData[field])) {
          prismaData[field] = { create: prismaData[field] };
        }
      }
    }

    // İdempotency anahtarı (Roll emsali) — form-oturumu başına istemci üretir;
    // timeout sonrası tekrar gönderim aynı token'la gelir → aşağıdaki catch
    // mevcut siparişi cached döner. Route-level zod olmadığından (BaseController
    // ham body) burada doğrulanır; whitelist'ten BİLEREK ayrı işlenir
    // (manualOrderNumber gibi kontrollü kabul).
    const clientToken =
      typeof data.clientToken === "string" && data.clientToken.trim()
        ? data.clientToken.trim()
        : null;
    if (clientToken && !isUuidString(clientToken)) {
      throw AppError.badRequest("Geçersiz istemci anahtarı");
    }
    if (clientToken) prismaData.clientToken = clientToken;

    // Saha #16: kullanıcı sipariş numarasını ELLE verebilir (override) —
    // whitelist'ten BİLEREK ayrı işlenir (mass-assignment koruması korunur;
    // yalnız bu alan kontrollü kabul edilir). Boş/verilmemiş → otomatik üretim.
    const manualOrderNumber =
      typeof data.orderNumber === "string" && data.orderNumber.trim()
        ? data.orderNumber.trim()
        : null;
    assertManualNumberAllowed("order", manualOrderNumber);
    if (manualOrderNumber) {
      if (manualOrderNumber.length > 40) {
        throw AppError.badRequest("Sipariş numarası en fazla 40 karakter olabilir");
      }
      const clash = await prisma.order.findUnique({
        where: { orderNumber: manualOrderNumber },
        select: { id: true },
      });
      if (clash) {
        throw AppError.conflict(`'${manualOrderNumber}' numaralı sipariş zaten var`);
      }
    }

    // orderNumber üretimi + create RETRY KAPSAMINDA (M-25): eşzamanlı iki POST
    // aynı seq'i hesaplarsa kaybeden P2002 sonrası taze max ile yeniden dener
    // (eskiden kullanıcıya 409 dönüyordu — koddaki eski yorum yarışı kabul
    // ediyordu). startsWith yerine range: en_US.UTF-8 collation'da LIKE-prefix
    // unique btree'yi KULLANAMAZ (her create'te seq scan — EXPLAIN ile
    // doğrulandı); gte/lt range her collation'da index seek yapar.
    // Manuel numarada retry'a gerek yok ama P2002 yarışına (aynı anda aynı
    // manuel no) karşı yine sarılır — ikinci deneme clash kontrolünde 409'a düşer.
    const record = (await withBarcodeRetry(async () => {
      if (manualOrderNumber) {
        const stillFree = await prisma.order.findUnique({
          where: { orderNumber: manualOrderNumber },
          select: { id: true },
        });
        if (stillFree) {
          throw AppError.conflict(`'${manualOrderNumber}' numaralı sipariş zaten var`);
        }
        return this.delegate.create({
          data: { ...prismaData, orderNumber: manualOrderNumber },
          ...(this.config.defaultInclude
            ? { include: this.config.defaultInclude }
            : {}),
        });
      }
      // collation-güvenli: eski `lt: prefix+"￿"` üst sınırı glibc'de (U+FFFF
      // ignorable) bugünün satırlarını dışlar → numara hep 1'den başlar → P2002.
      // `gte` (index seek, bugün+sonrası) + `startsWith` (LIKE, collation-bağımsız
      // tam-prefix; prefix'ten yüksek sıralanan manuel orderNumber'ları eler).
      // ⚠️ C0 KAPSAMI (E2 üretim dilimi): sayaç yalnız BU BİÇİM yürürlüğe girdikten
      // sonra doğan kodlara bakar; `nextSeriesNo` kapsamı, numeric-tail max'ı ve
      // çakışma atlamasını tek yerde tutar. Biçim BİR KEZ okunmuş `fmt` olarak
      // geçirilir ("iki okuma" sınıfı).
      const orderNumber = await nextSeriesNo(
        "order",
        async (fullPrefix) =>
          prisma.order
            .findMany({
              where: { orderNumber: { gte: fullPrefix, startsWith: fullPrefix } },
              select: { orderNumber: true, createdAt: true },
            })
            .then((rows) => rows.map((r) => ({ code: r.orderNumber, createdAt: r.createdAt }))),
        today,
        fmt,
      );
      return this.delegate.create({
        data: { ...prismaData, orderNumber },
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude }
          : {}),
      });
    }, undefined, (err) =>
      // İdempotent replay: clientToken P2002'si retry EDİLMEZ (retry hep aynı
      // token'ı yazar) — aşağıdaki catch cached yanıta çevirir. Diğer P2002'ler
      // (orderNumber seq yarışı) mevcut M-25 davranışıyla taze max ile retry.
      !isClientTokenP2002(err),
    ).catch(async (err) => ({
      __replayOf: await this.resolveCreateTokenReplay(err, clientToken, data),
    }))) as Record<string, unknown>;

    if (record.__replayOf) {
      const existing = record.__replayOf as Record<string, unknown>;
      // Audit + alias terfisi yalnız gerçek create yolunda (ilk çağrıda yazıldı).
      return this.withUnitWarnings({
        success: true,
        data: existing,
        message: `Sipariş zaten oluşturulmuş (idempotent retry): ${existing.orderNumber}`,
      });
    }
    const orderNumber = record.orderNumber as string;

    await AuditService.log({
      userId,
      action: "CREATE",
      tableName: this.config.tableName,
      recordId: record.id as string,
      newData: { ...data, orderNumber },
    });

    // Müşteriye-özel ad terfisi: girilen customerItemName/customerColorName,
    // master alias yoksa kalıcı kaydedilir (sonraki siparişte otomatik gelir).
    await this.promoteCustomerAliases(
      data.customerId as string | undefined,
      Array.isArray(data.lines)
        ? (data.lines as Array<Record<string, unknown>>)
        : null,
      userId
    );

    return this.withUnitWarnings({ success: true, data: record, message: "Sipariş oluşturuldu" });
  }

  /**
   * create() clientToken P2002 ile düştüyse idempotent replay çözümlemesi (Roll
   * emsali): aynı token'lı mevcut siparişi bulur; payload kimliği (customerId +
   * branchId + satır sayısı) uyuşuyorsa onu döner (çağıran cached yanıt üretir).
   * Uyuşmuyorsa 409 CLIENT_TOKEN_COLLISION — token yenilenseydi sessizce ikinci
   * sipariş açılırdı; 409 kullanıcıya ilk gönderimin kaydedildiğini ifşa eder.
   * Token replay'i değilse orijinal hata aynen fırlar.
   */
  private async resolveCreateTokenReplay(
    err: unknown,
    clientToken: string | null,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!clientToken || !isClientTokenP2002(err)) throw err;
    const existing = (await prisma.order.findUnique({
      where: { clientToken },
      ...(this.config.defaultInclude
        ? { include: this.config.defaultInclude as Prisma.OrderInclude }
        : {}),
    })) as Record<string, unknown> | null;
    if (!existing) throw err;
    // ⚠️ ÖNCE 4. DURUM (T1-006): sipariş yazıldı ama SONRADAN İPTAL EDİLDİ mi?
    // Özdeşlik kontrolünden ÖNCE — aksi hâlde iptal edilmiş sipariş "başarılı"
    // diye dönerdi ve müşteriye söz verilen metraj sipariş listesinde HİÇ
    // görünmezdi (hata da görünmediği için kimse aramaz).
    assertOrderReplayAlive({
      id: String(existing.id),
      status: existing.status as OrderStatus,
      orderNumber: (existing.orderNumber as string | null) ?? null,
    });
    // Hafif payload-özdeşlik (F117 emsali): kimlik-kilit alanları uyuşmalı.
    // Derin satır karşılaştırması bilinçli yapılmıyor (Decimal/alias-terfisi
    // kırılgan) — müşteri + şube + satır sayısı "farklı form oturumu"nu yakalar.
    const existingLines = existing.lines;
    const incomingLineCount = Array.isArray(data.lines) ? data.lines.length : 0;
    const same =
      existing.customerId === data.customerId &&
      (existing.branchId ?? null) === ((data.branchId as string | null | undefined) ?? null) &&
      Array.isArray(existingLines) &&
      existingLines.length === incomingLineCount;
    if (same) return existing;
    throw AppError.conflict(
      `Bu form daha önce kaydedilmiş: ${existing.orderNumber}. Yeni sipariş için formu kapatıp yeniden açın.`,
      {
        code: "CLIENT_TOKEN_COLLISION",
        orderNumber: existing.orderNumber,
        existing: {
          id: existing.id,
          customerId: existing.customerId,
          branchId: existing.branchId ?? null,
          lineCount: Array.isArray(existingLines) ? existingLines.length : null,
        },
        incoming: {
          customerId: data.customerId ?? null,
          branchId: (data.branchId as string | null | undefined) ?? null,
          lineCount: incomingLineCount,
        },
      },
    );
  }

  /**
   * Saha #11: ham/stok toplardan HIZLI SİPARİŞ. Operatör 70 topu tek tek satıra
   * girmek yerine okutur → müşteri seçer → sistem topları spec (ürün+renk+en)
   * bazında gruplayıp sipariş satırlarına çevirir, siparişi APPROVED açar ve
   * STOK topları WAREHOUSE'a (sevke hazır) alır.
   *
   * GEVŞEK MODEL KORUNUR: toplar siparişe BAĞLANMAZ — satırlar yalnız spec-toplam
   * talebi temsil eder; karşılanma yine spec-toplam üzerinden işler (sevkte). Top
   * okutmak burada yalnız "ne kadar/ne tür satır açılacağını" türetmek içindir.
   */
  async quickOrderFromRolls(
    data: { customerId: string; branchId?: string | null; rollIds: string[]; clientToken?: string | null },
    userId?: string,
  ): Promise<ApiResponse<unknown>> {
    const rollIds = [...new Set(data.rollIds)];
    if (rollIds.length === 0) throw AppError.badRequest("En az bir top okutulmalı");

    const rolls = await prisma.roll.findMany({
      where: { id: { in: rollIds } },
      select: {
        id: true,
        barcode: true,
        itemId: true,
        colorId: true,
        width: true,
        currentQty: true,
        status: true,
        shipmentId: true,
        sackId: true,
        currentStepId: true,
      },
    });
    if (rolls.length !== rollIds.length) throw AppError.notFound("Bazı toplar bulunamadı");

    // Her top serbest + satılabilir statüde olmalı (STOCK ham veya WAREHOUSE, çuvalsız).
    for (const r of rolls) {
      if (r.shipmentId) throw AppError.conflict(`Top bir sevkiyatta: ${r.barcode ?? r.id}`);
      if (r.sackId) throw AppError.conflict(`Top bir çuvalda: ${r.barcode ?? r.id}`);
      if (r.currentStepId) throw AppError.conflict(`Top bir iş emri adımında: ${r.barcode ?? r.id}`);
      if (r.status !== RollStatus.STOCK && r.status !== RollStatus.WAREHOUSE) {
        throw AppError.badRequest(`Top satışa uygun değil (${r.status}): ${r.barcode ?? r.id}`);
      }
    }

    // Spec (ürün+renk+en) bazında grupla → satır metrajı = grup currentQty toplamı.
    const groups = new Map<
      string,
      { itemId: string; colorId: string | null; width: number | null; quantity: Prisma.Decimal }
    >();
    for (const r of rolls) {
      const key = `${r.itemId}|${r.colorId ?? ""}|${r.width == null ? "" : Number(r.width)}`;
      const g =
        groups.get(key) ??
        { itemId: r.itemId, colorId: r.colorId, width: r.width != null ? Number(r.width) : null, quantity: new Prisma.Decimal(0) };
      g.quantity = g.quantity.plus(r.currentQty);
      groups.set(key, g);
    }
    const lines = [...groups.values()].map((g) => ({
      itemId: g.itemId,
      colorId: g.colorId,
      width: g.width,
      quantity: Number(g.quantity),
    }));

    // F143: CLAIM-FIRST. Eskiden sipariş create edilip SONRA topları claim ediyordu;
    // claim.count HİÇ kontrol edilmiyordu → topların bir kısmı arada başka akışta
    // tüketilse bile sipariş açılıyor ve preparedToWarehouse yalan söylüyordu.
    // Artık: create-fail-after-claim'i önlemek için create()'in fırlatabileceği TÜM
    // doğrulamaları (müşteri/şube + ürün/renk-atanabilirlik) claim'den ÖNCE koştur;
    // sonra topları atomik claim et. Aksi halde create() içindeki validateLineColors/
    // validateLineItems fırlatırsa toplar WAREHOUSE'da yetim kalırdı (rollback yok).
    await this.validateCustomer(data.customerId);
    if (data.branchId) await this.validateBranch(data.branchId, data.customerId);
    await this.validateLineItems(lines);
    await this.validateLineColors(lines, data.customerId);

    const stockRollIds = rolls.filter((r) => r.status === RollStatus.STOCK).map((r) => r.id);
    if (stockRollIds.length > 0) {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.roll.updateMany({
          where: { id: { in: stockRollIds }, status: RollStatus.STOCK, shipmentId: null, currentStepId: null },
          data: { status: RollStatus.WAREHOUSE },
        });
        // Depoya GİRİŞ yazan her yolun ortak damgası (bkz. `warehouseStampManyTx`).
        await warehouseStampManyTx(tx, stockRollIds);
        if (claimed.count !== stockRollIds.length) {
          const escaped = await tx.roll.findMany({
            where: {
              id: { in: stockRollIds },
              NOT: { status: RollStatus.WAREHOUSE, shipmentId: null, currentStepId: null },
            },
            select: { id: true, barcode: true },
          });
          const list = escaped.map((r) => r.barcode ?? r.id).join(", ");
          throw AppError.conflict(
            `Şu toplar işlem sırasında başka bir akışta tüketildi; hızlı sipariş açılmadı, lütfen tekrar okutup deneyin: ${list}`,
          );
        }
      });
    }

    // Sipariş aç (claim garanti; satırlar gerçek metrajı temsil eder).
    // clientToken create'e akar: timeout-replay'de toplar zaten WAREHOUSE olduğundan
    // claim bloğu atlanır ve TEK koruma bu token'dır (create cached siparişi döner) —
    // token'sız replay birebir aynı satırlı İKİNCİ siparişi açardı.
    const created = await this.create(
      { customerId: data.customerId, branchId: data.branchId ?? null, lines, clientToken: data.clientToken ?? null },
      userId,
    );
    const order = created.data as { id: string; orderNumber: string };

    // Roll hareketini denetle (best-effort, tx DIŞI).
    if (stockRollIds.length > 0) {
      await AuditService.log({
        userId,
        action: "UPDATE",
        tableName: "ROLL",
        // F153: tableName=ROLL ise recordId bir ROLL olmalı (order.id değil) — audit
        // tutarlılığı; sipariş bağı newData.orderNumber/rollIds ile korunur.
        recordId: stockRollIds[0],
        newData: { kind: "QUICK_ORDER_RAW_TO_WAREHOUSE", rollIds: stockRollIds, orderNumber: order.orderNumber },
      });
    }

    return {
      success: true,
      data: { order, lineCount: lines.length, rollCount: rolls.length, preparedToWarehouse: stockRollIds.length },
      message: `Hızlı sipariş açıldı: ${order.orderNumber} (${lines.length} satır, ${rolls.length} top)`,
    };
  }

  /**
   * Update override — status-gated header + lines editi.
   *
   * Kurallar:
   * - COMPLETED / CANCELLED → değiştirilemez (409).
   * - PARTIAL_SHIPPED → sadece `deadline` güncellenir; lines forbidden.
   * - APPROVED / PENDING → header alanları açık. Aktif WO (IN_PROGRESS/
   *   COMPLETED) bağlıysa customerId/branchId değiştirilemez.
   * - Lines: CANCELLED dışı herhangi bir WO bağı yoksa düzenlenebilir.
   *   Diff stratejisi: id eşleşene update, eşleşmeyene create, mevcut'ta var
   *   incoming'de yok ise delete. customerItemName/customerColorName + property
   *   referansları id korunduğu için bozulmaz.
   */
  async update(
    id: string,
    data: Record<string, unknown>,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    const current = await prisma.order.findUnique({
      where: { id },
      select: {
        customerId: true,
        branchId: true,
        status: true,
        orderDate: true, // F148: termin-tarih kuralı için mevcut referans
        deadline: true,
        lines: {
          select: {
            id: true,
            itemId: true,
            // ⚠️ LOAD-BEARING: aşağıdaki `cancelledAt !== null` süzgeci bu alan
            // seçilmezse `undefined !== null` ile TÜM kalemleri iptal sayar ve
            // hiçbir kalem güncellenemez olurdu (sessiz felç).
            cancelledAt: true,
            requiredProperties: { select: { propertyId: true } },
            workOrderLinks: {
              where: ACTIVE_ORDER_LINK,
              select: {
                workOrder: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!current) throw AppError.notFound("Sipariş bulunamadı");

    if (
      current.status === OrderStatus.COMPLETED ||
      current.status === OrderStatus.CANCELLED
    ) {
      throw AppError.conflict(
        "Tamamlanmış veya iptal edilmiş sipariş düzenlenemez"
      );
    }

    const incomingLines = Array.isArray(data.lines)
      ? (data.lines as Array<Record<string, unknown>>)
      : null;

    const cleanData: Record<string, unknown> = { ...data };
    delete cleanData.lines;

    // HEADER WHITELIST (mass-assignment guard'ı — M-3): status / shippedQty /
    // completedAt / manualClosedById / orderNumber gibi muhasebe+kimlik alanları
    // istemci gövdesinden YAZILAMAZ. PATCH {"status":"CANCELLED"} cancel
    // kaskadını (WO-unbind matrisi), {"status":"COMPLETED"} manuel kapatma
    // gerekçesini atlardı; shippedQty "tek yazma noktası: sevkiyat akışı +
    // recomputeOrderStatusTx" invariant'ını (şema notu) bozardı. Statü/kapatma
    // için özel endpoint'ler var (cancel, manual-close).
    for (const key of Object.keys(cleanData)) {
      if (!ORDER_HEADER_WRITABLE.has(key)) delete cleanData[key];
    }

    // F148: create ile simetrik doğrulama (update'te eksikti). PARTIAL_SHIPPED'ten
    // ÖNCE çalışır → deadline-only PATCH'te de termin kuralı uygulanır (currency
    // PARTIAL_SHIPPED'te zaten whitelist'ten düşer).
    if (Object.prototype.hasOwnProperty.call(cleanData, "currency")) {
      this.assertValidCurrency(cleanData.currency);
    }
    const deadlineChanging = Object.prototype.hasOwnProperty.call(cleanData, "deadline");
    const orderDateChanging = Object.prototype.hasOwnProperty.call(cleanData, "orderDate");
    if (deadlineChanging || orderDateChanging) {
      const effDeadline = deadlineChanging ? cleanData.deadline : current.deadline;
      const effOrderDate = orderDateChanging ? cleanData.orderDate : current.orderDate;
      this.assertDeadlineNotBeforeOrderDate(effDeadline, effOrderDate);
    }

    // PARTIAL_SHIPPED: sadece deadline. Lines kabul edilmez, diğer header
    // alanları sessizce yutulur (eski davranış korunur).
    if (current.status === OrderStatus.PARTIAL_SHIPPED) {
      if (incomingLines) {
        throw AppError.conflict(
          "Kısmi sevk edilmiş siparişin kalemleri değiştirilemez"
        );
      }
      const allowed = new Set(["deadline"]);
      for (const key of Object.keys(cleanData)) {
        if (!allowed.has(key)) delete cleanData[key];
      }
      if (Object.keys(cleanData).length === 0) {
        // F156: no-op'ta da normal update ile aynı (defaultInclude'lu) tam şekli dön.
        const full = await this.findById(id);
        return { ...full, message: "Değişiklik yok" };
      }
      return super.update(id, cleanData, userId);
    }

    const branchChanging = Object.prototype.hasOwnProperty.call(cleanData, "branchId");
    const customerChanging = Object.prototype.hasOwnProperty.call(cleanData, "customerId");
    // Sipariş AÇIKÇA başka cariye/şubeye taşınırsa yön yeniden çözülür (o cariye açılmadı; eski değer audit'te).
    let retarget: { customerId: string; branchId: string | null } | null = null;

    if (branchChanging || customerChanging) {
      const blockingStatuses = new Set(["IN_PROGRESS", "COMPLETED"]);
      const hasBlockingWO = current.lines.some((line) =>
        line.workOrderLinks.some((link) =>
          blockingStatuses.has(link.workOrder.status)
        )
      );
      if (hasBlockingWO) {
        throw AppError.conflict(
          "Aktif iş emrine bağlı sipariş; müşteri veya şube değiştirilemez"
        );
      }

      const finalBranchId = branchChanging
        ? (cleanData.branchId as string | null)
        : current.branchId;
      const finalCustomerId = customerChanging
        ? (cleanData.customerId as string)
        : current.customerId;

      // M-22: müşteri değişiminde yeni müşteri varlık+isActive doğrulanır
      // (create() ile simetrik — pasif müşteriye sipariş taşınamaz).
      if (customerChanging) {
        await this.validateCustomer(finalCustomerId);

        // Lines payload'ı yoksa MEVCUT satır renkleri yeni müşteriye karşı
        // yeniden doğrulanır — eski müşteriye exclusive atanmış renk, sipariş
        // taşınınca satırda kalamaz (renk exclusivity backend-ENFORCE garantisi).
        if (!incomingLines) {
          const existingColorIds = [
            ...new Set(
              (
                await prisma.orderLine.findMany({
                  where: { orderId: id, colorId: { not: null } },
                  select: { colorId: true },
                })
              ).map((l) => l.colorId as string),
            ),
          ];
          if (existingColorIds.length > 0) {
            await assertColorsAssignableToCustomer(existingColorIds, finalCustomerId);
          }
        }
      }

      if (finalBranchId) {
        await this.validateBranch(finalBranchId, finalCustomerId);
      }
      retarget = { customerId: finalCustomerId, branchId: finalBranchId ?? null };
    }

    // Lines payload geldiyse: WO bağı kontrolü + diff uygula.
    let unitByItem: Map<string, ItemUnit> = new Map();
    if (incomingLines) {
      // CANCELLED WO bağları sayılmaz (iptal edilmiş, kalem serbest).
      const hasActiveWoLink = current.lines.some((line) =>
        line.workOrderLinks.some((link) => link.workOrder.status !== "CANCELLED")
      );
      if (hasActiveWoLink) {
        throw AppError.conflict(
          "İş emri açılmış siparişin kalemleri değiştirilemez. Önce iş emrini iptal edin."
        );
      }
      this.validateLines(incomingLines);
      unitByItem = await this.validateLineItems(incomingLines);

      const effectiveCustomerId = customerChanging
        ? (cleanData.customerId as string | null)
        : current.customerId;
      await this.validateLineColors(incomingLines, effectiveCustomerId);

      // totalAmount auto-recompute (cleanData'da explicit yoksa)
      if (cleanData.totalAmount === undefined) {
        cleanData.totalAmount = computeTotalAmount(
          incomingLines as Array<{ quantity?: number; unitPrice?: number | null | string }>
        );
      }
    }

    // Tek transaction: lines diff + header update + final fetch.
    const updated = await prisma.$transaction(async (tx) => {
      if (incomingLines) {
        // F144: WO-bağı guard'ını tx İÇİNDE TAZE re-check et — pre-tx (1362) okuma
        // ile deleteMany arasında eşzamanlı WO create (orderLinks INSERT) araya
        // girip CASCADE ile linki sessizce silebilir; statement commit'li linkleri görür.
        const activeLink = await tx.workOrderToOrderLine.findFirst({
          where: {
            ...ACTIVE_ORDER_LINK,
            orderLine: { orderId: id },
            workOrder: { status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } },
          },
          select: { workOrderId: true },
        });
        if (activeLink) {
          throw AppError.conflict(
            "İş emri açılmış siparişin kalemleri değiştirilemez. Önce iş emrini iptal edin.",
          );
        }
        // ── İPTAL EDİLMİŞ KALEM DOKUNULMAZ (2026-08-27) ──────────────────
        // İki ayrı tehlike var ve ikisi de SESSİZ:
        //   ① payload'da yoksa diff onu SİLER → iptal olgusu ve sevk edilmiş
        //      metrajı kayıtlardan kaybolur (sevkiyat mutabakatı bozulur),
        //   ② payload'da varsa metrajı/rengi DEĞİŞTİRİLEBİLİR → kapanmış bir
        //      kararın geçmişi sonradan yeniden yazılır.
        // İkisini de sunucuda kapatıyoruz; istemci disiplinine bırakılmaz.
        const cancelledLineIds = new Set(
          // Gevşek `!= null` (order-status.helper ile aynı gerekçe): alan
          // seçilmezse KATI karşılaştırma tüm kalemleri iptal sayar ve hiçbir
          // kalem güncellenemez olurdu.
          current.lines.filter((l) => l.cancelledAt != null).map((l) => l.id),
        );
        const existingById = new Map(current.lines.map((l) => [l.id, l]));
        const incomingIds = new Set(
          incomingLines
            .filter((l) => typeof l.id === "string" && (l.id as string).length > 0)
            .map((l) => l.id as string)
        );

        // Delete: existing - incoming. Cascade ile requiredProperties otomatik siler.
        // İPTAL EDİLMİŞ kalemler silme kümesinden ÇIKARILIR (payload'da olmasalar
        // da korunurlar) — form onları göstermese bile satır yaşamaya devam eder.
        const toDelete = [...existingById.keys()].filter(
          (eid) => !incomingIds.has(eid) && !cancelledLineIds.has(eid),
        );
        if (toDelete.length > 0) {
          // O-6: silinecek satırları FOR UPDATE ile kilitle — in-flight WO orderLine
          // INSERT'i (FK → FOR KEY SHARE) yalnız FOR UPDATE bloklar (FOR NO KEY UPDATE
          // yetmez). Sonra toDelete-scope taze link kontrolü: araya giren INSERT ya
          // guard'da yakalanır (409) ya da silme sonrası FK ihlaliyle düşer.
          await tx.$queryRaw`SELECT id FROM order_lines WHERE id = ANY(${toDelete}::uuid[]) FOR UPDATE`;
          // ⚠️ KAPSAM İPTAL EDİLMİŞ İŞ EMİRLERİNİ DE İÇERİR (2026-08-29 / K5).
          // Eskiden yalnız CANLI iş emirleri sayılıyordu; iptal edilmiş bir iş
          // emrine bağlı kalem silinebiliyor ve bağ satırı `onDelete: Cascade`
          // ile SESSİZCE düşüyordu → "bu iş emri hangi sipariş için açıldı"
          // olgusu hiçbir iz bırakmadan kayboluyordu (BULGU-T1-100; sahada 3
          // satır bu durumdaydı). Artık bağ DB seddiyle de korunuyor
          // (`work_order_to_order_lines_orderLineId_fkey` → RESTRICT), yani bu
          // kontrol kalkarsa kullanıcı ham FK hatası görürdü — mesajı veren yer
          // burası, koruma ise DB'de.
          const linkedToDeleted = await tx.workOrderToOrderLine.findFirst({
            where: { orderLineId: { in: toDelete }, ...ACTIVE_ORDER_LINK },
            select: { workOrderId: true, workOrder: { select: { status: true, workOrderNumber: true } } },
          });
          if (linkedToDeleted) {
            const wo = linkedToDeleted.workOrder;
            const iptalli =
              wo.status === WorkOrderStatus.CANCELLED || wo.status === WorkOrderStatus.SUPERSEDED;
            throw AppError.conflict(
              iptalli
                ? `Bu kalem için ${wo.workOrderNumber} iş emri açılmış — iş emri iptal edilse de kayıt duruyor ve silinemez. ` +
                  "Kalemi silmek yerine İPTAL edin; sevk edilmiş metraj ve geçmiş korunur."
                : "İş emri açılmış siparişin kalemleri değiştirilemez. Önce iş emrini iptal edin.",
            );
          }
          await tx.orderLine.deleteMany({ where: { id: { in: toDelete } } });
        }

        for (const raw of incomingLines) {
          const propertyIds: string[] = Array.isArray(raw.requiredPropertyIds)
            ? [...new Set((raw.requiredPropertyIds as string[]).filter(Boolean))]
            : [];

          // SATIR WHITELIST (M-3): shippedQty (sevk defteri — forge edilirse
          // recompute header'a TERFİ ettirir) ve orderId (satırı başka siparişe
          // taşıma) dahil bilinmeyen her anahtar atılır; yalnız gerçek
          // düzenlenebilir kalem alanları geçer.
          const lineData: Record<string, unknown> = {};
          for (const key of Object.keys(raw)) {
            if (ORDER_LINE_WRITABLE.has(key)) lineData[key] = raw[key];
          }

          const existingLine =
            typeof raw.id === "string" ? existingById.get(raw.id as string) : undefined;
          // Birim: yeni satırda ve kalem değişiminde kalemden (ya da açık
          // gönderilen değerden); mevcut satırda gönderilmediyse DOKUNULMAZ.
          const unitSent = raw.unit != null && raw.unit !== "";
          const itemChanged =
            existingLine != null && typeof raw.itemId === "string" && raw.itemId !== existingLine.itemId;
          if (!existingLine || unitSent || itemChanged) {
            lineData.unit = this.resolveLineUnit(raw, unitByItem);
          } else {
            delete lineData.unit;
          }

          if (existingLine) {
            const lineId = existingLine.id;
            // İptal edilmiş kalem SALT-OKUNUR: bayat bir formdan gelen değişiklik
            // sessizce yutulur (400 atmak, kullanıcının dokunmadığı bir satır
            // yüzünden tüm kaydı düşürürdü — form kalemleri toptan gönderir).
            if (cancelledLineIds.has(lineId)) continue;
            await tx.orderLine.update({ where: { id: lineId }, data: lineData });

            const currentPropIds = new Set(
              existingLine.requiredProperties.map((p) => p.propertyId)
            );
            const incomingPropIds = new Set(propertyIds);
            const propsToDelete = [...currentPropIds].filter(
              (pid) => !incomingPropIds.has(pid)
            );
            const propsToAdd = [...incomingPropIds].filter(
              (pid) => !currentPropIds.has(pid)
            );

            if (propsToDelete.length > 0) {
              await tx.orderLineRequiredProperty.deleteMany({
                where: { orderLineId: lineId, propertyId: { in: propsToDelete } },
              });
            }
            if (propsToAdd.length > 0) {
              await tx.orderLineRequiredProperty.createMany({
                data: propsToAdd.map((propertyId) => ({ orderLineId: lineId, propertyId })),
                skipDuplicates: true,
              });
            }
          } else {
            await tx.orderLine.create({
              data: {
                ...(lineData as Prisma.OrderLineUncheckedCreateInput),
                orderId: id,
                ...(propertyIds.length > 0
                  ? {
                      requiredProperties: {
                        create: propertyIds.map((propertyId) => ({ propertyId })),
                      },
                    }
                  : {}),
              },
            });
          }
        }
      }

      if (Object.keys(cleanData).length > 0) {
        // A10 (2026-07-31 denetimi): header yazımı tx-içi TAZE durum claim'iyle —
        // pre-tx status okuması (1763) ile commit arasında eşzamanlı cancel/
        // manual-close/kısmi-sevk araya girerse müşteri/şube/termin yazımı
        // terminal veya kısıtlı duruma sızmasın. Beklenen durum pre-tx okunandır;
        // değiştiyse 409 — istemci taze veriyle tekrar dener.
        if (retarget) cleanData.destination = (await resolveShipmentDestination(tx, retarget)).destination;
        const claimed = await tx.order.updateMany({
          where: { id, status: current.status },
          data: cleanData,
        });
        if (claimed.count === 0) {
          throw AppError.conflict(
            "Sipariş durumu bu sırada değişti — sayfayı yenileyip tekrar deneyin.",
          );
        }
      }

      // Satırlar değiştiyse denormalize sevk toplamı + durumu YENİDEN HESAPLA.
      // recomputeOrderStatusTx = Order.shippedQty + status tek yazma noktası (şema notu).
      // Satır ekleme/silme/quantity düzenlemesi sonrası çağrılmazsa Order.shippedQty
      // ve status, satırların gerçeğinden bayatlar (Σline.shippedQty ile drift).
      if (incomingLines) {
        await recomputeOrderStatusTx(tx, id);
      }

      return tx.order.findUnique({
        where: { id },
        ...(this.config.defaultInclude
          ? { include: this.config.defaultInclude as Prisma.OrderInclude }
          : {}),
      });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      newData: {
        ...cleanData,
        ...(incomingLines ? { linesCount: incomingLines.length } : {}),
      },
    });

    // Müşteriye-özel ad terfisi (create ile aynı kural). Müşteri değiştiyse
    // yeni müşteri baz alınır; lines payload gelmediyse atlanır.
    if (incomingLines) {
      const finalCustomerId =
        typeof cleanData.customerId === "string"
          ? cleanData.customerId
          : current.customerId;
      await this.promoteCustomerAliases(finalCustomerId, incomingLines, userId);
    }

    return this.withUnitWarnings({ success: true, data: updated, message: "Sipariş güncellendi" });
  }

  /**
   * Soft-delete (cancel) an order.
   *
   * Business Rules (R1 — sipariş iptal çift yönlü tutarlılık):
   *   - Sipariş hiçbir WO'ya bağlı değilse sorunsuz iptal.
   *   - PLANNED durumdaki WO bağları varsa → join satırlarını otomatik kopar
   *     (WO hayatta kalır, operatör isterse STOCK_PRODUCTION'a çevirir).
   *   - IN_PROGRESS / COMPLETED durumda WO varsa → 409 conflict.
   *     Operatör önce o WO'yu iptal etmeli.
   */
  /**
   * Siparişin bağlı olduğu AKTİF (PLANNED) sevkiyatları döner.
   * İptal/manuel kapatma bu bağ varken bloklanır: aktif sevkiyat dispatch'te
   * bu siparişe tahsis+shippedQty yazacaktı; computeShipmentAllocation iptal/
   * kapalı siparişi tahsis dışı bıraksa da operatör niyeti netleşmeli — önce
   * sipariş sevkiyattan çıkarılmalı ya da sevkiyat tamamlanmalı/iptal edilmeli.
   */
  private async getActiveShipmentLinks(
    orderId: string
  ): Promise<Array<{ id: string; shipmentNo: string; status: ShipmentStatus }>> {
    // ÇUVAL HAVUZU: "aktif" = donmuş tahsisli sevkiyat (PLANNED). Rezerv YOK
    // (packedQty/rebalance kalktı) — açık miktar sevkte düşer; iptal serbest bırakır.
    const links = await prisma.shipmentOrder.findMany({
      where: {
        orderId,
        shipment: {
          status: ShipmentStatus.PLANNED,
        },
      },
      select: {
        shipment: { select: { id: true, shipmentNo: true, status: true } },
      },
    });
    return links.map((l) => l.shipment);
  }

  private assertNoActiveShipments(
    activeShipments: Array<{ shipmentNo: string; status: ShipmentStatus }>,
    eylem: string
  ): void {
    if (activeShipments.length === 0) return;
    const list = activeShipments.map((s) => `${s.shipmentNo} (${s.status})`).join(", ");
    throw AppError.conflict(
      `Sipariş aktif sevkiyat(lar)a bağlı: ${list}. ${eylem} için önce siparişi sevkiyattan çıkarın veya sevkiyatı tamamlayın/iptal edin.`
    );
  }

  /**
   * Fiziksel silme YOK ("asla fiziksel DELETE" kuralı). BaseService.hardDelete
   * guard'sız prisma.delete çalıştırır ve Order→OrderLine→WorkOrderToOrderLine
   * Cascade zinciri üretimdeki WO'yu sessizce yetim bırakır, MRP talebi
   * kaybolur, SystemLog recordId'leri boşa düşer — softDelete'in 409 blokajı,
   * cancel-preview ve CONVERT_TO_STOCK akışının tamamı atlanırdı. /permanent
   * çağrısı guard'lı iptale yönlendirilir (WorkOrderService.hardDelete'in
   * arşive çevrilmesiyle aynı desen).
   */
  /**
   * SİPARİŞ KALEMİ RENGİNİ DEĞİŞTİR (2026-08-21 — "Rengi Değiştir → siparişi de
   * düzelt" seçeneği). Genel `update` iş emri bağlı siparişin kalemlerine
   * KAPALIDIR ("önce iş emrini iptal edin") ve o kural korunur; bu uç yalnız
   * RENK alanını, SEBEPLE ve audit iziyle gevşetir: müşteri telefonla rengi
   * değiştirdiğinde plan (iş emri) + sözleşme (sipariş kalemi) aynı anda
   * düzeltilebilsin, sipariş iptal edilip yeniden açılmasın.
   *
   * Kapsam BİLİNÇLİ DAR: kumaş / metraj / en DEĞİŞMEZ (metraj tahsis ve sevk
   * defterine bağlı, kumaş kimliktir). İptal edilmiş / tamamlanmış siparişte
   * çalışmaz. Kural seti WO hedef rengiyle aynı: renk aktif + müşteriye
   * atanabilir + kumaşın izinli renk listesi.
   */
  async changeLineColor(
    orderId: string,
    lineId: string,
    colorId: string | null,
    reason: string,
    userId?: string,
  ): Promise<ApiResponse<{ lineId: string; previousColorId: string | null; colorId: string | null }>> {
    const trimmed = (reason ?? "").trim();
    if (trimmed.length < 3) {
      throw AppError.badRequest("Renk değişikliği için sebep yazmalısınız.");
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        customerId: true,
        lines: { where: { id: lineId }, select: { id: true, colorId: true, itemId: true } },
      },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      throw AppError.conflict(
        `${order.orderNumber} ${order.status === "CANCELLED" ? "iptal edilmiş" : "tamamlanmış"} — kalem rengi değiştirilemez.`,
      );
    }
    const line = order.lines[0];
    if (!line) throw AppError.notFound("Sipariş kalemi bulunamadı");
    if ((line.colorId ?? null) === colorId) {
      throw AppError.badRequest("Sipariş kalemi zaten bu renkte.");
    }

    let colorName: string | null = null;
    if (colorId) {
      const color = await prisma.color.findUnique({
        where: { id: colorId },
        select: { name: true, isActive: true },
      });
      if (!color || !color.isActive) throw AppError.badRequest("Renk bulunamadı veya pasif.");
      colorName = color.name;
      await assertColorsAssignableToCustomer([colorId], order.customerId);
      const item = await prisma.item.findUnique({
        where: { id: line.itemId },
        select: { allowedColors: { select: { colorId: true } } },
      });
      const allowed = new Set((item?.allowedColors ?? []).map((c) => c.colorId));
      if (allowed.size > 0 && !allowed.has(colorId)) {
        throw AppError.badRequest("Renk bu kumaşın izinli renk listesinde değil.");
      }
    }

    // Atomik: eşzamanlı başka bir düzeltme kalemi değiştirdiyse sessizce ezme.
    const claim = await prisma.orderLine.updateMany({
      where: { id: lineId, orderId, colorId: line.colorId },
      data: { colorId },
    });
    if (claim.count === 0) {
      throw AppError.conflict("Sipariş kalemi bu sırada değişti — yenileyip tekrar deneyin.");
    }

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: "ORDER",
      recordId: orderId,
      oldData: { lineId, colorId: line.colorId },
      newData: { event: "ORDER_LINE_COLOR_CHANGED", lineId, colorId, colorName, reason: trimmed },
    });

    return {
      success: true,
      data: { lineId, previousColorId: line.colorId, colorId },
      message: `Sipariş kalemi rengi "${colorName ?? "renksiz"}" olarak güncellendi.`,
    };
  }

  async hardDelete(id: string, userId?: string): Promise<ApiResponse<unknown>> {
    return this.softDelete(id, userId);
  }

  async softDelete(
    id: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    this.assertNoActiveShipments(await this.getActiveShipmentLinks(id), "İptal");
    const oldRecord = await prisma.order.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            workOrderLinks: {
              where: ACTIVE_ORDER_LINK,
              include: { workOrder: true },
            },
          },
        },
      },
    });

    if (!oldRecord) {
      return { success: false, data: null, message: "Sipariş bulunamadı" };
    }

    const allLinks = oldRecord.lines.flatMap((line) => line.workOrderLinks);
    const blockingStatuses = new Set(["IN_PROGRESS", "COMPLETED"]);
    const blockingWOs = allLinks
      .map((l) => l.workOrder)
      .filter((wo) => blockingStatuses.has(wo.status));

    if (blockingWOs.length > 0) {
      const workOrderNumbers = [...new Set(blockingWOs.map((w) => w.workOrderNumber))].join(", ");
      throw AppError.conflict(
        `Bu siparişe bağlı aktif/tamamlanmış iş emirleri var: ${workOrderNumbers}. Önce onları iptal edin.`
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      // F142: atomik claim ÖNCE — çift-paralel iptal ve araya giren COMPLETED
      // (manualComplete/recompute) koşulsuz CANCELLED ezmesini kapat.
      const cancelClaim = await tx.order.updateMany({
        where: { id, status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] } },
        // `cancelledAt` HER iptal yolunda damgalanır (bu generic yol dahil):
        // "dönemde kaç iptal" sorusu `orderDate`e sorulamaz ve damgasız satır
        // rapordan sessizce düşerdi. SEBEP yalnız operatörün seçtiği yolda
        // (`cancelWithActions`) dolar — burada uydurulmaz.
        data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      });
      if (cancelClaim.count === 0) {
        const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
        throw AppError.conflict(
          `Sipariş bu sırada ${
            fresh?.status === OrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, tekrar iptal edilemez. Sayfayı yenileyin.`,
        );
      }


      // BU siparişin satır bağlarını TAZE oku (orderLineId scope — shared WO'nun
      // başka sipariş bağları korunur). Linkli WO satırlarını sıralı kilitle
      // (workorder softDelete deseniyle simetrik) → eşzamanlı WO status geçişi serileşir.
      const myLinks = await tx.workOrderToOrderLine.findMany({
        where: { orderLine: { orderId: id }, ...ACTIVE_ORDER_LINK },
        select: { workOrderId: true, orderLineId: true },
      });
      const woIds = [...new Set(myLinks.map((l) => l.workOrderId))].sort();
      for (const wid of woIds) await touchWorkOrderTx(tx, wid); // döngü — Promise.all(tx.*) YASAK
      const woRows = await tx.workOrder.findMany({
        where: { id: { in: woIds } },
        select: { id: true, status: true, workOrderNumber: true },
      });
      const woById = new Map(woRows.map((w) => [w.id, w]));
      const blocking = woRows.filter((w) => blockingStatuses.has(w.status));
      if (blocking.length > 0) {
        const workOrderNumbers = [...new Set(blocking.map((w) => w.workOrderNumber))].join(", ");
        throw AppError.conflict(
          `Bu siparişe bağlı aktif/tamamlanmış iş emirleri var: ${workOrderNumbers}. Önce onları iptal edin.`,
        );
      }
      // BU siparişin bağlarını TERMİNAL OLMAYAN her iş emrinden kopar (2026-08-21).
      // Eskiden yalnız `status === "PLANNED"` çiftleri koparılıyordu; kardeş yol
      // `cancelWithActions` ise UNLINK/CONVERT/CANCEL üçünde de bağı siliyor. İki
      // yolun aynı cümleyi kurması gerekir: **iptal edilmiş siparişin bağı hiçbir
      // canlı/bitmiş iş emrinde kalmasın.** CANCELLED/SUPERSEDED iş emirleri kapsam
      // DIŞI — onlar tarihçedir, bağları da tarihsel izdir (silmek geçmişi bozar).
      // ⚠️ Bugün küme fiilen PLANNED'a eşittir: yukarıdaki `blocking` guard'ı
      // IN_PROGRESS/COMPLETED bağlı siparişi zaten 409 ile reddediyor. Kural yine de
      // kanonik yazıldı — guard gevşerse davranış sessizce eskiye dönmesin.
      const livePairs = myLinks.filter((l) => {
        const st = woById.get(l.workOrderId)?.status;
        return st !== undefined && st !== WorkOrderStatus.CANCELLED && st !== WorkOrderStatus.SUPERSEDED;
      });
      const typeChangedWorkOrderIds: string[] = [];
      if (livePairs.length > 0) {
        // Bağ SİLİNMEZ, damgalanır (③a, 2026-09-14): sipariş silinse de "bu iş emri o
        // sipariş için açılmıştı" izi durur (K5 şerhinin uygulama katmanı yarısı).
        await unlinkOrderLinesTx(tx, { pairs: livePairs, reason: "ORDER_DELETE", userId: userId ?? null });
        // Bağı kopan HER iş emri için (döngü — Promise.all(tx.*) YASAK):
        //   ① refakat kartı bayat — kartta sipariş bloğu + tip basılı,
        //   ② son bağı kalktıysa tip STOK'a döner (TİP = BAĞIN AYNASI;
        //      `cancelWithActions` UNLINK_ONLY dalı + `unlinkOrderLine` emsali).
        for (const wid of [...new Set(livePairs.map((l) => l.workOrderId))].sort()) {
          await markTravelerCardDirtyTx(tx, wid);
          const remaining = await activeOrderLinkCount(tx, wid);
          if (remaining > 0) continue;
          // Atomik: `updateMany WHERE type=ORDER_PRODUCTION` — zaten STOK'sa dokunmaz,
          // iptal/devredilmiş atlanır. `targetItemId: { not: null }` STOK'un değişmezi:
          // hedef kumaşı olmayan iş emri çevrilemez (sessizce ORDER kalır, count=0).
          const flipped = await tx.workOrder.updateMany({
            where: {
              id: wid,
              type: "ORDER_PRODUCTION",
              status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
              targetItemId: { not: null },
            },
            data: { type: "STOCK_PRODUCTION" },
          });
          if (flipped.count > 0) typeChangedWorkOrderIds.push(wid);
        }
      }
      const order = await tx.order.findUnique({ where: { id } });
      return { order: order!, unlinkedCount: livePairs.length, typeChangedWorkOrderIds };
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: oldRecord as unknown as Record<string, unknown>,
      newData: {
        status: "CANCELLED",
        unlinkedWorkOrderCount: updated.unlinkedCount,
        typeChangedWorkOrderIds: updated.typeChangedWorkOrderIds,
      },
    });

    return {
      success: true,
      data: updated.order,
      message:
        updated.unlinkedCount > 0
          ? `Sipariş iptal edildi. ${updated.unlinkedCount} iş emri bağlantısı koparıldı.` +
            (updated.typeChangedWorkOrderIds.length > 0
              ? ` ${updated.typeChangedWorkOrderIds.length} iş emri stok üretimine döndü.`
              : "")
          : "Sipariş iptal edildi",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // İptal Akışı (Preview + Per-WO Action) — R1.2
  //
  // Operatör "Sipariş Sil" derken katı 409 yerine WO başına seçim sunulur:
  //   - PLANNED WO          → otomatik UNLINK_ONLY (üretim yok, sessiz kopar)
  //   - IN_PROGRESS ya da COMPLETED + tek-sipariş WO
  //                         → UNLINK_ONLY | CONVERT_TO_STOCK | CANCEL_WO
  //                           (CANCEL_WO sadece IN_PROGRESS için)
  //   - IN_PROGRESS ya da COMPLETED + çoklu-sipariş WO
  //                         → sadece UNLINK_ONLY (diğer siparişler ayakta)
  //
  // Frontend önce `getCancelPreview` ile etkilenecek WO listesini alır,
  // operatör seçimini yapar, `cancelWithActions` ile uygular.
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * İptal "dry-run" — operatöre detaylı onay göstermek için.
   * Aksiyon belirlenmemiş ham bilgi döner; karar matrisi de döner ki frontend
   * tek noktadan default'u alabilsin.
   */
  async getCancelPreview(orderId: string): Promise<ApiResponse<unknown>> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        lines: {
          select: {
            id: true,
            workOrderLinks: {
              where: ACTIVE_ORDER_LINK,
              select: {
                workOrder: {
                  select: {
                    id: true,
                    workOrderNumber: true,
                    status: true,
                    type: true,
                    targetQuantity: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) throw AppError.notFound("Sipariş bulunamadı");

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.COMPLETED
    ) {
      throw AppError.conflict(
        `Sipariş ${order.status === "CANCELLED" ? "zaten iptal" : "tamamlanmış"} — iptal edilemez`
      );
    }

    // WO bazında grupla — bir WO'ya birden fazla satırdan bağ olabilir.
    const woMap = new Map<
      string,
      {
        id: string;
        workOrderNumber: string;
        status: string;
        /** WO'nun hedef üretim metrajı (link-only model: per-sipariş tahsis yok). */
        targetQuantity: Prisma.Decimal | null;
      }
    >();
    for (const line of order.lines) {
      for (const link of line.workOrderLinks) {
        const wo = link.workOrder;
        if (woMap.has(wo.id)) continue;
        woMap.set(wo.id, {
          id: wo.id,
          workOrderNumber: wo.workOrderNumber,
          status: wo.status,
          targetQuantity:
            wo.targetQuantity != null ? new Prisma.Decimal(wo.targetQuantity) : null,
        });
      }
    }

    // PERF (N+1 giderildi): eskiden her WO için 2 ayrı sorgu (order.findMany +
    // roll.count) `Promise.all(map(async))` içinde dönüyordu → paylaşımlı siparişte
    // 2N round-trip + havuz baskısı. Artık WO sayısından bağımsız 3 sınırlı sorgu:
    //   (a) bu siparişin DIŞINDA bu WO'lara bağlı diğer siparişler,
    //   (b) bu WO'ların step'leri, (c) o step'lerde üretilmiş rulo sayısı (groupBy).
    // woId başına sonuçlar bellekte toplanır.
    const woIds = Array.from(woMap.keys());

    // (a) Diğer siparişler — hangi WO'ya bağlı olduklarını da çekip woId→Set kur.
    const otherOrderRows =
      woIds.length === 0
        ? []
        : await prisma.order.findMany({
            where: {
              id: { not: orderId },
              lines: {
                some: { workOrderLinks: { some: { ...ACTIVE_ORDER_LINK, workOrderId: { in: woIds } } } },
              },
            },
            select: {
              orderNumber: true,
              lines: {
                where: { workOrderLinks: { some: { ...ACTIVE_ORDER_LINK, workOrderId: { in: woIds } } } },
                select: { workOrderLinks: { where: ACTIVE_ORDER_LINK, select: { workOrderId: true } } },
              },
            },
          });
    const otherOrdersByWo = new Map<string, Set<string>>();
    for (const ord of otherOrderRows) {
      for (const line of ord.lines) {
        for (const link of line.workOrderLinks) {
          if (!woMap.has(link.workOrderId)) continue;
          let set = otherOrdersByWo.get(link.workOrderId);
          if (!set) {
            set = new Set<string>();
            otherOrdersByWo.set(link.workOrderId, set);
          }
          set.add(ord.orderNumber);
        }
      }
    }

    // (b+c) WO başına üretilmiş rulo sayısı: step'leri çek, roll.groupBy ile
    //       producedInStepId üzerinden say ([producedInStepId,status] index'li).
    const steps =
      woIds.length === 0
        ? []
        : await prisma.workOrderStep.findMany({
            where: { workOrderId: { in: woIds } },
            select: { id: true, workOrderId: true },
          });
    const stepToWo = new Map<string, string>();
    for (const s of steps) stepToWo.set(s.id, s.workOrderId);

    const rollGroups =
      steps.length === 0
        ? []
        : await prisma.roll.groupBy({
            by: ["producedInStepId"],
            where: { producedInStepId: { in: steps.map((s) => s.id) } },
            _count: { _all: true },
          });
    const rollCountByWo = new Map<string, number>();
    for (const g of rollGroups) {
      const wid = g.producedInStepId ? stepToWo.get(g.producedInStepId) : undefined;
      if (!wid) continue;
      rollCountByWo.set(wid, (rollCountByWo.get(wid) ?? 0) + g._count._all);
    }

    const affectedWorkOrders = Array.from(woMap.values()).map((wo) => {
      const otherOrderNumbers = Array.from(otherOrdersByWo.get(wo.id) ?? []);
      const isSoleOrder = otherOrderNumbers.length === 0;
      const allowedActions = computeAllowedActions(wo.status, isSoleOrder);
      const defaultAction = pickDefaultAction(wo.status, isSoleOrder);

      return {
        id: wo.id,
        workOrderNumber: wo.workOrderNumber,
        status: wo.status,
        targetQuantity: wo.targetQuantity,
        isSoleOrder,
        otherOrdersCount: otherOrderNumbers.length,
        otherOrderNumbers,
        producedRollCount: rollCountByWo.get(wo.id) ?? 0,
        allowedActions,
        defaultAction,
      };
    });

    // Aktif sevkiyat bağları — somut listele (uygulamada cancelWithActions/
    // softDelete bu bağ varken 409 ile bloklar; preview operatöre nedeni gösterir).
    const activeShipments = await this.getActiveShipmentLinks(orderId);

    return {
      success: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        affectedWorkOrders,
        activeShipments,
        canCancel: activeShipments.length === 0,
      },
    };
  }

  /**
   * Planlamacı: Preview'ı görüp her WO için seçim yaptıktan sonra çağrılır.
   * `workOrderActions` boş gelirse default davranış uygulanır (preview ile
   * aynı): PLANNED → UNLINK_ONLY, IN_PROGRESS+ tek-sipariş → CONVERT_TO_STOCK,
   * çoklu-sipariş → UNLINK_ONLY.
   *
   * Sıra: önce CANCEL_WO aksiyonları (WorkOrderService.softDelete cascadeleriyle),
   * sonra tek transaction içinde join temizliği + WO type değişimi + order
   * iptal. CANCEL_WO öncesi başarılı, sonrası başarısız olursa orphan WO
   * iptal kalır — operatör tekrar denerse idempotent (zaten iptal).
   */
  async cancelWithActions(
    orderId: string,
    workOrderActions: Array<{ workOrderId: string; action: CancelAction }>,
    userId?: string,
    reason?: { reasonCode?: string | null; reasonText?: string | null }
  ): Promise<ApiResponse<unknown>> {
    this.assertNoActiveShipments(await this.getActiveShipmentLinks(orderId), "İptal");

    // SEBEP ÇÖZÜMÜ TX DIŞINDA (top iptalindeki kural): `resolveReasonCode`
    // katalog önbelleğini okur ve gerekirse tazeler — tx içinde çağrılırsa
    // kilidi ağ/DB turu kadar uzatır. Geçersiz açık kod burada 400 verir, yani
    // iptal hiç başlamadan durur.
    //
    // Metin GÖRÜNEN kayıt, kod RAPOR ANAHTARI. Serbest metin yazıldıysa kod
    // NULL kalır ve UYDURULMAZ — rapor "Diğer" kovasında değil "kodsuz"
    // kovasında gösterir.
    const { code: cancelReasonCode, text: cancelReasonText } = reason
      ? await resolveReasonCode(ReasonPresetKind.ORDER_CANCEL, reason)
      : { code: null, text: null };
    const previewRes = await this.getCancelPreview(orderId);
    const preview = previewRes.data as {
      orderId: string;
      orderNumber: string;
      affectedWorkOrders: Array<{
        id: string;
        status: string;
        isSoleOrder: boolean;
        allowedActions: CancelAction[];
        defaultAction: CancelAction;
      }>;
    };

    // Her WO için seçilen aksiyonu belirle (operatör vermediyse default).
    const actionByWO = new Map<string, CancelAction>();
    for (const wo of preview.affectedWorkOrders) {
      const provided = workOrderActions.find((a) => a.workOrderId === wo.id);
      if (provided) {
        if (!wo.allowedActions.includes(provided.action)) {
          throw AppError.badRequest(
            `WO ${wo.id} için '${provided.action}' geçersiz. İzinli: ${wo.allowedActions.join(", ")}`
          );
        }
        actionByWO.set(wo.id, provided.action);
      } else {
        // FAIL-CLOSED: varsayılan da izinli listeden geçer. `pickDefaultAction`
        // artık listeden türetiyor, yani buraya düşmek imkânsız — ama ayrışma
        // bir daha olursa SESSİZ 400 yerine sebebini söyleyen bir hata çıksın
        // (T2-005'in bedeli sessizliğiydi: operatör "Sayfayı yenileyin" görüp
        // yeniliyor ve aynı duvara çarpıyordu).
        if (!wo.allowedActions.includes(wo.defaultAction)) {
          throw AppError.badRequest(
            `İş emri ${wo.id} için varsayılan aksiyon ('${wo.defaultAction}') izinli değil ` +
              `(izinli: ${wo.allowedActions.join(", ")}). Bu bir sunucu tutarsızlığıdır — ` +
              "sipariş iptali için destek ekibine bildirin.",
          );
        }
        actionByWO.set(wo.id, wo.defaultAction);
      }
    }

    // 1) CANCEL_WO aksiyonları — WorkOrderService.softDelete cascadeleriyle.
    //    Dynamic import: workorder.service.ts → order.service.ts döngüsünden
    //    kaçınmak için.
    const cancelWoIds = preview.affectedWorkOrders
      .filter((wo) => actionByWO.get(wo.id) === "CANCEL_WO")
      .map((wo) => wo.id);
    if (cancelWoIds.length > 0) {
      const { WorkOrderService } = await import("./workorder.service");
      const woService = new WorkOrderService();
      for (const woId of cancelWoIds) {
        await woService.softDelete(woId, userId);
      }
    }

    // 2) Tek transaction: convert + unlink + order cancel.
    await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM (check-then-act DEĞİL): tx başında siparişi non-terminal
      // iddia et + write-kilitle. Yıkıcı işlem preview+per-record onayıyla korunuyor;
      // bu yalnız eşzamanlılık/replay sertleştirmesi (iki paralel iptal, ya da
      // sipariş bu arada COMPLETED'a geçtiyse → 409). Claim status=CANCELLED'i de set
      // ettiğinden eski sondaki koşulsuz order.update kaldırıldı.
      const cancelClaim = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED] },
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: cancelReasonText,
          cancelReasonCode,
        },
      });
      if (cancelClaim.count === 0) {
        const fresh = await tx.order.findUnique({
          where: { id: orderId },
          select: { status: true },
        });
        throw AppError.conflict(
          `Sipariş bu sırada ${
            fresh?.status === OrderStatus.COMPLETED ? "tamamlandı" : "iptal edildi"
          }, tekrar iptal edilemez. Sayfayı yenileyin.`
        );
      }
      // F145: preview↔apply arası WO status yarışını kapat. Etkilenen WO'ları
      // SIRALI kilitle (WO start/dispatch/finalize/cancel yolları da bu satırı
      // kilitler → serileşir), sonra TAZE status + TAZE sole-order oku ve her
      // non-CANCEL aksiyonu bayat preview yerine güncel duruma karşı doğrula.
      const affectedWoIds = [...new Set(preview.affectedWorkOrders.map((w) => w.id))].sort();
      for (const wid of affectedWoIds) await touchWorkOrderTx(tx, wid); // döngü — Promise.all(tx.*) YASAK
      const freshRows = await tx.workOrder.findMany({
        where: { id: { in: affectedWoIds } },
        select: { id: true, status: true },
      });
      const freshStatus = new Map(freshRows.map((r) => [r.id, r.status]));
      const otherLinks = await tx.workOrderToOrderLine.findMany({
        where: { workOrderId: { in: affectedWoIds }, orderLine: { orderId: { not: orderId } }, ...ACTIVE_ORDER_LINK },
        select: { workOrderId: true },
      });
      const hasOther = new Set(otherLinks.map((l) => l.workOrderId));
      for (const wo of preview.affectedWorkOrders) {
        const action = actionByWO.get(wo.id)!;
        if (action === "CANCEL_WO") continue; // adım 4'te kendi claim'iyle iptal edilir
        const fs = freshStatus.get(wo.id);
        if (!fs) {
          throw AppError.conflict("İş emri bu sırada kaldırıldı, tekrar deneyin. Sayfayı yenileyin.");
        }
        if (!computeAllowedActions(fs, !hasOther.has(wo.id)).includes(action)) {
          throw AppError.conflict(
            "İş emri durumu değişti (önizleme bayatladı). Sayfayı yenileyip iptali tekrar onaylayın.",
          );
        }
      }
      // Önizleme sonrası bu siparişe DOĞAN yeni WO bağı → onaysız kopmayı engelle.
      const currentLinks = await tx.workOrderToOrderLine.findMany({
        where: { ...ACTIVE_ORDER_LINK, orderLine: { orderId }, workOrder: { status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } } },
        select: { workOrderId: true },
      });
      if (currentLinks.some((l) => !affectedWoIds.includes(l.workOrderId))) {
        throw AppError.conflict(
          "Önizleme sonrası bu siparişe yeni iş emri bağlandı. Sayfayı yenileyip iptali tekrar onaylayın.",
        );
      }

      for (const wo of preview.affectedWorkOrders) {
        const action = actionByWO.get(wo.id)!;
        if (action === "CONVERT_TO_STOCK") {
          const conv = await tx.workOrder.updateMany({
            where: { id: wo.id, status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] } },
            data: { type: "STOCK_PRODUCTION" },
          });
          if (conv.count === 0) {
            throw AppError.conflict("İş emri bu sırada iptal edildi, stoğa çevrilemedi. Sayfayı yenileyin.");
          }
        }
        // UNLINK_ONLY / CONVERT_TO_STOCK / CANCEL_WO hepsi bağı KOPARIR — silmez, damgalar (③a).
        await unlinkOrderLinesTx(tx, { workOrderId: wo.id, orderId, reason: "ORDER_CANCEL", userId: userId ?? null });
        // REFAKAT KARTI BAYAT (2026-08-21): kartta SİPARİŞ bloğu + iş emri TİPİ
        // basılıdır (`buildPlan` → orderLinks). Sipariş iptali o bloğu değiştirir →
        // sahadaki kâğıt artık olmayan bir siparişi gösterir. Emsal + simetri:
        // `workorder-link.service` bağ EKLERKEN de, KALDIRIRKEN de işaretliyor.
        // CANCEL_WO dalında kart zaten VOIDED (softDelete kaskatı) → helper ACTIVE
        // olmayan kartı atlar, yani bu çağrı orada güvenli bir no-op'tur.
        await markTravelerCardDirtyTx(tx, wo.id); // döngü — Promise.all(tx.*) YASAK
        // TİP = BAĞIN AYNASI (2026-08-21): UNLINK_ONLY tek-siparişli iş emrinde
        // son bağı da siler → iş emri hiçbir siparişe bağlı kalmaz → STOK'a
        // döner (CONVERT_TO_STOCK ile aynı sonuç; fark yalnız operatörün niyet
        // etiketi). Eskiden ORDER tipli ama bağsız "Siparişe Özel" iş emri
        // kalıyordu (PLANNED'da tek izinli aksiyon buydu). Taze sayım tx içinde,
        // kilit altında; `updateMany WHERE type=ORDER` — zaten STOK'sa dokunmaz,
        // iptal/devredilmiş iş emri de (assertPlanEditable aynası) atlanır.
        if (action === "UNLINK_ONLY") {
          const remaining = await activeOrderLinkCount(tx, wo.id);
          if (remaining === 0) {
            await tx.workOrder.updateMany({
              where: {
                id: wo.id,
                type: "ORDER_PRODUCTION",
                status: { notIn: [WorkOrderStatus.CANCELLED, WorkOrderStatus.SUPERSEDED] },
                // STOK'un değişmezi: hedef kumaş dolu (unlinkOrderLine aynası).
                targetItemId: { not: null },
              },
              data: { type: "STOCK_PRODUCTION" },
            });
          }
        }
      }
    });

    await AuditService.log({
      userId,
      action: "DELETE",
      tableName: this.config.tableName,
      recordId: orderId,
      newData: {
        status: "CANCELLED",
        actions: Array.from(actionByWO.entries()).map(([woId, a]) => ({
          workOrderId: woId,
          action: a,
        })),
      },
    });

    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    return {
      success: true,
      data: updated,
      message: `Sipariş iptal edildi (${preview.affectedWorkOrders.length} iş emri etkilendi)`,
    };
  }

  /**
   * Planlamacı tarafından manuel tamamlama. Tölerans dışında eksik metraj
   * kabul edildiğinde, ürün üretilmeyecekse, müşteri kabul ettiğinde vb.
   *
   * - APPROVED veya PARTIAL_SHIPPED durumdaki siparişler için.
   * - PENDING (onaysız) ya da CANCELLED kapatılamaz.
   * - Zaten COMPLETED ise no-op değil hata — yanlışlıkla tetiklenmesin.
   */
  async manualComplete(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();
    if (!reason.trim()) throw AppError.badRequest("Tamamlama sebebi gerekli");

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, orderNumber: true, status: true, completedAt: true, customerId: true },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    this.assertNoActiveShipments(
      await this.getActiveShipmentLinks(id),
      "Manuel kapatma"
    );
    if (order.status === OrderStatus.COMPLETED) {
      throw AppError.badRequest("Sipariş zaten tamamlanmış");
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw AppError.badRequest("İptal edilmiş sipariş kapatılamaz");
    }
    if (order.status === OrderStatus.PENDING) {
      throw AppError.badRequest("Onaysız sipariş manuel tamamlanamaz");
    }

    // ATOMİK CLAIM (check-then-act DEĞİL — kardeş cancelWithActions ile parite):
    // terminal/PENDING reddini yazmanın WHERE'ine koy. Eşzamanlı cancelWithActions
    // ile yarışta manualComplete bayat non-terminal okuyup CANCELLED siparişi
    // sessizce COMPLETED'a ezemesin (yıkıcı iptalin geri alınması engellenir).
    await prisma.$transaction(async (tx) => {
      const claim = await tx.order.updateMany({
        where: {
          id,
          status: {
            notIn: [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.PENDING],
          },
        },
        data: {
          status: OrderStatus.COMPLETED,
          completedAt: order.completedAt ?? new Date(),
          manualClosedById: userId,
          manualCloseReason: reason.trim(),
        },
      });
      if (claim.count === 0) {
        const fresh = await tx.order.findUnique({ where: { id }, select: { status: true } });
        throw AppError.conflict(
          `Sipariş bu sırada ${fresh?.status} durumuna geçti — manuel tamamlanamadı. Sayfayı yenileyin.`
        );
      }
    });
    const updated = await prisma.order.findUnique({ where: { id } });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: { status: order.status },
      newData: {
        status: updated!.status,
        manualClosedById: userId,
        manualCloseReason: updated!.manualCloseReason,
      },
    });

    return {
      success: true,
      data: updated!,
      message: `Sipariş manuel tamamlandı: ${order.orderNumber}`,
    };
  }

  /**
   * Manuel kapatılmış siparişi geri açar. Recompute sonucunda statü
   * otomatik PARTIAL_SHIPPED veya APPROVED'a döner. Sadece manuel
   * kapatılmış (manualClosedById dolu) siparişler için.
   */
  async reopen(
    id: string,
    reason: string,
    userId?: string
  ): Promise<ApiResponse<unknown>> {
    if (!userId) throw AppError.unauthorized();

    const order = await prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        manualClosedById: true,
      },
    });
    if (!order) throw AppError.notFound("Sipariş bulunamadı");
    if (!order.manualClosedById) {
      throw AppError.badRequest(
        "Bu sipariş manuel kapatılmamış — yeniden açma uygulanamaz"
      );
    }

    // Manuel iz silinir; sonra recomputeOrderStatusTx sevk sayaçlarına göre
    // status (APPROVED/PARTIAL_SHIPPED) ve shippedQty'yi senkronize eder.
    const updated = await prisma.$transaction(async (tx) => {
      // ATOMİK CLAIM (check-then-act DEĞİL — manualComplete/cancelWithActions paritesi):
      // yalnız HÂLÂ manuel-kapalı sipariş yeniden açılır. tx-dışı manualClosedById
      // okuması UX; iki paralel reopen yarışında biri count===0 → 409 (çift audit/
      // koşulsuz APPROVED yazımı engellenir).
      const claim = await tx.order.updateMany({
        where: { id, manualClosedById: { not: null } },
        data: {
          manualClosedById: null,
          manualCloseReason: null,
          completedAt: null,
          status: OrderStatus.APPROVED,
        },
      });
      if (claim.count === 0) {
        throw AppError.conflict(
          "Sipariş bu sırada durum değiştirdi — yeniden açılamadı, sayfayı yenileyin"
        );
      }
      await recomputeOrderStatusTx(tx, id);
      return tx.order.findUniqueOrThrow({ where: { id } });
    });

    await AuditService.log({
      userId,
      action: "UPDATE",
      tableName: this.config.tableName,
      recordId: id,
      oldData: { status: order.status, manualClosedById: order.manualClosedById },
      newData: {
        status: updated.status,
        manualClosedById: null,
        reopenReason: reason.trim() || null,
      },
    });

    return {
      success: true,
      data: updated,
      message: `Sipariş yeniden açıldı: ${order.orderNumber}`,
    };
  }
}
