// =============================================================================
// SİPARİŞ "NEREDE?" — SÜZGEÇLER (Prisma ikizi; türetme `order-where.helper.ts`)
// =============================================================================
// `filter[nerede|fasonFirmaId|fasondaGunden]` → liste + cursor + özet where parçaları.
// Her parça `order-where.helper` türetmesindeki bir yerin İKİZİDİR; bekçi
// `scripts/test_order_where.ts` "süzgeç kümesi == türetmede o yeri taşıyanlar"ı ölçer.
// =============================================================================
import { OrderStatus, Prisma, RollStatus } from "@prisma/client";
import { AppError } from "../../utils/app-error";
import { readFilterList } from "../../utils/query-parser";
import { whereWorkOrdersOfRolls } from "./workorder-rolls.helper";
import { SHIP_READY_READY_STATUSES } from "./ship-readiness.helper";
import { workOrderAtFasonWhere } from "./roll-place.helper";
import { DEADLINE_OPEN_ORDER_STATUSES } from "./order-deadline.helper";
import { ACTIVE_ORDER_LINK } from "./order-link.helper";
import { OPEN_ORDER_EXCLUDED, WO_ROLLUP_ACTIVE, fasonDayThreshold } from "./order-where.helper";

export const ORDER_WHERE_TABS = ["BEKLEYEN", "FASONDA", "SEVKE_HAZIR", "KISMEN", "GECIKEN"] as const;
export type OrderWhereTab = (typeof ORDER_WHERE_TABS)[number];
/** Üretim modülü kapalıyken anlamı olmayan süzgeçler (403 MODULE_DISABLED). */
export const ORDER_WHERE_PRODUCTION_TABS: readonly OrderWhereTab[] = ["FASONDA", "SEVKE_HAZIR"];
export const ORDER_WHERE_FILTER_KEYS = ["nerede", "fasonFirmaId", "fasondaGunden"] as const;
const MAX_DAYS = 3650;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OPEN_ORDER: Prisma.OrderWhereInput = { status: { notIn: OPEN_ORDER_EXCLUDED } };

/** "Siparişin aktif bağlı iş emirlerinden biri `woCond`u sağlar". */
function hasActiveWo(woCond: Prisma.WorkOrderWhereInput): Prisma.OrderWhereInput {
  return {
    lines: {
      some: {
        workOrderLinks: {
          some: { ...ACTIVE_ORDER_LINK, workOrder: { status: { in: WO_ROLLUP_ACTIVE }, AND: [woCond] } },
        },
      },
    },
  };
}

/** FASON yeri ikizi: canlı fason topu (adımda) VEYA firmalı açık sevk kalemi (`placesOfFacts`). */
const HAS_FASON_PLACE: Prisma.WorkOrderWhereInput = {
  OR: [
    { steps: { some: { currentRolls: { some: { status: RollStatus.AT_SUBCONTRACTOR } } } } },
    workOrderAtFasonWhere(),
  ],
};
/** HAZIR yeri ikizi: üç yoldan biriyle bağlı, hazır statüde top. */
const HAS_READY_PLACE: Prisma.WorkOrderWhereInput = whereWorkOrdersOfRolls({ status: { in: [...SHIP_READY_READY_STATUSES] } });

export interface OrderWhereFilters {
  tabs: OrderWhereTab[];
  firmaIds: string[];
  gunden: number | null;
}

/** `filter[nerede|fasonFirmaId|fasondaGunden]` okuması; bozuk/tanınmayan değer 400 (fail-closed). */
export function readOrderWhereFilters(filters: Record<string, string | string[]>): OrderWhereFilters {
  const tabs = readFilterList(filters.nerede);
  const known = new Set<string>(ORDER_WHERE_TABS);
  const badTab = tabs.find((t) => !known.has(t));
  if (badTab) {
    throw AppError.badRequest(`Tanınmayan "Nerede" süzgeci: "${badTab}" (geçerli: ${ORDER_WHERE_TABS.join(", ")})`, {
      code: "INVALID_FILTER_VALUE",
      field: "nerede",
    });
  }
  const firmaIds = readFilterList(filters.fasonFirmaId);
  const badId = firmaIds.find((id) => !UUID_RE.test(id));
  if (badId) {
    throw AppError.badRequest(`Geçersiz fason firma kimliği: "${badId}"`, { code: "INVALID_FILTER_VALUE", field: "fasonFirmaId" });
  }
  const rawDays = readFilterList(filters.fasondaGunden);
  let gunden: number | null = null;
  if (rawDays.length > 0) {
    if (rawDays.length > 1 || !/^\d+$/.test(rawDays[0]) || Number(rawDays[0]) > MAX_DAYS) {
      throw AppError.badRequest(`"Fasonda X günden uzun" 0–${MAX_DAYS} arası tam sayı olmalı`, {
        code: "INVALID_FILTER_VALUE",
        field: "fasondaGunden",
      });
    }
    gunden = Number(rawDays[0]);
  }
  return { tabs: [...new Set(tabs)] as OrderWhereTab[], firmaIds, gunden };
}

/** Üretim modülü gerektiren süzgeç seçili mi (kapalıyken 403). */
export function needsProduction(f: OrderWhereFilters): boolean {
  return f.firmaIds.length > 0 || f.gunden !== null || f.tabs.some((t) => ORDER_WHERE_PRODUCTION_TABS.includes(t));
}

function tabWhere(tab: OrderWhereTab, now: Date): Prisma.OrderWhereInput {
  switch (tab) {
    case "BEKLEYEN":
      return OPEN_ORDER;
    case "KISMEN":
      return { status: OrderStatus.PARTIAL_SHIPPED };
    case "GECIKEN":
      return { deadline: { lt: now }, status: { in: [...DEADLINE_OPEN_ORDER_STATUSES] } };
    case "FASONDA":
      return { AND: [OPEN_ORDER, hasActiveWo(HAS_FASON_PLACE)] };
    case "SEVKE_HAZIR":
      return { AND: [OPEN_ORDER, hasActiveWo(HAS_READY_PLACE)] };
  }
}

/** Liste + cursor + özet where parçaları (sekmeler kendi içinde VEYA; firma/gün sekmeyle VE). */
export function orderWhereFilterParts(f: OrderWhereFilters, now: Date): Prisma.OrderWhereInput[] {
  const out: Prisma.OrderWhereInput[] = [];
  if (f.tabs.length > 0) {
    const parts = f.tabs.map((t) => tabWhere(t, now));
    out.push(parts.length === 1 ? parts[0] : { OR: parts });
  }
  if (f.firmaIds.length > 0 || f.gunden !== null) {
    const extra: Prisma.SubcontractorDispatchWhereInput = {};
    if (f.firmaIds.length > 0) extra.subcontractorId = { in: f.firmaIds };
    if (f.gunden !== null) extra.dispatchedAt = { lt: fasonDayThreshold(f.gunden, now) };
    out.push({ AND: [OPEN_ORDER, hasActiveWo(workOrderAtFasonWhere(extra))] });
  }
  return out;
}
