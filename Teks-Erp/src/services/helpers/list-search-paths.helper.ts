import type { ListSearchPaths } from "../../utils/list-search";

/**
 * Liste aramasında tekrar eden ilişki yolları — aynı varlığı arayan uçlar AYNI yolu kullansın.
 * `prefix` ilişkinin adı ("cari", "machine"); kova ayrımı (`text` Fold gölgeli, `code` BÜYÜK ASCII) burada sabit.
 */
export function cariSearchPaths(prefix: string): ListSearchPaths {
  return {
    text: [`${prefix}.customer.name`, `${prefix}.subcontractor.name`],
    code: [`${prefix}.customer.code`, `${prefix}.subcontractor.code`],
  };
}

/** Makine (tezgah) — kod + katlanmış ad. */
export function machineSearchPaths(prefix: string): ListSearchPaths {
  return { text: [`${prefix}.name`], code: [`${prefix}.code`] };
}

/** Birden çok yol kümesini tek kümeye birleştirir (kova kova). */
export function mergeSearchPaths(...sets: ListSearchPaths[]): ListSearchPaths {
  return {
    text: sets.flatMap((s) => s.text ?? []),
    code: sets.flatMap((s) => s.code ?? []),
    plain: sets.flatMap((s) => s.plain ?? []),
  };
}

/** Satın alma bekleyen kalemi — sipariş no, ürün ad/kod, tedarikçi (müşteri kartı ya da fason) ad/kod. */
export const PURCHASE_OPEN_LINE_SEARCH: ListSearchPaths = {
  text: ["item.name", "purchaseOrder.supplier.name", "purchaseOrder.subcontractorSupplier.name"],
  code: ["purchaseOrder.orderNo", "item.code", "purchaseOrder.supplier.code", "purchaseOrder.subcontractorSupplier.code"],
};
