// =============================================================================
// Temel raporların VARYANT boyutları + koşu kapanışları (R1-VARYANT) — uç ve eşitlik bekçisi AYNI kapanışı koşar
// =============================================================================
// Bir boyut yalnız kaynak ucun ZATEN kabul ettiği süzgeçle süzülebiliyorsa beyan edilir (hücre = süzgeçli ana
// koşu). Katalogdaki öteki boyutlar (renk, istasyon, tezgâh…) kaynak süzgeci gelene dek KAPALIDIR: çip yok, 400.

import type { Currency, ShipmentDestination } from "@prisma/client";
import { factoryYmd } from "../../../constants/time";
import type { CompareMode, DateRange } from "../_shared";
import { buildOrderDemandReport } from "./siparis-talep.temel";
import { buildShippedReport } from "./sevkiyat.temel";
import { buildDeadlineReport } from "./termin.temel";
import { buildOpenOrderReport } from "./acik-siparisler.temel";
import { buildSubcontractorsReport } from "./fasoncular.temel";
import { buildLoomStopsReport } from "./duruslar.temel";
import { getExpenseSummary, type ExpenseSummary } from "../../helpers/expense-summary.helper";
import { buildExpenseSummarySunumu, currencyName } from "../expense-summary.sunum";
import type { ResolvedDayRange } from "./_day-range";
import { DESTINATION_DIMENSION, declaredOptionsDimension, rankedDimension, type CoreRunner, type VariantDimension } from "./_variant";

export const ORDER_DEMAND_DIMS: readonly VariantDimension[] = [rankedDimension("musteri", "customerId"), rankedDimension("urun", "itemId"), DESTINATION_DIMENSION];
export const SHIPPED_DIMS: readonly VariantDimension[] = [DESTINATION_DIMENSION];
export const DEADLINE_DIMS: readonly VariantDimension[] = [DESTINATION_DIMENSION];
export const OPEN_ORDER_DIMS: readonly VariantDimension[] = [rankedDimension("urun", "itemId")];
export const SUBCONTRACTOR_DIMS: readonly VariantDimension[] = [rankedDimension("fasoncu", "subcontractorId")];
export const LOOM_STOP_DIMS: readonly VariantDimension[] = [declaredOptionsDimension("vardiya", "shiftDefinitionId")];
export const EXPENSE_SUMMARY_DIMS: readonly VariantDimension[] = [rankedDimension("paraBirimi", "currency")];

/** Uç anahtarı → beyanlı boyutlar (bekçi: katalog `varyantBoyutlari`nın alt kümesi olmalı). */
export const CORE_VARIANT_DIMS = {
  "sales/siparis-talep": ORDER_DEMAND_DIMS,
  "sales/sevkiyat": SHIPPED_DIMS,
  "sales/termin": DEADLINE_DIMS,
  "sales/acik-siparisler": OPEN_ORDER_DIMS,
  "subcontract/fasoncular": SUBCONTRACTOR_DIMS,
  "dokuma/duruslar": LOOM_STOP_DIMS,
  "finance/masraf-ozeti": EXPENSE_SUMMARY_DIMS,
} as const;

type Cell = Parameters<CoreRunner>[2];
const only = (cell: Cell, boyut: string): string[] | undefined => (cell && cell.boyut === boyut ? [cell.deger] : undefined);

export interface OrderDemandFilters { customerId?: string[]; destination?: ShipmentDestination; itemId?: string[] }
export function orderDemandRunner(filters: OrderDemandFilters, compareMode: CompareMode): CoreRunner {
  return (range, compareRange, cell) =>
    buildOrderDemandReport({
      range, compareRange, compareMode,
      filters: {
        customerId: only(cell, "musteri") ?? filters.customerId,
        itemId: only(cell, "urun") ?? filters.itemId,
        destination: cell?.boyut === "yon" ? (cell.deger as ShipmentDestination) : filters.destination,
      },
    });
}

export function shippedRunner(destination: ShipmentDestination | undefined, compareMode: CompareMode): CoreRunner {
  return (range, compareRange, cell) =>
    buildShippedReport({ range, compareRange, compareMode, filters: { destination: cell?.boyut === "yon" ? (cell.deger as ShipmentDestination) : destination } });
}

export function deadlineRunner(destination: ShipmentDestination | undefined, compareMode: CompareMode): CoreRunner {
  return (range, compareRange, cell) =>
    buildDeadlineReport({ range, compareRange, compareMode, filters: { destination: cell?.boyut === "yon" ? (cell.deger as ShipmentDestination) : destination } });
}

/** Kesit: aralık okunmaz (dönem sütunları `snapshotOnly` ile ölçülemedi döner). */
export function openOrderRunner(itemId: string[] | undefined): CoreRunner {
  return (_range, _compareRange, cell) => buildOpenOrderReport({ filters: { itemId: only(cell, "urun") ?? itemId } });
}

export interface SubcontractorFilters { subcontractorId?: string[]; itemId?: string[]; colorId?: string[] }
export function subcontractorRunner(filters: SubcontractorFilters, compareMode: CompareMode): CoreRunner {
  return (range, compareRange, cell) =>
    buildSubcontractorsReport({ range, compareRange, compareMode, filters: { ...filters, subcontractorId: only(cell, "fasoncu") ?? filters.subcontractorId } });
}

/** Mutlak aralık → fabrika günü penceresi (dokuma kaynakları `YYYY-MM-DD` alır). */
export function dayWindowOf(range: DateRange, compareRange: DateRange | null, mode: CompareMode): ResolvedDayRange {
  return {
    days: { from: factoryYmd(range.from), to: factoryYmd(range.to) },
    range,
    mode,
    compareDays: compareRange ? { from: factoryYmd(compareRange.from), to: factoryYmd(compareRange.to) } : null,
    compareRange,
  };
}

export function loomStopsRunner(shiftDefinitionId: string[] | undefined, mode: CompareMode): CoreRunner {
  return (range, compareRange, cell) =>
    buildLoomStopsReport({ window: dayWindowOf(range, compareRange, mode), shiftDefinitionId: only(cell, "vardiya") ?? shiftDefinitionId });
}

/**
 * Masraf özeti: hücre = masrafın ASIL para birimiyle süzülmüş özet (tutar yine TL karşılığı). Havuz ana koşunun
 * para birimi kırılımından (TL azalan). `onMain` ilk (ana) koşunun özetini verir — uç `detay`ı ondan basar.
 */
export function expenseSummaryRunner(main: ResolvedDayRange, currency: Currency[] | undefined, onMain: (s: ExpenseSummary) => void): CoreRunner {
  let first = true;
  return async (range, compareRange, cell) => {
    const cur = cell?.boyut === "paraBirimi" ? [cell.deger as Currency] : currency;
    const summary = await getExpenseSummary({ range, currency: cur });
    const previous = compareRange ? await getExpenseSummary({ range: compareRange, currency: cur }) : null;
    if (first) { first = false; onMain(summary); }
    const window = range === main.range && compareRange === main.compareRange ? main : dayWindowOf(range, compareRange, main.mode);
    return {
      sunum: buildExpenseSummarySunumu(summary, window, previous, cur),
      kirilimlar: { paraBirimi: summary.currencies.map((c) => ({ deger: c.currency, etiket: currencyName(c.currency) })) },
    };
  };
}
