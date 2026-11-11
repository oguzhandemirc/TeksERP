// =============================================================================
// Order Service / list
// =============================================================================
// Sipariş listesi yardımcıları: 'nerede' filtre kapısı, extraWhere (iş emri durumu) ve özet istatistikleri (buildListWhere/assertListQueryShape/findAll cephede — super çağrısı).
// `order.service.ts`ten kelimesi kelimesine taşındı (2026-11-08, davranış aynı);
// dışa açık ad yalnız cepheden (`../order.service`) okunur.
// =============================================================================

import prisma from "../../lib/prisma";
import { ApiResponse } from "../../types/api.types";
import { AppError } from "../../utils/app-error";
import {
  OrderStatus,
  Prisma,
  WorkOrderStatus,
} from "@prisma/client";
import { buildHideCancelledWhere } from "../helpers/hidden-status.helper";
import {
  parseQueryParams,
  readIdCondition,
} from "../../utils/query-parser";
import {
  WO_ROLLUP_ACTIVE,
} from "../helpers/order-where.helper";
import {
  needsProduction,
  orderWhereFilterParts,
  readOrderWhereFilters,
} from "../helpers/order-where-filter.helper";
import { readProductionEnabled, SETTING_KEYS } from "../system-setting.service";
import { licenseModuleError } from "../../lib/license/module-ceiling";
import { Request } from "express";
import { ACTIVE_ORDER_LINK } from "../helpers/order-link.helper";
import type { OrderServiceThis } from "./shared";

// ── "İş Emri" rollup filtresi (filter[woState]) ──────────────────────────────
// Semantik Electron `work-order-rollup.ts` (deriveWoRollup) ile BİREBİR aynı
// olmalı — rozet ne gösteriyorsa filtre onu bulmalı. Aktif küme CANCELLED +
// SUPERSEDED hariçtir; PLANNED+COMPLETED karışımı (IN_PROGRESS yokken) rozette
// "Üretimde" sayılır. Durumlar bu tanımla karşılıklı münhasırdır; çoklu seçim
// OR'lanır. Varlık sorgusu (some) distinct-WO ayrımına duyarsızdır → frontend'in
// distinct kümesiyle aynı sonucu verir.
// Aktif küme `WO_ROLLUP_ACTIVE` "Nerede?" türetmesiyle ortaktır → `order-where.helper`da tek tanım.

/** "Siparişin herhangi bir kalemi, verilen durumlardan bir WO'ya bağlı" koşulu. */
function hasWoLink(statuses: WorkOrderStatus[]): Record<string, unknown> {
  return {
    lines: {
      some: { workOrderLinks: { some: { ...ACTIVE_ORDER_LINK, workOrder: { status: { in: statuses } } } } },
    },
  } satisfies Prisma.OrderWhereInput;
}

/** Dışa açık: açılış panosunun "üretime gönderilmemiş sipariş" sayımı `NONE` rozetini birebir okur. */
export const WO_STATE_WHERE: Record<string, Record<string, unknown>> = {
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

export async function gateOrderWhereFilters(req: Request): Promise<boolean> {
    const enabled = await readProductionEnabled();
    if (!enabled && needsProduction(readOrderWhereFilters(parseQueryParams(req).filters))) {
      throw licenseModuleError(SETTING_KEYS.PRODUCTION_ENABLED, "Üretim")
        ?? AppError.forbidden("Üretim modülü kapalı; bu süzgeç kullanılamaz.", { code: "MODULE_DISABLED", modul: "production" });
    }
    return enabled;
  }

export function extraWhere(req: Request): Record<string, unknown> | undefined {
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

    // "Nerede?" sekmeleri + fason firma/gün (tek where: liste + cursor + özet). Bozuk değer 400.
    conds.push(...(orderWhereFilterParts(readOrderWhereFilters(filters), new Date()) as Record<string, unknown>[]));

    // İptal edilmiş siparişleri gizle (panel varsayılanı). `safeFilters` bu
    // anahtarı skaler süzgeçte düşürür — burada ham filters'tan okunur.
    const hideCancelled = buildHideCancelledWhere(filters, [OrderStatus.CANCELLED]);
    if (hideCancelled) conds.push(hideCancelled);

    if (conds.length === 0) return undefined;
    return conds.length === 1 ? conds[0] : { AND: conds };
  }

export async function getOrderStats(this: OrderServiceThis, req: Request): Promise<ApiResponse<OrderStats>> {
    await this.gateOrderWhereFilters(req);
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
